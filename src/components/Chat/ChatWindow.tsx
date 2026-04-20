import { useCallback, useRef, useState } from 'react';
import Logo from '../common/Logo';
import Button from '../common/Button';
import MessageList from './MessageList';
import InputBox from './InputBox';
import ApprovalModal from './ApprovalModal';
import SettingsPanel from '../Settings/SettingsPanel';
import { respondToApproval, streamChat } from '../../lib/sidecar';
import type {
  ApprovalRequest,
  AssistantEvent,
  Config,
  Lang,
  Message,
  TextEvent,
  ThinkingEvent,
  ToolEvent,
} from '../../types';
import './ChatWindow.css';

const COPY = {
  en: { newChat: 'NEW', settings: 'SETTINGS' },
  zh: { newChat: '新对话', settings: '设置' },
};

interface Props {
  lang: Lang;
  onLangChange: (l: Lang) => void;
  config: Config | null;
  onConfigChanged: (c: Config) => void;
}

/* Helpers for mutating the tail assistant message's event list immutably. */

function updateAssistant(
  msgs: Message[],
  id: string,
  fn: (m: Message) => Message,
): Message[] {
  return msgs.map((m) => (m.id === id ? fn(m) : m));
}

function appendTextEvent(events: AssistantEvent[], text: string): AssistantEvent[] {
  if (!text) return events;
  // Coalesce consecutive text events into a single markdown block so lists
  // / code fences stay coherent as tokens trickle in.
  const last = events[events.length - 1];
  if (last && last.kind === 'text') {
    const next: TextEvent = { kind: 'text', text: last.text + text };
    return [...events.slice(0, -1), next];
  }
  return [...events, { kind: 'text', text }];
}

function appendThinkingEvent(
  events: AssistantEvent[],
  chunk: string,
): AssistantEvent[] {
  if (!chunk) return events;
  // Similarly coalesce consecutive thinking deltas.
  const last = events[events.length - 1];
  if (last && last.kind === 'thinking') {
    const next: ThinkingEvent = { kind: 'thinking', text: last.text + chunk };
    return [...events.slice(0, -1), next];
  }
  return [...events, { kind: 'thinking', text: chunk }];
}

function upsertTool(
  events: AssistantEvent[],
  id: string,
  mutate: (t: ToolEvent) => ToolEvent,
): AssistantEvent[] {
  const idx = events.findIndex((e) => e.kind === 'tool' && e.id === id);
  if (idx === -1) return events;
  const next = [...events];
  next[idx] = mutate(next[idx] as ToolEvent);
  return next;
}

export default function ChatWindow({
  lang,
  onLangChange,
  config,
  onConfigChanged,
}: Props) {
  const L = COPY[lang];

  const [messages, setMessages] = useState<Message[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [approval, setApproval] = useState<ApprovalRequest | null>(null);

  // Queue of approvals that arrived while another one is already shown.
  // Kept in a ref (not state) so the resolver callback sees the latest queue.
  const approvalQueueRef = useRef<ApprovalRequest[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  const showNextApproval = useCallback(() => {
    const next = approvalQueueRef.current.shift() || null;
    setApproval(next);
  }, []);

  const handleApprovalResolve = useCallback(
    (allow: boolean, remember: boolean) => {
      const current = approval;
      if (!current) return;
      // Close immediately — don't block on the network round-trip.
      setApproval(null);
      respondToApproval(current.request_id, allow, remember).catch((err) => {
        console.warn('approval post failed', err);
      });
      // If more approvals queued up while we were deciding, show the next one.
      // Next frame so the unmount animation (if any) settles first.
      setTimeout(showNextApproval, 0);
    },
    [approval, showNextApproval],
  );

  function handleSend(text: string) {
    const trimmed = text.trim();
    if (!trimmed || streaming) return;

    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: trimmed,
    };
    const assistantId = crypto.randomUUID();
    const assistantMsg: Message = {
      id: assistantId,
      role: 'assistant',
      content: '',
      streaming: true,
      events: [],
    };
    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setStreaming(true);

    const history = [...messages, userMsg].map((m) => ({
      role: m.role,
      content: m.content,
    }));

    abortRef.current = streamChat(history, {
      onToken: (txt) => {
        setMessages((prev) =>
          updateAssistant(prev, assistantId, (m) => ({
            ...m,
            content: m.content + txt,
            events: appendTextEvent(m.events || [], txt),
          })),
        );
      },
      onThinking: (txt) => {
        setMessages((prev) =>
          updateAssistant(prev, assistantId, (m) => ({
            ...m,
            events: appendThinkingEvent(m.events || [], txt),
          })),
        );
      },
      onToolStart: (t) => {
        setMessages((prev) =>
          updateAssistant(prev, assistantId, (m) => ({
            ...m,
            events: [
              ...(m.events || []),
              {
                kind: 'tool',
                id: t.id,
                name: t.name,
                args: t.args,
                preview: t.preview,
                output: '',
              } as ToolEvent,
            ],
          })),
        );
      },
      onToolOutput: (id, chunk) => {
        setMessages((prev) =>
          updateAssistant(prev, assistantId, (m) => ({
            ...m,
            events: upsertTool(m.events || [], id, (t) => ({
              ...t,
              output: t.output + chunk,
            })),
          })),
        );
      },
      onToolResult: (id, result) => {
        setMessages((prev) =>
          updateAssistant(prev, assistantId, (m) => ({
            ...m,
            events: upsertTool(m.events || [], id, (t) => ({
              ...t,
              result,
            })),
          })),
        );
      },
      onApprovalRequest: (req) => {
        // Modal is app-level, not message-level. Show immediately if idle;
        // otherwise queue.
        setApproval((current) => {
          if (current) {
            approvalQueueRef.current.push(req);
            return current;
          }
          return req;
        });
      },
      onStep: (step) => {
        setMessages((prev) =>
          updateAssistant(prev, assistantId, (m) => ({ ...m, step })),
        );
      },
      onStatus: (txt) => {
        setMessages((prev) =>
          updateAssistant(prev, assistantId, (m) => ({ ...m, status: txt })),
        );
      },
      onDone: () => {
        setMessages((prev) =>
          updateAssistant(prev, assistantId, (m) => ({
            ...m,
            streaming: false,
            status: undefined,
          })),
        );
        setStreaming(false);
        abortRef.current = null;
      },
      onError: (msg) => {
        setMessages((prev) =>
          updateAssistant(prev, assistantId, (m) => {
            const errorText = `_connection error:_ \`${msg.replace(/`/g, "'")}\``;
            const events = (m.events || []).concat({
              kind: 'text',
              text: `\n\n${errorText}`,
            });
            return {
              ...m,
              streaming: false,
              status: undefined,
              content: m.content || errorText,
              events,
            };
          }),
        );
        setStreaming(false);
        abortRef.current = null;
      },
    });
  }

  function handleStop() {
    abortRef.current?.abort();
    abortRef.current = null;
    setStreaming(false);
    setMessages((prev) =>
      prev.map((m) =>
        m.streaming ? { ...m, streaming: false, status: undefined } : m,
      ),
    );
    // Clear any pending approvals that belong to the cancelled run.
    approvalQueueRef.current = [];
    setApproval(null);
  }

  function handleNewChat() {
    if (streaming) handleStop();
    setMessages([]);
  }

  return (
    <div className="chat-root">
      <header className="chat-topbar">
        <div className="row" style={{ gap: 14 }}>
          <Logo size="sm" />
        </div>
        <div className="row" style={{ gap: 10 }}>
          <Button size="sm" variant="secondary" onClick={handleNewChat}>
            + {L.newChat}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setSettingsOpen(true)}
          >
            ⚙ {L.settings}
          </Button>
        </div>
      </header>

      <div className="chat-body">
        <main className="chat-center">
          <MessageList messages={messages} lang={lang} />
          <InputBox
            lang={lang}
            streaming={streaming}
            onSend={handleSend}
            onStop={handleStop}
          />
        </main>
      </div>

      <SettingsPanel
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        lang={lang}
        onLangChange={onLangChange}
        config={config}
        onConfigChanged={onConfigChanged}
      />

      <ApprovalModal
        request={approval}
        lang={lang}
        onResolve={handleApprovalResolve}
      />
    </div>
  );
}

import { useCallback, useEffect, useRef, useState } from 'react';
import Logo from '../common/Logo';
import Button from '../common/Button';
import ModelPicker from './ModelPicker';
import MessageList from './MessageList';
import InputBox from './InputBox';
import ApprovalModal from './ApprovalModal';
import SettingsPanel from '../Settings/SettingsPanel';
import ConversationSidebar from './ConversationSidebar';
import ConfirmDeleteModal from './ConfirmDeleteModal';
import { respondToApproval, saveConfig, streamChat } from '../../lib/sidecar';
import {
  deriveTitle,
  getMessages,
  getMostRecentConversationId,
  openDb,
  updateConversationTimestamp,
  upsertMessage,
  vacuumOldDeletions,
} from '../../lib/db';
import { conversationToMarkdown, sanitizeFilename } from '../../lib/exportMarkdown';
import { useConversations } from '../../hooks/useConversations';
import type {
  ApprovalRequest,
  AssistantEvent,
  Config,
  Lang,
  Message,
  SearchHit,
  StoredMessage,
  TextEvent,
  ThinkingEvent,
  ToolEvent,
} from '../../types';
import { save as showSaveDialog } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import './ChatWindow.css';

const COPY = {
  en: { settings: 'SETTINGS' },
  zh: { settings: '设置' },
};

interface Props {
  lang: Lang;
  onLangChange: (l: Lang) => void;
  config: Config | null;
  onConfigChanged: (c: Config) => void;
}

function updateAssistant(
  msgs: Message[],
  id: string,
  fn: (m: Message) => Message,
): Message[] {
  return msgs.map((m) => (m.id === id ? fn(m) : m));
}

function appendTextEvent(events: AssistantEvent[], text: string): AssistantEvent[] {
  if (!text) return events;
  const last = events[events.length - 1];
  if (last && last.kind === 'text') {
    const next: TextEvent = { kind: 'text', text: last.text + text };
    return [...events.slice(0, -1), next];
  }
  return [...events, { kind: 'text', text }];
}

function appendThinkingEvent(events: AssistantEvent[], chunk: string): AssistantEvent[] {
  if (!chunk) return events;
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

function storedToMessage(s: StoredMessage): Message {
  return {
    id: s.id,
    role: s.role,
    content: s.content,
    events: s.events,
    step: s.step,
    streaming: false,
  };
}

export default function ChatWindow({
  lang,
  onLangChange,
  config,
  onConfigChanged,
}: Props) {
  const L = COPY[lang];
  const convs = useConversations();

  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [approval, setApproval] = useState<ApprovalRequest | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => localStorage.getItem('ui.sidebar_collapsed') === 'true',
  );
  const [confirmDelete, setConfirmDelete] = useState<string[] | null>(null);
  const [dbReady, setDbReady] = useState(false);

  const approvalQueueRef = useRef<ApprovalRequest[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    (async () => {
      try {
        await openDb();
        await vacuumOldDeletions();
        setDbReady(true);
        const id = await getMostRecentConversationId();
        if (id) {
          setConversationId(id);
          const stored = await getMessages(id);
          setMessages(stored.map(storedToMessage));
        }
      } catch (e) {
        console.error('DB init failed, running in-memory mode', e);
        setDbReady(false);
      }
    })();
  }, []);

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((v) => {
      const next = !v;
      localStorage.setItem('ui.sidebar_collapsed', String(next));
      return next;
    });
  }, []);

  const loadConversation = useCallback(async (id: string) => {
    if (streaming) return;
    try {
      const stored = await getMessages(id);
      setMessages(stored.map(storedToMessage));
      setConversationId(id);
    } catch (e) {
      console.error('failed to load conversation', e);
    }
  }, [streaming]);

  const showNextApproval = useCallback(() => {
    const next = approvalQueueRef.current.shift() || null;
    setApproval(next);
  }, []);

  const handleApprovalResolve = useCallback(
    (allow: boolean, remember: boolean) => {
      const current = approval;
      if (!current) return;
      setApproval(null);
      respondToApproval(current.request_id, allow, remember).catch((err) => {
        console.warn('approval post failed', err);
      });
      setTimeout(showNextApproval, 0);
    },
    [approval, showNextApproval],
  );

  const schedulePersist = useCallback(
    (msg: Message, convId: string) => {
      if (!dbReady) return;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(async () => {
        try {
          const stored: StoredMessage = {
            id: msg.id,
            conversation_id: convId,
            role: msg.role,
            content: msg.content,
            events: msg.events,
            step: msg.step,
            created_at: Date.now(),
          };
          await upsertMessage(stored);
        } catch (e) {
          console.warn('debounced persist failed', e);
        }
      }, 500);
    },
    [dbReady],
  );

  const flushPersist = useCallback(
    async (msg: Message, convId: string) => {
      if (!dbReady) return;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      try {
        const stored: StoredMessage = {
          id: msg.id,
          conversation_id: convId,
          role: msg.role,
          content: msg.content,
          events: msg.events,
          step: msg.step,
          created_at: Date.now(),
        };
        await upsertMessage(stored);
        await updateConversationTimestamp(convId);
        convs.refresh();
      } catch (e) {
        console.warn('final persist failed', e);
      }
    },
    [dbReady, convs],
  );

  async function handleSend(text: string) {
    const trimmed = text.trim();
    if (!trimmed || streaming) return;

    let convId = conversationId;
    if (!convId && dbReady) {
      convId = crypto.randomUUID();
      const title = deriveTitle(trimmed);
      try {
        await convs.create(convId, title);
        setConversationId(convId);
      } catch (e) {
        console.error('failed to create conversation', e);
      }
    }
    if (!convId) convId = crypto.randomUUID();

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

    if (dbReady) {
      try {
        const stored: StoredMessage = {
          id: userMsg.id,
          conversation_id: convId,
          role: 'user',
          content: userMsg.content,
          created_at: Date.now(),
        };
        await upsertMessage(stored);
        await updateConversationTimestamp(convId);
      } catch (e) {
        console.warn('user message persist failed', e);
      }
    }

    const history = [...messages, userMsg].map((m) => ({
      role: m.role,
      content: m.content,
    }));

    const capturedConvId = convId;

    abortRef.current = streamChat(history, {
      onToken: (txt) => {
        setMessages((prev) => {
          const updated = updateAssistant(prev, assistantId, (m) => ({
            ...m,
            content: m.content + txt,
            events: appendTextEvent(m.events || [], txt),
          }));
          const msg = updated.find((m) => m.id === assistantId);
          if (msg) schedulePersist(msg, capturedConvId);
          return updated;
        });
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
                auto_allowed: t.auto_allowed,
                allowed_until_ms: t.allowed_until_ms,
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
        setMessages((prev) => {
          const updated = updateAssistant(prev, assistantId, (m) => ({
            ...m,
            streaming: false,
            status: undefined,
          }));
          const msg = updated.find((m) => m.id === assistantId);
          if (msg) flushPersist(msg, capturedConvId);
          return updated;
        });
        setStreaming(false);
        abortRef.current = null;
      },
      onError: (msg) => {
        setMessages((prev) => {
          const errorText = `_connection error:_ \`${msg.replace(/`/g, "'")}\``;
          const updated = updateAssistant(prev, assistantId, (m) => {
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
          });
          const finalMsg = updated.find((m) => m.id === assistantId);
          if (finalMsg) flushPersist(finalMsg, capturedConvId);
          return updated;
        });
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
    approvalQueueRef.current = [];
    setApproval(null);
  }

  function handleNewChat() {
    if (streaming) handleStop();
    setMessages([]);
    setConversationId(null);
  }

  async function handleSelectConversation(id: string) {
    if (id === conversationId) return;
    if (streaming) handleStop();
    await loadConversation(id);
  }

  async function handleDeleteConversation(id: string, title: string) {
    await convs.remove(id, title);
    if (id === conversationId) {
      const nextId = await getMostRecentConversationId();
      if (nextId) {
        await loadConversation(nextId);
      } else {
        setMessages([]);
        setConversationId(null);
      }
    }
  }

  async function handleDeleteMany(ids: string[]) {
    setConfirmDelete(ids);
  }

  async function confirmDeleteMany() {
    if (!confirmDelete) return;
    await convs.removeMany(confirmDelete);
    if (confirmDelete.includes(conversationId ?? '')) {
      const nextId = await getMostRecentConversationId();
      if (nextId) await loadConversation(nextId);
      else { setMessages([]); setConversationId(null); }
    }
    setConfirmDelete(null);
  }

  async function handleExport(id: string) {
    try {
      const stored = await getMessages(id);
      const conv = convs.conversations.find((c) => c.id === id);
      const title = conv?.title ?? 'conversation';
      const md = conversationToMarkdown(title, stored);
      const path = await showSaveDialog({
        defaultPath: `${sanitizeFilename(title)}.md`,
        filters: [{ name: 'Markdown', extensions: ['md'] }],
      });
      if (path) {
        await invoke('write_text_file', { path, content: md });
      }
    } catch (e) {
      console.error('export failed', e);
    }
  }

  async function handleExportMany(ids: string[]) {
    for (const id of ids) {
      await handleExport(id);
    }
  }

  async function handleModelChange(model: string) {
    if (!config) return;
    try {
      await saveConfig({ provider: config.provider, model });
      onConfigChanged({ ...config, model });
    } catch (e) {
      console.error('model change failed', e);
    }
  }

  function handleSearchSelect(hit: SearchHit) {
    handleSelectConversation(hit.conversation_id);
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key === 'n') { e.preventDefault(); handleNewChat(); }
      if (mod && e.key === '\\') { e.preventDefault(); toggleSidebar(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleSidebar, streaming]);

  return (
    <div className="chat-root">
      <header className="chat-topbar">
        <div className="row" style={{ gap: 14 }}>
          <Logo size="sm" />
        </div>
        <div className="row" style={{ gap: 10 }}>
          <ModelPicker
            provider={config?.provider ?? 'openai'}
            model={config?.model ?? ''}
            onModelChange={handleModelChange}
          />
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
        <ConversationSidebar
          lang={lang}
          conversations={convs.conversations}
          currentId={conversationId}
          collapsed={sidebarCollapsed}
          undo={convs.undo}
          onToggleCollapse={toggleSidebar}
          onSelect={handleSelectConversation}
          onNew={handleNewChat}
          onRename={convs.rename}
          onPin={convs.pin}
          onDelete={handleDeleteConversation}
          onDeleteMany={handleDeleteMany}
          onExport={handleExport}
          onExportMany={handleExportMany}
          onUndo={convs.undoDelete}
          onDismissUndo={convs.dismissUndo}
          onSearchSelect={handleSearchSelect}
        />
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

      <ConfirmDeleteModal
        lang={lang}
        count={confirmDelete?.length ?? 0}
        open={confirmDelete !== null}
        onConfirm={confirmDeleteMany}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  );
}

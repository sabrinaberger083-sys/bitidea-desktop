import { useRef, useState } from 'react';
import Logo from '../common/Logo';
import Button from '../common/Button';
import MessageList from './MessageList';
import InputBox from './InputBox';
import SettingsPanel from '../Settings/SettingsPanel';
import { streamChat } from '../../lib/sidecar';
import type { Config, Lang, Message } from '../../types';
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

  const abortRef = useRef<AbortController | null>(null);

  function handleSend(text: string) {
    const trimmed = text.trim();
    if (!trimmed || streaming) return;

    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: trimmed,
    };
    const assistantMsg: Message = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: '',
      streaming: true,
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
          prev.map((m) =>
            m.id === assistantMsg.id ? { ...m, content: m.content + txt } : m,
          ),
        );
      },
      onDone: () => {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsg.id ? { ...m, streaming: false } : m,
          ),
        );
        setStreaming(false);
        abortRef.current = null;
      },
      onError: (msg) => {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsg.id
              ? {
                  ...m,
                  streaming: false,
                  content:
                    m.content ||
                    `_connection error:_ \`${msg.replace(/`/g, "'")}\``,
                }
              : m,
          ),
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
      prev.map((m) => (m.streaming ? { ...m, streaming: false } : m)),
    );
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
    </div>
  );
}

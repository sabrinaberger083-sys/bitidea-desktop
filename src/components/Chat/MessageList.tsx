import { useEffect, useRef } from 'react';
import MessageView from './Message';
import type { Artifact } from '../../lib/artifacts';
import type { Lang, Message } from '../../types';
import './MessageList.css';

const COPY = {
  en: {
    title: 'Ready when you are',
    sub: 'Ask anything, paste code, brainstorm. Bitidea will stream its reply in real time.',
    hint1: 'Cmd+Enter to send',
    hint2: 'Shift+Enter for newline',
  },
  zh: {
    title: '准备就绪',
    sub: '任意提问、粘贴代码、头脑风暴，Bitidea 会实时流式回答。',
    hint1: 'Cmd+Enter 发送',
    hint2: 'Shift+Enter 换行',
  },
};

interface Props {
  messages: Message[];
  lang: Lang;
  onPreviewArtifact?: (artifact: Artifact) => void;
}

export default function MessageList({ messages, lang, onPreviewArtifact }: Props) {
  const L = COPY[lang];
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const lastContentLen = useRef(0);

  // Auto-scroll on new tokens / new messages, unless the user scrolled up.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const last = messages[messages.length - 1];
    const totalLen =
      messages.reduce((n, m) => n + m.content.length, 0) + messages.length;
    const nearBottom =
      el.scrollHeight - el.scrollTop - el.clientHeight < 160;
    const grew = totalLen > lastContentLen.current;
    lastContentLen.current = totalLen;
    if (grew && (nearBottom || last?.role === 'user')) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages]);

  if (messages.length === 0) {
    return (
      <div className="ml-empty">
        <div className="ml-empty-title">{L.title}</div>
        <div className="ml-empty-sub">{L.sub}</div>
        <div className="ml-empty-hints">
          <kbd>⌘</kbd> <kbd>↵</kbd> <span>{L.hint1}</span>
          <span className="divider" aria-hidden>·</span>
          <kbd>⇧</kbd> <kbd>↵</kbd> <span>{L.hint2}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="ml-scroller" ref={scrollerRef}>
      <div className="ml-inner">
        {messages.map((m) => (
          <MessageView key={m.id} message={m} onPreviewArtifact={onPreviewArtifact} />
        ))}
      </div>
    </div>
  );
}

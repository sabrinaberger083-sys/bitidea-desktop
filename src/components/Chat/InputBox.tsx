import { useEffect, useRef, useState } from 'react';
import Button from '../common/Button';
import type { Lang } from '../../types';
import './InputBox.css';

const COPY = {
  en: {
    placeholder: 'Type your message — Cmd+Enter to send, Shift+Enter for newline',
    send: 'SEND',
    stop: 'STOP',
  },
  zh: {
    placeholder: '输入内容 — Cmd+Enter 发送，Shift+Enter 换行',
    send: '发送',
    stop: '停止',
  },
};

interface Props {
  lang: Lang;
  streaming: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
}

const LINE_HEIGHT_PX = 22;
const MIN_LINES = 1;
const MAX_LINES = 10;

export default function InputBox({ lang, streaming, onSend, onStop }: Props) {
  const L = COPY[lang];
  const [text, setText] = useState('');
  const ref = useRef<HTMLTextAreaElement | null>(null);

  // Auto-grow the textarea up to MAX_LINES.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    const max = LINE_HEIGHT_PX * MAX_LINES + 24;
    el.style.height = Math.min(el.scrollHeight, max) + 'px';
  }, [text]);

  function submit() {
    if (!text.trim() || streaming) return;
    onSend(text);
    setText('');
    requestAnimationFrame(() => ref.current?.focus());
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    const mod = e.metaKey || e.ctrlKey;
    if (e.key === 'Enter' && mod && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  const minHeight = LINE_HEIGHT_PX * MIN_LINES + 24;

  return (
    <div className="input-wrap">
      <div className="input-bar">
        <textarea
          ref={ref}
          className="textarea mono-ish"
          placeholder={L.placeholder}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          rows={1}
          style={{ minHeight }}
          disabled={streaming}
        />
        {streaming ? (
          <Button variant="danger" size="md" onClick={onStop}>
            ■ {L.stop}
          </Button>
        ) : (
          <Button
            variant="primary"
            size="md"
            arrow
            onClick={submit}
            disabled={!text.trim()}
          >
            {L.send}
          </Button>
        )}
      </div>
    </div>
  );
}

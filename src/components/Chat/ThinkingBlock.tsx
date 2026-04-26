import { useEffect, useRef, useState } from 'react';
import type { Lang } from '../../types';
import './ThinkingBlock.css';

interface Props {
  text: string;
  lang: Lang;
  live?: boolean;
  statusText?: string;
}

const COPY = {
  en: {
    label: 'THINKING',
    pending: 'Thinking...',
    liveSummary: 'Click to view live',
    summary: 'Click to view',
  },
  zh: {
    label: '思考过程',
    pending: '正在思考...',
    liveSummary: '点击展开实时查看',
    summary: '点击展开查看',
  },
} as const;

/** Collapsible reasoning trace. Closed by default; if the user opens it
 *  while the model is still thinking, content continues streaming inside. */
export default function ThinkingBlock({
  text,
  lang,
  live = false,
  statusText,
}: Props) {
  const L = COPY[lang];
  const [open, setOpen] = useState(false);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const hasText = !!text.trim();
  const displayText = hasText ? text : (statusText?.trim() || L.pending);

  useEffect(() => {
    if (!open || !live || !bodyRef.current) return;
    bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [open, live, text, statusText]);

  if (!hasText && !live) return null;

  return (
    <div className={`think-card ${live ? 'think-live' : ''}`}>
      <button
        type="button"
        className="think-head"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="think-glyph" aria-hidden>◆</span>
        <span className="think-label">{L.label}</span>
        {live && <span className="think-live-dot" aria-hidden>●</span>}
        {!open && (
          <span className="think-summary">
            {live ? L.liveSummary : L.summary}
          </span>
        )}
        <span className="think-caret" aria-hidden>
          {open ? '▾' : '▸'}
        </span>
      </button>
      {open && (
        <div
          ref={bodyRef}
          className={`think-body ${!hasText ? 'think-body-pending' : ''}`}
          aria-live={live ? 'polite' : undefined}
        >
          <span>{displayText}</span>
          {live && <span className="think-stream-caret" aria-hidden>▍</span>}
        </div>
      )}
    </div>
  );
}

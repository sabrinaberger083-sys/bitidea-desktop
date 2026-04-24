import { useEffect, useRef, useState } from 'react';
import './ThinkingBlock.css';

interface Props {
  text: string;
  live?: boolean;
  statusText?: string;
}

/** Collapsible reasoning trace. Closed by default; if the user opens it
 *  while the model is still thinking, content continues streaming inside. */
export default function ThinkingBlock({ text, live = false, statusText }: Props) {
  const [open, setOpen] = useState(false);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const hasText = !!text.trim();
  const displayText = hasText ? text : (statusText?.trim() || '正在思考…');

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
        <span className="think-label">THINKING</span>
        {live && <span className="think-live-dot" aria-hidden>●</span>}
        {!open && (
          <span className="think-summary">
            {live ? '点击展开实时查看' : '点击展开查看'}
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

import { useState } from 'react';
import './ThinkingBlock.css';

interface Props {
  text: string;
  /** When true, the block is always expanded regardless of internal state
   *  (e.g. still streaming — we want the user to watch it think). */
  live?: boolean;
}

/** Dimmed italic thinking/reasoning trace in a ◆ THINKING framed section. */
export default function ThinkingBlock({ text, live = false }: Props) {
  const [open, setOpen] = useState(live);

  if (!text.trim()) return null;

  return (
    <div className={`think-card ${live ? 'think-live' : ''}`}>
      <button
        type="button"
        className="think-head"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open || live}
      >
        <span className="think-glyph" aria-hidden>◆</span>
        <span className="think-label">THINKING</span>
        {live && <span className="think-live-dot" aria-hidden>●</span>}
        <span className="think-caret" aria-hidden>
          {open || live ? '▾' : '▸'}
        </span>
      </button>
      {(open || live) && <div className="think-body">{text}</div>}
    </div>
  );
}

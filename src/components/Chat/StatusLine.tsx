import './StatusLine.css';

interface Props {
  text?: string;
}

/** Single-line ephemeral status ("Planning…", "Running shell…") rendered
 *  directly below an in-flight assistant message. */
export default function StatusLine({ text }: Props) {
  if (!text) return null;
  return (
    <div className="status-line" aria-live="polite">
      <span className="status-dot" aria-hidden>›</span>
      <span className="status-text">{text}</span>
    </div>
  );
}

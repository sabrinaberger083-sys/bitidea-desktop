import { useEffect, useRef, useState } from 'react';
import Button from '../common/Button';
import type { ApprovalRequest, Lang } from '../../types';
import './ApprovalModal.css';

const COPY = {
  en: {
    title: 'PERMISSION REQUIRED',
    sub: 'The agent wants to run a command that was flagged as potentially dangerous.',
    remember: 'Remember for 60 seconds',
    allow: 'Allow',
    deny: 'Deny',
    hintAllow: '↵ / ⌘↵',
    hintDeny: 'Esc',
    name: 'RULE',
    cmd: 'COMMAND',
  },
  zh: {
    title: '需要授权',
    sub: '代理准备执行一条被标记为潜在危险的命令。',
    remember: '记住 60 秒',
    allow: '允许',
    deny: '拒绝',
    hintAllow: '↵ / ⌘↵',
    hintDeny: 'Esc',
    name: '规则',
    cmd: '命令',
  },
};

interface Props {
  request: ApprovalRequest | null;
  lang: Lang;
  onResolve: (allow: boolean, remember: boolean) => void;
}

/** Centered modal that blocks the agent until the user decides. Keyboard
 *  shortcuts: Enter / Cmd+Enter = Allow, Esc = Deny. */
export default function ApprovalModal({ request, lang, onResolve }: Props) {
  const L = COPY[lang];
  const [remember, setRemember] = useState(false);
  const allowRef = useRef<HTMLButtonElement | null>(null);

  // Reset "remember" checkbox every time a new request comes in, and focus
  // the Allow button so Enter works immediately.
  useEffect(() => {
    if (!request) return;
    setRemember(false);
    // Next frame to win focus vs. any re-render.
    const t = setTimeout(() => allowRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [request?.request_id]);

  useEffect(() => {
    if (!request) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onResolve(false, false);
      } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey || document.activeElement === allowRef.current)) {
        e.preventDefault();
        onResolve(true, remember);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [request, remember, onResolve]);

  if (!request) return null;

  const args = request.args || {};
  const command = typeof args.command === 'string' ? (args.command as string) : '';
  const description =
    typeof args.description === 'string' ? (args.description as string) : request.tool_name;

  return (
    <div
      className="approve-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="approve-title"
    >
      <div className="approve-card">
        <div className="approve-head">
          <span className="approve-glyph" aria-hidden>⚠</span>
          <span id="approve-title" className="approve-title">
            {L.title}
          </span>
        </div>
        <p className="approve-sub">{L.sub}</p>

        <dl className="approve-meta">
          <dt>{L.name}</dt>
          <dd>{description}</dd>
          {command && (
            <>
              <dt>{L.cmd}</dt>
              <dd>
                <pre className="approve-cmd">{command}</pre>
              </dd>
            </>
          )}
          {!command && request.preview && (
            <>
              <dt>{L.cmd}</dt>
              <dd>
                <pre className="approve-cmd">{request.preview}</pre>
              </dd>
            </>
          )}
        </dl>

        <label className="approve-remember">
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
          />
          <span>{L.remember}</span>
        </label>

        <div className="approve-actions">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => onResolve(false, false)}
          >
            {L.deny}
            <span className="approve-hint">{L.hintDeny}</span>
          </Button>
          <Button
            ref={allowRef}
            variant="primary"
            size="sm"
            onClick={() => onResolve(true, remember)}
          >
            {L.allow}
            <span className="approve-hint">{L.hintAllow}</span>
          </Button>
        </div>
      </div>
    </div>
  );
}

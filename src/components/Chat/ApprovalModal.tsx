import { useEffect, useRef, useState } from 'react';
import Button from '../common/Button';
import type { ApprovalMode, ApprovalRequest, Lang, Severity } from '../../types';
import { renderToolPreview } from './renderToolPreview';
import './ApprovalModal.css';

type TierCopy = {
  title: string;
  sub: string;
};

const SEV_CONFIG: Record<
  Severity,
  { glyph: string; cls: string; copy: Record<Lang, TierCopy> }
> = {
  read: {
    glyph: 'ℹ',
    cls: 'approve-read',
    copy: {
      zh: { title: '读取', sub: '代理想读取以下资源。' },
      en: { title: 'Read', sub: 'The agent wants to read:' },
    },
  },
  write: {
    glyph: '◆',
    cls: 'approve-write',
    copy: {
      zh: { title: '修改', sub: '代理想修改以下内容。' },
      en: { title: 'Modify', sub: 'The agent wants to modify:' },
    },
  },
  destructive: {
    glyph: '⚠',
    cls: 'approve-destructive',
    copy: {
      zh: {
        title: '不可逆操作',
        sub: '代理想执行一个无法撤回的操作，请确认后再继续。',
      },
      en: {
        title: 'Irreversible',
        sub: 'The agent wants to take an irreversible action. Confirm before proceeding.',
      },
    },
  },
  network: {
    glyph: '→',
    cls: 'approve-network',
    copy: {
      zh: { title: '网络请求', sub: '代理想向外部服务发起请求。' },
      en: { title: 'Network', sub: 'The agent wants to reach an external service:' },
    },
  },
  unknown: {
    glyph: '◆',
    cls: 'approve-write', // visual alias of write (amber, cautious)
    copy: {
      zh: { title: '未分类操作', sub: '代理想执行一个未知类别的操作。' },
      en: { title: 'Unclassified', sub: 'The agent wants to take an action we could not classify:' },
    },
  },
};

const SHARED_COPY = {
  en: {
    remember: 'Remember for 60 seconds',
    always: 'Always allow',
    allow: 'Allow',
    deny: 'Deny',
    hintDeny: 'Esc',
    persistLabel: 'Approval scope',
  },
  zh: {
    remember: '记住 60 秒',
    always: '永远允许',
    allow: '允许',
    deny: '拒绝',
    hintDeny: 'Esc',
    persistLabel: '授权范围',
  },
};

interface Props {
  request: ApprovalRequest | null;
  lang: Lang;
  onResolve: (allow: boolean, mode: ApprovalMode) => void;
}

function SeverityIcon({ severity }: { severity: Severity }) {
  if (severity === 'read') {
    return (
      <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.2" />
        <path d="M8 6.25v3.4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        <circle cx="8" cy="4.6" r=".7" fill="currentColor" />
      </svg>
    );
  }

  if (severity === 'network') {
    return (
      <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path
          d="M3 8h8.5M8.75 4.25 12.5 8l-3.75 3.75"
          stroke="currentColor"
          strokeWidth="1.25"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  if (severity === 'destructive') {
    return (
      <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path
          d="M8 2.5 13.25 12h-10.5z"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinejoin="round"
        />
        <path d="M8 6v2.8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        <circle cx="8" cy="10.8" r=".7" fill="currentColor" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M4 11.8 11.9 3.9M10.8 3.25h2v2M4.2 12.75h-1v-1l6.45-6.45 2 2z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function ApprovalModal({ request, lang, onResolve }: Props) {
  const [mode, setMode] = useState<ApprovalMode>('once');
  const allowRef = useRef<HTMLButtonElement | null>(null);
  const denyRef = useRef<HTMLButtonElement | null>(null);

  const severity: Severity = request?.severity ?? 'unknown';
  const tier = SEV_CONFIG[severity];
  const copy = tier.copy[lang];
  const shared = SHARED_COPY[lang];
  const isDestructive = severity === 'destructive';
  const isApplePlatform =
    typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/i.test(navigator.userAgent);
  const allowHint = isApplePlatform ? '↵ / ⌘↵' : '↵ / Ctrl+↵';

  // Reset remember + focus appropriate button per severity.
  useEffect(() => {
    if (!request) return;
    setMode('once');
    const target = isDestructive ? denyRef : allowRef;
    const t = setTimeout(() => target.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [request?.request_id, isDestructive]);

  // Keyboard shortcuts. Destructive severity disables Enter/Space Allow.
  useEffect(() => {
    if (!request) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onResolve(false, 'once');
        return;
      }
      if (isDestructive) return; // no keyboard Allow for destructive.
      if (
        e.key === 'Enter' &&
        (e.metaKey || e.ctrlKey || document.activeElement === allowRef.current)
      ) {
        e.preventDefault();
        onResolve(true, mode);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [request, mode, onResolve, isDestructive]);

  if (!request) return null;

  return (
    <div
      className="approve-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="approve-title"
    >
      <div className={`approve-card ${tier.cls}`}>
        <div className="approve-head">
          <span className="approve-glyph" aria-hidden><SeverityIcon severity={severity} /></span>
          <span id="approve-title" className="approve-title">{copy.title}</span>
        </div>
        <p className="approve-sub">{copy.sub}</p>

        <div className="approve-preview">
          {renderToolPreview(request.tool_name, request.args)}
        </div>

        {!isDestructive && (
          <div
            className="approve-options"
            role="group"
            aria-label={shared.persistLabel}
          >
            <label
              className={`approve-option ${mode === 'remember' ? 'approve-option-active' : ''}`}
            >
              <input
                type="checkbox"
                checked={mode === 'remember'}
                onChange={(e) => setMode(e.target.checked ? 'remember' : 'once')}
              />
              <span>{shared.remember}</span>
            </label>
            <label
              className={`approve-option ${mode === 'always' ? 'approve-option-active' : ''}`}
            >
              <input
                type="checkbox"
                checked={mode === 'always'}
                onChange={(e) => setMode(e.target.checked ? 'always' : 'once')}
              />
              <span>{shared.always}</span>
            </label>
          </div>
        )}

        <div className="approve-actions">
          <Button
            ref={denyRef}
            variant={isDestructive ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => onResolve(false, 'once')}
          >
            {shared.deny}
            <span className="approve-hint">{shared.hintDeny}</span>
          </Button>
          <Button
            ref={allowRef}
            variant={isDestructive ? 'secondary' : 'primary'}
            size="sm"
            onClick={() => onResolve(true, mode)}
            onKeyDown={(e) => {
              if (isDestructive && (e.key === 'Enter' || e.key === ' ')) {
                e.preventDefault();
              }
            }}
            aria-description={
              isDestructive
                ? 'Click required — keyboard shortcuts are disabled for this action.'
                : undefined
            }
          >
            {shared.allow}
            {!isDestructive && <span className="approve-hint">{allowHint}</span>}
          </Button>
        </div>
      </div>
    </div>
  );
}

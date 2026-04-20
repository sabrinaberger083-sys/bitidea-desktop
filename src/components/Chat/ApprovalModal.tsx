import { useEffect, useRef, useState } from 'react';
import Button from '../common/Button';
import type { ApprovalRequest, Lang, Severity } from '../../types';
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
  en: { remember: 'Remember for 60 seconds', allow: 'Allow', deny: 'Deny', hintAllow: '↵ / ⌘↵', hintDeny: 'Esc' },
  zh: { remember: '记住 60 秒', allow: '允许', deny: '拒绝', hintAllow: '↵ / ⌘↵', hintDeny: 'Esc' },
};

interface Props {
  request: ApprovalRequest | null;
  lang: Lang;
  onResolve: (allow: boolean, remember: boolean) => void;
}

export default function ApprovalModal({ request, lang, onResolve }: Props) {
  const [remember, setRemember] = useState(false);
  const allowRef = useRef<HTMLButtonElement | null>(null);
  const denyRef = useRef<HTMLButtonElement | null>(null);

  const severity: Severity = request?.severity ?? 'unknown';
  const tier = SEV_CONFIG[severity];
  const copy = tier.copy[lang];
  const shared = SHARED_COPY[lang];
  const isDestructive = severity === 'destructive';

  // Reset remember + focus appropriate button per severity.
  useEffect(() => {
    if (!request) return;
    setRemember(false);
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
        onResolve(false, false);
        return;
      }
      if (isDestructive) return; // no keyboard Allow for destructive.
      if (
        e.key === 'Enter' &&
        (e.metaKey || e.ctrlKey || document.activeElement === allowRef.current)
      ) {
        e.preventDefault();
        onResolve(true, remember);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [request, remember, onResolve, isDestructive]);

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
          <span className="approve-glyph" aria-hidden>{tier.glyph}</span>
          <span id="approve-title" className="approve-title">{copy.title}</span>
        </div>
        <p className="approve-sub">{copy.sub}</p>

        <div className="approve-preview">
          {renderToolPreview(request.tool_name, request.args)}
        </div>

        {!isDestructive && (
          <label className="approve-remember">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
            />
            <span>{shared.remember}</span>
          </label>
        )}

        <div className="approve-actions">
          <Button
            ref={denyRef}
            variant={isDestructive ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => onResolve(false, false)}
          >
            {shared.deny}
            <span className="approve-hint">{shared.hintDeny}</span>
          </Button>
          <Button
            ref={allowRef}
            variant={isDestructive ? 'secondary' : 'primary'}
            size="sm"
            onClick={() => onResolve(true, remember)}
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
            {!isDestructive && <span className="approve-hint">{shared.hintAllow}</span>}
          </Button>
        </div>
      </div>
    </div>
  );
}

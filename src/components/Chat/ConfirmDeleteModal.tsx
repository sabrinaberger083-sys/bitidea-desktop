import { useEffect, useRef } from 'react';
import Button from '../common/Button';
import type { Lang } from '../../types';

interface Props {
  lang: Lang;
  count: number;
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDeleteModal({ lang, count, open, onConfirm, onCancel }: Props) {
  const denyRef = useRef<HTMLButtonElement | null>(null);
  const isZh = lang === 'zh';

  useEffect(() => {
    if (open) setTimeout(() => denyRef.current?.focus(), 0);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div className="approve-overlay" role="dialog" aria-modal="true">
      <div className="approve-card approve-destructive" style={{ maxWidth: 400 }}>
        <div className="approve-head">
          <span className="approve-glyph" aria-hidden>⚠</span>
          <span className="approve-title">{isZh ? '确认删除' : 'Confirm delete'}</span>
        </div>
        <p className="approve-sub">
          {isZh
            ? `即将删除 ${count} 条对话。此操作可在 30 天内通过数据恢复找回。`
            : `About to delete ${count} conversation${count > 1 ? 's' : ''}. Recoverable for 30 days.`}
        </p>
        <div className="approve-actions">
          <Button ref={denyRef} variant="primary" size="sm" onClick={onCancel}>
            {isZh ? '取消' : 'Cancel'}
          </Button>
          <Button variant="danger" size="sm" onClick={onConfirm}>
            {isZh ? '删除' : 'Delete'}
          </Button>
        </div>
      </div>
    </div>
  );
}

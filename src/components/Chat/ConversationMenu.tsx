import { useEffect, useRef } from 'react';
import type { ConversationWithPreview, Lang } from '../../types';

interface Props {
  conv: ConversationWithPreview;
  lang: Lang;
  x: number;
  y: number;
  onRename: (id: string) => void;
  onPin: (id: string, pinned: boolean) => void;
  onExport: (id: string) => void;
  onDelete: (id: string, title: string) => void;
  onClose: () => void;
}

const COPY = {
  en: { rename: 'Rename', pin: 'Pin', unpin: 'Unpin', export: 'Export as Markdown…', delete: 'Delete' },
  zh: { rename: '重命名', pin: '固定', unpin: '取消固定', export: '导出为 Markdown…', delete: '删除' },
};

export default function ConversationMenu({
  conv, lang, x, y, onRename, onPin, onExport, onDelete, onClose,
}: Props) {
  const L = COPY[lang];
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener('mousedown', handler);
    return () => window.removeEventListener('mousedown', handler);
  }, [onClose]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div ref={ref} className="conv-menu" style={{ top: y, left: x }}>
      <button type="button" onClick={() => onRename(conv.id)}>{L.rename}</button>
      <button type="button" onClick={() => onPin(conv.id, !conv.pinned)}>
        {conv.pinned ? L.unpin : L.pin}
      </button>
      <button type="button" onClick={() => onExport(conv.id)}>{L.export}</button>
      <button type="button" className="conv-menu-danger" onClick={() => onDelete(conv.id, conv.title)}>
        {L.delete}
      </button>
    </div>
  );
}

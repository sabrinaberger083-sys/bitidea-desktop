import { useRef, useState } from 'react';
import type { ConversationWithPreview, Lang } from '../../types';

interface Props {
  conv: ConversationWithPreview;
  active: boolean;
  lang: Lang;
  batchMode: boolean;
  selected: boolean;
  isStreaming?: boolean;
  onSelect: (id: string) => void;
  onToggleBatch: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onPin: (id: string, pinned: boolean) => void;
  onDelete: (id: string, title: string) => void;
  onExport: (id: string) => void;
  onContextMenu: (e: React.MouseEvent, id: string) => void;
}

export default function ConversationItem({
  conv,
  active,
  lang,
  batchMode,
  selected,
  isStreaming,
  onSelect,
  onToggleBatch,
  onRename,
  onPin: _onPin,
  onDelete: _onDelete,
  onExport: _onExport,
  onContextMenu,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(conv.title);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const isZh = lang === 'zh';

  // These props are passed through for parent orchestration; suppress TS unused-param errors.
  void _onPin; void _onDelete; void _onExport;

  function commitRename() {
    const trimmed = editValue.trim();
    if (!trimmed) {
      setEditValue(conv.title);
      setEditing(false);
      return;
    }
    onRename(conv.id, trimmed);
    setEditing(false);
  }

  function handleClick() {
    if (batchMode) {
      onToggleBatch(conv.id);
    } else {
      onSelect(conv.id);
    }
  }

  return (
    <div
      className={`conv-item ${active ? 'conv-active' : ''} ${selected ? 'conv-selected' : ''}`}
      onClick={handleClick}
      onContextMenu={(e) => onContextMenu(e, conv.id)}
    >
      {batchMode && (
        <input
          type="checkbox"
          className="conv-check"
          checked={selected}
          onChange={() => onToggleBatch(conv.id)}
          onClick={(e) => e.stopPropagation()}
        />
      )}
      {conv.pinned && <span className="conv-pin" aria-label="pinned">📌</span>}
      <div className="conv-body">
        {editing ? (
          <input
            ref={inputRef}
            className="conv-rename-input mono"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitRename();
              if (e.key === 'Escape') { setEditing(false); setEditValue(conv.title); }
            }}
            onBlur={commitRename}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <>
            <div className="conv-title">
              {conv.title}
              {isStreaming && <span className="conv-streaming-dot" />}
            </div>
            <div className="conv-preview">{conv.preview}</div>
          </>
        )}
      </div>
      {!batchMode && !editing && (
        <button
          type="button"
          className="conv-menu-btn"
          onClick={(e) => { e.stopPropagation(); onContextMenu(e, conv.id); }}
          aria-label={isZh ? '更多' : 'More'}
        >
          ⋯
        </button>
      )}
    </div>
  );
}

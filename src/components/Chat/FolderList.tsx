import { useEffect, useRef, useState } from 'react';
import type { Folder, Lang } from '../../types';
import './FolderList.css';

const COPY = {
  en: {
    folders: 'Folders',
    all: 'All Conversations',
    rename: 'Rename',
    delete: 'Delete',
    newFolder: 'New folder name...',
  },
  zh: {
    folders: '文件夹',
    all: '全部对话',
    rename: '重命名',
    delete: '删除',
    newFolder: '文件夹名称...',
  },
};

interface Props {
  lang: Lang;
  folders: Folder[];
  activeFolderId: string | null;
  conversationCounts: Map<string, number>;
  onSelect: (folderId: string | null) => void;
  onCreate: (name: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
}

interface ContextMenuState {
  folderId: string;
  x: number;
  y: number;
}

export default function FolderList({
  lang,
  folders,
  activeFolderId,
  conversationCounts,
  onSelect,
  onCreate,
  onRename,
  onDelete,
}: Props) {
  const L = COPY[lang];

  const [expanded, setExpanded] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createValue, setCreateValue] = useState('');
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const menuRef = useRef<HTMLDivElement | null>(null);
  const createInputRef = useRef<HTMLInputElement | null>(null);
  const renameInputRef = useRef<HTMLInputElement | null>(null);

  // Focus create input when it appears
  useEffect(() => {
    if (creating && createInputRef.current) {
      createInputRef.current.focus();
    }
  }, [creating]);

  // Focus rename input when it appears
  useEffect(() => {
    if (renamingId && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renamingId]);

  // Close context menu on outside click
  useEffect(() => {
    if (!contextMenu) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setContextMenu(null);
      }
    };
    window.addEventListener('mousedown', handler);
    return () => window.removeEventListener('mousedown', handler);
  }, [contextMenu]);

  // Close context menu on Escape
  useEffect(() => {
    if (!contextMenu) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setContextMenu(null);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [contextMenu]);

  function handleHeaderClick() {
    setExpanded((prev) => !prev);
  }

  function handleCreateClick(e: React.MouseEvent) {
    e.stopPropagation();
    setExpanded(true);
    setCreating(true);
    setCreateValue('');
  }

  function handleCreateKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      const trimmed = createValue.trim();
      if (trimmed) {
        onCreate(trimmed);
      }
      setCreating(false);
      setCreateValue('');
    } else if (e.key === 'Escape') {
      setCreating(false);
      setCreateValue('');
    }
  }

  function handleFolderContextMenu(e: React.MouseEvent, folderId: string) {
    e.preventDefault();
    setContextMenu({ folderId, x: e.clientX, y: e.clientY });
  }

  function handleRenameClick() {
    if (!contextMenu) return;
    const folder = folders.find((f) => f.id === contextMenu.folderId);
    if (!folder) return;
    setRenamingId(contextMenu.folderId);
    setRenameValue(folder.name);
    setContextMenu(null);
  }

  function handleDeleteClick() {
    if (!contextMenu) return;
    onDelete(contextMenu.folderId);
    setContextMenu(null);
  }

  function handleRenameKeyDown(e: React.KeyboardEvent<HTMLInputElement>, id: string) {
    if (e.key === 'Enter') {
      const trimmed = renameValue.trim();
      if (trimmed) {
        onRename(id, trimmed);
      }
      setRenamingId(null);
      setRenameValue('');
    } else if (e.key === 'Escape') {
      setRenamingId(null);
      setRenameValue('');
    }
  }

  function handleFolderClick(folderId: string) {
    // Already-active folder click = deselect (show all)
    if (activeFolderId === folderId) {
      onSelect(null);
    } else {
      onSelect(folderId);
    }
  }

  return (
    <div className="folder-section">
      {/* Header row */}
      <div className="folder-header" onClick={handleHeaderClick} role="button" tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleHeaderClick(); }}>
        <span className="folder-header-label">📁 {L.folders}</span>
        <button
          type="button"
          className="folder-create-btn"
          onClick={handleCreateClick}
          title={L.newFolder}
          aria-label={L.newFolder}
        >
          +
        </button>
      </div>

      {/* Expanded content */}
      {expanded && (
        <div className="folder-list">
          {/* All Conversations item */}
          <div
            className={`folder-item ${activeFolderId === null ? 'folder-item-active' : ''}`}
            onClick={() => onSelect(null)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onSelect(null); }}
          >
            <span className="folder-item-icon">💬</span>
            <span className="folder-item-name">{L.all}</span>
          </div>

          {/* User-created folders */}
          {[...folders].sort((a, b) => a.sort_order - b.sort_order).map((folder) => {
            const count = conversationCounts.get(folder.id) ?? 0;
            const isActive = activeFolderId === folder.id;
            const isRenaming = renamingId === folder.id;

            return (
              <div
                key={folder.id}
                className={`folder-item ${isActive ? 'folder-item-active' : ''}`}
                onClick={() => !isRenaming && handleFolderClick(folder.id)}
                onContextMenu={(e) => handleFolderContextMenu(e, folder.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if ((e.key === 'Enter' || e.key === ' ') && !isRenaming) {
                    handleFolderClick(folder.id);
                  }
                }}
              >
                <span className="folder-item-icon">{folder.icon || '📁'}</span>

                {isRenaming ? (
                  <input
                    ref={renameInputRef}
                    type="text"
                    className="folder-rename-input"
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onKeyDown={(e) => handleRenameKeyDown(e, folder.id)}
                    onBlur={() => {
                      const trimmed = renameValue.trim();
                      if (trimmed) onRename(folder.id, trimmed);
                      setRenamingId(null);
                      setRenameValue('');
                    }}
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  <span className="folder-item-name">{folder.name}</span>
                )}

                {!isRenaming && count > 0 && (
                  <span className="folder-item-count">{count}</span>
                )}
              </div>
            );
          })}

          {/* Inline create input */}
          {creating && (
            <div className="folder-item folder-item-creating">
              <span className="folder-item-icon">📁</span>
              <input
                ref={createInputRef}
                type="text"
                className="folder-rename-input"
                placeholder={L.newFolder}
                value={createValue}
                onChange={(e) => setCreateValue(e.target.value)}
                onKeyDown={handleCreateKeyDown}
                onBlur={() => {
                  setCreating(false);
                  setCreateValue('');
                }}
              />
            </div>
          )}
        </div>
      )}

      {/* Context menu */}
      {contextMenu && (
        <div
          ref={menuRef}
          className="conv-menu folder-context-menu"
          style={{ top: contextMenu.y, left: contextMenu.x }}
        >
          <button type="button" onClick={handleRenameClick}>
            {L.rename}
          </button>
          <button
            type="button"
            className="conv-menu-danger"
            onClick={handleDeleteClick}
          >
            {L.delete}
          </button>
        </div>
      )}
    </div>
  );
}

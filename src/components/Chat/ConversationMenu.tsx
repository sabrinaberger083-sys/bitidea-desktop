import { useEffect, useRef, useState } from 'react';
import type { ConversationWithPreview, Folder, Lang } from '../../types';

interface Props {
  conv: ConversationWithPreview;
  lang: Lang;
  x: number;
  y: number;
  folders?: Folder[];
  onRename: (id: string) => void;
  onPin: (id: string, pinned: boolean) => void;
  onExport: (id: string, format: 'md' | 'pdf' | 'docx') => void;
  onDelete: (id: string, title: string) => void;
  onMoveToFolder?: (convId: string, folderId: string | null) => void;
  onClose: () => void;
}

const COPY = {
  en: { rename: 'Rename', pin: 'Pin', unpin: 'Unpin', exportAs: 'Export as…', exportMd: 'Markdown (.md)', exportPdf: 'PDF (.pdf)', exportDocx: 'Word (.docx)', delete: 'Delete', moveTo: 'Move to folder', removeFromFolder: 'Remove from folder' },
  zh: { rename: '重命名', pin: '固定', unpin: '取消固定', exportAs: '导出…', exportMd: 'Markdown (.md)', exportPdf: 'PDF (.pdf)', exportDocx: 'Word (.docx)', delete: '删除', moveTo: '移到文件夹', removeFromFolder: '移出文件夹' },
};

export default function ConversationMenu({
  conv, lang, x, y, folders, onRename, onPin, onExport, onDelete, onMoveToFolder, onClose,
}: Props) {
  const L = COPY[lang];
  const ref = useRef<HTMLDivElement | null>(null);
  const [showFolderSub, setShowFolderSub] = useState(false);
  const [showExportSub, setShowExportSub] = useState(false);

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
      <div
        className="conv-menu-folder-wrap"
        onMouseEnter={() => setShowExportSub(true)}
        onMouseLeave={() => setShowExportSub(false)}
      >
        <button type="button" className="conv-menu-folder-trigger">
          {L.exportAs} <span style={{ float: 'right' }}>→</span>
        </button>
        {showExportSub && (
          <div className="conv-menu-sub">
            <button type="button" onClick={() => onExport(conv.id, 'md')}>
              {L.exportMd}
            </button>
            <button type="button" onClick={() => onExport(conv.id, 'pdf')}>
              {L.exportPdf}
            </button>
            <button type="button" onClick={() => onExport(conv.id, 'docx')}>
              {L.exportDocx}
            </button>
          </div>
        )}
      </div>
      {folders && folders.length > 0 && onMoveToFolder && (
        <div
          className="conv-menu-folder-wrap"
          onMouseEnter={() => setShowFolderSub(true)}
          onMouseLeave={() => setShowFolderSub(false)}
        >
          <button type="button" className="conv-menu-folder-trigger">
            {L.moveTo} <span style={{ float: 'right' }}>→</span>
          </button>
          {showFolderSub && (
            <div className="conv-menu-sub">
              {conv.folder_id && (
                <button type="button" onClick={() => onMoveToFolder(conv.id, null)}>
                  {L.removeFromFolder}
                </button>
              )}
              {folders.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => onMoveToFolder(conv.id, f.id)}
                >
                  {f.icon} {f.name}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      <button type="button" className="conv-menu-danger" onClick={() => onDelete(conv.id, conv.title)}>
        {L.delete}
      </button>
    </div>
  );
}

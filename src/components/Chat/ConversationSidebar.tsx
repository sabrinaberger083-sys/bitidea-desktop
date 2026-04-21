import { useMemo, useState } from 'react';
import Button from '../common/Button';
import ConversationItem from './ConversationItem';
import ConversationMenu from './ConversationMenu';
import ProjectPicker from './ProjectPicker';
import SearchBar from './SearchBar';
import BatchFooter from './BatchFooter';
import UndoToast from './UndoToast';
import type { ConversationWithPreview, Lang, SearchHit } from '../../types';
import type { UndoState } from '../../hooks/useConversations';
import './ConversationSidebar.css';

interface Props {
  lang: Lang;
  conversations: ConversationWithPreview[];
  currentId: string | null;
  collapsed: boolean;
  undo: UndoState | null;
  currentProjectId: string | null;
  streamingIds?: Set<string>;
  onProjectChange: (projectId: string | null, projectPath?: string) => void;
  onToggleCollapse: () => void;
  onSelect: (id: string) => void;
  onNew: () => void;
  onRename: (id: string, title: string) => void;
  onPin: (id: string, pinned: boolean) => Promise<boolean>;
  onDelete: (id: string, title: string) => void;
  onDeleteMany: (ids: string[]) => void;
  onExport: (id: string) => void;
  onExportMany: (ids: string[]) => void;
  onUndo: () => void;
  onDismissUndo: () => void;
  onSearchSelect: (hit: SearchHit) => void;
}

interface TimeBucket {
  label: string;
  items: ConversationWithPreview[];
}

const LABELS = {
  en: { pinned: 'Pinned', today: 'Today', yesterday: 'Yesterday', week: 'Past 7 days', month: 'Past 30 days', older: 'Older', newChat: 'NEW', batch: 'Batch', collapse: '◀', expand: '▶' },
  zh: { pinned: '固定', today: '今天', yesterday: '昨天', week: '过去 7 天', month: '过去 30 天', older: '更早', newChat: '新对话', batch: '批量', collapse: '◀', expand: '▶' },
};

function bucketConversations(convs: ConversationWithPreview[], lang: Lang): TimeBucket[] {
  const L = LABELS[lang];
  const now = Date.now();
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const yesterdayStart = new Date(todayStart); yesterdayStart.setDate(yesterdayStart.getDate() - 1);
  const weekStart = now - 7 * 86400000;
  const monthStart = now - 30 * 86400000;

  const pinned: ConversationWithPreview[] = [];
  const today: ConversationWithPreview[] = [];
  const yesterday: ConversationWithPreview[] = [];
  const week: ConversationWithPreview[] = [];
  const month: ConversationWithPreview[] = [];
  const older: ConversationWithPreview[] = [];

  for (const c of convs) {
    if (c.pinned) { pinned.push(c); continue; }
    const t = c.updated_at;
    if (t >= todayStart.getTime()) today.push(c);
    else if (t >= yesterdayStart.getTime()) yesterday.push(c);
    else if (t >= weekStart) week.push(c);
    else if (t >= monthStart) month.push(c);
    else older.push(c);
  }

  const buckets: TimeBucket[] = [];
  if (pinned.length) buckets.push({ label: `📌 ${L.pinned}`, items: pinned });
  if (today.length) buckets.push({ label: L.today, items: today });
  if (yesterday.length) buckets.push({ label: L.yesterday, items: yesterday });
  if (week.length) buckets.push({ label: L.week, items: week });
  if (month.length) buckets.push({ label: L.month, items: month });
  if (older.length) buckets.push({ label: L.older, items: older });
  return buckets;
}

export default function ConversationSidebar({
  lang,
  conversations,
  currentId,
  collapsed,
  undo,
  currentProjectId,
  streamingIds,
  onProjectChange,
  onToggleCollapse,
  onSelect,
  onNew,
  onRename,
  onPin,
  onDelete,
  onDeleteMany,
  onExport,
  onExportMany,
  onUndo,
  onDismissUndo,
  onSearchSelect,
}: Props) {
  const L = LABELS[lang];
  const [batchMode, setBatchMode] = useState(false);
  const [batchSelected, setBatchSelected] = useState<Set<string>>(new Set());
  const [menuTarget, setMenuTarget] = useState<{ id: string; x: number; y: number } | null>(null);
  const [searching, setSearching] = useState(false);

  const buckets = useMemo(() => bucketConversations(conversations, lang), [conversations, lang]);

  function toggleBatch(id: string) {
    setBatchSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function exitBatch() {
    setBatchMode(false);
    setBatchSelected(new Set());
  }

  function handleContextMenu(e: React.MouseEvent, id: string) {
    e.preventDefault();
    setMenuTarget({ id, x: e.clientX, y: e.clientY });
  }

  const menuConv = menuTarget ? conversations.find((c) => c.id === menuTarget.id) : null;

  if (collapsed) {
    return (
      <aside className="sidebar sidebar-collapsed">
        <button type="button" className="sidebar-expand-btn" onClick={onToggleCollapse} aria-label={L.expand}>
          {L.expand}
        </button>
        <button type="button" className="sidebar-icon-btn" onClick={onNew} aria-label={L.newChat}>
          +
        </button>
      </aside>
    );
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <Button size="sm" variant="primary" onClick={onNew}>+ {L.newChat}</Button>
        <button type="button" className="sidebar-collapse-btn" onClick={onToggleCollapse} aria-label={L.collapse}>
          {L.collapse}
        </button>
      </div>

      <ProjectPicker
        lang={lang}
        currentProjectId={currentProjectId}
        onProjectChange={onProjectChange}
      />

      <SearchBar
        lang={lang}
        onResults={(hits) => setSearching(hits.length > 0)}
        onSelect={onSearchSelect}
        onClear={() => setSearching(false)}
      />

      {!searching && (
        <div className="sidebar-list">
          {buckets.map((b) => (
            <div key={b.label} className="sidebar-bucket">
              <div className="sidebar-bucket-label">{b.label}</div>
              {b.items.map((c) => (
                <ConversationItem
                  key={c.id}
                  conv={c}
                  active={c.id === currentId}
                  lang={lang}
                  batchMode={batchMode}
                  selected={batchSelected.has(c.id)}
                  isStreaming={streamingIds?.has(c.id) ?? false}
                  onSelect={onSelect}
                  onToggleBatch={toggleBatch}
                  onRename={onRename}
                  onPin={(id, pinned) => { onPin(id, pinned); }}
                  onDelete={onDelete}
                  onExport={onExport}
                  onContextMenu={handleContextMenu}
                />
              ))}
            </div>
          ))}
        </div>
      )}

      {!searching && !batchMode && (
        <div className="sidebar-foot">
          <Button size="sm" variant="secondary" onClick={() => { setBatchMode(true); setBatchSelected(new Set()); }}>
            {L.batch}
          </Button>
        </div>
      )}

      {batchMode && (
        <BatchFooter
          lang={lang}
          count={batchSelected.size}
          onDelete={() => { onDeleteMany(Array.from(batchSelected)); exitBatch(); }}
          onExport={() => { onExportMany(Array.from(batchSelected)); exitBatch(); }}
          onCancel={exitBatch}
        />
      )}

      {menuTarget && menuConv && (
        <ConversationMenu
          conv={menuConv}
          lang={lang}
          x={menuTarget.x}
          y={menuTarget.y}
          onRename={() => { setMenuTarget(null); }}
          onPin={(id, pinned) => { setMenuTarget(null); onPin(id, pinned); }}
          onExport={(id) => { setMenuTarget(null); onExport(id); }}
          onDelete={(id, title) => { setMenuTarget(null); onDelete(id, title); }}
          onClose={() => setMenuTarget(null)}
        />
      )}

      {undo && <UndoToast lang={lang} title={undo.title} onUndo={onUndo} onDismiss={onDismissUndo} />}
    </aside>
  );
}

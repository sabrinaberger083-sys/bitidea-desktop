import { useState } from 'react';
import Button from '../common/Button';
import type { Lang } from '../../types';

interface Props {
  lang: Lang;
  count: number;
  onDelete: () => void;
  onExport: (format: 'md' | 'pdf' | 'docx') => void;
  onCancel: () => void;
}

const COPY = {
  en: { items: 'items', del: 'Delete selected', exp: 'Export ▾', cancel: 'Cancel', md: 'Markdown', pdf: 'PDF', docx: 'Word' },
  zh: { items: '项', del: '删除所选', exp: '导出 ▾', cancel: '取消', md: 'Markdown', pdf: 'PDF', docx: 'Word' },
};

export default function BatchFooter({ lang, count, onDelete, onExport, onCancel }: Props) {
  const L = COPY[lang];
  const [showExportMenu, setShowExportMenu] = useState(false);
  return (
    <div className="batch-footer">
      <span className="batch-count mono">{count} {L.items}</span>
      <div className="batch-actions">
        <Button size="sm" variant="danger" onClick={onDelete} disabled={count === 0}>
          {L.del}
        </Button>
        <div style={{ position: 'relative', display: 'inline-block' }}>
          <Button size="sm" variant="secondary" onClick={() => setShowExportMenu(!showExportMenu)} disabled={count === 0}>
            {L.exp}
          </Button>
          {showExportMenu && (
            <div className="batch-export-menu">
              <button type="button" onClick={() => { onExport('md'); setShowExportMenu(false); }}>{L.md}</button>
              <button type="button" onClick={() => { onExport('pdf'); setShowExportMenu(false); }}>{L.pdf}</button>
              <button type="button" onClick={() => { onExport('docx'); setShowExportMenu(false); }}>{L.docx}</button>
            </div>
          )}
        </div>
        <Button size="sm" variant="secondary" onClick={onCancel}>
          {L.cancel}
        </Button>
      </div>
    </div>
  );
}

import Button from '../common/Button';
import type { Lang } from '../../types';

interface Props {
  lang: Lang;
  count: number;
  onDelete: () => void;
  onExport: () => void;
  onCancel: () => void;
}

const COPY = {
  en: { items: 'items', del: 'Delete selected', exp: 'Export selected', cancel: 'Cancel' },
  zh: { items: '项', del: '删除所选', exp: '导出所选', cancel: '取消' },
};

export default function BatchFooter({ lang, count, onDelete, onExport, onCancel }: Props) {
  const L = COPY[lang];
  return (
    <div className="batch-footer">
      <span className="batch-count mono">{count} {L.items}</span>
      <div className="batch-actions">
        <Button size="sm" variant="danger" onClick={onDelete} disabled={count === 0}>
          {L.del}
        </Button>
        <Button size="sm" variant="secondary" onClick={onExport} disabled={count === 0}>
          {L.exp}
        </Button>
        <Button size="sm" variant="secondary" onClick={onCancel}>
          {L.cancel}
        </Button>
      </div>
    </div>
  );
}

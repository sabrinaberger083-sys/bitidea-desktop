import type { Lang } from '../../types';
import './UndoToast.css';

interface Props {
  lang: Lang;
  title: string;
  onUndo: () => void;
  onDismiss: () => void;
}

export default function UndoToast({ lang, title, onUndo, onDismiss }: Props) {
  const isZh = lang === 'zh';
  return (
    <div className="undo-toast">
      <span>{isZh ? `已删除「${title}」` : `Deleted "${title}"`}</span>
      <button type="button" className="undo-btn" onClick={onUndo}>
        {isZh ? '撤销' : 'Undo'}
      </button>
      <button type="button" className="undo-dismiss" onClick={onDismiss} aria-label="dismiss">✕</button>
    </div>
  );
}

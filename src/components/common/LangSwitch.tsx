import type { Lang } from '../../types';

interface LangSwitchProps {
  lang: Lang;
  onChange: (next: Lang) => void;
  className?: string;
}

export default function LangSwitch({ lang, onChange, className }: LangSwitchProps) {
  return (
    <div className={`lang-switch ${className || ''}`} role="group" aria-label="Language">
      <button
        type="button"
        className={lang === 'en' ? 'active' : ''}
        onClick={() => onChange('en')}
      >
        EN
      </button>
      <button
        type="button"
        className={lang === 'zh' ? 'active' : ''}
        onClick={() => onChange('zh')}
      >
        中
      </button>
    </div>
  );
}

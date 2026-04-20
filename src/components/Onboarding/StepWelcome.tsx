import Button from '../common/Button';
import LangSwitch from '../common/LangSwitch';
import Logo from '../common/Logo';
import Badge from '../common/Badge';
import type { Lang } from '../../types';

const COPY = {
  en: {
    badge: 'v0.1 · DESKTOP',
    tagline_strong: 'Self-improving AI',
    tagline: 'An agent that learns from experience and gets better with use.',
    cta: 'GET STARTED',
  },
  zh: {
    badge: 'v0.1 · 桌面版',
    tagline_strong: '自我进化的 AI 智能体',
    tagline: '从每一次交互中学习，越用越强。',
    cta: '开始使用',
  },
};

interface Props {
  lang: Lang;
  onLangChange: (l: Lang) => void;
  onNext: () => void;
}

export default function StepWelcome({ lang, onLangChange, onNext }: Props) {
  const L = COPY[lang];
  return (
    <div className="onb-welcome">
      <div className="onb-welcome-head">
        <Badge pulse tone="accent">{L.badge}</Badge>
        <LangSwitch lang={lang} onChange={onLangChange} />
      </div>

      <Logo size="lg" glow />

      <p className="onb-tagline">
        <strong>{L.tagline_strong}</strong>
        <span className="sep">·</span>
        {L.tagline}
      </p>

      <Button variant="primary" arrow onClick={onNext}>
        {L.cta}
      </Button>
    </div>
  );
}

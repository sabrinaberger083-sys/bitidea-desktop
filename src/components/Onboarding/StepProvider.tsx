import Button from '../common/Button';
import Panel from '../common/Panel';
import type { Lang, Provider } from '../../types';

const COPY = {
  en: {
    label: 'STEP 02 · PROVIDER',
    title: 'Choose your model provider',
    sub: 'Pick where your requests get sent. You can change this later in Settings.',
    back: 'BACK',
    next: 'CONTINUE',
    cards: {
      openai: {
        name: 'OpenAI',
        desc: 'Direct OpenAI API. GPT-4o, GPT-4o-mini, o-series.',
      },
      openrouter: {
        name: 'OpenRouter',
        desc: 'Unified access to 200+ models (Claude, GPT, Llama, …).',
      },
      anthropic: {
        name: 'Anthropic',
        desc: 'Direct Claude API — Sonnet, Opus, Haiku.',
      },
      custom: {
        name: 'Custom endpoint',
        desc: 'Any OpenAI-compatible endpoint (local LLM, self-hosted…).',
      },
    },
  },
  zh: {
    label: '步骤 02 · 模型提供方',
    title: '选择模型提供方',
    sub: '决定请求发往哪里。稍后可在设置中修改。',
    back: '返回',
    next: '继续',
    cards: {
      openai: {
        name: 'OpenAI',
        desc: '直连 OpenAI API，支持 GPT-4o、GPT-4o-mini、o 系列。',
      },
      openrouter: {
        name: 'OpenRouter',
        desc: '一个接口接入 200+ 模型（Claude、GPT、Llama 等）。',
      },
      anthropic: {
        name: 'Anthropic',
        desc: '直连 Claude API，Sonnet / Opus / Haiku。',
      },
      custom: {
        name: '自定义接口',
        desc: '任何兼容 OpenAI 协议的地址（本地模型、自建服务…）。',
      },
    },
  },
};

const PROVIDERS: Provider[] = ['openai', 'openrouter', 'anthropic', 'custom'];

interface Props {
  lang: Lang;
  selected: Provider;
  onSelect: (p: Provider) => void;
  onBack: () => void;
  onNext: () => void;
}

export default function StepProvider({
  lang,
  selected,
  onSelect,
  onBack,
  onNext,
}: Props) {
  const L = COPY[lang];
  return (
    <div style={{ width: '100%' }}>
      <div className="onb-step-head">
        <div className="section-label">{L.label}</div>
        <h2 className="onb-step-title">{L.title}</h2>
        <p className="onb-step-sub">{L.sub}</p>
      </div>

      <div className="provider-grid">
        {PROVIDERS.map((p) => (
          <Panel
            key={p}
            topStripe
            hoverGlow
            corners
            className={`provider-card ${selected === p ? 'selected' : ''}`}
            onClick={() => onSelect(p)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') onSelect(p);
            }}
          >
            <div className="provider-name">{L.cards[p].name}</div>
            <div className="provider-desc">{L.cards[p].desc}</div>
          </Panel>
        ))}
      </div>

      <div className="onb-nav">
        <Button variant="secondary" onClick={onBack}>
          ← {L.back}
        </Button>
        <Button variant="primary" arrow onClick={onNext}>
          {L.next}
        </Button>
      </div>
    </div>
  );
}

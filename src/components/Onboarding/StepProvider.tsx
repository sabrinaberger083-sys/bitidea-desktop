import Button from '../common/Button';
import type { Lang, Provider } from '../../types';

interface CardInfo {
  name: string;
  desc: string;
}

const COPY: Record<string, {
  label: string;
  title: string;
  sub: string;
  back: string;
  next: string;
  cards: Record<string, CardInfo>;
}> = {
  en: {
    label: 'STEP 02 · PROVIDER',
    title: 'Choose your model provider',
    sub: 'Pick where your requests get sent. You can change this later in Settings.',
    back: 'BACK',
    next: 'CONTINUE',
    cards: {
      openai: { name: 'OpenAI', desc: 'Direct OpenAI API. GPT-4o, o-series.' },
      openrouter: { name: 'OpenRouter', desc: 'Unified access to 200+ models.' },
      anthropic: { name: 'Anthropic', desc: 'Direct Claude API — Sonnet, Opus, Haiku.' },
      gemini: { name: 'Google Gemini', desc: 'Gemini 2.5 Pro/Flash via AI Studio.' },
      zai: { name: 'z.ai / GLM', desc: 'ZhipuAI GLM-4 Plus/Flash/Long.' },
      kimi: { name: 'Kimi / Moonshot', desc: 'Kimi K2.5 and Moonshot models.' },
      minimax: { name: 'MiniMax', desc: 'MiniMax Text models.' },
      xiaomi: { name: 'Xiaomi MiMo', desc: 'MiMo v2 Pro/Flash/Omni.' },
      huggingface: { name: 'Hugging Face', desc: 'Open models via HF Inference.' },
      arcee: { name: 'Arcee AI', desc: 'Trinity Large/Mini models.' },
      'ollama-cloud': { name: 'Ollama Cloud', desc: 'Cloud-hosted open models.' },
      'opencode-zen': { name: 'OpenCode Zen', desc: 'Curated models, pay-as-you-go.' },
      'opencode-go': { name: 'OpenCode Go', desc: 'Open models, $10/month.' },
      custom: { name: 'Custom endpoint', desc: 'Any OpenAI-compatible endpoint.' },
    },
  },
  zh: {
    label: '步骤 02 · 模型提供方',
    title: '选择模型提供方',
    sub: '决定请求发往哪里。稍后可在设置中修改。',
    back: '返回',
    next: '继续',
    cards: {
      openai: { name: 'OpenAI', desc: '直连 OpenAI API，GPT-4o、o 系列。' },
      openrouter: { name: 'OpenRouter', desc: '一个接口接入 200+ 模型。' },
      anthropic: { name: 'Anthropic', desc: '直连 Claude API，Sonnet / Opus / Haiku。' },
      gemini: { name: 'Google Gemini', desc: 'AI Studio 的 Gemini 2.5 Pro/Flash。' },
      zai: { name: 'z.ai / 智谱', desc: 'GLM-4 Plus/Flash/Long 系列。' },
      kimi: { name: 'Kimi / Moonshot', desc: 'Kimi K2.5 及 Moonshot 模型。' },
      minimax: { name: 'MiniMax', desc: 'MiniMax 文本模型。' },
      xiaomi: { name: '小米 MiMo', desc: 'MiMo v2 Pro/Flash/Omni。' },
      huggingface: { name: 'Hugging Face', desc: '通过 HF Inference 使用开源模型。' },
      arcee: { name: 'Arcee AI', desc: 'Trinity Large/Mini 模型。' },
      'ollama-cloud': { name: 'Ollama Cloud', desc: '云端托管的开源模型。' },
      'opencode-zen': { name: 'OpenCode Zen', desc: '精选模型，按量付费。' },
      'opencode-go': { name: 'OpenCode Go', desc: '开源模型，$10/月。' },
      custom: { name: '自定义接口', desc: '任何兼容 OpenAI 协议的地址。' },
    },
  },
};

const PROVIDERS: Provider[] = [
  'openrouter', 'openai', 'anthropic', 'gemini', 'zai', 'kimi',
  'minimax', 'xiaomi', 'huggingface', 'arcee', 'ollama-cloud',
  'opencode-zen', 'opencode-go', 'custom',
];

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

  function handleChoose(provider: Provider) {
    onSelect(provider);
  }

  function handleChooseAndContinue(provider: Provider) {
    onSelect(provider);
    onNext();
  }

  return (
    <div className="onb-provider-step">
      <div className="onb-step-head">
        <div className="section-label">{L.label}</div>
        <h2 className="onb-step-title">{L.title}</h2>
        <p className="onb-step-sub">{L.sub}</p>
      </div>

      <div className="provider-grid">
        {PROVIDERS.map((p) => (
          <button
            key={p}
            type="button"
            className={`provider-card panel panel-top-stripe panel-hover-glow ${selected === p ? 'selected' : ''}`}
            onClick={() => handleChoose(p)}
            onDoubleClick={() => handleChooseAndContinue(p)}
            aria-pressed={selected === p}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleChooseAndContinue(p);
              }
              if (e.key === ' ') {
                e.preventDefault();
                handleChoose(p);
              }
            }}
          >
            <div className="provider-name">{L.cards[p]?.name ?? p}</div>
            <div className="provider-desc">{L.cards[p]?.desc ?? ''}</div>
          </button>
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

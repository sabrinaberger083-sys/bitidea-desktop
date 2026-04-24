/* ══════════════════════════════════════════════════════════
   BITIDEA Desktop · Model Presets
   Preset model lists per provider for the ModelPicker and
   SettingsPanel combo box.
   ══════════════════════════════════════════════════════════ */

export interface ModelPreset {
  id: string;      // e.g. "gpt-4o"
  label: string;   // e.g. "GPT-4o"
  provider: string; // e.g. "openai"
}

export const MODEL_PRESETS: Record<string, ModelPreset[]> = {
  openai: [
    { id: 'gpt-4o', label: 'GPT-4o', provider: 'openai' },
    { id: 'gpt-4o-mini', label: 'GPT-4o Mini', provider: 'openai' },
    { id: 'gpt-4-turbo', label: 'GPT-4 Turbo', provider: 'openai' },
    { id: 'o1', label: 'o1', provider: 'openai' },
    { id: 'o1-mini', label: 'o1 Mini', provider: 'openai' },
    { id: 'o3-mini', label: 'o3 Mini', provider: 'openai' },
  ],
  anthropic: [
    { id: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4', provider: 'anthropic' },
    { id: 'claude-3-5-haiku-latest', label: 'Claude 3.5 Haiku', provider: 'anthropic' },
    { id: 'claude-3-5-sonnet-latest', label: 'Claude 3.5 Sonnet', provider: 'anthropic' },
    { id: 'claude-3-opus-latest', label: 'Claude 3 Opus', provider: 'anthropic' },
  ],
  openrouter: [
    { id: 'anthropic/claude-sonnet-4', label: 'Claude Sonnet 4', provider: 'openrouter' },
    { id: 'openai/gpt-4o', label: 'GPT-4o', provider: 'openrouter' },
    { id: 'google/gemini-2.5-pro', label: 'Gemini 2.5 Pro', provider: 'openrouter' },
    { id: 'meta-llama/llama-3.1-405b-instruct', label: 'Llama 3.1 405B', provider: 'openrouter' },
    { id: 'deepseek/deepseek-chat', label: 'DeepSeek Chat', provider: 'openrouter' },
  ],
  gemini: [
    { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', provider: 'gemini' },
    { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', provider: 'gemini' },
    { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash', provider: 'gemini' },
  ],
  zai: [
    { id: 'glm-4-plus', label: 'GLM-4 Plus', provider: 'zai' },
    { id: 'glm-4-flash', label: 'GLM-4 Flash', provider: 'zai' },
    { id: 'glm-4-long', label: 'GLM-4 Long', provider: 'zai' },
  ],
  kimi: [
    { id: 'kimi-k2.5', label: 'Kimi K2.5', provider: 'kimi' },
    { id: 'moonshot-v1-8k', label: 'Moonshot v1 8K', provider: 'kimi' },
  ],
  minimax: [
    { id: 'MiniMax-Text-01', label: 'MiniMax Text 01', provider: 'minimax' },
    { id: 'abab6.5s-chat', label: 'ABAB 6.5s', provider: 'minimax' },
  ],
  xiaomi: [
    { id: 'mimo-v2-pro', label: 'MiMo v2 Pro', provider: 'xiaomi' },
    { id: 'mimo-v2-flash', label: 'MiMo v2 Flash', provider: 'xiaomi' },
  ],
  huggingface: [
    { id: 'Qwen/Qwen3-235B-A22B', label: 'Qwen3 235B', provider: 'huggingface' },
    { id: 'meta-llama/Llama-3.3-70B-Instruct', label: 'Llama 3.3 70B', provider: 'huggingface' },
  ],
  arcee: [
    { id: 'trinity-large', label: 'Trinity Large', provider: 'arcee' },
    { id: 'trinity-mini', label: 'Trinity Mini', provider: 'arcee' },
  ],
  'ollama-cloud': [
    { id: 'llama3.1', label: 'Llama 3.1', provider: 'ollama-cloud' },
    { id: 'qwen3', label: 'Qwen3', provider: 'ollama-cloud' },
  ],
  'opencode-zen': [
    { id: 'gpt-4o', label: 'GPT-4o (Zen)', provider: 'opencode-zen' },
    { id: 'claude-sonnet-4', label: 'Claude Sonnet 4 (Zen)', provider: 'opencode-zen' },
  ],
  'opencode-go': [
    { id: 'glm-5', label: 'GLM-5 (Go)', provider: 'opencode-go' },
    { id: 'kimi-k2.5', label: 'Kimi K2.5 (Go)', provider: 'opencode-go' },
  ],
  custom: [],
};

export function getPresetsForProvider(provider: string): ModelPreset[] {
  return MODEL_PRESETS[provider] ?? [];
}

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
  custom: [],
};

export function getPresetsForProvider(provider: string): ModelPreset[] {
  return MODEL_PRESETS[provider] ?? [];
}

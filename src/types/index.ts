/* ══════════════════════════════════════════════════════════
   BITIDEA Desktop · Shared Types
   ══════════════════════════════════════════════════════════ */

export type Provider = 'openai' | 'openrouter' | 'anthropic' | 'custom';

export type Lang = 'en' | 'zh';

export interface Config {
  provider: Provider;
  model: string;
  base_url?: string;
  has_api_key: boolean;
}

/** Payload sent to `POST /config`. api_key is optional — when omitted the
 *  sidecar keeps the currently stored key. */
export interface ConfigInput {
  provider: Provider;
  model: string;
  api_key?: string;
  base_url?: string;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  /** True while streaming tokens into this message. */
  streaming?: boolean;
}

export interface TestResult {
  ok: boolean;
  error?: string;
}

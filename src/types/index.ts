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

/* ══════════════════════════════════════════════════════════
   Agent event stream
   ══════════════════════════════════════════════════════════
   An assistant message is no longer a single blob of markdown — it is a
   time-ordered stream of "events" (text deltas, thinking traces, tool
   cards) that the UI renders inline. The sidecar emits these as SSE
   frames; the frontend groups them into the nearest message bubble. */

/** Plain LLM token delta — the bread-and-butter of streaming chat. */
export interface TextEvent {
  kind: 'text';
  text: string;
}

/** Reasoning/thinking trace (o1-style). Collapsible, dimmed in the UI. */
export interface ThinkingEvent {
  kind: 'thinking';
  /** Concatenated thought chunks as they arrive. */
  text: string;
}

/** One tool invocation, from start to result. */
export interface ToolEvent {
  kind: 'tool';
  id: string;
  name: string;
  args: Record<string, unknown>;
  /** Short human-readable preview emitted at tool_start (command text, etc). */
  preview?: string;
  /** Streaming stdout chunks (tool_output events). */
  output: string;
  /** Present once tool_result arrives. */
  result?: {
    ok: boolean;
    summary: string;
    truncated: boolean;
  };
  /** True when this invocation was auto-approved via the 60s remember cache. */
  auto_allowed?: boolean;
  /** Epoch ms at which the auto-approval window expires. */
  allowed_until_ms?: number;
}

export type AssistantEvent = TextEvent | ThinkingEvent | ToolEvent;

/** Current multi-step progress indicator. `total=0` means "unknown". */
export interface StepEvent {
  n: number;
  total: number;
}

/** Ephemeral status line rendered near the assistant bubble. */
export interface StatusEvent {
  text: string;
}

export type Severity = 'read' | 'write' | 'destructive' | 'network' | 'unknown';

/** A dangerous command that needs the user's permission before it runs. */
export interface ApprovalRequest {
  request_id: string;
  tool_name: string;
  args: Record<string, unknown>;
  /** Short human-readable preview (command text, truncated if long). */
  preview: string;
  severity: Severity;
  /** Local timestamp at which we received the request. */
  received_at: number;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  /** Plain text for user messages; legacy fallback for assistant messages
   *  that were rendered before the agent event protocol existed. */
  content: string;
  /** True while streaming events into this message. */
  streaming?: boolean;
  /** Time-ordered stream of agent events. Only populated for assistant
   *  messages that went through the agent loop. */
  events?: AssistantEvent[];
  /** Current step indicator (overwritten on each ``step`` event). */
  step?: StepEvent;
  /** Latest ephemeral status line. Cleared when streaming ends. */
  status?: string;
}

export interface TestResult {
  ok: boolean;
  error?: string;
}

/* ══════════════════════════════════════════════════════════
   Conversation persistence
   ══════════════════════════════════════════════════════════ */

export interface Conversation {
  id: string;
  title: string;
  pinned: boolean;
  created_at: number;
  updated_at: number;
}

export interface ConversationWithPreview extends Conversation {
  preview: string;
  message_count: number;
}

export interface StoredMessage {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant';
  content: string;
  events?: AssistantEvent[];
  step?: StepEvent;
  created_at: number;
}

export interface SearchHit {
  conversation_id: string;
  conversation_title: string;
  message_id: string;
  snippet: string;
}

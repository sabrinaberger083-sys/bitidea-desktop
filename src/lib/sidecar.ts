/* ══════════════════════════════════════════════════════════
   BITIDEA Desktop · Sidecar Client
   Talks to the local Python FastAPI subprocess over HTTP + SSE.
   ══════════════════════════════════════════════════════════ */

import { invoke } from '@tauri-apps/api/core';
import type {
  ApprovalRequest,
  Attachment,
  Config,
  ConfigInput,
  Message,
  Severity,
  StepEvent,
  TestResult,
} from '../types';

/* ── Handshake state, populated by bootstrap() before any request ── */
interface SidecarInfo {
  port: number | null;
  token: string | null;
  ready: boolean;
  error: string | null;
}

let base: { url: string; token: string } | null = null;

/** Poll the Rust side until the Python sidecar has emitted its handshake,
 *  then cache port+token for all subsequent fetch() calls. Throws on timeout
 *  or if the Rust side surfaced a spawn error. */
export async function bootstrap(timeoutMs = 15000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    let info: SidecarInfo;
    try {
      info = await invoke<SidecarInfo>('get_sidecar_info');
    } catch (e) {
      throw new SidecarError(`tauri invoke failed: ${(e as Error).message ?? e}`);
    }
    if (info.error) throw new SidecarError(info.error);
    if (info.ready && info.port && info.token) {
      base = { url: `http://127.0.0.1:${info.port}`, token: info.token };
      return;
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new SidecarError('sidecar did not become ready in time');
}

function getBase(): { url: string; token: string } {
  if (!base) throw new SidecarError('sidecar not bootstrapped yet');
  return base;
}

function headers(): HeadersInit {
  const { token } = getBase();
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) h['X-Bitidea-Token'] = token;
  return h;
}

export class SidecarError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SidecarError';
  }
}

async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { url } = getBase();
  let res: Response;
  try {
    res = await fetch(`${url}${path}`, {
      ...init,
      headers: { ...headers(), ...(init.headers || {}) },
    });
  } catch {
    throw new SidecarError(
      `cannot reach sidecar at ${url} — is it running?`,
    );
  }
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const body = await res.text();
      msg += `: ${body.slice(0, 240)}`;
    } catch {
      /* ignore */
    }
    throw new SidecarError(msg);
  }
  return (await res.json()) as T;
}

/* ── Basic endpoints ───────────────────────────────────────── */

export function getConfig(): Promise<Config> {
  return req<Config>('/config');
}

export function saveConfig(cfg: ConfigInput): Promise<{ ok: true }> {
  return req<{ ok: true }>('/config', {
    method: 'POST',
    body: JSON.stringify(cfg),
  });
}

export function testConnection(cfg?: ConfigInput): Promise<TestResult> {
  return req<TestResult>('/test-connection', {
    method: 'POST',
    body: cfg ? JSON.stringify(cfg) : 'null',
  });
}

/* ── Streaming chat (SSE parser) ───────────────────────────── */

/**
 * The sidecar streams a rich set of SSE events — plain text deltas plus
 * tool lifecycle, thinking traces, approval requests, step indicators
 * and ephemeral status. The ChatWindow supplies the handlers it cares
 * about; unknown/missing handlers are no-ops.
 */
export interface StreamHandlers {
  onToken: (text: string) => void;
  onThinking?: (text: string) => void;
  onToolStart?: (tool: {
    id: string;
    name: string;
    args: Record<string, unknown>;
    preview: string;
    auto_allowed?: boolean;
    allowed_until_ms?: number;
  }) => void;
  onToolOutput?: (id: string, chunk: string) => void;
  onToolResult?: (id: string, result: {
    ok: boolean;
    summary: string;
    truncated: boolean;
  }) => void;
  onApprovalRequest?: (req: ApprovalRequest) => void;
  onStep?: (step: StepEvent) => void;
  onStatus?: (text: string) => void;
  onDone: () => void;
  onError: (message: string) => void;
}

function formatMessageForApi(
  msg: { role: string; content: string; attachments?: Attachment[] },
): { role: string; content: string | Array<Record<string, unknown>> } {
  const atts = msg.attachments;
  if (!atts || atts.length === 0) {
    return { role: msg.role, content: msg.content };
  }

  const images = atts.filter(a => a.type === 'image');
  const docs = atts.filter(a => a.type === 'file');

  let textContent = msg.content;
  if (docs.length > 0) {
    const docText = docs.map(d => `[File: ${d.name}]\n${d.data}`).join('\n\n---\n\n');
    textContent = docText + (textContent ? '\n\n' + textContent : '');
  }

  if (images.length === 0) {
    return { role: msg.role, content: textContent };
  }

  const contentArray: Array<Record<string, unknown>> = [];
  if (textContent) {
    contentArray.push({ type: 'text', text: textContent });
  }
  for (const img of images) {
    contentArray.push({
      type: 'image_url',
      image_url: { url: `data:${img.mime};base64,${img.data}` },
    });
  }

  return { role: msg.role, content: contentArray };
}

/**
 * Stream a chat completion. Returns an AbortController the caller can use
 * to cancel the stream (stop button). Handlers never throw.
 */
export function streamChat(
  messages: (Pick<Message, 'role' | 'content'> & { attachments?: Attachment[] })[],
  handlers: StreamHandlers,
  options?: { projectPath?: string },
): AbortController {
  const controller = new AbortController();
  const { url } = getBase();

  // onDone and onError must fire at most once and are mutually exclusive.
  // An SSE `event: error` frame followed by the body closing would otherwise
  // fire both; the AbortController path must fire neither.
  let settled = false;
  const done = () => {
    if (settled) return;
    settled = true;
    handlers.onDone();
  };
  const fail = (msg: string) => {
    if (settled) return;
    settled = true;
    handlers.onError(msg);
  };
  const guarded: StreamHandlers = {
    ...handlers,
    onDone: done,
    onError: fail,
  };

  (async () => {
    let res: Response;
    try {
      const chatBody: Record<string, unknown> = { messages: messages.map(formatMessageForApi) };
      if (options?.projectPath) chatBody.project_path = options.projectPath;
      res = await fetch(`${url}/chat`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify(chatBody),
        signal: controller.signal,
      });
    } catch (err) {
      if ((err as Error).name === 'AbortError') { settled = true; return; }
      fail(`cannot reach sidecar at ${url} — is it running?`);
      return;
    }

    if (!res.ok || !res.body) {
      let text = '';
      try { text = await res.text(); } catch { /* ignore */ }
      fail(`HTTP ${res.status}: ${text.slice(0, 240)}`);
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    try {
      while (!settled) {
        const { value, done: eof } = await reader.read();
        if (eof) break;
        buffer += decoder.decode(value, { stream: true });

        let sep: number;
        // eslint-disable-next-line no-cond-assign
        while ((sep = buffer.indexOf('\n\n')) !== -1) {
          const frame = buffer.slice(0, sep);
          buffer = buffer.slice(sep + 2);
          parseFrame(frame, guarded);
          if (settled) return;
        }
      }
      done();
    } catch (err) {
      if ((err as Error).name === 'AbortError') { settled = true; return; }
      fail((err as Error).message || String(err));
    }
  })();

  return controller;
}

type AnyRecord = Record<string, unknown>;

function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}
function num(v: unknown, fallback = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}
function bool(v: unknown, fallback = false): boolean {
  return typeof v === 'boolean' ? v : fallback;
}
function obj(v: unknown): AnyRecord {
  return v !== null && typeof v === 'object' ? (v as AnyRecord) : {};
}

function parseFrame(frame: string, h: StreamHandlers): void {
  let event = 'message';
  const dataLines: string[] = [];
  for (const line of frame.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
  }
  if (dataLines.length === 0) return;
  const raw = dataLines.join('\n');
  let data: AnyRecord;
  try {
    data = JSON.parse(raw);
  } catch {
    return;
  }

  switch (event) {
    case 'token':
      if (typeof data.text === 'string') h.onToken(data.text);
      return;
    case 'thinking':
      h.onThinking?.(str(data.text));
      return;
    case 'tool_start':
      h.onToolStart?.({
        id: str(data.id),
        name: str(data.name),
        args: obj(data.args),
        preview: str(data.preview),
        auto_allowed: data.auto_allowed === true ? true : undefined,
        allowed_until_ms:
          typeof data.allowed_until_ms === 'number' ? data.allowed_until_ms : undefined,
      });
      return;
    case 'tool_output':
      h.onToolOutput?.(str(data.id), str(data.chunk));
      return;
    case 'tool_result':
      h.onToolResult?.(str(data.id), {
        ok: bool(data.ok, true),
        summary: str(data.summary),
        truncated: bool(data.truncated),
      });
      return;
    case 'approval_request':
      h.onApprovalRequest?.({
        request_id: str(data.request_id),
        tool_name: str(data.tool_name, 'command'),
        args: obj(data.args),
        preview: str(data.preview),
        severity: (typeof data.severity === 'string'
          ? (data.severity as Severity)
          : 'unknown'),
        received_at: Date.now(),
      });
      return;
    case 'step':
      h.onStep?.({ n: num(data.n), total: num(data.total) });
      return;
    case 'status':
      h.onStatus?.(str(data.text));
      return;
    case 'error':
      h.onError(str(data.message, 'unknown error'));
      return;
    case 'done':
      // The caller's onDone fires via reader EOF — don't double-fire here.
      return;
    default:
      return;
  }
}

/* ── Approval responder ────────────────────────────────────── */

export function respondToApproval(
  requestId: string,
  allow: boolean,
  remember: boolean,
): Promise<{ ok: true }> {
  return req<{ ok: true }>('/approval', {
    method: 'POST',
    body: JSON.stringify({
      request_id: requestId,
      allow,
      remember,
    }),
  });
}

/* ── MCP server management ────────────────────────────────── */

export interface McpServer {
  id: string;
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  enabled: boolean;
  running?: boolean;
  tool_count?: number;
}

export function listMcpServers(): Promise<McpServer[]> {
  return req<McpServer[]>('/mcp/servers');
}

export function addMcpServer(server: McpServer): Promise<{ ok: true; warning?: string }> {
  return req<{ ok: true; warning?: string }>('/mcp/servers', {
    method: 'POST',
    body: JSON.stringify(server),
  });
}

export function removeMcpServer(id: string): Promise<{ ok: true }> {
  return req<{ ok: true }>(`/mcp/servers/${id}`, { method: 'DELETE' });
}

export function toggleMcpServer(id: string): Promise<{ ok: true; enabled: boolean; error?: string }> {
  return req<{ ok: true; enabled: boolean; error?: string }>(`/mcp/servers/${id}/toggle`, {
    method: 'POST',
  });
}

export function listMcpTools(): Promise<Array<{ name: string; description?: string; _server_name: string }>> {
  return req<Array<{ name: string; description?: string; _server_name: string }>>('/mcp/tools');
}

/* ── Knowledge Base ──────────────────────────────────────── */

export interface KbDocument {
  id: string;
  name: string;
  path: string;
  chunk_count: number;
  created_at: number;
}

export interface KbChunk {
  id: string;
  doc_id: string;
  doc_name: string;
  content: string;
  chunk_index: number;
  score: number;
}

export function listKbDocuments(projectId: string): Promise<KbDocument[]> {
  return req<KbDocument[]>(`/kb/${projectId}/documents`);
}

export function addKbDocument(
  projectId: string,
  doc: { name: string; path: string; content: string },
): Promise<{ ok: true; id: string; chunk_count: number }> {
  return req<{ ok: true; id: string; chunk_count: number }>(`/kb/${projectId}/documents`, {
    method: 'POST',
    body: JSON.stringify(doc),
  });
}

export function removeKbDocument(projectId: string, docId: string): Promise<{ ok: true }> {
  return req<{ ok: true }>(`/kb/${projectId}/documents/${docId}`, { method: 'DELETE' });
}

export function searchKb(projectId: string, query: string, limit = 5): Promise<KbChunk[]> {
  return req<KbChunk[]>(`/kb/${projectId}/search?q=${encodeURIComponent(query)}&limit=${limit}`);
}

/* ── Routines (scheduled AI tasks) ─────────────────────── */

export interface RoutineConfig {
  id: string;
  name: string;
  prompt: string;
  cron: string;
  project_id?: string | null;
  project_path?: string | null;
  enabled: boolean;
  created_at: number;
  last_run_at?: number | null;
  last_status?: string | null;
}

export interface RoutineRunResult {
  routine_id: string;
  started_at: number;
  finished_at: number;
  status: string;
  output: string;
  error?: string | null;
}

export function listRoutines(): Promise<RoutineConfig[]> {
  return req<RoutineConfig[]>('/routines');
}

export function upsertRoutine(routine: Partial<RoutineConfig> & { name: string; prompt: string }): Promise<{ ok: true; id: string }> {
  return req<{ ok: true; id: string }>('/routines', {
    method: 'POST',
    body: JSON.stringify(routine),
  });
}

export function deleteRoutine(id: string): Promise<{ ok: true }> {
  return req<{ ok: true }>(`/routines/${id}`, { method: 'DELETE' });
}

export function toggleRoutine(id: string): Promise<{ ok: true; enabled: boolean }> {
  return req<{ ok: true; enabled: boolean }>(`/routines/${id}/toggle`, { method: 'POST' });
}

export function runRoutineNow(id: string): Promise<{ ok: true; status: string; output: string }> {
  return req<{ ok: true; status: string; output: string }>(`/routines/${id}/run`, { method: 'POST' });
}

export function getRoutineHistory(id: string, limit = 10): Promise<RoutineRunResult[]> {
  return req<RoutineRunResult[]>(`/routines/${id}/history?limit=${limit}`);
}


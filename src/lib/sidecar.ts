/* ══════════════════════════════════════════════════════════
   BITIDEA Desktop · Sidecar Client
   Talks to the local Python FastAPI subprocess over HTTP + SSE.
   ══════════════════════════════════════════════════════════ */

import { invoke } from '@tauri-apps/api/core';
import type {
  Config,
  ConfigInput,
  Message,
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

export interface StreamHandlers {
  onToken: (text: string) => void;
  onDone: () => void;
  onError: (message: string) => void;
}

/**
 * Stream a chat completion. Returns an AbortController the caller can use
 * to cancel the stream (stop button). Handlers never throw.
 */
export function streamChat(
  messages: Pick<Message, 'role' | 'content'>[],
  handlers: StreamHandlers,
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
    onToken: handlers.onToken,
    onDone: done,
    onError: fail,
  };

  (async () => {
    let res: Response;
    try {
      res = await fetch(`${url}/chat`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ messages }),
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

function parseFrame(frame: string, h: StreamHandlers): void {
  let event = 'message';
  const dataLines: string[] = [];
  for (const line of frame.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
  }
  if (dataLines.length === 0) return;
  const raw = dataLines.join('\n');
  let data: { text?: unknown; message?: unknown };
  try {
    data = JSON.parse(raw);
  } catch {
    return;
  }
  if (event === 'token' && typeof data.text === 'string') h.onToken(data.text);
  else if (event === 'error') h.onError(String(data.message ?? 'unknown error'));
}


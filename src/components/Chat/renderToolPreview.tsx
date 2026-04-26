import type { ReactNode } from 'react';

const SHELL_TOOL_NAMES = new Set(['terminal', 'shell', 'bash', 'execute_command']);
const NETWORK_TOOL_NAMES = new Set(['http_get', 'http_post', 'fetch']);
const FILE_WRITE_TOOL_NAMES = new Set(['write_file', 'edit_file', 'create_file']);
const SKILL_TOOL_NAMES = new Set(['skill_view']);
const INLINE_IMAGE_PREFIX = 'data:image/';

function formatByteCount(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function summarizeString(value: string): string {
  if (value.startsWith(INLINE_IMAGE_PREFIX)) {
    const commaIndex = value.indexOf(',');
    const header = commaIndex >= 0 ? value.slice(5, commaIndex) : value.slice(5);
    const semicolonIndex = header.indexOf(';');
    const mime = (semicolonIndex >= 0 ? header.slice(0, semicolonIndex) : header) || 'image';
    const payloadLength = commaIndex >= 0 ? Math.max(0, value.length - commaIndex - 1) : value.length;
    const approxBytes = Math.floor((payloadLength * 3) / 4);
    return `[inline image: ${mime}, ${formatByteCount(approxBytes)}]`;
  }
  if (value.length > 500) {
    return `${value.slice(0, 220)}… (${value.length} chars)`;
  }
  return value;
}

function sanitizePreviewValue(value: unknown): unknown {
  if (typeof value === 'string') return summarizeString(value);
  if (Array.isArray(value)) return value.map(sanitizePreviewValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, sanitizePreviewValue(v)]),
    );
  }
  return value;
}

function firstString(args: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = args[k];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return null;
}

function renderShell(command: string): ReactNode {
  const [head, ...rest] = command.split(/(\s+)/); // keep whitespace tokens
  return (
    <pre className="tool-preview-shell">
      <span className="tool-preview-prompt">$ </span>
      <span className="tool-preview-cmd-head">{head}</span>
      {rest.join('')}
    </pre>
  );
}

function renderFileWrite(args: Record<string, unknown>): ReactNode {
  const path = firstString(args, ['path', 'file_path', 'filename']);
  const content = firstString(args, ['content', 'text']);
  return (
    <div className="tool-preview-file">
      {path && <div className="tool-preview-path">{path}</div>}
      {content && content.length < 400 && (
        <pre className="tool-preview-content">{content}</pre>
      )}
    </div>
  );
}

function renderNetwork(args: Record<string, unknown>): ReactNode {
  const method =
    (firstString(args, ['method']) ?? 'GET').toUpperCase();
  const url = summarizeString(firstString(args, ['url', 'endpoint']) ?? '');
  return (
    <pre className="tool-preview-network">
      <span className="tool-preview-method">{method}</span> {url}
    </pre>
  );
}

function skillName(args: Record<string, unknown>): string | null {
  return firstString(args, ['name', 'skill_name', 'skill']);
}

function renderSkill(args: Record<string, unknown>): ReactNode {
  const name = skillName(args);
  if (!name) return renderJson(args);
  return (
    <pre className="tool-preview-skill">
      {name}
    </pre>
  );
}

function renderJson(args: Record<string, unknown>): ReactNode {
  return <pre className="tool-preview-json">{JSON.stringify(sanitizePreviewValue(args), null, 2)}</pre>;
}

/**
 * Render a tool invocation's args in a human-legible form. Used by both
 * ApprovalModal (for the request preview) and ToolCard (for the header /
 * expanded body).
 */
export function renderToolPreview(
  toolName: string,
  args: Record<string, unknown>,
): ReactNode {
  const name = (toolName ?? '').toLowerCase();
  const command = firstString(args, ['command']);
  if (command) {
    return renderShell(command);
  }
  if (SHELL_TOOL_NAMES.has(name)) {
    return renderJson(args);
  }
  if (FILE_WRITE_TOOL_NAMES.has(name)) {
    return renderFileWrite(args);
  }
  if (NETWORK_TOOL_NAMES.has(name)) {
    return renderNetwork(args);
  }
  if (SKILL_TOOL_NAMES.has(name)) {
    return renderSkill(args);
  }
  return renderJson(args);
}

/** One-line text preview for use in collapsed headers. */
export function renderToolPreviewLine(
  toolName: string,
  args: Record<string, unknown>,
): string {
  const name = (toolName ?? '').toLowerCase();
  const command = firstString(args, ['command']);
  if (command) {
    return `$ ${command}`;
  }
  if (SHELL_TOOL_NAMES.has(name)) {
    return '';
  }
  if (FILE_WRITE_TOOL_NAMES.has(name)) {
    const path = firstString(args, ['path', 'file_path', 'filename']);
    if (path) return path;
  }
  if (NETWORK_TOOL_NAMES.has(name)) {
    const method = (firstString(args, ['method']) ?? 'GET').toUpperCase();
    const url = summarizeString(firstString(args, ['url', 'endpoint']) ?? '');
    return `${method} ${url}`.trim();
  }
  if (SKILL_TOOL_NAMES.has(name)) {
    const value = skillName(args);
    if (value) return value;
  }
  try {
    return JSON.stringify(sanitizePreviewValue(args));
  } catch {
    return '';
  }
}

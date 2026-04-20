import type { ReactNode } from 'react';

const SHELL_TOOL_NAMES = new Set(['terminal', 'shell', 'bash', 'execute_command']);
const NETWORK_TOOL_NAMES = new Set(['http_get', 'http_post', 'fetch']);
const FILE_WRITE_TOOL_NAMES = new Set(['write_file', 'edit_file', 'create_file']);

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
  const url = firstString(args, ['url', 'endpoint']) ?? '';
  return (
    <pre className="tool-preview-network">
      <span className="tool-preview-method">{method}</span> {url}
    </pre>
  );
}

function renderJson(args: Record<string, unknown>): ReactNode {
  return <pre className="tool-preview-json">{JSON.stringify(args, null, 2)}</pre>;
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
  if (SHELL_TOOL_NAMES.has(name)) {
    const cmd = firstString(args, ['command']);
    if (cmd) return renderShell(cmd);
    return renderJson(args);
  }
  if (FILE_WRITE_TOOL_NAMES.has(name)) {
    return renderFileWrite(args);
  }
  if (NETWORK_TOOL_NAMES.has(name)) {
    return renderNetwork(args);
  }
  return renderJson(args);
}

/** One-line text preview for use in collapsed headers. */
export function renderToolPreviewLine(
  toolName: string,
  args: Record<string, unknown>,
): string {
  const name = (toolName ?? '').toLowerCase();
  if (SHELL_TOOL_NAMES.has(name)) {
    const cmd = firstString(args, ['command']);
    if (cmd) return `$ ${cmd}`;
  }
  if (FILE_WRITE_TOOL_NAMES.has(name)) {
    const path = firstString(args, ['path', 'file_path', 'filename']);
    if (path) return path;
  }
  if (NETWORK_TOOL_NAMES.has(name)) {
    const method = (firstString(args, ['method']) ?? 'GET').toUpperCase();
    const url = firstString(args, ['url', 'endpoint']) ?? '';
    return `${method} ${url}`.trim();
  }
  try {
    return JSON.stringify(args);
  } catch {
    return '';
  }
}

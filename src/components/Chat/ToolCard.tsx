import { useState } from 'react';
import type { ToolEvent } from '../../types';
import { useCountdown } from './useCountdown';
import { renderToolPreviewLine } from './renderToolPreview';
import './ToolCard.css';

interface Props {
  tool: ToolEvent;
}

export default function ToolCard({ tool }: Props) {
  const isRunning = tool.result === undefined;
  const ok = tool.result?.ok ?? true;
  const [expanded, setExpanded] = useState(true);

  const statusGlyph = isRunning ? '◇' : ok ? '✓' : '✕';
  const statusClass = isRunning ? 'running' : ok ? 'ok' : 'fail';

  // Prefer the shared renderer's one-line preview (so terminal tools show
  // `$ mkdir x` instead of `{"command":"mkdir x"}`). Fall back to the
  // server-supplied preview string if the helper returns empty.
  const preview =
    renderToolPreviewLine(tool.name, tool.args) ||
    tool.preview?.trim() ||
    '';

  const remaining = useCountdown(tool.allowed_until_ms);
  const showBadge = tool.auto_allowed === true;

  return (
    <div className={`tool-card tool-${statusClass}`}>
      <button
        type="button"
        className="tool-head"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <span className={`tool-glyph tool-glyph-${statusClass}`} aria-hidden>
          {statusGlyph}
        </span>
        <span className="tool-name">{tool.name || 'tool'}</span>
        {preview && <span className="tool-preview">{preview}</span>}
        {showBadge && (
          <span
            className={`tool-auto ${remaining !== null && remaining <= 0 ? 'tool-auto-fade' : ''}`}
            aria-label="auto-allowed via remember cache"
          >
            ✓ auto{remaining !== null && remaining > 0 ? ` · ${remaining}s` : ''}
          </span>
        )}
        <span className="tool-caret" aria-hidden>
          {expanded ? '▾' : '▸'}
        </span>
      </button>

      {expanded && (
        <div className="tool-body">
          {Object.keys(tool.args).length > 0 && (
            <pre className="tool-args">{JSON.stringify(tool.args, null, 2)}</pre>
          )}
          {tool.output && <pre className="tool-output">{tool.output}</pre>}
          {tool.result && (
            <div className={`tool-result tool-result-${ok ? 'ok' : 'fail'}`}>
              <span className="tool-result-label">
                {ok ? 'RESULT' : 'ERROR'}
                {tool.result.truncated && ' · truncated'}
              </span>
              {tool.result.summary && (
                <pre className="tool-result-body">{tool.result.summary}</pre>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

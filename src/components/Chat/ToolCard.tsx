import { useEffect, useRef, useState } from 'react';
import type { ToolEvent } from '../../types';
import { useCountdown } from './useCountdown';
import { renderToolPreviewLine } from './renderToolPreview';
import './ToolCard.css';

interface Props {
  tool: ToolEvent;
}

export default function ToolCard({ tool }: Props) {
  const normalizedToolName = (tool.name ?? '').toLowerCase();
  const isSkillView = normalizedToolName === 'skill_view';
  const isRunning = tool.result === undefined;
  const ok = tool.result?.ok ?? true;
  const [expanded, setExpanded] = useState(true);
  const outputRef = useRef<HTMLPreElement | null>(null);

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
  const hasArgs = Object.keys(tool.args).length > 0;
  const hasOutput = tool.output.trim().length > 0;
  const skillDisplayName = isSkillView
    ? renderToolPreviewLine(tool.name, tool.args)
    : '';

  useEffect(() => {
    if (!isRunning || !outputRef.current) return;
    outputRef.current.scrollTop = outputRef.current.scrollHeight;
  }, [tool.output, isRunning]);

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
          {hasArgs && (
            <pre className="tool-args">
              {isSkillView && skillDisplayName
                ? skillDisplayName
                : JSON.stringify(tool.args, null, 2)}
            </pre>
          )}
          {(hasOutput || isRunning) && (
            <div className={`tool-stream ${isRunning ? 'tool-stream-live' : ''}`}>
              <div className="tool-stream-head">
                <span className="tool-stream-label">
                  {isRunning ? 'LIVE OUTPUT' : 'OUTPUT'}
                </span>
                {isRunning && <span className="tool-stream-state">streaming</span>}
              </div>
              <pre
                ref={outputRef}
                className={`tool-output ${!hasOutput ? 'tool-output-empty' : ''}`}
                aria-live={isRunning ? 'polite' : undefined}
              >
                {hasOutput ? tool.output : '等待工具输出...'}
                {isRunning && <span className="tool-output-caret" aria-hidden>▍</span>}
              </pre>
            </div>
          )}
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

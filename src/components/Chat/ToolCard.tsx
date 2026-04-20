import { useState } from 'react';
import type { ToolEvent } from '../../types';
import './ToolCard.css';

interface Props {
  tool: ToolEvent;
}

/** Collapsible terminal-style card showing one tool invocation:
 *  header (name + status icon), args block, streaming output, final result. */
export default function ToolCard({ tool }: Props) {
  const isRunning = tool.result === undefined;
  const ok = tool.result?.ok ?? true;
  // Default expanded while running, collapsed once the result lands.
  const [expanded, setExpanded] = useState(true);

  const statusGlyph = isRunning ? '◇' : ok ? '✓' : '✕';
  const statusClass = isRunning ? 'running' : ok ? 'ok' : 'fail';

  // Preview line under the header: command text if we have one, otherwise
  // a compact serialisation of the args object.
  const preview =
    tool.preview?.trim() ||
    (tool.args && Object.keys(tool.args).length > 0
      ? JSON.stringify(tool.args)
      : '');

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

import { useCallback, useEffect, useRef, useState } from 'react';
import { getPresetsForProvider } from '../../lib/modelPresets';
import type { ModelPreset } from '../../lib/modelPresets';
import './ModelPicker.css';

interface Props {
  provider: string;
  model: string;
  onModelChange: (model: string) => void;
}

export default function ModelPicker({ provider, model, onModelChange }: Props) {
  const [open, setOpen] = useState(false);
  const [customInput, setCustomInput] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const presets = getPresetsForProvider(provider);

  // Find a display label for the current model.
  const activePreset = presets.find((p) => p.id === model);
  const displayLabel = activePreset?.label ?? model ?? 'select model';

  // Close on click outside.
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open]);

  const select = useCallback(
    (id: string) => {
      onModelChange(id);
      setOpen(false);
      setCustomInput('');
    },
    [onModelChange],
  );

  function handleCustomSubmit() {
    const trimmed = customInput.trim();
    if (trimmed) {
      select(trimmed);
    }
  }

  function handleCustomKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleCustomSubmit();
    }
  }

  return (
    <div className="model-picker" ref={rootRef}>
      <button
        type="button"
        className={`model-picker-chip${open ? ' open' : ''}`}
        onClick={() => setOpen((v) => !v)}
        title={model}
      >
        <span>{displayLabel}</span>
        <span className="model-picker-chevron" aria-hidden>▾</span>
      </button>

      {open && (
        <div className="model-picker-dropdown">
          {presets.map((p: ModelPreset) => (
            <button
              key={p.id}
              type="button"
              className={`model-picker-item${p.id === model ? ' active' : ''}`}
              onClick={() => select(p.id)}
            >
              <span className="model-picker-check">
                {p.id === model ? '●' : ''}
              </span>
              <span className="model-picker-item-label">{p.label}</span>
              {p.label !== p.id && (
                <span className="model-picker-item-id">{p.id}</span>
              )}
            </button>
          ))}

          <div className="model-picker-custom">
            <input
              ref={inputRef}
              type="text"
              placeholder="custom model ID…"
              value={customInput}
              onChange={(e) => setCustomInput(e.target.value)}
              onKeyDown={handleCustomKeyDown}
              spellCheck={false}
              autoComplete="off"
            />
            <button
              type="button"
              disabled={!customInput.trim()}
              onClick={handleCustomSubmit}
            >
              OK
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

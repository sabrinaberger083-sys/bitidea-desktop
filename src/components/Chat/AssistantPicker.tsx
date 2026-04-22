import { useEffect, useRef, useState } from 'react';
import type { Assistant, Lang } from '../../types';
import './AssistantPicker.css';

const COPY = {
  en: { general: 'General', newAssistant: '+ New Assistant', builtin: 'Built-in', custom: 'Custom' },
  zh: { general: '通用', newAssistant: '+ 新建助手', builtin: '内置', custom: '自定义' },
};

interface Props {
  lang: Lang;
  assistants: Assistant[];
  currentId: string | null;
  onChange: (id: string | null) => void;
  onCreateNew: () => void;
}

export default function AssistantPicker({
  lang,
  assistants,
  currentId,
  onChange,
  onCreateNew,
}: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const L = COPY[lang];

  const builtin = assistants.filter((a) => a.builtin);
  const custom = assistants.filter((a) => !a.builtin);

  const currentAssistant = currentId ? assistants.find((a) => a.id === currentId) : null;
  const chipLabel = currentAssistant
    ? `${currentAssistant.icon} ${currentAssistant.name}`
    : `🤖 ${L.general}`;

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

  function select(id: string | null) {
    onChange(id);
    setOpen(false);
  }

  function handleCreateNew() {
    setOpen(false);
    onCreateNew();
  }

  return (
    <div className="assistant-picker" ref={rootRef}>
      <button
        type="button"
        className={`assistant-picker-chip${open ? ' open' : ''}`}
        onClick={() => setOpen((v) => !v)}
        title={currentAssistant?.name ?? L.general}
      >
        <span>{chipLabel}</span>
        <span className="assistant-picker-chevron" aria-hidden>▾</span>
      </button>

      {open && (
        <div className="assistant-picker-dropdown">
          {/* General option */}
          <button
            type="button"
            className={`assistant-picker-item${currentId === null ? ' active' : ''}`}
            onClick={() => select(null)}
          >
            <span className="assistant-picker-check">
              {currentId === null ? '●' : ''}
            </span>
            <span className="assistant-picker-icon">🤖</span>
            <span className="assistant-picker-item-body">
              <span className="assistant-picker-item-name">{L.general}</span>
            </span>
          </button>

          <div className="assistant-picker-divider" />

          {/* Built-in assistants */}
          {builtin.map((a) => (
            <button
              key={a.id}
              type="button"
              className={`assistant-picker-item${a.id === currentId ? ' active' : ''}`}
              onClick={() => select(a.id)}
            >
              <span className="assistant-picker-check">
                {a.id === currentId ? '●' : ''}
              </span>
              <span className="assistant-picker-icon">{a.icon}</span>
              <span className="assistant-picker-item-body">
                <span className="assistant-picker-item-name">{a.name}</span>
                {a.description && (
                  <span className="assistant-picker-item-desc">{a.description}</span>
                )}
              </span>
            </button>
          ))}

          {/* Custom assistants section */}
          {custom.length > 0 && (
            <>
              <div className="assistant-picker-divider" />
              {custom.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  className={`assistant-picker-item${a.id === currentId ? ' active' : ''}`}
                  onClick={() => select(a.id)}
                >
                  <span className="assistant-picker-check">
                    {a.id === currentId ? '●' : ''}
                  </span>
                  <span className="assistant-picker-icon">{a.icon}</span>
                  <span className="assistant-picker-item-body">
                    <span className="assistant-picker-item-name">{a.name}</span>
                    {a.description && (
                      <span className="assistant-picker-item-desc">{a.description}</span>
                    )}
                  </span>
                </button>
              ))}
            </>
          )}

          <div className="assistant-picker-divider" />

          {/* New assistant button */}
          <button
            type="button"
            className="assistant-picker-new"
            onClick={handleCreateNew}
          >
            {L.newAssistant}
          </button>
        </div>
      )}
    </div>
  );
}

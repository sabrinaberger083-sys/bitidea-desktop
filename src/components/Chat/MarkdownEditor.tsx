import { useCallback, useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { invoke } from '@tauri-apps/api/core';
import type { Lang } from '../../types';
import './MarkdownEditor.css';

interface Props {
  filePath: string;
  lang: Lang;
  onClose: () => void;
}

const COPY = {
  en: {
    save: 'Save',
    saved: '✓ Saved',
    close: 'Close',
  },
  zh: {
    save: '保存',
    saved: '✓ 已保存',
    close: '关闭',
  },
} as const;

export default function MarkdownEditor({ filePath, lang, onClose }: Props) {
  const [content, setContent] = useState('');
  const [savedContent, setSavedContent] = useState('');
  const [justSaved, setJustSaved] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const t = COPY[lang];

  const dirty = content !== savedContent;
  const filename = filePath.split('/').pop() || filePath;

  /* Load file on mount */
  useEffect(() => {
    let cancelled = false;
    invoke<string>('read_text_file', { path: filePath })
      .then((text) => {
        if (!cancelled) {
          setContent(text);
          setSavedContent(text);
        }
      })
      .catch((err) => {
        console.error('Failed to read file:', err);
      });
    return () => { cancelled = true; };
  }, [filePath]);

  /* Save handler */
  const handleSave = useCallback(async () => {
    try {
      await invoke('write_text_file', { path: filePath, content });
      setSavedContent(content);
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 2000);
    } catch (err) {
      console.error('Failed to save file:', err);
    }
  }, [filePath, content]);

  /* Keyboard shortcuts: Cmd+S to save, Escape to close */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 's' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        handleSave();
      } else if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handleSave, onClose]);

  /* Auto-focus textarea on mount */
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  return (
    <aside className="mde-panel">
      <header className="mde-header">
        <div className="mde-header-left">
          <span className="mde-badge">MD</span>
          <span className="mde-filename">
            {filename}{dirty ? ' *' : ''}
          </span>
        </div>
        <div className="mde-header-right">
          <button
            className="ap-btn"
            onClick={handleSave}
            disabled={!dirty && !justSaved}
            title={t.save}
          >
            {justSaved ? t.saved : t.save}
          </button>
          <button
            className="ap-btn ap-btn-close"
            onClick={onClose}
            title={t.close}
          >
            &#x2715;
          </button>
        </div>
      </header>

      <div className="mde-body">
        <div className="mde-editor">
          <textarea
            ref={textareaRef}
            className="mde-textarea"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            spellCheck={false}
          />
        </div>

        <div className="mde-preview md">
          <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
            {content}
          </ReactMarkdown>
        </div>
      </div>
    </aside>
  );
}

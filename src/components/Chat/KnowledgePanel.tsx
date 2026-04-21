import { useCallback, useEffect, useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import {
  addKbDocument,
  listKbDocuments,
  removeKbDocument,
} from '../../lib/sidecar';
import type { KbDocument } from '../../lib/sidecar';
import type { Lang } from '../../types';
import './KnowledgePanel.css';

const COPY = {
  en: {
    title: 'Knowledge Base',
    importBtn: 'Import Documents',
    importing: 'Importing...',
    empty: 'No documents imported yet',
    chunks: 'chunks',
  },
  zh: {
    title: '知识库',
    importBtn: '导入文档',
    importing: '导入中...',
    empty: '还没有导入文档',
    chunks: '个片段',
  },
};

// Supported extensions for file dialog filter
const KB_EXTENSIONS = ['md', 'txt', 'pdf'];

/**
 * Derive the same KB project ID the sidecar uses:
 * sha256(projectPath)[:16] (hex).
 */
async function deriveKbId(path: string): Promise<string> {
  const data = new TextEncoder().encode(path);
  const buf = await crypto.subtle.digest('SHA-256', data);
  const hex = Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return hex.slice(0, 16);
}

interface Props {
  lang: Lang;
  /** The absolute project directory path (used to derive KB id). */
  projectId: string;
}

export default function KnowledgePanel({ lang, projectId: projectPath }: Props) {
  const L = COPY[lang];
  const [kbId, setKbId] = useState<string | null>(null);
  const [documents, setDocuments] = useState<KbDocument[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [importing, setImporting] = useState(false);

  // Compute the hash-based KB id whenever path changes
  useEffect(() => {
    let cancelled = false;
    deriveKbId(projectPath).then((id) => {
      if (!cancelled) setKbId(id);
    });
    return () => { cancelled = true; };
  }, [projectPath]);

  const refresh = useCallback(async () => {
    if (!kbId) return;
    try {
      const docs = await listKbDocuments(kbId);
      setDocuments(docs);
    } catch (e) {
      console.error('kb list failed', e);
    }
  }, [kbId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function handleImport() {
    if (!kbId) return;
    try {
      const selected = await open({
        multiple: true,
        filters: [
          {
            name: 'Documents',
            extensions: KB_EXTENSIONS,
          },
        ],
      });
      if (!selected) return;

      const paths = Array.isArray(selected) ? selected : [selected];
      if (paths.length === 0) return;

      setImporting(true);
      for (const filePath of paths) {
        try {
          const content = await invoke<string>('read_text_file', { path: filePath });
          const segments = filePath.replace(/[/\\]+$/, '').split(/[/\\]/);
          const name = segments[segments.length - 1] || filePath;
          await addKbDocument(kbId, { name, path: filePath, content });
        } catch (e) {
          console.error('import file failed', filePath, e);
        }
      }
      await refresh();
    } catch (e) {
      console.error('file dialog failed', e);
    } finally {
      setImporting(false);
    }
  }

  async function handleRemove(docId: string) {
    if (!kbId) return;
    try {
      await removeKbDocument(kbId, docId);
      setDocuments((prev) => prev.filter((d) => d.id !== docId));
    } catch (e) {
      console.error('kb remove failed', e);
    }
  }

  function docIcon(name: string): string {
    if (name.endsWith('.md')) return '📝';
    if (name.endsWith('.pdf')) return '📄';
    return '📃';
  }

  return (
    <div className="kb-section">
      <button
        type="button"
        className="kb-toggle"
        onClick={() => setExpanded(!expanded)}
      >
        <span className="kb-toggle-icon">{'📚'}</span>
        <span className="kb-toggle-label">{L.title}</span>
        {documents.length > 0 && (
          <span className="kb-toggle-count">{documents.length}</span>
        )}
        <span
          className={`kb-toggle-arrow ${expanded ? 'kb-toggle-arrow-open' : ''}`}
        >
          {'▼'}
        </span>
      </button>

      {expanded && (
        <div className="kb-panel">
          {documents.length > 0 ? (
            <div className="kb-doc-list">
              {documents.map((doc) => (
                <div key={doc.id} className="kb-doc-item">
                  <span className="kb-doc-icon">{docIcon(doc.name)}</span>
                  <div className="kb-doc-info">
                    <div className="kb-doc-name" title={doc.path}>
                      {doc.name}
                    </div>
                    <div className="kb-doc-meta">
                      {doc.chunk_count} {L.chunks}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="kb-doc-remove"
                    onClick={() => handleRemove(doc.id)}
                    title={lang === 'zh' ? '删除' : 'Delete'}
                  >
                    {'✕'}
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="kb-empty">{L.empty}</div>
          )}

          <button
            type="button"
            className="kb-import-btn"
            onClick={handleImport}
            disabled={importing}
          >
            {importing ? L.importing : `+ ${L.importBtn}`}
          </button>
        </div>
      )}
    </div>
  );
}

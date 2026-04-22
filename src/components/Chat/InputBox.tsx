import { useEffect, useRef, useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import Button from '../common/Button';
import type { Attachment, Lang } from '../../types';
import './InputBox.css';

const COPY = {
  en: {
    placeholder: 'Type your message — Cmd+Enter to send, Shift+Enter for newline',
    send: 'SEND',
    stop: 'STOP',
    dropHint: 'Drop files here',
    attach: 'Attach',
  },
  zh: {
    placeholder: '输入内容 — Cmd+Enter 发送，Shift+Enter 换行',
    send: '发送',
    stop: '停止',
    dropHint: '拖放文件到此处',
    attach: '附件',
  },
};

interface Props {
  lang: Lang;
  streaming: boolean;
  onSend: (text: string, attachments?: Attachment[]) => void;
  onStop: () => void;
}

const LINE_HEIGHT_PX = 22;
const MIN_LINES = 1;
const MAX_LINES = 10;

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp']);
const IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

const MIME_MAP: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  gif: 'image/gif', webp: 'image/webp',
};

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(',')[1]);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function attachFromPath(filePath: string): Promise<Attachment> {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  const name = filePath.split(/[/\\]/).pop() ?? filePath;
  if (IMAGE_EXTS.has(ext)) {
    const base64 = await invoke<string>('read_binary_file', { path: filePath });
    return {
      id: crypto.randomUUID(), type: 'image', name,
      mime: MIME_MAP[ext] ?? 'image/png', data: base64, size: base64.length,
    };
  }
  const text = await invoke<string>('read_text_file', { path: filePath });
  return {
    id: crypto.randomUUID(), type: 'file', name,
    mime: 'text/plain', data: text, size: text.length,
  };
}

export default function InputBox({ lang, streaming, onSend, onStop }: Props) {
  const L = COPY[lang];
  const [text, setText] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const ref = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    const max = LINE_HEIGHT_PX * MAX_LINES + 24;
    el.style.height = Math.min(el.scrollHeight, max) + 'px';
  }, [text]);

  // Tauri native drag-and-drop (browser drag events are intercepted by Tauri)
  useEffect(() => {
    const webview = getCurrentWebview();
    const unlistenPromise = webview.onDragDropEvent(async (event) => {
      if (event.payload.type === 'enter' || event.payload.type === 'over') {
        setDragOver(true);
      } else if (event.payload.type === 'leave') {
        setDragOver(false);
      } else if (event.payload.type === 'drop') {
        setDragOver(false);
        for (const filePath of event.payload.paths) {
          try {
            const att = await attachFromPath(filePath);
            setAttachments(prev => [...prev, att]);
          } catch (e) {
            console.error('drop file failed', filePath, e);
          }
        }
      }
    });
    return () => { unlistenPromise.then(fn => fn()); };
  }, []);

  function submit() {
    if ((!text.trim() && attachments.length === 0) || streaming) return;
    onSend(text, attachments.length > 0 ? attachments : undefined);
    setText('');
    setAttachments([]);
    requestAnimationFrame(() => ref.current?.focus());
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    const mod = e.metaKey || e.ctrlKey;
    if (e.key === 'Enter' && mod && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  async function onPaste(e: React.ClipboardEvent) {
    const items = e.clipboardData?.items;
    if (!items) return;

    for (const item of Array.from(items)) {
      if (item.kind === 'file' && IMAGE_MIMES.has(item.type)) {
        e.preventDefault();
        const file = item.getAsFile();
        if (!file) continue;
        const base64 = await fileToBase64(file);
        setAttachments(prev => [...prev, {
          id: crypto.randomUUID(),
          type: 'image',
          name: file.name || 'pasted-image.png',
          mime: file.type,
          data: base64,
          size: file.size,
        }]);
        return;
      }
    }
  }

  async function handleAttachClick() {
    try {
      const selected = await open({
        multiple: true,
        filters: [
          { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] },
          { name: 'Documents', extensions: ['pdf', 'txt', 'md'] },
        ],
      });
      if (!selected) return;
      const paths = Array.isArray(selected) ? selected : [selected];
      for (const filePath of paths) {
        try {
          const att = await attachFromPath(filePath);
          setAttachments(prev => [...prev, att]);
        } catch (e) {
          console.error('attach failed', filePath, e);
        }
      }
    } catch (e) {
      console.error('file dialog failed', e);
    }
  }

  const minHeight = LINE_HEIGHT_PX * MIN_LINES + 24;

  return (
    <div className={`input-wrap ${dragOver ? 'input-drag-over' : ''}`}>
      {dragOver && (
        <div className="drop-overlay">{L.dropHint}</div>
      )}
      {attachments.length > 0 && (
        <div className="attach-preview-strip">
          {attachments.map((att) => (
            <div key={att.id} className={`attach-chip ${att.type === 'image' ? 'attach-chip-img' : 'attach-chip-file'}`}>
              {att.type === 'image' ? (
                <img src={`data:${att.mime};base64,${att.data}`} alt={att.name} className="attach-thumb" />
              ) : (
                <span className="attach-file-icon">{att.name.endsWith('.pdf') ? '📄' : '📝'}</span>
              )}
              <span className="attach-name">{att.name}</span>
              <button
                type="button"
                className="attach-remove"
                onClick={() => setAttachments(prev => prev.filter(a => a.id !== att.id))}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="input-bar">
        <textarea
          ref={ref}
          className="textarea mono-ish"
          placeholder={L.placeholder}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          rows={1}
          style={{ minHeight }}
          disabled={streaming}
        />
        <button
          type="button"
          className="attach-btn"
          onClick={handleAttachClick}
          disabled={streaming}
          title={L.attach}
        >
          📎
        </button>
        {streaming ? (
          <Button variant="danger" size="md" onClick={onStop}>
            ■ {L.stop}
          </Button>
        ) : (
          <Button
            variant="primary"
            size="md"
            arrow
            onClick={submit}
            disabled={!text.trim() && attachments.length === 0}
          >
            {L.send}
          </Button>
        )}
      </div>
    </div>
  );
}

import { useCallback, useEffect, useRef, useState } from 'react';
import Logo from '../common/Logo';
import Button from '../common/Button';
import ModelPicker from './ModelPicker';
import MessageList from './MessageList';
import InputBox from './InputBox';
import ApprovalModal from './ApprovalModal';
import ArtifactPreview from './ArtifactPreview';
import MarkdownEditor from './MarkdownEditor';
import SettingsPanel from '../Settings/SettingsPanel';
import ConversationSidebar from './ConversationSidebar';
import ConfirmDeleteModal from './ConfirmDeleteModal';
import AssistantPicker from './AssistantPicker';
import AssistantEditor from '../Settings/AssistantEditor';
import { respondToApproval, saveConfig, streamChat } from '../../lib/sidecar';
import {
  deriveTitle,
  getMessages,
  getMostRecentConversationId,
  openDb,
  updateConversationTimestamp,
  upsertMessage,
  vacuumOldDeletions,
  listAssistants,
  upsertAssistant,
  deleteAssistant,
  seedBuiltinAssistants,
} from '../../lib/db';
import { getBuiltinAssistants } from '../../lib/assistantPresets';
import { conversationToMarkdown, sanitizeFilename } from '../../lib/exportMarkdown';
import { conversationToPdf, conversationToDocx } from '../../lib/exportFormats';
import { useConversations } from '../../hooks/useConversations';
import { useStreamManager } from '../../hooks/useStreamManager';
import type { Artifact } from '../../lib/artifacts';
import { getProject } from '../../lib/db';
import type {
  ApprovalRequest,
  Assistant,
  AssistantEvent,
  Attachment,
  Config,
  Lang,
  Message,
  SearchHit,
  StoredMessage,
  TextEvent,
  ThinkingEvent,
  ToolEvent,
} from '../../types';
import { open as openFileDialog, save as showSaveDialog } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import './ChatWindow.css';

const COPY = {
  en: { settings: 'SETTINGS' },
  zh: { settings: '设置' },
};

interface Props {
  lang: Lang;
  onLangChange: (l: Lang) => void;
  config: Config | null;
  onConfigChanged: (c: Config) => void;
}

function updateAssistant(
  msgs: Message[],
  id: string,
  fn: (m: Message) => Message,
): Message[] {
  return msgs.map((m) => (m.id === id ? fn(m) : m));
}

function appendTextEvent(events: AssistantEvent[], text: string): AssistantEvent[] {
  if (!text) return events;
  const last = events[events.length - 1];
  if (last && last.kind === 'text') {
    const next: TextEvent = { kind: 'text', text: last.text + text };
    return [...events.slice(0, -1), next];
  }
  return [...events, { kind: 'text', text }];
}

function appendThinkingEvent(events: AssistantEvent[], chunk: string): AssistantEvent[] {
  if (!chunk) return events;
  const last = events[events.length - 1];
  if (last && last.kind === 'thinking') {
    const next: ThinkingEvent = { kind: 'thinking', text: last.text + chunk };
    return [...events.slice(0, -1), next];
  }
  return [...events, { kind: 'thinking', text: chunk }];
}

function upsertTool(
  events: AssistantEvent[],
  id: string,
  mutate: (t: ToolEvent) => ToolEvent,
  fallback?: Partial<ToolEvent>,
): AssistantEvent[] {
  const idx = events.findIndex((e) => e.kind === 'tool' && e.id === id);
  if (idx === -1) {
    if (!fallback) return events;
    const seeded: ToolEvent = {
      kind: 'tool',
      id,
      name: fallback.name ?? 'tool',
      args: fallback.args ?? {},
      preview: fallback.preview,
      output: fallback.output ?? '',
      result: fallback.result,
      auto_allowed: fallback.auto_allowed,
      allowed_until_ms: fallback.allowed_until_ms,
    };
    return [...events, mutate(seeded)];
  }
  const next = [...events];
  next[idx] = mutate(next[idx] as ToolEvent);
  return next;
}

function storedToMessage(s: StoredMessage): Message {
  return {
    id: s.id,
    role: s.role,
    content: s.content,
    events: s.events,
    step: s.step,
    streaming: false,
    attachments: s.attachments,
  };
}

export default function ChatWindow({
  lang,
  onLangChange,
  config,
  onConfigChanged,
}: Props) {
  const L = COPY[lang];

  const [currentProjectId, setCurrentProjectId] = useState<string | null>(
    () => localStorage.getItem('ui.current_project_id') || null,
  );
  const [currentProjectPath, setCurrentProjectPath] = useState<string | null>(null);

  const [assistants, setAssistants] = useState<Assistant[]>([]);
  const [currentAssistantId, setCurrentAssistantId] = useState<string | null>(
    () => localStorage.getItem('ui.current_assistant_id') || null,
  );
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingAssistant, setEditingAssistant] = useState<Assistant | null>(null);

  const convs = useConversations(currentProjectId);

  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [approval, setApproval] = useState<ApprovalRequest | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => localStorage.getItem('ui.sidebar_collapsed') === 'true',
  );
  const [confirmDelete, setConfirmDelete] = useState<string[] | null>(null);
  const [previewArtifact, setPreviewArtifact] = useState<Artifact | null>(null);
  const [editorFilePath, setEditorFilePath] = useState<string | null>(null);
  const [dbReady, setDbReady] = useState(false);

  const streams = useStreamManager();

  // Derived streaming state for the current conversation
  const streaming = conversationId ? streams.isStreaming(conversationId) : false;

  // Track current conversationId in a ref so SSE callbacks can check
  // whether their target conversation is still the active one.
  const conversationIdRef = useRef<string | null>(null);
  useEffect(() => { conversationIdRef.current = conversationId; }, [conversationId]);

  // Messages cache: all SSE callbacks write here; React state is only
  // updated when the callback's target conversation is the active one.
  const messagesCacheRef = useRef<Map<string, Message[]>>(new Map());
  useEffect(() => {
    if (conversationId) {
      messagesCacheRef.current.set(conversationId, messages);
    }
  }, [messages, conversationId]);

  const approvalQueueRef = useRef<ApprovalRequest[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function refreshAssistants() {
    try {
      const list = await listAssistants();
      setAssistants(list);
    } catch (e) {
      console.error('failed to load assistants', e);
    }
  }

  useEffect(() => {
    (async () => {
      try {
        await openDb();
        await vacuumOldDeletions();
        setDbReady(true);
        // Restore project path from persisted project id
        const savedProjectId = localStorage.getItem('ui.current_project_id');
        if (savedProjectId) {
          try {
            const proj = await getProject(savedProjectId);
            if (proj) {
              setCurrentProjectPath(proj.path);
            } else {
              // Project was deleted — clear stale reference
              localStorage.removeItem('ui.current_project_id');
              setCurrentProjectId(null);
            }
          } catch { /* ignore */ }
        }
        // Seed built-in assistants
        const builtins = getBuiltinAssistants(lang);
        await seedBuiltinAssistants(builtins.map(b => ({
          ...b,
          created_at: Date.now(),
          updated_at: Date.now(),
        })));
        await refreshAssistants();

        const id = await getMostRecentConversationId();
        if (id) {
          setConversationId(id);
          const stored = await getMessages(id);
          setMessages(stored.map(storedToMessage));
        }
      } catch (e) {
        console.error('DB init failed, running in-memory mode', e);
        setDbReady(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (currentAssistantId) {
      localStorage.setItem('ui.current_assistant_id', currentAssistantId);
    } else {
      localStorage.removeItem('ui.current_assistant_id');
    }
  }, [currentAssistantId]);

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((v) => {
      const next = !v;
      localStorage.setItem('ui.sidebar_collapsed', String(next));
      return next;
    });
  }, []);

  const loadConversation = useCallback(async (id: string) => {
    try {
      // If this conversation is streaming in the background, restore from cache
      const cached = messagesCacheRef.current.get(id);
      if (cached && streams.isStreaming(id)) {
        setMessages(cached);
      } else {
        const stored = await getMessages(id);
        setMessages(stored.map(storedToMessage));
      }
      setConversationId(id);
    } catch (e) {
      console.error('failed to load conversation', e);
    }
  }, [streams]);

  const showNextApproval = useCallback(() => {
    const next = approvalQueueRef.current.shift() || null;
    setApproval(next);
  }, []);

  const handleApprovalResolve = useCallback(
    (allow: boolean, remember: boolean) => {
      const current = approval;
      if (!current) return;
      setApproval(null);
      respondToApproval(current.request_id, allow, remember).catch((err) => {
        console.warn('approval post failed', err);
      });
      setTimeout(showNextApproval, 0);
    },
    [approval, showNextApproval],
  );

  const schedulePersist = useCallback(
    (msg: Message, convId: string) => {
      if (!dbReady) return;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(async () => {
        try {
          const stored: StoredMessage = {
            id: msg.id,
            conversation_id: convId,
            role: msg.role,
            content: msg.content,
            events: msg.events,
            step: msg.step,
            created_at: Date.now(),
          };
          await upsertMessage(stored);
        } catch (e) {
          console.warn('debounced persist failed', e);
        }
      }, 500);
    },
    [dbReady],
  );

  const flushPersist = useCallback(
    async (msg: Message, convId: string) => {
      if (!dbReady) return;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      try {
        const stored: StoredMessage = {
          id: msg.id,
          conversation_id: convId,
          role: msg.role,
          content: msg.content,
          events: msg.events,
          step: msg.step,
          created_at: Date.now(),
        };
        await upsertMessage(stored);
        await updateConversationTimestamp(convId);
        convs.refresh();
      } catch (e) {
        console.warn('final persist failed', e);
      }
    },
    [dbReady, convs],
  );

  // Helper: update messages in the cache AND in React state (if the
  // target conversation is still the active one).
  function updateMessagesFor(
    targetConvId: string,
    fn: (prev: Message[]) => Message[],
  ) {
    const cached = messagesCacheRef.current.get(targetConvId) ?? [];
    const updated = fn(cached);
    messagesCacheRef.current.set(targetConvId, updated);
    if (conversationIdRef.current === targetConvId) {
      setMessages(updated);
    }
  }

  async function handleSend(text: string, attachments?: Attachment[]) {
    const trimmed = text.trim();
    const hasContent = trimmed || (attachments && attachments.length > 0);
    if (!hasContent || streaming) return;

    let convId = conversationId;
    if (!convId && dbReady) {
      convId = crypto.randomUUID();
      const title = deriveTitle(trimmed || (attachments?.[0]?.name ?? ''));
      try {
        await convs.create(convId, title, currentProjectId, currentAssistantId);
        setConversationId(convId);
      } catch (e) {
        console.error('failed to create conversation', e);
      }
    }
    if (!convId) convId = crypto.randomUUID();

    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: trimmed,
      attachments,
    };
    const assistantId = crypto.randomUUID();
    const assistantMsg: Message = {
      id: assistantId,
      role: 'assistant',
      content: '',
      streaming: true,
      events: [],
    };
    setMessages((prev) => [...prev, userMsg, assistantMsg]);

    if (dbReady) {
      try {
        const stored: StoredMessage = {
          id: userMsg.id,
          conversation_id: convId,
          role: 'user',
          content: userMsg.content,
          created_at: Date.now(),
          attachments: userMsg.attachments,
        };
        await upsertMessage(stored);
        await updateConversationTimestamp(convId);
      } catch (e) {
        console.warn('user message persist failed', e);
      }
    }

    const history = [...messages, userMsg].map((m) => ({
      role: m.role,
      content: m.content,
      attachments: m.attachments,
    }));

    const capturedConvId = convId;
    const pendingStreamRef = {
      text: '',
      thinking: '',
      status: undefined as string | undefined,
      statusDirty: false,
    };
    let flushRaf = 0;

    const flushPendingStream = () => {
      if (flushRaf) {
        cancelAnimationFrame(flushRaf);
        flushRaf = 0;
      }
      const textChunk = pendingStreamRef.text;
      const thinkingChunk = pendingStreamRef.thinking;
      const statusDirty = pendingStreamRef.statusDirty;
      const statusText = pendingStreamRef.status;
      pendingStreamRef.text = '';
      pendingStreamRef.thinking = '';
      pendingStreamRef.status = undefined;
      pendingStreamRef.statusDirty = false;

      if (!textChunk && !thinkingChunk && !statusDirty) return;

      updateMessagesFor(capturedConvId, (prev) => {
        const updated = updateAssistant(prev, assistantId, (m) => {
          let nextEvents = m.events || [];
          if (textChunk) nextEvents = appendTextEvent(nextEvents, textChunk);
          if (thinkingChunk) nextEvents = appendThinkingEvent(nextEvents, thinkingChunk);
          return {
            ...m,
            content: textChunk ? m.content + textChunk : m.content,
            status: statusDirty ? statusText : m.status,
            events: nextEvents,
          };
        });
        const msg = updated.find((m) => m.id === assistantId);
        if (msg) schedulePersist(msg, capturedConvId);
        return updated;
      });
    };

    const schedulePendingFlush = () => {
      if (flushRaf) return;
      flushRaf = requestAnimationFrame(() => {
        flushRaf = 0;
        flushPendingStream();
      });
    };

    // Resolve system prompt from the current assistant
    let systemPrompt: string | undefined;
    if (currentAssistantId) {
      const assistant = assistants.find(a => a.id === currentAssistantId);
      if (assistant) systemPrompt = assistant.system_prompt;
    }

    const controller = streamChat(history, {
      onToken: (txt) => {
        pendingStreamRef.text += txt;
        schedulePendingFlush();
      },
      onThinking: (txt) => {
        pendingStreamRef.thinking += txt;
        schedulePendingFlush();
      },
      onToolStart: (t) => {
        flushPendingStream();
        updateMessagesFor(capturedConvId, (prev) =>
          updateAssistant(prev, assistantId, (m) => ({
            ...m,
            events: upsertTool(
              m.events || [],
              t.id,
              (tool) => ({
                ...tool,
                name: t.name,
                args: t.args,
                preview: t.preview,
                auto_allowed: t.auto_allowed,
                allowed_until_ms: t.allowed_until_ms,
              }),
              {
                name: t.name,
                args: t.args,
                preview: t.preview,
                output: '',
                auto_allowed: t.auto_allowed,
                allowed_until_ms: t.allowed_until_ms,
              },
            ),
          })),
        );
      },
      onToolOutput: (id, chunk) => {
        flushPendingStream();
        updateMessagesFor(capturedConvId, (prev) =>
          updateAssistant(prev, assistantId, (m) => ({
            ...m,
            events: upsertTool(
              m.events || [],
              id,
              (t) => ({
                ...t,
                output: t.output + chunk,
              }),
              { output: chunk },
            ),
          })),
        );
      },
      onToolResult: (id, result) => {
        flushPendingStream();
        updateMessagesFor(capturedConvId, (prev) =>
          updateAssistant(prev, assistantId, (m) => ({
            ...m,
            events: upsertTool(
              m.events || [],
              id,
              (t) => ({
                ...t,
                result,
              }),
              { result, output: '' },
            ),
          })),
        );
      },
      onApprovalRequest: (req) => {
        setApproval((current) => {
          if (current) {
            approvalQueueRef.current.push(req);
            return current;
          }
          return req;
        });
      },
      onStep: (step) => {
        flushPendingStream();
        updateMessagesFor(capturedConvId, (prev) =>
          updateAssistant(prev, assistantId, (m) => ({ ...m, step })),
        );
      },
      onStatus: (txt) => {
        pendingStreamRef.status = txt;
        pendingStreamRef.statusDirty = true;
        schedulePendingFlush();
      },
      onDone: () => {
        flushPendingStream();
        updateMessagesFor(capturedConvId, (prev) => {
          const updated = updateAssistant(prev, assistantId, (m) => ({
            ...m,
            streaming: false,
            status: undefined,
          }));
          const msg = updated.find((m) => m.id === assistantId);
          if (msg) flushPersist(msg, capturedConvId);
          return updated;
        });
        streams.endStream(capturedConvId);
      },
      onError: (msg) => {
        flushPendingStream();
        updateMessagesFor(capturedConvId, (prev) => {
          const errorText = `_connection error:_ \`${msg.replace(/`/g, "'")}\``;
          const updated = updateAssistant(prev, assistantId, (m) => {
            const events = (m.events || []).concat({
              kind: 'text',
              text: `\n\n${errorText}`,
            });
            return {
              ...m,
              streaming: false,
              status: undefined,
              content: m.content || errorText,
              events,
            };
          });
          const finalMsg = updated.find((m) => m.id === assistantId);
          if (finalMsg) flushPersist(finalMsg, capturedConvId);
          return updated;
        });
        streams.endStream(capturedConvId);
      },
    }, {
      ...(currentProjectPath ? { projectPath: currentProjectPath } : {}),
      ...(systemPrompt ? { systemPrompt } : {}),
    });

    streams.startStream(convId, controller);
  }

  function handleStop() {
    if (conversationId) {
      streams.stopStream(conversationId);
    }
    setMessages((prev) =>
      prev.map((m) =>
        m.streaming ? { ...m, streaming: false, status: undefined } : m,
      ),
    );
    approvalQueueRef.current = [];
    setApproval(null);
  }

  async function handleAssistantSave(data: { id: string; name: string; description: string; icon: string; system_prompt: string }) {
    const now = Date.now();
    await upsertAssistant({
      ...data,
      builtin: false,
      created_at: editingAssistant?.created_at ?? now,
      updated_at: now,
    });
    await refreshAssistants();
    setEditorOpen(false);
    setEditingAssistant(null);
  }

  async function handleAssistantDelete(id: string) {
    await deleteAssistant(id);
    if (currentAssistantId === id) setCurrentAssistantId(null);
    await refreshAssistants();
    setEditorOpen(false);
    setEditingAssistant(null);
  }

  function handleProjectChange(projectId: string | null, projectPath?: string) {
    // Stop all active streams when switching projects
    streams.stopAll();
    messagesCacheRef.current.clear();
    setCurrentProjectId(projectId);
    setCurrentProjectPath(projectPath ?? null);
    if (projectId) {
      localStorage.setItem('ui.current_project_id', projectId);
    } else {
      localStorage.removeItem('ui.current_project_id');
    }
    // Reset to no active conversation when switching projects
    setMessages([]);
    setConversationId(null);
  }

  function handleNewChat() {
    // Don't stop background streams — just switch to a blank conversation.
    // The cache already syncs via the messages/conversationId effect.
    setMessages([]);
    setConversationId(null);
  }

  async function handleSelectConversation(id: string) {
    if (id === conversationId) return;
    // Don't stop the current stream — it continues in the background.
    // The cache is synced automatically via the messages/conversationId effect.
    await loadConversation(id);
  }

  async function handleDeleteConversation(id: string, title: string) {
    // Stop any active stream for the deleted conversation
    if (streams.isStreaming(id)) {
      streams.stopStream(id);
    }
    messagesCacheRef.current.delete(id);
    await convs.remove(id, title);
    if (id === conversationId) {
      const nextId = await getMostRecentConversationId();
      if (nextId) {
        await loadConversation(nextId);
      } else {
        setMessages([]);
        setConversationId(null);
      }
    }
  }

  async function handleDeleteMany(ids: string[]) {
    setConfirmDelete(ids);
  }

  async function confirmDeleteMany() {
    if (!confirmDelete) return;
    // Stop any active streams for deleted conversations
    for (const id of confirmDelete) {
      if (streams.isStreaming(id)) streams.stopStream(id);
      messagesCacheRef.current.delete(id);
    }
    await convs.removeMany(confirmDelete);
    if (confirmDelete.includes(conversationId ?? '')) {
      const nextId = await getMostRecentConversationId();
      if (nextId) await loadConversation(nextId);
      else { setMessages([]); setConversationId(null); }
    }
    setConfirmDelete(null);
  }

  async function handleExport(id: string, format: 'md' | 'pdf' | 'docx' = 'md') {
    try {
      const stored = await getMessages(id);
      const conv = convs.conversations.find((c) => c.id === id);
      const title = conv?.title ?? 'conversation';
      const safeName = sanitizeFilename(title);

      if (format === 'md') {
        const md = conversationToMarkdown(title, stored);
        const path = await showSaveDialog({
          defaultPath: `${safeName}.md`,
          filters: [{ name: 'Markdown', extensions: ['md'] }],
        });
        if (path) await invoke('write_text_file', { path, content: md });
      } else if (format === 'pdf') {
        const blob = await conversationToPdf(title, stored);
        const path = await showSaveDialog({
          defaultPath: `${safeName}.pdf`,
          filters: [{ name: 'PDF', extensions: ['pdf'] }],
        });
        if (path) {
          const buffer = await blob.arrayBuffer();
          const bytes = Array.from(new Uint8Array(buffer));
          await invoke('write_binary_file', { path, data: bytes });
        }
      } else if (format === 'docx') {
        const blob = await conversationToDocx(title, stored);
        const path = await showSaveDialog({
          defaultPath: `${safeName}.docx`,
          filters: [{ name: 'Word', extensions: ['docx'] }],
        });
        if (path) {
          const buffer = await blob.arrayBuffer();
          const bytes = Array.from(new Uint8Array(buffer));
          await invoke('write_binary_file', { path, data: bytes });
        }
      }
    } catch (e) {
      console.error('export failed', e);
    }
  }

  async function handleExportMany(ids: string[], format: 'md' | 'pdf' | 'docx' = 'md') {
    for (const id of ids) {
      await handleExport(id, format);
    }
  }

  async function handleModelChange(model: string) {
    if (!config) return;
    try {
      await saveConfig({ provider: config.provider, model });
      onConfigChanged({ ...config, model });
    } catch (e) {
      console.error('model change failed', e);
    }
  }

  function handleSearchSelect(hit: SearchHit) {
    handleSelectConversation(hit.conversation_id);
  }

  async function handleOpenMarkdownFile() {
    try {
      const selected = await openFileDialog({
        multiple: false,
        filters: [{ name: 'Markdown', extensions: ['md', 'txt'] }],
      });
      if (selected && typeof selected === 'string') {
        setPreviewArtifact(null);
        setEditorFilePath(selected);
      }
    } catch (e) {
      console.error('open file dialog failed', e);
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key === 'n') { e.preventDefault(); handleNewChat(); }
      if (mod && e.key === '\\') { e.preventDefault(); toggleSidebar(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleSidebar]);

  return (
    <div className="chat-root">
      <header className="chat-topbar">
        <div className="row" style={{ gap: 14 }}>
          <Logo size="sm" />
          <AssistantPicker
            lang={lang}
            assistants={assistants}
            currentId={currentAssistantId}
            onChange={setCurrentAssistantId}
            onCreateNew={() => { setEditingAssistant(null); setEditorOpen(true); }}
          />
        </div>
        <div className="row" style={{ gap: 10 }}>
          <ModelPicker
            provider={config?.provider ?? 'openai'}
            model={config?.model ?? ''}
            onModelChange={handleModelChange}
          />
          <Button
            size="sm"
            variant="secondary"
            onClick={handleOpenMarkdownFile}
          >
            {lang === 'zh' ? '📝 编辑器' : '📝 EDITOR'}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setSettingsOpen(true)}
          >
            ⚙ {L.settings}
          </Button>
        </div>
      </header>

      <div className="chat-body">
        <ConversationSidebar
          lang={lang}
          conversations={convs.conversations}
          currentId={conversationId}
          collapsed={sidebarCollapsed}
          undo={convs.undo}
          currentProjectId={currentProjectId}
          currentProjectPath={currentProjectPath}
          streamingIds={streams.streamingIds}
          folders={convs.folders}
          activeFolderId={convs.activeFolderId}
          conversationCounts={convs.conversationCounts}
          onProjectChange={handleProjectChange}
          onToggleCollapse={toggleSidebar}
          onSelect={handleSelectConversation}
          onNew={handleNewChat}
          onRename={convs.rename}
          onPin={convs.pin}
          onDelete={handleDeleteConversation}
          onDeleteMany={handleDeleteMany}
          onExport={handleExport}
          onExportMany={handleExportMany}
          onUndo={convs.undoDelete}
          onDismissUndo={convs.dismissUndo}
          onSearchSelect={handleSearchSelect}
          onFolderSelect={convs.setActiveFolderId}
          onFolderCreate={convs.addFolder}
          onFolderRename={convs.editFolderName}
          onFolderDelete={convs.removeFolder}
          onMoveToFolder={convs.moveToFolder}
        />
        <main className={`chat-center ${(previewArtifact || editorFilePath) ? 'with-preview' : ''}`}>
          <MessageList messages={messages} lang={lang} onPreviewArtifact={(a) => { setEditorFilePath(null); setPreviewArtifact(a); }} />
          <InputBox
            lang={lang}
            streaming={streaming}
            onSend={handleSend}
            onStop={handleStop}
          />
        </main>
        {previewArtifact && (
          <ArtifactPreview
            artifact={previewArtifact}
            onClose={() => setPreviewArtifact(null)}
          />
        )}
        {editorFilePath && (
          <MarkdownEditor
            filePath={editorFilePath}
            lang={lang}
            onClose={() => setEditorFilePath(null)}
          />
        )}
      </div>

      <SettingsPanel
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        lang={lang}
        onLangChange={onLangChange}
        config={config}
        onConfigChanged={onConfigChanged}
      />

      <ApprovalModal
        request={approval}
        lang={lang}
        onResolve={handleApprovalResolve}
      />

      <ConfirmDeleteModal
        lang={lang}
        count={confirmDelete?.length ?? 0}
        open={confirmDelete !== null}
        onConfirm={confirmDeleteMany}
        onCancel={() => setConfirmDelete(null)}
      />

      <AssistantEditor
        lang={lang}
        open={editorOpen}
        assistant={editingAssistant}
        onSave={handleAssistantSave}
        onDelete={handleAssistantDelete}
        onClose={() => { setEditorOpen(false); setEditingAssistant(null); }}
      />
    </div>
  );
}

# Conversation History & Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make conversations survive app restart and let users browse, search, rename, pin, export, and delete past conversations from a persistent sidebar — on par with Claude Desktop / ChatGPT.

**Architecture:** SQLite via `tauri-plugin-sql` stores conversations and messages with FTS5 full-text search. A typed `db.ts` layer wraps all SQL. The sidebar is a 260 px collapsible panel inside `ChatWindow` with time-bucketed conversation list. Persistence is wired via immediate writes for user messages and debounced 500 ms writes for streaming assistant messages. Export uses `tauri-plugin-dialog` for native save dialog + a custom Rust `write_text_file` command.

**Tech Stack:** Tauri 2 (Rust), React 19, TypeScript 5.8, Vite 7, SQLite (via tauri-plugin-sql + FTS5), existing CSS custom props.

**Branch:** `feat/agent-integration` (continues from the approval severity work).

**Spec:** `docs/superpowers/specs/2026-04-21-conversation-history-design.md`

**Deviations from spec:**
- DB location: spec says `~/.bitidea-desktop/agent-state/chat.db`. We use `sqlite:chat.db` which resolves to Tauri's app data dir (`~/Library/Application Support/com.bitidea.desktop/chat.db` on macOS). Reason: tauri-plugin-sql resolves paths relative to app data dir; constructing matching absolute paths between Rust migrations and TS frontend is fragile.
- Migrations: spec says `src-tauri/migrations/0001_init.sql`. tauri-plugin-sql v2 defines migrations in Rust code via `Migration` structs, not SQL files. Same SQL, different delivery mechanism.
- Sidebar collapse state: spec says `@tauri-apps/plugin-store`. We use `localStorage` — the store plugin is not registered on the Rust side and adding it is out of scope.
- Hooks location: spec says `src/hooks/`. We follow the spec to create this new directory.

---

## File Structure

### Created

- `src/lib/db.ts` — typed SQLite client: open, conversations CRUD, messages CRUD, FTS search, vacuum
- `src/lib/exportMarkdown.ts` — conversation → markdown string
- `src/hooks/useConversations.ts` — sidebar conversation list state + CRUD
- `src/hooks/useMessages.ts` — load messages for a conversation on id change
- `src/components/Chat/ConversationSidebar.tsx` — sidebar shell with time buckets, collapse toggle
- `src/components/Chat/ConversationSidebar.css` — sidebar styles
- `src/components/Chat/ConversationItem.tsx` — single conversation row (title, preview, active state, hover menu)
- `src/components/Chat/ConversationMenu.tsx` — rename/pin/export/delete context menu
- `src/components/Chat/SearchBar.tsx` — search input with 200 ms debounce, result rendering
- `src/components/Chat/ConfirmDeleteModal.tsx` — batch delete confirmation modal
- `src/components/Chat/UndoToast.tsx` — undo toast for soft deletes
- `src/components/Chat/UndoToast.css` — toast styles
- `src/components/Chat/BatchFooter.tsx` — batch mode footer with actions

### Modified

- `src-tauri/Cargo.toml` — add `tauri-plugin-sql`, `tauri-plugin-dialog`
- `src-tauri/src/lib.rs` — register plugins, define migrations, add `write_text_file` command
- `src-tauri/capabilities/default.json` — add `sql:*`, `dialog:*` permissions
- `package.json` — add `@tauri-apps/plugin-sql`, `@tauri-apps/plugin-dialog`
- `src/types/index.ts` — add `Conversation`, `ConversationWithPreview`, `StoredMessage`
- `src/components/Chat/ChatWindow.tsx` — integrate sidebar, conversation state, persistence wiring
- `src/components/Chat/ChatWindow.css` — sidebar layout (flex row with collapsible left panel)

### Untouched

- `sidecar/*` — no Python changes; chat SSE protocol unchanged
- `src/components/Chat/ApprovalModal.*` — approval UX unchanged
- `src/components/Chat/ToolCard.*` — tool cards unchanged
- `src/components/Chat/Message.*` — message rendering unchanged
- `src/components/Chat/InputBox.*` — input unchanged

---

## Task 1: Rust + npm plugin setup

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/capabilities/default.json`

- [ ] **Step 1: Add Rust dependencies**

In `src-tauri/Cargo.toml`, add to `[dependencies]`:

```toml
tauri-plugin-sql = { version = "2", features = ["sqlite"] }
tauri-plugin-dialog = "2"
```

- [ ] **Step 2: Register plugins and define migrations in lib.rs**

Replace `src-tauri/src/lib.rs` with:

```rust
mod sidecar;

use sidecar::{SidecarState, get_sidecar_info, kill, spawn};
use tauri::RunEvent;
use tauri_plugin_sql::{Migration, MigrationKind};

fn chat_migrations() -> Vec<Migration> {
    vec![Migration {
        version: 1,
        description: "create conversations, messages, and FTS index",
        sql: r#"
CREATE TABLE conversations (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  pinned      INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  deleted_at  INTEGER
);
CREATE INDEX idx_conv_updated ON conversations (deleted_at, pinned DESC, updated_at DESC);

CREATE TABLE messages (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role            TEXT NOT NULL CHECK (role IN ('user','assistant')),
  content         TEXT NOT NULL DEFAULT '',
  events_json     TEXT,
  step_json       TEXT,
  created_at      INTEGER NOT NULL
);
CREATE INDEX idx_msg_conv ON messages (conversation_id, created_at);

CREATE VIRTUAL TABLE messages_fts USING fts5(
  content,
  message_id UNINDEXED,
  conversation_id UNINDEXED,
  tokenize = 'unicode61 remove_diacritics 2'
);
"#,
        kind: MigrationKind::Up,
    }]
}

#[tauri::command]
fn write_text_file(path: String, content: String) -> Result<(), String> {
    std::fs::write(&path, &content).map_err(|e| format!("write failed: {e}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let state = SidecarState::default();
    let state_for_setup = state.clone();
    let state_for_exit = state.clone();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:chat.db", chat_migrations())
                .build(),
        )
        .manage(state)
        .setup(move |_app| {
            spawn(&state_for_setup);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![get_sidecar_info, write_text_file])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(move |_app, event| {
            if matches!(event, RunEvent::Exit) {
                kill(&state_for_exit);
            }
        });
}
```

- [ ] **Step 3: Update capabilities**

Replace `src-tauri/capabilities/default.json`:

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "Capability for the main window",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "opener:default",
    "sql:default",
    "sql:allow-execute",
    "dialog:default"
  ]
}
```

- [ ] **Step 4: Install npm packages**

Run:
```bash
cd /Users/huangpinqing/Desktop/bitidea-desktop
npm install @tauri-apps/plugin-sql @tauri-apps/plugin-dialog
```

- [ ] **Step 5: Verify Rust compiles**

Run:
```bash
cd /Users/huangpinqing/Desktop/bitidea-desktop/src-tauri
cargo check
```
Expected: compiles cleanly. If `tauri_plugin_dialog` or `tauri_plugin_sql` has errors, check crate versions match Tauri 2.x.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/lib.rs \
  src-tauri/capabilities/default.json package.json package-lock.json
git commit -m "feat(db): add tauri-plugin-sql + dialog + SQLite migrations

Registers tauri-plugin-sql (sqlite), tauri-plugin-dialog, and defines
the v1 migration: conversations, messages, FTS5 index. Adds a
write_text_file command for markdown export. Capabilities updated."
```

---

## Task 2: TypeScript types

**Files:**
- Modify: `src/types/index.ts`

- [ ] **Step 1: Add persistence types**

In `src/types/index.ts`, append after the existing `TestResult` interface:

```ts
/* ══════════════════════════════════════════════════════════
   Conversation persistence
   ═════════���════════════════════════════════════════════════ */

export interface Conversation {
  id: string;
  title: string;
  pinned: boolean;
  created_at: number;
  updated_at: number;
}

export interface ConversationWithPreview extends Conversation {
  preview: string;
  message_count: number;
}

export interface StoredMessage {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant';
  content: string;
  events?: AssistantEvent[];
  step?: StepEvent;
  created_at: number;
}

export interface SearchHit {
  conversation_id: string;
  conversation_title: string;
  message_id: string;
  snippet: string;
}
```

- [ ] **Step 2: Verify types compile**

Run:
```bash
cd /Users/huangpinqing/Desktop/bitidea-desktop
npx tsc --noEmit
```
Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add src/types/index.ts
git commit -m "feat(types): add Conversation, StoredMessage, SearchHit types"
```

---

## Task 3: Database layer (db.ts)

**Files:**
- Create: `src/lib/db.ts`

- [ ] **Step 1: Write the full database layer**

Create `src/lib/db.ts`:

```ts
import Database from '@tauri-apps/plugin-sql';
import type {
  AssistantEvent,
  Conversation,
  ConversationWithPreview,
  SearchHit,
  StepEvent,
  StoredMessage,
} from '../types';

const DB_URL = 'sqlite:chat.db';
let _db: Database | null = null;

export async function openDb(): Promise<Database> {
  if (_db) return _db;
  _db = await Database.load(DB_URL);
  return _db;
}

// ── Conversations ──────────────────────────────────────────

export async function listConversations(): Promise<ConversationWithPreview[]> {
  const db = await openDb();
  const rows = await db.select<
    Array<{
      id: string;
      title: string;
      pinned: number;
      created_at: number;
      updated_at: number;
      preview: string | null;
      message_count: number;
    }>
  >(
    `SELECT c.id, c.title, c.pinned, c.created_at, c.updated_at,
       (SELECT substr(m.content, 1, 80) FROM messages m
        WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) AS preview,
       (SELECT count(*) FROM messages m WHERE m.conversation_id = c.id) AS message_count
     FROM conversations c
     WHERE c.deleted_at IS NULL
     ORDER BY c.pinned DESC, c.updated_at DESC`,
  );
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    pinned: r.pinned === 1,
    created_at: r.created_at,
    updated_at: r.updated_at,
    preview: r.preview ?? '',
    message_count: r.message_count,
  }));
}

export async function getConversation(id: string): Promise<Conversation | null> {
  const db = await openDb();
  const rows = await db.select<
    Array<{
      id: string;
      title: string;
      pinned: number;
      created_at: number;
      updated_at: number;
    }>
  >(
    'SELECT id, title, pinned, created_at, updated_at FROM conversations WHERE id = $1 AND deleted_at IS NULL',
    [id],
  );
  if (rows.length === 0) return null;
  const r = rows[0];
  return { id: r.id, title: r.title, pinned: r.pinned === 1, created_at: r.created_at, updated_at: r.updated_at };
}

export async function createConversation(id: string, title: string): Promise<void> {
  const db = await openDb();
  const now = Date.now();
  await db.execute(
    'INSERT INTO conversations (id, title, pinned, created_at, updated_at) VALUES ($1, $2, 0, $3, $4)',
    [id, title, now, now],
  );
}

export async function updateConversationTimestamp(id: string): Promise<void> {
  const db = await openDb();
  await db.execute('UPDATE conversations SET updated_at = $1 WHERE id = $2', [Date.now(), id]);
}

export async function renameConversation(id: string, title: string): Promise<void> {
  const db = await openDb();
  await db.execute('UPDATE conversations SET title = $1, updated_at = $2 WHERE id = $3', [title, Date.now(), id]);
}

export async function pinConversation(id: string, pinned: boolean): Promise<void> {
  const db = await openDb();
  await db.execute('UPDATE conversations SET pinned = $1, updated_at = $2 WHERE id = $3', [pinned ? 1 : 0, Date.now(), id]);
}

export async function countPinned(): Promise<number> {
  const db = await openDb();
  const rows = await db.select<Array<{ n: number }>>(
    'SELECT count(*) AS n FROM conversations WHERE pinned = 1 AND deleted_at IS NULL',
  );
  return rows[0]?.n ?? 0;
}

export async function softDeleteConversation(id: string): Promise<void> {
  const db = await openDb();
  await db.execute('UPDATE conversations SET deleted_at = $1 WHERE id = $2', [Date.now(), id]);
}

export async function undoDeleteConversation(id: string): Promise<void> {
  const db = await openDb();
  await db.execute('UPDATE conversations SET deleted_at = NULL WHERE id = $1', [id]);
}

export async function softDeleteMany(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const db = await openDb();
  const now = Date.now();
  const placeholders = ids.map((_, i) => `$${i + 2}`).join(',');
  await db.execute(
    `UPDATE conversations SET deleted_at = $1 WHERE id IN (${placeholders})`,
    [now, ...ids],
  );
}

export async function getMostRecentConversationId(): Promise<string | null> {
  const db = await openDb();
  const rows = await db.select<Array<{ id: string }>>(
    'SELECT id FROM conversations WHERE deleted_at IS NULL ORDER BY updated_at DESC LIMIT 1',
  );
  return rows[0]?.id ?? null;
}

// ── Messages ───────────────────────────────────────────────

export async function getMessages(conversationId: string): Promise<StoredMessage[]> {
  const db = await openDb();
  const rows = await db.select<
    Array<{
      id: string;
      conversation_id: string;
      role: 'user' | 'assistant';
      content: string;
      events_json: string | null;
      step_json: string | null;
      created_at: number;
    }>
  >(
    'SELECT id, conversation_id, role, content, events_json, step_json, created_at FROM messages WHERE conversation_id = $1 ORDER BY created_at',
    [conversationId],
  );
  return rows.map((r) => ({
    id: r.id,
    conversation_id: r.conversation_id,
    role: r.role,
    content: r.content,
    events: r.events_json ? (JSON.parse(r.events_json) as AssistantEvent[]) : undefined,
    step: r.step_json ? (JSON.parse(r.step_json) as StepEvent) : undefined,
    created_at: r.created_at,
  }));
}

export async function upsertMessage(msg: StoredMessage): Promise<void> {
  const db = await openDb();
  const eventsJson = msg.events ? JSON.stringify(msg.events) : null;
  const stepJson = msg.step ? JSON.stringify(msg.step) : null;

  await db.execute(
    `INSERT INTO messages (id, conversation_id, role, content, events_json, step_json, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT(id) DO UPDATE SET content = $4, events_json = $5, step_json = $6`,
    [msg.id, msg.conversation_id, msg.role, msg.content, eventsJson, stepJson, msg.created_at],
  );

  // Rewrite FTS entry.
  const flat = flattenForFts(msg);
  await db.execute('DELETE FROM messages_fts WHERE message_id = $1', [msg.id]);
  if (flat) {
    await db.execute(
      'INSERT INTO messages_fts (content, message_id, conversation_id) VALUES ($1, $2, $3)',
      [flat, msg.id, msg.conversation_id],
    );
  }
}

function flattenForFts(msg: StoredMessage): string {
  const parts: string[] = [];
  if (msg.content) parts.push(msg.content);
  if (msg.events) {
    for (const ev of msg.events) {
      if (ev.kind === 'text' && ev.text) parts.push(ev.text);
      if (ev.kind === 'thinking' && ev.text) parts.push(ev.text);
      if (ev.kind === 'tool') {
        if (ev.preview) parts.push(ev.preview);
        if (ev.result?.summary) parts.push(ev.result.summary);
      }
    }
  }
  return parts.join(' ').trim();
}

// ── Search ─────────────────────────────────────────────────

export async function searchFts(query: string): Promise<SearchHit[]> {
  if (!query.trim()) return [];
  const db = await openDb();
  const escaped = query.replace(/"/g, '""');
  const rows = await db.select<
    Array<{
      conversation_id: string;
      conversation_title: string;
      message_id: string;
      snippet: string;
    }>
  >(
    `SELECT f.conversation_id, c.title AS conversation_title,
            f.message_id, snippet(messages_fts, 0, '<mark>', '</mark>', '…', 20) AS snippet
     FROM messages_fts f
     JOIN conversations c ON c.id = f.conversation_id
     WHERE c.deleted_at IS NULL AND messages_fts MATCH $1
     ORDER BY rank
     LIMIT 30`,
    [`"${escaped}"`],
  );
  return rows;
}

// ── Vacuum ─────────────────────────────────────────────────

export async function vacuumOldDeletions(): Promise<void> {
  const db = await openDb();
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;

  const rows = await db.select<Array<{ id: string }>>(
    'SELECT id FROM conversations WHERE deleted_at IS NOT NULL AND deleted_at < $1',
    [cutoff],
  );
  if (rows.length === 0) return;

  const ids = rows.map((r) => r.id);

  // Get message ids for FTS cleanup.
  const placeholders = ids.map((_, i) => `$${i + 1}`).join(',');
  const msgRows = await db.select<Array<{ id: string }>>(
    `SELECT id FROM messages WHERE conversation_id IN (${placeholders})`,
    ids,
  );

  // Delete FTS entries.
  if (msgRows.length > 0) {
    const msgPlaceholders = msgRows.map((_, i) => `$${i + 1}`).join(',');
    await db.execute(
      `DELETE FROM messages_fts WHERE message_id IN (${msgPlaceholders})`,
      msgRows.map((r) => r.id),
    );
  }

  // Hard delete conversations (CASCADE removes messages).
  await db.execute(
    `DELETE FROM conversations WHERE id IN (${placeholders})`,
    ids,
  );
}

// ── Title derivation ───────────────────────────────────────

export function deriveTitle(firstUserContent: string): string {
  const cleaned = firstUserContent.replace(/\n/g, ' ').trim();
  if (cleaned.length <= 40) return cleaned || 'New conversation';
  return cleaned.slice(0, 40) + '…';
}
```

- [ ] **Step 2: Verify types compile**

Run:
```bash
cd /Users/huangpinqing/Desktop/bitidea-desktop
npx tsc --noEmit
```
Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/db.ts
git commit -m "feat(db): typed SQLite client for conversations and messages

Full CRUD for conversations and messages, FTS5 search, soft-delete with
30-day vacuum, title derivation. All queries go through tauri-plugin-sql
with positional parameter binding."
```

---

## Task 4: Export markdown helper

**Files:**
- Create: `src/lib/exportMarkdown.ts`

- [ ] **Step 1: Write the export helper**

Create `src/lib/exportMarkdown.ts`:

```ts
import type { StoredMessage } from '../types';

export function conversationToMarkdown(
  title: string,
  messages: StoredMessage[],
): string {
  const lines: string[] = [`# ${title}`, ''];

  if (messages.length > 0) {
    const firstDate = new Date(messages[0].created_at).toISOString().split('T')[0];
    lines.push(`_${firstDate}_`, '');
  }

  for (const msg of messages) {
    const heading = msg.role === 'user' ? '## 你' : '## 助手';
    lines.push(heading, '');

    if (msg.role === 'user') {
      lines.push(msg.content, '');
    } else if (msg.events && msg.events.length > 0) {
      for (const ev of msg.events) {
        if (ev.kind === 'text') {
          lines.push(ev.text, '');
        } else if (ev.kind === 'thinking') {
          for (const line of ev.text.split('\n')) {
            lines.push(`> ${line}`);
          }
          lines.push('');
        } else if (ev.kind === 'tool') {
          const lang = ev.name.match(/terminal|shell|bash/) ? 'shell' : 'text';
          lines.push(`\`\`\`${lang}`);
          if (ev.preview) lines.push(ev.preview);
          lines.push('```', '');
          if (ev.result?.summary) {
            lines.push(`> result: ${ev.result.summary}`, '');
          }
        }
      }
    } else if (msg.content) {
      lines.push(msg.content, '');
    }

    lines.push('---', '');
  }

  return lines.join('\n').trimEnd() + '\n';
}

export function sanitizeFilename(title: string): string {
  return title
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/_+/g, '_')
    .trim()
    .slice(0, 100);
}
```

- [ ] **Step 2: Verify types compile**

Run:
```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/exportMarkdown.ts
git commit -m "feat(export): conversation to markdown converter

Flattens assistant events into markdown: text as paragraphs, thinking
as blockquotes, tools as fenced code blocks. Includes filename sanitizer."
```

---

## Task 5: useConversations hook

**Files:**
- Create: `src/hooks/useConversations.ts`

- [ ] **Step 1: Create hooks directory and write the hook**

Create `src/hooks/useConversations.ts`:

```ts
import { useCallback, useEffect, useState } from 'react';
import type { ConversationWithPreview } from '../types';
import {
  countPinned,
  createConversation,
  listConversations,
  pinConversation,
  renameConversation,
  softDeleteConversation,
  softDeleteMany,
  undoDeleteConversation,
} from '../lib/db';

export interface UndoState {
  ids: string[];
  title: string;
  timer: ReturnType<typeof setTimeout>;
}

export function useConversations() {
  const [conversations, setConversations] = useState<ConversationWithPreview[]>([]);
  const [loading, setLoading] = useState(true);
  const [undo, setUndo] = useState<UndoState | null>(null);

  const refresh = useCallback(async () => {
    try {
      const list = await listConversations();
      setConversations(list);
    } catch (e) {
      console.error('failed to load conversations', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const create = useCallback(
    async (id: string, title: string) => {
      await createConversation(id, title);
      await refresh();
    },
    [refresh],
  );

  const rename = useCallback(
    async (id: string, title: string) => {
      if (!title.trim()) return;
      await renameConversation(id, title.trim());
      await refresh();
    },
    [refresh],
  );

  const pin = useCallback(
    async (id: string, value: boolean): Promise<boolean> => {
      if (value) {
        const n = await countPinned();
        if (n >= 5) return false;
      }
      await pinConversation(id, value);
      await refresh();
      return true;
    },
    [refresh],
  );

  const remove = useCallback(
    async (id: string, title: string) => {
      if (undo) clearTimeout(undo.timer);
      await softDeleteConversation(id);
      await refresh();
      const timer = setTimeout(() => setUndo(null), 5000);
      setUndo({ ids: [id], title, timer });
    },
    [refresh, undo],
  );

  const removeMany = useCallback(
    async (ids: string[]) => {
      if (undo) clearTimeout(undo.timer);
      await softDeleteMany(ids);
      await refresh();
      const timer = setTimeout(() => setUndo(null), 5000);
      setUndo({ ids, title: `${ids.length} conversations`, timer });
    },
    [refresh, undo],
  );

  const undoDelete = useCallback(async () => {
    if (!undo) return;
    clearTimeout(undo.timer);
    for (const id of undo.ids) {
      await undoDeleteConversation(id);
    }
    setUndo(null);
    await refresh();
  }, [undo, refresh]);

  const dismissUndo = useCallback(() => {
    if (!undo) return;
    clearTimeout(undo.timer);
    setUndo(null);
  }, [undo]);

  return {
    conversations,
    loading,
    undo,
    refresh,
    create,
    rename,
    pin,
    remove,
    removeMany,
    undoDelete,
    dismissUndo,
  };
}
```

- [ ] **Step 2: Verify types compile**

Run:
```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useConversations.ts
git commit -m "feat(hooks): useConversations for sidebar state + CRUD

Manages the conversation list, pin cap (max 5), soft-delete with 5s undo
window, and batch delete. Refresh pulls latest from SQLite."
```

---

## Task 6: ConversationSidebar + ConversationItem

**Files:**
- Create: `src/components/Chat/ConversationSidebar.tsx`
- Create: `src/components/Chat/ConversationSidebar.css`
- Create: `src/components/Chat/ConversationItem.tsx`

- [ ] **Step 1: Write ConversationItem**

Create `src/components/Chat/ConversationItem.tsx`:

```tsx
import { useRef, useState } from 'react';
import type { ConversationWithPreview, Lang } from '../../types';

interface Props {
  conv: ConversationWithPreview;
  active: boolean;
  lang: Lang;
  batchMode: boolean;
  selected: boolean;
  onSelect: (id: string) => void;
  onToggleBatch: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onPin: (id: string, pinned: boolean) => void;
  onDelete: (id: string, title: string) => void;
  onExport: (id: string) => void;
  onContextMenu: (e: React.MouseEvent, id: string) => void;
}

export default function ConversationItem({
  conv,
  active,
  lang,
  batchMode,
  selected,
  onSelect,
  onToggleBatch,
  onRename,
  onPin,
  onDelete,
  onExport,
  onContextMenu,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(conv.title);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const isZh = lang === 'zh';

  function startRename() {
    setEditValue(conv.title);
    setEditing(true);
    setTimeout(() => inputRef.current?.select(), 0);
  }

  function commitRename() {
    const trimmed = editValue.trim();
    if (!trimmed) {
      setEditValue(conv.title);
      setEditing(false);
      return;
    }
    onRename(conv.id, trimmed);
    setEditing(false);
  }

  function handleClick() {
    if (batchMode) {
      onToggleBatch(conv.id);
    } else {
      onSelect(conv.id);
    }
  }

  return (
    <div
      className={`conv-item ${active ? 'conv-active' : ''} ${selected ? 'conv-selected' : ''}`}
      onClick={handleClick}
      onContextMenu={(e) => onContextMenu(e, conv.id)}
    >
      {batchMode && (
        <input
          type="checkbox"
          className="conv-check"
          checked={selected}
          onChange={() => onToggleBatch(conv.id)}
          onClick={(e) => e.stopPropagation()}
        />
      )}
      {conv.pinned && <span className="conv-pin" aria-label="pinned">📌</span>}
      <div className="conv-body">
        {editing ? (
          <input
            ref={inputRef}
            className="conv-rename-input mono"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitRename();
              if (e.key === 'Escape') { setEditing(false); setEditValue(conv.title); }
            }}
            onBlur={commitRename}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <>
            <div className="conv-title">{conv.title}</div>
            <div className="conv-preview">{conv.preview}</div>
          </>
        )}
      </div>
      {!batchMode && !editing && (
        <button
          type="button"
          className="conv-menu-btn"
          onClick={(e) => { e.stopPropagation(); onContextMenu(e, conv.id); }}
          aria-label={isZh ? '更多' : 'More'}
        >
          ⋯
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Write ConversationSidebar**

Create `src/components/Chat/ConversationSidebar.tsx`:

```tsx
import { useMemo, useState } from 'react';
import Button from '../common/Button';
import ConversationItem from './ConversationItem';
import ConversationMenu from './ConversationMenu';
import SearchBar from './SearchBar';
import BatchFooter from './BatchFooter';
import UndoToast from './UndoToast';
import type { ConversationWithPreview, Lang, SearchHit } from '../../types';
import type { UndoState } from '../../hooks/useConversations';
import './ConversationSidebar.css';

interface Props {
  lang: Lang;
  conversations: ConversationWithPreview[];
  currentId: string | null;
  collapsed: boolean;
  undo: UndoState | null;
  onToggleCollapse: () => void;
  onSelect: (id: string) => void;
  onNew: () => void;
  onRename: (id: string, title: string) => void;
  onPin: (id: string, pinned: boolean) => Promise<boolean>;
  onDelete: (id: string, title: string) => void;
  onDeleteMany: (ids: string[]) => void;
  onExport: (id: string) => void;
  onExportMany: (ids: string[]) => void;
  onUndo: () => void;
  onDismissUndo: () => void;
  onSearchSelect: (hit: SearchHit) => void;
}

interface TimeBucket {
  label: string;
  items: ConversationWithPreview[];
}

const LABELS = {
  en: { pinned: 'Pinned', today: 'Today', yesterday: 'Yesterday', week: 'Past 7 days', month: 'Past 30 days', older: 'Older', newChat: 'NEW', batch: 'Batch', collapse: '◀', expand: '▶' },
  zh: { pinned: '固定', today: '今天', yesterday: '昨天', week: '过去 7 天', month: '过去 30 天', older: '更早', newChat: '新对话', batch: '批量', collapse: '◀', expand: '▶' },
};

function bucketConversations(convs: ConversationWithPreview[], lang: Lang): TimeBucket[] {
  const L = LABELS[lang];
  const now = Date.now();
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const yesterdayStart = new Date(todayStart); yesterdayStart.setDate(yesterdayStart.getDate() - 1);
  const weekStart = now - 7 * 86400000;
  const monthStart = now - 30 * 86400000;

  const pinned: ConversationWithPreview[] = [];
  const today: ConversationWithPreview[] = [];
  const yesterday: ConversationWithPreview[] = [];
  const week: ConversationWithPreview[] = [];
  const month: ConversationWithPreview[] = [];
  const older: ConversationWithPreview[] = [];

  for (const c of convs) {
    if (c.pinned) { pinned.push(c); continue; }
    const t = c.updated_at;
    if (t >= todayStart.getTime()) today.push(c);
    else if (t >= yesterdayStart.getTime()) yesterday.push(c);
    else if (t >= weekStart) week.push(c);
    else if (t >= monthStart) month.push(c);
    else older.push(c);
  }

  const buckets: TimeBucket[] = [];
  if (pinned.length) buckets.push({ label: `📌 ${L.pinned}`, items: pinned });
  if (today.length) buckets.push({ label: L.today, items: today });
  if (yesterday.length) buckets.push({ label: L.yesterday, items: yesterday });
  if (week.length) buckets.push({ label: L.week, items: week });
  if (month.length) buckets.push({ label: L.month, items: month });
  if (older.length) buckets.push({ label: L.older, items: older });
  return buckets;
}

export default function ConversationSidebar({
  lang,
  conversations,
  currentId,
  collapsed,
  undo,
  onToggleCollapse,
  onSelect,
  onNew,
  onRename,
  onPin,
  onDelete,
  onDeleteMany,
  onExport,
  onExportMany,
  onUndo,
  onDismissUndo,
  onSearchSelect,
}: Props) {
  const L = LABELS[lang];
  const isZh = lang === 'zh';
  const [batchMode, setBatchMode] = useState(false);
  const [batchSelected, setBatchSelected] = useState<Set<string>>(new Set());
  const [menuTarget, setMenuTarget] = useState<{ id: string; x: number; y: number } | null>(null);
  const [searching, setSearching] = useState(false);

  const buckets = useMemo(() => bucketConversations(conversations, lang), [conversations, lang]);

  function toggleBatch(id: string) {
    setBatchSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function exitBatch() {
    setBatchMode(false);
    setBatchSelected(new Set());
  }

  function handleContextMenu(e: React.MouseEvent, id: string) {
    e.preventDefault();
    setMenuTarget({ id, x: e.clientX, y: e.clientY });
  }

  const menuConv = menuTarget ? conversations.find((c) => c.id === menuTarget.id) : null;

  if (collapsed) {
    return (
      <aside className="sidebar sidebar-collapsed">
        <button type="button" className="sidebar-expand-btn" onClick={onToggleCollapse} aria-label={L.expand}>
          {L.expand}
        </button>
        <button type="button" className="sidebar-icon-btn" onClick={onNew} aria-label={L.newChat}>
          +
        </button>
      </aside>
    );
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <Button size="sm" variant="primary" onClick={onNew}>+ {L.newChat}</Button>
        <button type="button" className="sidebar-collapse-btn" onClick={onToggleCollapse} aria-label={L.collapse}>
          {L.collapse}
        </button>
      </div>

      <SearchBar
        lang={lang}
        onResults={(hits) => setSearching(hits.length > 0)}
        onSelect={onSearchSelect}
        onClear={() => setSearching(false)}
      />

      {!searching && (
        <div className="sidebar-list">
          {buckets.map((b) => (
            <div key={b.label} className="sidebar-bucket">
              <div className="sidebar-bucket-label">{b.label}</div>
              {b.items.map((c) => (
                <ConversationItem
                  key={c.id}
                  conv={c}
                  active={c.id === currentId}
                  lang={lang}
                  batchMode={batchMode}
                  selected={batchSelected.has(c.id)}
                  onSelect={onSelect}
                  onToggleBatch={toggleBatch}
                  onRename={onRename}
                  onPin={(id, pinned) => { onPin(id, pinned); }}
                  onDelete={onDelete}
                  onExport={onExport}
                  onContextMenu={handleContextMenu}
                />
              ))}
            </div>
          ))}
        </div>
      )}

      {!searching && !batchMode && (
        <div className="sidebar-foot">
          <Button size="sm" variant="secondary" onClick={() => { setBatchMode(true); setBatchSelected(new Set()); }}>
            {L.batch}
          </Button>
        </div>
      )}

      {batchMode && (
        <BatchFooter
          lang={lang}
          count={batchSelected.size}
          onDelete={() => { onDeleteMany(Array.from(batchSelected)); exitBatch(); }}
          onExport={() => { onExportMany(Array.from(batchSelected)); exitBatch(); }}
          onCancel={exitBatch}
        />
      )}

      {menuTarget && menuConv && (
        <ConversationMenu
          conv={menuConv}
          lang={lang}
          x={menuTarget.x}
          y={menuTarget.y}
          onRename={(id) => { setMenuTarget(null); /* inline rename handled by item */ }}
          onPin={(id, pinned) => { setMenuTarget(null); onPin(id, pinned); }}
          onExport={(id) => { setMenuTarget(null); onExport(id); }}
          onDelete={(id, title) => { setMenuTarget(null); onDelete(id, title); }}
          onClose={() => setMenuTarget(null)}
        />
      )}

      {undo && <UndoToast lang={lang} title={undo.title} onUndo={onUndo} onDismiss={onDismissUndo} />}
    </aside>
  );
}
```

- [ ] **Step 3: Write sidebar CSS**

Create `src/components/Chat/ConversationSidebar.css`:

```css
/* ── Sidebar layout ──────────────────────────────────────── */

.sidebar {
  width: 260px;
  min-width: 260px;
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--panel-border);
  background: rgba(5, 7, 15, 0.55);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  overflow: hidden;
  position: relative;
}
.sidebar-collapsed {
  width: 48px;
  min-width: 48px;
  align-items: center;
  padding-top: 12px;
  gap: 12px;
}
.sidebar-expand-btn,
.sidebar-collapse-btn {
  background: transparent;
  border: 1px solid var(--panel-border);
  color: var(--ink-dim);
  width: 28px;
  height: 28px;
  border-radius: var(--r-xs);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  transition: all var(--t);
}
.sidebar-expand-btn:hover,
.sidebar-collapse-btn:hover {
  color: var(--accent-2);
  border-color: var(--accent);
}
.sidebar-icon-btn {
  background: transparent;
  border: 1px solid var(--panel-border);
  color: var(--accent-2);
  width: 32px;
  height: 32px;
  border-radius: var(--r-sm);
  cursor: pointer;
  font-size: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all var(--t);
}
.sidebar-icon-btn:hover {
  border-color: var(--accent);
  box-shadow: 0 0 8px rgba(74, 158, 255, 0.2);
}

/* ── Header ──────────────────────────────────────────────── */

.sidebar-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px;
  border-bottom: 1px solid var(--panel-border);
  flex-shrink: 0;
}

/* ── List ─────────────────────────────────────────────────── */

.sidebar-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px 0;
}
.sidebar-bucket {
  padding: 0 8px;
}
.sidebar-bucket-label {
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: var(--ink-faint);
  padding: 10px 8px 4px;
}

/* ── Conversation item ────────────────────────────────────── */

.conv-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px 10px;
  border-radius: var(--r-sm);
  cursor: pointer;
  transition: background var(--t-fast);
  position: relative;
}
.conv-item:hover {
  background: rgba(74, 158, 255, 0.06);
}
.conv-active {
  background: rgba(74, 158, 255, 0.1);
  border-left: 2px solid var(--accent);
}
.conv-selected {
  background: rgba(74, 158, 255, 0.08);
}
.conv-pin {
  font-size: 11px;
  flex-shrink: 0;
  margin-top: 2px;
}
.conv-body {
  flex: 1;
  min-width: 0;
  overflow: hidden;
}
.conv-title {
  font-size: 13px;
  color: var(--ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.conv-preview {
  font-size: 11px;
  color: var(--ink-faint);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-top: 2px;
}
.conv-menu-btn {
  opacity: 0;
  background: transparent;
  border: none;
  color: var(--ink-dim);
  cursor: pointer;
  font-size: 14px;
  padding: 2px 4px;
  border-radius: var(--r-xs);
  transition: opacity var(--t-fast);
  flex-shrink: 0;
}
.conv-item:hover .conv-menu-btn {
  opacity: 1;
}
.conv-menu-btn:hover {
  color: var(--accent-2);
}
.conv-check {
  margin-top: 3px;
  flex-shrink: 0;
  accent-color: var(--accent);
}
.conv-rename-input {
  width: 100%;
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid var(--accent);
  border-radius: var(--r-xs);
  color: var(--ink);
  font-size: 13px;
  padding: 2px 6px;
  outline: none;
}

/* ── Footer ──────────────────────────────────────────────── */

.sidebar-foot {
  padding: 10px 14px;
  border-top: 1px solid var(--panel-border);
  flex-shrink: 0;
}
```

- [ ] **Step 4: Verify types compile**

Run:
```bash
npx tsc --noEmit
```
Expected: errors because `SearchBar`, `BatchFooter`, `ConversationMenu`, `UndoToast` don't exist yet. Create stubs in next steps.

- [ ] **Step 5: Create stub components**

Create `src/components/Chat/SearchBar.tsx`:

```tsx
import { useState } from 'react';
import type { Lang, SearchHit } from '../../types';
import { searchFts } from '../../lib/db';

interface Props {
  lang: Lang;
  onResults: (hits: SearchHit[]) => void;
  onSelect: (hit: SearchHit) => void;
  onClear: () => void;
}

export default function SearchBar({ lang, onResults, onSelect, onClear }: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchHit[]>([]);
  const debounceRef = { current: 0 as ReturnType<typeof setTimeout> | 0 };

  function handleChange(value: string) {
    setQuery(value);
    clearTimeout(debounceRef.current);
    if (!value.trim()) {
      setResults([]);
      onResults([]);
      onClear();
      return;
    }
    debounceRef.current = setTimeout(async () => {
      try {
        const hits = await searchFts(value);
        setResults(hits);
        onResults(hits);
      } catch {
        setResults([]);
        onResults([]);
      }
    }, 200);
  }

  return (
    <div className="search-wrap">
      <input
        className="search-input mono"
        placeholder={lang === 'zh' ? '🔍 搜索...' : '🔍 Search...'}
        value={query}
        onChange={(e) => handleChange(e.target.value)}
      />
      {results.length > 0 && (
        <div className="search-results">
          {results.map((hit) => (
            <button
              type="button"
              key={`${hit.conversation_id}-${hit.message_id}`}
              className="search-hit"
              onClick={() => onSelect(hit)}
            >
              <div className="search-hit-title">{hit.conversation_title}</div>
              <div
                className="search-hit-snippet"
                dangerouslySetInnerHTML={{ __html: hit.snippet }}
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
```

Create `src/components/Chat/ConversationMenu.tsx`:

```tsx
import { useEffect, useRef } from 'react';
import type { ConversationWithPreview, Lang } from '../../types';

interface Props {
  conv: ConversationWithPreview;
  lang: Lang;
  x: number;
  y: number;
  onRename: (id: string) => void;
  onPin: (id: string, pinned: boolean) => void;
  onExport: (id: string) => void;
  onDelete: (id: string, title: string) => void;
  onClose: () => void;
}

const COPY = {
  en: { rename: 'Rename', pin: 'Pin', unpin: 'Unpin', export: 'Export as Markdown…', delete: 'Delete' },
  zh: { rename: '重命名', pin: '固定', unpin: '取消固定', export: '导出为 Markdown…', delete: '删除' },
};

export default function ConversationMenu({
  conv, lang, x, y, onRename, onPin, onExport, onDelete, onClose,
}: Props) {
  const L = COPY[lang];
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener('mousedown', handler);
    return () => window.removeEventListener('mousedown', handler);
  }, [onClose]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div ref={ref} className="conv-menu" style={{ top: y, left: x }}>
      <button type="button" onClick={() => onRename(conv.id)}>{L.rename}</button>
      <button type="button" onClick={() => onPin(conv.id, !conv.pinned)}>
        {conv.pinned ? L.unpin : L.pin}
      </button>
      <button type="button" onClick={() => onExport(conv.id)}>{L.export}</button>
      <button type="button" className="conv-menu-danger" onClick={() => onDelete(conv.id, conv.title)}>
        {L.delete}
      </button>
    </div>
  );
}
```

Create `src/components/Chat/UndoToast.tsx`:

```tsx
import type { Lang } from '../../types';
import './UndoToast.css';

interface Props {
  lang: Lang;
  title: string;
  onUndo: () => void;
  onDismiss: () => void;
}

export default function UndoToast({ lang, title, onUndo, onDismiss }: Props) {
  const isZh = lang === 'zh';
  return (
    <div className="undo-toast">
      <span>{isZh ? `已删除「${title}」` : `Deleted "${title}"`}</span>
      <button type="button" className="undo-btn" onClick={onUndo}>
        {isZh ? '撤销' : 'Undo'}
      </button>
      <button type="button" className="undo-dismiss" onClick={onDismiss} aria-label="dismiss">✕</button>
    </div>
  );
}
```

Create `src/components/Chat/UndoToast.css`:

```css
.undo-toast {
  position: absolute;
  bottom: 56px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 14px;
  background: var(--panel-solid);
  border: 1px solid var(--panel-border);
  border-radius: var(--r-sm);
  font-size: 12px;
  color: var(--ink-dim);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
  z-index: 20;
  animation: fadeIn 0.2s ease;
}
.undo-btn {
  background: transparent;
  border: 1px solid var(--accent);
  color: var(--accent-2);
  border-radius: var(--r-xs);
  padding: 2px 8px;
  font-size: 11px;
  font-family: var(--font-mono);
  cursor: pointer;
  transition: all var(--t);
}
.undo-btn:hover {
  background: rgba(74, 158, 255, 0.1);
}
.undo-dismiss {
  background: transparent;
  border: none;
  color: var(--ink-faint);
  cursor: pointer;
  font-size: 12px;
}
```

Create `src/components/Chat/BatchFooter.tsx`:

```tsx
import Button from '../common/Button';
import type { Lang } from '../../types';

interface Props {
  lang: Lang;
  count: number;
  onDelete: () => void;
  onExport: () => void;
  onCancel: () => void;
}

const COPY = {
  en: { items: 'items', del: 'Delete selected', exp: 'Export selected', cancel: 'Cancel' },
  zh: { items: '项', del: '删除所选', exp: '导出所选', cancel: '取消' },
};

export default function BatchFooter({ lang, count, onDelete, onExport, onCancel }: Props) {
  const L = COPY[lang];
  return (
    <div className="batch-footer">
      <span className="batch-count mono">{count} {L.items}</span>
      <div className="batch-actions">
        <Button size="sm" variant="danger" onClick={onDelete} disabled={count === 0}>
          {L.del}
        </Button>
        <Button size="sm" variant="secondary" onClick={onExport} disabled={count === 0}>
          {L.exp}
        </Button>
        <Button size="sm" variant="secondary" onClick={onCancel}>
          {L.cancel}
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Add remaining sidebar CSS (search, menu, batch)**

Append to `src/components/Chat/ConversationSidebar.css`:

```css
/* ── Search ──────────────────────────────────────────────── */

.search-wrap {
  padding: 8px 14px;
  flex-shrink: 0;
}
.search-input {
  width: 100%;
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid var(--panel-border);
  border-radius: var(--r-sm);
  color: var(--ink);
  font-size: 12px;
  padding: 6px 10px;
  outline: none;
  transition: border-color var(--t);
}
.search-input:focus {
  border-color: var(--accent);
}
.search-results {
  margin-top: 6px;
  max-height: 300px;
  overflow-y: auto;
}
.search-hit {
  display: block;
  width: 100%;
  text-align: left;
  background: transparent;
  border: none;
  padding: 6px 8px;
  border-radius: var(--r-xs);
  cursor: pointer;
  transition: background var(--t-fast);
}
.search-hit:hover {
  background: rgba(74, 158, 255, 0.06);
}
.search-hit-title {
  font-size: 12px;
  color: var(--ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.search-hit-snippet {
  font-size: 11px;
  color: var(--ink-faint);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-top: 2px;
}
.search-hit-snippet mark {
  background: rgba(0, 229, 255, 0.2);
  color: var(--accent-2);
  padding: 0 1px;
  border-radius: 1px;
}

/* ── Context menu ────────────────────────────────────────── */

.conv-menu {
  position: fixed;
  z-index: 100;
  background: var(--panel-solid);
  border: 1px solid var(--panel-border);
  border-radius: var(--r-sm);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
  padding: 4px;
  min-width: 160px;
}
.conv-menu button {
  display: block;
  width: 100%;
  text-align: left;
  background: transparent;
  border: none;
  color: var(--ink-dim);
  font-size: 12px;
  padding: 6px 12px;
  border-radius: var(--r-xs);
  cursor: pointer;
  transition: all var(--t-fast);
}
.conv-menu button:hover {
  background: rgba(74, 158, 255, 0.08);
  color: var(--ink);
}
.conv-menu-danger:hover {
  color: var(--danger) !important;
  background: rgba(239, 68, 68, 0.08) !important;
}

/* ── Batch footer ────────────────────────────────────────── */

.batch-footer {
  padding: 10px 14px;
  border-top: 1px solid var(--panel-border);
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.batch-count {
  font-size: 11px;
  color: var(--ink-dim);
  letter-spacing: 0.08em;
}
.batch-actions {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
```

- [ ] **Step 7: Verify types compile**

Run:
```bash
npx tsc --noEmit
```
Expected: zero errors.

- [ ] **Step 8: Commit**

```bash
git add src/components/Chat/ConversationSidebar.tsx \
  src/components/Chat/ConversationSidebar.css \
  src/components/Chat/ConversationItem.tsx \
  src/components/Chat/ConversationMenu.tsx \
  src/components/Chat/SearchBar.tsx \
  src/components/Chat/BatchFooter.tsx \
  src/components/Chat/UndoToast.tsx \
  src/components/Chat/UndoToast.css
git commit -m "feat(sidebar): conversation sidebar with time buckets, search, context menu

Full sidebar UI: collapsible 260px panel, time-bucketed conversation list,
inline rename, search with FTS results, context menu (rename/pin/export/
delete), batch mode footer, undo toast for soft deletes."
```

---

## Task 7: ChatWindow integration + persistence wiring

**Files:**
- Modify: `src/components/Chat/ChatWindow.tsx`
- Modify: `src/components/Chat/ChatWindow.css`

This is the largest modification. ChatWindow gains:
1. A `conversationId` state tracking the active conversation
2. Sidebar rendering
3. DB writes for user messages (immediate) and assistant messages (500 ms debounce)
4. Conversation load on sidebar click / app startup

- [ ] **Step 1: Update ChatWindow.css layout**

In `src/components/Chat/ChatWindow.css`, replace the `.chat-body` block and remove the `.chat-root.wide`/`.chat-root.narrow` rules. Replace the `/* ── Body layout ── */` section with:

```css
/* ── Body layout ───────────────────────────────────────── */
.chat-body {
  flex: 1;
  display: flex;
  min-height: 0;
}
```

Remove these rules (no longer needed):
```css
.chat-root.wide .chat-body {
  grid-template-columns: 240px 1fr 280px;
}
.chat-root.narrow .chat-body {
  grid-template-columns: 1fr;
}
```

- [ ] **Step 2: Rewrite ChatWindow.tsx with persistence**

Replace `src/components/Chat/ChatWindow.tsx`:

```tsx
import { useCallback, useEffect, useRef, useState } from 'react';
import Logo from '../common/Logo';
import Button from '../common/Button';
import MessageList from './MessageList';
import InputBox from './InputBox';
import ApprovalModal from './ApprovalModal';
import SettingsPanel from '../Settings/SettingsPanel';
import ConversationSidebar from './ConversationSidebar';
import ConfirmDeleteModal from './ConfirmDeleteModal';
import { respondToApproval, streamChat } from '../../lib/sidecar';
import {
  deriveTitle,
  getMessages,
  getMostRecentConversationId,
  openDb,
  updateConversationTimestamp,
  upsertMessage,
  vacuumOldDeletions,
} from '../../lib/db';
import { conversationToMarkdown, sanitizeFilename } from '../../lib/exportMarkdown';
import { useConversations } from '../../hooks/useConversations';
import type {
  ApprovalRequest,
  AssistantEvent,
  Config,
  Lang,
  Message,
  SearchHit,
  StoredMessage,
  TextEvent,
  ThinkingEvent,
  ToolEvent,
} from '../../types';
import { save as showSaveDialog } from '@tauri-apps/plugin-dialog';
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
): AssistantEvent[] {
  const idx = events.findIndex((e) => e.kind === 'tool' && e.id === id);
  if (idx === -1) return events;
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
  };
}

export default function ChatWindow({
  lang,
  onLangChange,
  config,
  onConfigChanged,
}: Props) {
  const L = COPY[lang];
  const convs = useConversations();

  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [approval, setApproval] = useState<ApprovalRequest | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => localStorage.getItem('ui.sidebar_collapsed') === 'true',
  );
  const [confirmDelete, setConfirmDelete] = useState<string[] | null>(null);
  const [dbReady, setDbReady] = useState(false);

  const approvalQueueRef = useRef<ApprovalRequest[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Boot: open DB, run vacuum, load most recent conversation.
  useEffect(() => {
    (async () => {
      try {
        await openDb();
        await vacuumOldDeletions();
        setDbReady(true);
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

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((v) => {
      const next = !v;
      localStorage.setItem('ui.sidebar_collapsed', String(next));
      return next;
    });
  }, []);

  const loadConversation = useCallback(async (id: string) => {
    if (streaming) return;
    try {
      const stored = await getMessages(id);
      setMessages(stored.map(storedToMessage));
      setConversationId(id);
    } catch (e) {
      console.error('failed to load conversation', e);
    }
  }, [streaming]);

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

  // Debounced DB write for in-progress assistant message.
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

  // Final flush on stream end.
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

  async function handleSend(text: string) {
    const trimmed = text.trim();
    if (!trimmed || streaming) return;

    // Ensure conversation exists.
    let convId = conversationId;
    if (!convId && dbReady) {
      convId = crypto.randomUUID();
      const title = deriveTitle(trimmed);
      try {
        await convs.create(convId, title);
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
    setStreaming(true);

    // Persist user message immediately.
    if (dbReady) {
      try {
        const stored: StoredMessage = {
          id: userMsg.id,
          conversation_id: convId,
          role: 'user',
          content: userMsg.content,
          created_at: Date.now(),
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
    }));

    const capturedConvId = convId;

    abortRef.current = streamChat(history, {
      onToken: (txt) => {
        setMessages((prev) => {
          const updated = updateAssistant(prev, assistantId, (m) => ({
            ...m,
            content: m.content + txt,
            events: appendTextEvent(m.events || [], txt),
          }));
          const msg = updated.find((m) => m.id === assistantId);
          if (msg) schedulePersist(msg, capturedConvId);
          return updated;
        });
      },
      onThinking: (txt) => {
        setMessages((prev) =>
          updateAssistant(prev, assistantId, (m) => ({
            ...m,
            events: appendThinkingEvent(m.events || [], txt),
          })),
        );
      },
      onToolStart: (t) => {
        setMessages((prev) =>
          updateAssistant(prev, assistantId, (m) => ({
            ...m,
            events: [
              ...(m.events || []),
              {
                kind: 'tool',
                id: t.id,
                name: t.name,
                args: t.args,
                preview: t.preview,
                output: '',
                auto_allowed: t.auto_allowed,
                allowed_until_ms: t.allowed_until_ms,
              } as ToolEvent,
            ],
          })),
        );
      },
      onToolOutput: (id, chunk) => {
        setMessages((prev) =>
          updateAssistant(prev, assistantId, (m) => ({
            ...m,
            events: upsertTool(m.events || [], id, (t) => ({
              ...t,
              output: t.output + chunk,
            })),
          })),
        );
      },
      onToolResult: (id, result) => {
        setMessages((prev) =>
          updateAssistant(prev, assistantId, (m) => ({
            ...m,
            events: upsertTool(m.events || [], id, (t) => ({
              ...t,
              result,
            })),
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
        setMessages((prev) =>
          updateAssistant(prev, assistantId, (m) => ({ ...m, step })),
        );
      },
      onStatus: (txt) => {
        setMessages((prev) =>
          updateAssistant(prev, assistantId, (m) => ({ ...m, status: txt })),
        );
      },
      onDone: () => {
        setMessages((prev) => {
          const updated = updateAssistant(prev, assistantId, (m) => ({
            ...m,
            streaming: false,
            status: undefined,
          }));
          const msg = updated.find((m) => m.id === assistantId);
          if (msg) flushPersist(msg, capturedConvId);
          return updated;
        });
        setStreaming(false);
        abortRef.current = null;
      },
      onError: (msg) => {
        setMessages((prev) => {
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
        setStreaming(false);
        abortRef.current = null;
      },
    });
  }

  function handleStop() {
    abortRef.current?.abort();
    abortRef.current = null;
    setStreaming(false);
    setMessages((prev) =>
      prev.map((m) =>
        m.streaming ? { ...m, streaming: false, status: undefined } : m,
      ),
    );
    approvalQueueRef.current = [];
    setApproval(null);
  }

  function handleNewChat() {
    if (streaming) handleStop();
    setMessages([]);
    setConversationId(null);
  }

  async function handleSelectConversation(id: string) {
    if (id === conversationId) return;
    if (streaming) handleStop();
    await loadConversation(id);
  }

  async function handleDeleteConversation(id: string, title: string) {
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
    await convs.removeMany(confirmDelete);
    if (confirmDelete.includes(conversationId ?? '')) {
      const nextId = await getMostRecentConversationId();
      if (nextId) await loadConversation(nextId);
      else { setMessages([]); setConversationId(null); }
    }
    setConfirmDelete(null);
  }

  async function handleExport(id: string) {
    try {
      const stored = await getMessages(id);
      const conv = convs.conversations.find((c) => c.id === id);
      const title = conv?.title ?? 'conversation';
      const md = conversationToMarkdown(title, stored);
      const path = await showSaveDialog({
        defaultPath: `${sanitizeFilename(title)}.md`,
        filters: [{ name: 'Markdown', extensions: ['md'] }],
      });
      if (path) {
        await invoke('write_text_file', { path, content: md });
      }
    } catch (e) {
      console.error('export failed', e);
    }
  }

  async function handleExportMany(ids: string[]) {
    for (const id of ids) {
      await handleExport(id);
    }
  }

  function handleSearchSelect(hit: SearchHit) {
    handleSelectConversation(hit.conversation_id);
  }

  // Keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key === 'n') { e.preventDefault(); handleNewChat(); }
      if (mod && e.key === '\\') { e.preventDefault(); toggleSidebar(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleSidebar, streaming]);

  return (
    <div className="chat-root">
      <header className="chat-topbar">
        <div className="row" style={{ gap: 14 }}>
          <Logo size="sm" />
        </div>
        <div className="row" style={{ gap: 10 }}>
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
        />
        <main className="chat-center">
          <MessageList messages={messages} lang={lang} />
          <InputBox
            lang={lang}
            streaming={streaming}
            onSend={handleSend}
            onStop={handleStop}
          />
        </main>
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
    </div>
  );
}
```

- [ ] **Step 3: Create ConfirmDeleteModal**

Create `src/components/Chat/ConfirmDeleteModal.tsx`:

```tsx
import { useEffect, useRef } from 'react';
import Button from '../common/Button';
import type { Lang } from '../../types';

interface Props {
  lang: Lang;
  count: number;
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDeleteModal({ lang, count, open, onConfirm, onCancel }: Props) {
  const denyRef = useRef<HTMLButtonElement | null>(null);
  const isZh = lang === 'zh';

  useEffect(() => {
    if (open) setTimeout(() => denyRef.current?.focus(), 0);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div className="approve-overlay" role="dialog" aria-modal="true">
      <div className="approve-card approve-destructive" style={{ maxWidth: 400 }}>
        <div className="approve-head">
          <span className="approve-glyph" aria-hidden>⚠</span>
          <span className="approve-title">{isZh ? '确认删除' : 'Confirm delete'}</span>
        </div>
        <p className="approve-sub">
          {isZh
            ? `即将删除 ${count} 条对话。此操作可在 30 天内通过数据恢复找回。`
            : `About to delete ${count} conversation${count > 1 ? 's' : ''}. Recoverable for 30 days.`}
        </p>
        <div className="approve-actions">
          <Button ref={denyRef} variant="primary" size="sm" onClick={onCancel}>
            {isZh ? '取消' : 'Cancel'}
          </Button>
          <Button variant="danger" size="sm" onClick={onConfirm}>
            {isZh ? '删除' : 'Delete'}
          </Button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Verify types compile**

Run:
```bash
npx tsc --noEmit
```
Expected: zero errors. If `showSaveDialog` type doesn't match, check `@tauri-apps/plugin-dialog` exports — it may export `save` directly or as `dialog.save`. Adjust the import accordingly.

- [ ] **Step 5: Commit**

```bash
git add src/components/Chat/ChatWindow.tsx src/components/Chat/ChatWindow.css \
  src/components/Chat/ConfirmDeleteModal.tsx
git commit -m "feat(chat): wire sidebar + persistence into ChatWindow

ChatWindow now: opens DB on boot, loads most recent conversation,
creates conversations on first message, persists user messages
immediately, debounce-writes assistant messages at 500ms with final
flush on stream end. Sidebar integrated with full CRUD. Keyboard
shortcuts: Cmd+N new chat, Cmd+\\ toggle sidebar."
```

---

## Task 8: Verification + smoke test

**Files:** none (verification only).

- [ ] **Step 1: Full static validation**

Run:
```bash
cd /Users/huangpinqing/Desktop/bitidea-desktop
npx tsc --noEmit
```
Expected: zero errors.

Run:
```bash
cd /Users/huangpinqing/Desktop/bitidea-desktop/src-tauri
cargo check
```
Expected: compiles cleanly.

- [ ] **Step 2: Start the dev app**

Run:
```bash
cd /Users/huangpinqing/Desktop/bitidea-desktop
npm run tauri dev
```
Expected: app launches with sidebar visible.

- [ ] **Step 3: Smoke test matrix**

| Test | Expected |
| --- | --- |
| Send a message in empty state | New conversation appears in sidebar, assistant responds |
| Click "新对话", send message | Second conversation in sidebar |
| Click first conversation in sidebar | Messages load correctly |
| Quit and reopen app | Most recent conversation auto-loads, both conversations in sidebar |
| Right-click → Rename → type new title → Enter | Title updates in sidebar |
| Right-click → Pin | Conversation moves to 📌 group; try pinning 6 → toast warning |
| Right-click → Delete | Conversation removed, undo toast appears for 5s |
| Click "撤销" on toast | Conversation restored |
| Type in search box | Matching conversations appear, click one to load it |
| Right-click → Export as Markdown | Save dialog appears, file is written |
| Click "批量" → select 2 → "删除所选" | Confirm modal appears, confirm → both deleted |
| `Cmd+N` shortcut | New conversation |
| `Cmd+\` shortcut | Sidebar collapses / expands |

- [ ] **Step 4: Verify FTS5 works**

After sending several messages, search for a word that appears in an assistant response. If no results appear, FTS5 may not be enabled in the bundled SQLite. Fix by adding to `src-tauri/Cargo.toml`:
```toml
[dependencies.libsqlite3-sys]
version = "*"
features = ["bundled", "bundled-sqlcipher-vendored-openssl"]
```
This forces FTS5 on. Re-run `cargo check` + `npm run tauri dev`.

- [ ] **Step 5: Final commit log**

```bash
git log --oneline main..feat/agent-integration
```
Expected: the prior approval severity commits + this plan's ~7 incremental commits covering: plugin setup, types, db.ts, export, sidebar components, ChatWindow wiring.

---

## Self-review against spec

### Spec coverage

- ✅ §1.1 SQLite via tauri-plugin-sql — Task 1 (Rust setup + migrations)
- ✅ §1.2 Location — adapted to Tauri app data dir (noted in deviations)
- ✅ §1.3 Schema — conversations, messages, messages_fts with FTS5 (Task 1 migration SQL)
- ✅ §1.4 Vacuum — `vacuumOldDeletions()` in db.ts (Task 3), runs on startup (Task 7)
- ✅ §2 TypeScript types — Conversation, ConversationWithPreview, StoredMessage (Task 2)
- ✅ §3.1 Layering — db.ts → tauri-plugin-sql → SQLite (Task 3)
- ✅ §3.2 Write cadence — immediate user msg write, 500 ms debounce assistant, final flush (Task 7)
- ✅ §3.3 Loading on startup — open DB → vacuum → load most recent conversation (Task 7)
- ✅ §4.1 Layout — 260 px sidebar, collapsible to 48 px rail (Task 6 CSS)
- ✅ §4.2 Conversation row — title, preview, hover ⋯ menu, active accent (Task 6 ConversationItem)
- ✅ §4.3 Search — 200 ms debounce FTS, results with `<mark>`, click to load (Task 6 SearchBar)
- ✅ §4.4 Pin — max 5, toast on 6th (Task 5 useConversations)
- ✅ §4.5 Rename — inline input, Enter commits, Esc cancels (Task 6 ConversationItem)
- ✅ §4.6 Delete single — soft delete, undo toast 5s (Task 5 + Task 6 UndoToast)
- ✅ §4.7 Batch mode — checkbox selection, delete/export footer (Task 6 BatchFooter, Task 7 ConfirmDeleteModal)
- ✅ §4.8 Export Markdown — format matches spec, native save dialog (Task 4 + Task 7)
- ✅ §5 Keyboard shortcuts — Cmd+N, Cmd+\\, Esc in batch/rename (Task 7)
- ✅ §6 Error handling — DB fail → in-memory mode, write fail → console warn (Task 7)
- ✅ §8 Migration — no existing data to migrate (handled naturally)

### Placeholder scan

No TBD, TODO, "add appropriate", or "similar to Task N" tokens present. All code blocks are complete.

### Type consistency

- `Conversation`, `ConversationWithPreview`, `StoredMessage`, `SearchHit` — defined in Task 2, consumed consistently in db.ts (Task 3), hooks (Task 5), components (Task 6-7).
- `openDb()`, `upsertMessage()`, `getMessages()` — signatures consistent between db.ts definition and ChatWindow consumption.
- `deriveTitle()`, `conversationToMarkdown()`, `sanitizeFilename()` — defined in Tasks 3-4, consumed in Task 7.
- `useConversations()` return shape — `conversations`, `refresh`, `create`, `rename`, `pin`, `remove`, `removeMany`, `undoDelete`, `dismissUndo`, `undo` — all consumed correctly in Task 7.

No naming inconsistencies detected.

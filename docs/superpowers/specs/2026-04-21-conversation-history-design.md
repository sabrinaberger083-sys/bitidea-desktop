# Conversation History & Persistence — Design

**Date:** 2026-04-21
**Status:** approved
**Author:** Bitidea Desktop

## Goal

Make conversations survive app restart and let users browse, search, rename, pin, export, and delete past conversations from a persistent sidebar — on par with Claude Desktop / ChatGPT.

## Non-goals

- Cloud sync between devices (local-only this round).
- Sharing conversations with other users.
- Editing past messages.
- AI-generated titles (we use the first 40 chars of the first user message — save one API call per new conversation).
- Voice / multimodal attachments in exports.

## Constraints

- Must not disturb the existing agent SSE stream (token/thinking/tool/step/status/approval_request events already flow into `ChatWindow.messages`).
- Must not regress the approval severity UX shipped in the prior round.
- Desktop-only; no server.
- Bitidea Desktop runs under Tauri 2.0; Rust + React + TypeScript are the three fixed languages.

---

## 1. Storage

### 1.1 Engine: SQLite via `tauri-plugin-sql`

We pick SQLite over the already-bundled `@tauri-apps/plugin-store` because:

1. **FTS5 full-text search** ships built-in; a JSON-file store would need linear scans.
2. **Relational shape** (conversation → messages) is the natural model.
3. **Bulk operations** (delete 12 selected conversations, vacuum old tombstones) are one SQL statement instead of JSON rewrite + fsync.

`@tauri-apps/plugin-store` stays for its current role (app config / API keys). We do not migrate it.

### 1.2 Location

`~/.bitidea-desktop/agent-state/chat.db` — same parent as the existing `BITIDEA_HOME`, so the user can back up one directory for everything.

### 1.3 Schema

```sql
CREATE TABLE conversations (
  id          TEXT PRIMARY KEY,          -- uuid v4
  title       TEXT NOT NULL,             -- first 40 chars of first user msg, editable
  pinned      INTEGER NOT NULL DEFAULT 0,-- 0 | 1
  created_at  INTEGER NOT NULL,          -- epoch ms
  updated_at  INTEGER NOT NULL,          -- epoch ms, bumped on every append
  deleted_at  INTEGER                    -- soft delete; NULL = live
);
CREATE INDEX idx_conv_updated ON conversations (deleted_at, pinned DESC, updated_at DESC);

CREATE TABLE messages (
  id              TEXT PRIMARY KEY,       -- uuid v4
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role            TEXT NOT NULL CHECK (role IN ('user','assistant')),
  content         TEXT NOT NULL DEFAULT '', -- plain text (user msg; assistant legacy fallback)
  events_json     TEXT,                   -- JSON-encoded AssistantEvent[], NULL for user msgs
  step_json       TEXT,                   -- JSON-encoded StepEvent, NULL if none
  created_at      INTEGER NOT NULL
);
CREATE INDEX idx_msg_conv ON messages (conversation_id, created_at);

CREATE VIRTUAL TABLE messages_fts USING fts5(
  content,          -- flattened text: user content OR concatenated text/thinking/tool previews
  message_id UNINDEXED,
  conversation_id UNINDEXED,
  tokenize = 'unicode61 remove_diacritics 2'
);
```

**FTS write policy:** every time we upsert a `messages` row, we rewrite the matching `messages_fts` row with the flattened text of `content` + every `TextEvent.text` + every `ThinkingEvent.text` + every `ToolEvent.preview` + every `ToolEvent.result.summary`. Tool `output` (raw streamed stdout) is **not indexed** — it is noisy and often huge.

**FTS cascade behavior:** FTS5 virtual tables do not auto-cascade from foreign-key deletes. `db.ts` explicitly deletes the matching `messages_fts` rows inside the same transaction as any message delete (hard-delete path only — see §1.4). Soft-delete leaves FTS rows in place but every search query joins `conversations ON ...WHERE deleted_at IS NULL` so tombstoned conversations never surface.

### 1.4 Vacuum

`vacuumOldDeletions()` runs once on startup (per §3.3). It hard-deletes `conversations` rows where `deleted_at IS NOT NULL AND deleted_at < now − 30 days`. The CASCADE on `messages.conversation_id` removes messages. `db.ts` then issues `DELETE FROM messages_fts WHERE message_id IN (...)` for the removed ids inside the same transaction.

**Migration plumbing:** `tauri-plugin-sql` has a built-in migration registry. We ship migrations as `src-tauri/migrations/0001_init.sql`. The plugin runs pending ones on startup.

---

## 2. Data model (TypeScript)

```ts
export interface Conversation {
  id: string;
  title: string;
  pinned: boolean;
  created_at: number; // epoch ms
  updated_at: number; // epoch ms
}

export interface ConversationWithPreview extends Conversation {
  /** First ~80 chars of the most recent non-empty message body — for list subtitle. */
  preview: string;
  /** Total message count (cached from latest write). */
  message_count: number;
}

export interface StoredMessage {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant';
  content: string;
  events?: AssistantEvent[];  // decoded from events_json
  step?: StepEvent;            // decoded from step_json
  created_at: number;
}
```

`Message` (the existing type consumed by `MessageList`) gets re-derived from `StoredMessage` on load. The round-trip identity we must preserve: `load(save(msg)) ≈ msg` (minus `streaming` flag, which is always `false` after reload).

---

## 3. Architecture

### 3.1 Layering

```
┌──────────────────────────────┐
│  React components            │  ChatWindow / ConversationSidebar
│                              │  SearchBar / ConfirmDeleteModal
└──────────────┬───────────────┘
               │  hooks: useConversations, useMessages
┌──────────────▼───────────────┐
│  src/lib/db.ts               │  typed wrappers; no JSX
│  - listConversations()       │
│  - getMessages(conv_id)      │
│  - upsertConversation(c)     │
│  - upsertMessage(m)          │
│  - softDelete / undoDelete   │
│  - searchFts(q)              │
│  - exportMarkdown(conv_id)   │
│  - vacuumOldDeletions()      │
└──────────────┬───────────────┘
               │  @tauri-apps/plugin-sql
┌──────────────▼───────────────┐
│  Rust: tauri-plugin-sql      │
│  - loads migrations          │
│  - runs SQL                  │
└──────────────────────────────┘
```

### 3.2 Write cadence

A conversation's messages are written in two moments:

- **User message send:** immediate upsert of the user message row + `conversations.updated_at` bump. Also creates the conversation row if `current_conversation_id === null` (new conversation case) and derives the title.
- **Assistant stream:** debounced 500 ms upsert of the in-progress assistant `StoredMessage` while streaming. Once `onDone` fires, a final flush runs immediately.

On app crash mid-stream we lose the last <500 ms of tokens. The user can re-ask. This is an acceptable trade vs. writing on every token.

### 3.3 Loading on startup

`App.tsx` after `bootstrap()`:

1. Open DB (migrations auto-run via `tauri-plugin-sql`).
2. Run `vacuumOldDeletions()` (see §1.4).
3. `SELECT id FROM conversations WHERE deleted_at IS NULL ORDER BY updated_at DESC LIMIT 1`.
4. If found, set `current_conversation_id` to it and load its messages. Otherwise stay on `messages=[]` (the "准备就绪" welcome state).

No explicit "restore last session" toggle. Users who want a blank canvas click **新对话**.

---

## 4. UI

### 4.1 Layout

Sidebar, left, 260 px wide, part of `ChatWindow`'s shell. Collapses to 48 px icon rail via a header button. Sidebar state persists in `@tauri-apps/plugin-store` under key `ui.sidebar_collapsed`.

```
┌──────────────┬─────────────────────────────┐
│ [+ 新对话]    │                             │
│              │                             │
│ 🔍 搜索...    │                             │
│              │                             │
│ 📌 固定        │      existing ChatWindow   │
│ • 产品脑暴     │                             │
│              │                             │
│ 今天          │                             │
│ • mkdir 测试  │                             │
│ 昨天          │                             │
│ • Phase D     │                             │
│ 上周          │                             │
│ • …          │                             │
│              │                             │
│ [批量]        │                             │
└──────────────┴─────────────────────────────┘
```

Time buckets: **今天 / 昨天 / 过去 7 天 / 过去 30 天 / 更早**. Empty buckets omit their header.

### 4.2 Conversation row

```
[📌]  Conversation title (truncated to 1 line)
      preview snippet (truncated, dim)      ⋯
```

On hover: trailing `⋯` menu button appears. Click opens:

- Rename
- Pin / Unpin
- Export as Markdown…
- Delete

Right-click opens the same menu at the cursor.

Active conversation row gets `accent` border-left accent + slightly brighter background.

### 4.3 Search

Typing in the search box (200 ms debounce) replaces the time-bucketed list with a flat result list. Each hit shows:

- Conversation title (hit snippet if matched there)
- The first 120 chars of the matched message with the hit token(s) wrapped in `<mark>`

Clicking a result loads that conversation and scrolls the `MessageList` to the matched message.

Empty search field restores the time-bucketed view.

### 4.4 Pin

Max 5 pinned (hard cap). If the user pins a 6th, show a toast "最多固定 5 条。请先取消固定一条。" and leave state unchanged.

Pinned rows sit in their own **📌 固定** group at the top, sorted by `updated_at DESC`.

### 4.5 Rename

Row-level inline edit. Click **Rename** from the menu → row title becomes an `<input>` with current title selected. `Enter` commits, `Esc` cancels. Empty title is rejected (kept as-is + brief shake animation).

### 4.6 Delete — single

Confirm-free delete from the row menu. On click:

1. Soft-delete the row (`UPDATE conversations SET deleted_at = now`).
2. Remove from sidebar.
3. If it was `current_conversation_id`, navigate to the most recently updated live conversation (or welcome state if none).
4. Show an undo toast at the top-right for 5 s: `已删除『标题』 · 撤销`.

Click **撤销** → `UPDATE conversations SET deleted_at = NULL`, re-insert into sidebar, restore `current_conversation_id` if it was the active one.

### 4.7 Batch mode

Footer **批量** button enters multi-select:

- Rows grow a leading checkbox.
- Sidebar footer swaps to `{N} 项 · 删除所选 · 导出所选 · 取消`.
- **删除所选** opens a `ConfirmDeleteModal` (same pattern as destructive approval friction — Deny button default-focused, no Enter on Allow, explicit count shown: "即将删除 12 条对话。").
- **导出所选** writes one `.md` file per conversation into a user-picked folder.
- **取消** exits batch mode without changes.

### 4.8 Export Markdown

Format:

```markdown
# {title}

_{ISO date of first message}_

## 你

{user content}

## 助手

{flattened assistant events: text runs as paragraphs; thinking as `> blockquote`; tools as fenced code blocks with language hint `shell` / `text`; tool results as `> result:` blockquotes}

---

## 你

...
```

Uses Tauri's native save dialog (`@tauri-apps/plugin-dialog`, already transitively available via Tauri 2). Default filename: `{title}.md` sanitized for filesystem.

---

## 5. Keyboard shortcuts

- `Cmd+N` — new conversation (same as clicking **+ 新对话**).
- `Cmd+\` — toggle sidebar collapse.
- `Cmd+F` — focus search box.
- `Cmd+Shift+F` — exit search / clear query.
- `Esc` — in rename mode → cancel. In batch mode → exit.
- `↑ / ↓` — while search or sidebar has focus, move selection. `Enter` to activate.

Non-goal: full vim-style navigation.

---

## 6. Error handling

- **DB open fails on startup:** fall back to an in-memory single-conversation mode (current behavior) and show a banner "会话历史暂不可用：{error}. 请重启应用。" App stays usable for the session.
- **Write fails mid-stream:** log to console; the in-memory `messages` state is authoritative for the current session. Surface a dim footer status "保存失败 · 重试" after 3 consecutive failures.
- **Export fails:** toast with error, nothing persisted.
- **Migration fails:** app boots into the DB-open-failure banner.

No crash screens. No destructive fallbacks.

---

## 7. Testing strategy

### 7.1 Unit tests (TypeScript, Vitest)

- `db.ts` round-trip: insert conversation + messages → read back → deep-equal (modulo `streaming`).
- Title derivation: first user message of length 0 / 1 / 39 / 40 / 100 / multiline / Chinese characters.
- FTS flattening: given a message with text + thinking + tool events, produce expected indexed blob.
- Markdown export: fixture conversation → deterministic string output.

### 7.2 Integration (manual smoke)

Dedicated checklist in the plan's final task, covering:

1. Restart app → last conversation loads.
2. New conversation → send message → quit → reopen → both conversations in sidebar, correct order.
3. Search returns conversations that only match in assistant text / thinking / tool preview.
4. Pin 5 → try pin 6 → see toast.
5. Delete → undo → row returns.
6. Batch-delete 3 conversations → confirm → gone.
7. Export one as Markdown → open in editor → human-readable.
8. Rename → refresh → new title persists.

### 7.3 Rust-side

`tauri-plugin-sql` handles its own tests upstream; we do not wrap it. Migration files are plain SQL reviewed by the code-reviewer.

---

## 8. Migration

**No existing data to migrate.** Prior versions stored messages only in React state, so there is no on-disk history. First startup on the new version sees no DB, runs migrations, opens to welcome state.

We do **not** attempt to "rescue" the currently-open session's in-memory messages when the user upgrades, because the upgrade path requires quitting the app (killing the process also kills in-memory state).

---

## 9. File layout

```
src-tauri/
  Cargo.toml                  # add tauri-plugin-sql = { version = "2", features = ["sqlite"] }
  src/main.rs                 # register plugin + migrations
  migrations/
    0001_init.sql             # conversations, messages, messages_fts

src/
  lib/
    db.ts                     # typed client + all queries
    exportMarkdown.ts         # conversation → markdown string
  components/
    Chat/
      ChatWindow.tsx          # MOD: wire current_conversation_id, load/save
      ConversationSidebar.tsx # NEW
      ConversationSidebar.css # NEW
      ConversationItem.tsx    # NEW
      ConversationMenu.tsx    # NEW (rename/pin/export/delete popover)
      SearchBar.tsx           # NEW
      ConfirmDeleteModal.tsx  # NEW
      UndoToast.tsx           # NEW
      UndoToast.css           # NEW
      BatchFooter.tsx         # NEW
  hooks/
    useConversations.ts       # list + CRUD state, subscribes to sidebar
    useMessagesForConversation.ts  # load on id change
  types/
    index.ts                  # MOD: add Conversation, ConversationWithPreview, StoredMessage
```

---

## 10. Effort estimate

| Chunk | Days |
|---|---|
| Plugin + migrations + db.ts skeleton | 0.5 |
| Sidebar shell + list + new/switch conversation | 1 |
| Persistence wiring + debounce write | 0.5 |
| Search + FTS | 0.5 |
| Pin + rename + context menu | 0.5 |
| Export markdown + save dialog | 0.25 |
| Batch mode + confirm modal | 0.25 |
| Soft delete + undo toast + vacuum | 0.5 |
| Edge cases + manual smoke + fixes | 0.5 |
| **Total** | **~4 days** |

---

## 11. Open questions

None. All UX choices are resolved in §4–§5. Technical choices (SQLite, FTS5, soft delete + 30-day vacuum, 5-pin cap, 500 ms write debounce, 200 ms search debounce) are baked in.

import Database from '@tauri-apps/plugin-sql';
import type {
  Attachment,
  AssistantEvent,
  Conversation,
  ConversationWithPreview,
  Project,
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
      project_id: string | null;
      preview: string | null;
      message_count: number;
      project_name: string | null;
    }>
  >(
    `SELECT c.id, c.title, c.pinned, c.created_at, c.updated_at, c.project_id,
       (SELECT substr(m.content, 1, 80) FROM messages m
        WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) AS preview,
       (SELECT count(*) FROM messages m WHERE m.conversation_id = c.id) AS message_count,
       p.name AS project_name
     FROM conversations c
     LEFT JOIN projects p ON c.project_id = p.id
     WHERE c.deleted_at IS NULL
     ORDER BY c.pinned DESC, c.updated_at DESC`,
  );
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    pinned: r.pinned === 1,
    created_at: r.created_at,
    updated_at: r.updated_at,
    project_id: r.project_id,
    preview: r.preview ?? '',
    message_count: r.message_count,
    project_name: r.project_name ?? undefined,
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
      project_id: string | null;
    }>
  >(
    'SELECT id, title, pinned, created_at, updated_at, project_id FROM conversations WHERE id = $1 AND deleted_at IS NULL',
    [id],
  );
  if (rows.length === 0) return null;
  const r = rows[0];
  return { id: r.id, title: r.title, pinned: r.pinned === 1, created_at: r.created_at, updated_at: r.updated_at, project_id: r.project_id };
}

export async function createConversation(id: string, title: string, projectId?: string | null): Promise<void> {
  const db = await openDb();
  const now = Date.now();
  await db.execute(
    'INSERT INTO conversations (id, title, pinned, created_at, updated_at, project_id) VALUES ($1, $2, 0, $3, $4, $5)',
    [id, title, now, now, projectId ?? null],
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
      attachments_json: string | null;
      created_at: number;
    }>
  >(
    'SELECT id, conversation_id, role, content, events_json, step_json, attachments_json, created_at FROM messages WHERE conversation_id = $1 ORDER BY created_at',
    [conversationId],
  );
  return rows.map((r) => ({
    id: r.id,
    conversation_id: r.conversation_id,
    role: r.role,
    content: r.content,
    events: r.events_json ? (JSON.parse(r.events_json) as AssistantEvent[]) : undefined,
    step: r.step_json ? (JSON.parse(r.step_json) as StepEvent) : undefined,
    attachments: r.attachments_json ? (JSON.parse(r.attachments_json) as Attachment[]) : undefined,
    created_at: r.created_at,
  }));
}

export async function upsertMessage(msg: StoredMessage): Promise<void> {
  const db = await openDb();
  const eventsJson = msg.events ? JSON.stringify(msg.events) : null;
  const stepJson = msg.step ? JSON.stringify(msg.step) : null;
  const attachmentsJson = msg.attachments ? JSON.stringify(msg.attachments) : null;

  await db.execute(
    `INSERT INTO messages (id, conversation_id, role, content, events_json, step_json, attachments_json, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT(id) DO UPDATE SET content = $4, events_json = $5, step_json = $6, attachments_json = $7`,
    [msg.id, msg.conversation_id, msg.role, msg.content, eventsJson, stepJson, attachmentsJson, msg.created_at],
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

// ── Projects ──────────────────────────────────────────────

export async function listProjects(): Promise<Project[]> {
  const db = await openDb();
  return db.select<Project[]>(
    'SELECT id, name, path, created_at, updated_at FROM projects ORDER BY updated_at DESC',
  );
}

export async function getProject(id: string): Promise<Project | null> {
  const db = await openDb();
  const rows = await db.select<Project[]>(
    'SELECT id, name, path, created_at, updated_at FROM projects WHERE id = ?',
    [id],
  );
  return rows[0] ?? null;
}

export async function getProjectByPath(path: string): Promise<Project | null> {
  const db = await openDb();
  const rows = await db.select<Project[]>(
    'SELECT id, name, path, created_at, updated_at FROM projects WHERE path = ?',
    [path],
  );
  return rows[0] ?? null;
}

export async function createProject(id: string, name: string, path: string): Promise<void> {
  const db = await openDb();
  const now = Date.now();
  await db.execute(
    'INSERT INTO projects (id, name, path, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    [id, name, path, now, now],
  );
}

export async function renameProject(id: string, name: string): Promise<void> {
  const db = await openDb();
  await db.execute(
    'UPDATE projects SET name = ?, updated_at = ? WHERE id = ?',
    [name, Date.now(), id],
  );
}

export async function deleteProject(id: string): Promise<void> {
  const db = await openDb();
  await db.execute('UPDATE conversations SET project_id = NULL WHERE project_id = ?', [id]);
  await db.execute('DELETE FROM projects WHERE id = ?', [id]);
}

export async function setConversationProject(conversationId: string, projectId: string | null): Promise<void> {
  const db = await openDb();
  await db.execute(
    'UPDATE conversations SET project_id = ? WHERE id = ?',
    [projectId, conversationId],
  );
}

export async function listConversationsForProject(projectId: string): Promise<ConversationWithPreview[]> {
  const db = await openDb();
  const rows = await db.select<
    Array<{
      id: string;
      title: string;
      pinned: number;
      created_at: number;
      updated_at: number;
      project_id: string | null;
      preview: string | null;
      message_count: number;
    }>
  >(
    `SELECT c.id, c.title, c.pinned, c.created_at, c.updated_at, c.project_id,
            COALESCE((SELECT SUBSTR(m.content, 1, 80) FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1), '') AS preview,
            (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) AS message_count
     FROM conversations c
     WHERE c.project_id = ? AND c.deleted_at IS NULL
     ORDER BY c.pinned DESC, c.updated_at DESC`,
    [projectId],
  );
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    pinned: r.pinned === 1,
    created_at: r.created_at,
    updated_at: r.updated_at,
    project_id: r.project_id,
    preview: r.preview ?? '',
    message_count: r.message_count,
  }));
}

// ── Title derivation ───────────────────────────────────────

export function deriveTitle(firstUserContent: string): string {
  const cleaned = firstUserContent.replace(/\n/g, ' ').trim();
  if (cleaned.length <= 40) return cleaned || 'New conversation';
  return cleaned.slice(0, 40) + '…';
}

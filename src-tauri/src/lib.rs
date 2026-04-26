mod sidecar;

use sidecar::{get_sidecar_info, kill, spawn, SidecarState};
use tauri::RunEvent;
use tauri_plugin_sql::{Migration, MigrationKind};

fn chat_migrations() -> Vec<Migration> {
    vec![
        Migration {
            version: 1,
            description: "create conversations, messages and FTS tables",
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
        },
        Migration {
            version: 2,
            description: "add projects table and link conversations",
            sql: r#"
CREATE TABLE projects (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  path        TEXT NOT NULL UNIQUE,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX idx_project_path ON projects (path);

ALTER TABLE conversations ADD COLUMN project_id TEXT REFERENCES projects(id) ON DELETE SET NULL;
CREATE INDEX idx_conv_project ON conversations (project_id);
"#,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "add attachments_json column to messages",
            sql: r#"
ALTER TABLE messages ADD COLUMN attachments_json TEXT;
"#,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 4,
            description: "add assistants and folders tables",
            sql: r#"
CREATE TABLE assistants (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  icon        TEXT NOT NULL DEFAULT '🤖',
  system_prompt TEXT NOT NULL,
  builtin     INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE folders (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  icon       TEXT NOT NULL DEFAULT '📁',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

ALTER TABLE conversations ADD COLUMN folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL;
ALTER TABLE conversations ADD COLUMN assistant_id TEXT REFERENCES assistants(id) ON DELETE SET NULL;
CREATE INDEX idx_conv_folder ON conversations (folder_id);
"#,
            kind: MigrationKind::Up,
        },
    ]
}

#[tauri::command]
fn write_text_file(path: String, content: String) -> Result<(), String> {
    std::fs::write(&path, &content).map_err(|e| e.to_string())
}

#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn write_binary_file(path: String, data: Vec<u8>) -> Result<(), String> {
    std::fs::write(&path, &data).map_err(|e| e.to_string())
}

#[tauri::command]
fn read_binary_file(path: String) -> Result<String, String> {
    use base64::Engine as _;
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    Ok(base64::engine::general_purpose::STANDARD.encode(&bytes))
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
        .setup(move |app| {
            let app_handle = app.handle();
            spawn(&app_handle, &state_for_setup);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_sidecar_info,
            write_text_file,
            write_binary_file,
            read_text_file,
            read_binary_file
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(move |_app, event| {
            if matches!(event, RunEvent::Exit) {
                kill(&state_for_exit);
            }
        });
}

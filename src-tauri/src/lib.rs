mod sidecar;

use sidecar::{SidecarState, get_sidecar_info, kill, spawn};
use tauri::RunEvent;
use tauri_plugin_sql::{Migration, MigrationKind};

fn chat_migrations() -> Vec<Migration> {
    vec![Migration {
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
    }]
}

#[tauri::command]
fn write_text_file(path: String, content: String) -> Result<(), String> {
    std::fs::write(&path, &content).map_err(|e| e.to_string())
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

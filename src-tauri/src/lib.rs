mod sidecar;

use sidecar::{SidecarState, get_sidecar_info, kill, spawn};
use tauri::RunEvent;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let state = SidecarState::default();
    let state_for_setup = state.clone();
    let state_for_exit = state.clone();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(state)
        .setup(move |_app| {
            spawn(&state_for_setup);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![get_sidecar_info])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(move |_app, event| {
            if matches!(event, RunEvent::Exit) {
                kill(&state_for_exit);
            }
        });
}

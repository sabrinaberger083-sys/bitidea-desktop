//! Spawns and supervises the Python sidecar process.
//!
//! The sidecar prints three lines to stdout on startup:
//!   SIDECAR_PORT=<int>
//!   SIDECAR_TOKEN=<hex>
//!   SIDECAR_READY
//!
//! We capture those, expose them to the webview via a Tauri command,
//! and kill the child when the app shuts down.

use std::io::{BufRead, BufReader};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use serde::Serialize;
use tauri::State;

#[derive(Default, Debug, Clone, Serialize)]
pub struct SidecarInfo {
    pub port: Option<u16>,
    pub token: Option<String>,
    pub ready: bool,
    pub error: Option<String>,
}

/// Tauri-managed state. Cloneable handles share access across threads.
#[derive(Default, Clone)]
pub struct SidecarState {
    pub info: Arc<Mutex<SidecarInfo>>,
    pub child: Arc<Mutex<Option<Child>>>,
}

fn find_python() -> String {
    for candidate in &["python3", "python"] {
        if Command::new(candidate).arg("--version").output().is_ok() {
            return candidate.to_string();
        }
    }
    "python3".to_string()
}

/// Locate the sidecar directory. In dev, that's `<project>/sidecar`
/// (the exe lives at `<project>/src-tauri/target/debug/bitidea-desktop`).
/// In a bundled .app, resources live next to the executable.
fn sidecar_dir() -> std::path::PathBuf {
    if let Ok(exe) = std::env::current_exe() {
        // Walk up from the exe looking for a sibling `sidecar` directory.
        let mut dir = exe.clone();
        for _ in 0..6 {
            if !dir.pop() {
                break;
            }
            let candidate = dir.join("sidecar");
            if candidate.exists() {
                return candidate;
            }
        }
    }
    // Final fallback: relative to cwd.
    std::path::PathBuf::from("sidecar")
}

pub fn spawn(state: &SidecarState) {
    let python = find_python();
    let dir = sidecar_dir();

    if !dir.exists() {
        let msg = format!("sidecar dir not found: {}", dir.display());
        eprintln!("[sidecar] {msg}");
        state.info.lock().unwrap().error = Some(msg);
        return;
    }

    // `python -m sidecar` needs cwd to be the *parent* of the `sidecar/` package,
    // not the package itself.
    let cwd = dir.parent().map(|p| p.to_path_buf()).unwrap_or_else(|| dir.clone());

    eprintln!(
        "[sidecar] spawning: {} -m sidecar (cwd={})",
        python,
        cwd.display()
    );

    let spawn_result = Command::new(&python)
        .arg("-m")
        .arg("sidecar")
        .current_dir(&cwd)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn();

    let mut child = match spawn_result {
        Ok(c) => c,
        Err(e) => {
            let msg = format!("failed to launch sidecar: {e}");
            eprintln!("[sidecar] {msg}");
            state.info.lock().unwrap().error = Some(msg);
            return;
        }
    };

    // Reader thread: parse startup handshake, then forward remaining stdout to our stderr for logs.
    if let Some(stdout) = child.stdout.take() {
        let info = state.info.clone();
        thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines().map_while(Result::ok) {
                if let Some(rest) = line.strip_prefix("SIDECAR_PORT=") {
                    if let Ok(port) = rest.trim().parse::<u16>() {
                        info.lock().unwrap().port = Some(port);
                    }
                } else if let Some(rest) = line.strip_prefix("SIDECAR_TOKEN=") {
                    info.lock().unwrap().token = Some(rest.trim().to_string());
                } else if line.trim() == "SIDECAR_READY" {
                    info.lock().unwrap().ready = true;
                    eprintln!("[sidecar] ready");
                } else {
                    eprintln!("[sidecar·stdout] {line}");
                }
            }
        });
    }

    // Forward stderr for diagnostics (tracebacks land here).
    if let Some(stderr) = child.stderr.take() {
        thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines().map_while(Result::ok) {
                eprintln!("[sidecar·stderr] {line}");
            }
        });
    }

    *state.child.lock().unwrap() = Some(child);

    // Crash watcher: if the child exits unexpectedly, flip ready=false
    // so the frontend surfaces the failure instead of silently 401-ing.
    let info = state.info.clone();
    let child_slot = state.child.clone();
    thread::spawn(move || loop {
        thread::sleep(Duration::from_secs(2));
        let mut slot = child_slot.lock().unwrap();
        let Some(child) = slot.as_mut() else { break };
        match child.try_wait() {
            Ok(Some(status)) => {
                let msg = format!("sidecar exited unexpectedly (status {status})");
                eprintln!("[sidecar] {msg}");
                let mut i = info.lock().unwrap();
                i.ready = false;
                i.error = Some(msg);
                slot.take();
                break;
            }
            Ok(None) => { /* still running */ }
            Err(e) => {
                eprintln!("[sidecar] try_wait error: {e}");
                break;
            }
        }
    });
}

pub fn kill(state: &SidecarState) {
    let Some(mut child) = state.child.lock().unwrap().take() else {
        return;
    };
    let pid = child.id();
    eprintln!("[sidecar] sending SIGTERM (pid={pid})");

    // Try graceful SIGTERM first so the sidecar can finish in-flight writes.
    #[cfg(unix)]
    {
        // SAFETY: libc::kill is safe with a valid pid and a known signum.
        unsafe { libc::kill(pid as libc::pid_t, libc::SIGTERM) };
    }
    #[cfg(not(unix))]
    {
        // No SIGTERM equivalent on Windows — go straight to kill().
        let _ = child.kill();
    }

    // Poll for up to 3 seconds.
    let deadline = std::time::Instant::now() + Duration::from_secs(3);
    while std::time::Instant::now() < deadline {
        match child.try_wait() {
            Ok(Some(_)) => return,
            Ok(None) => thread::sleep(Duration::from_millis(100)),
            Err(_) => break,
        }
    }

    eprintln!("[sidecar] SIGTERM timeout, sending SIGKILL (pid={pid})");
    let _ = child.kill();
    let _ = child.wait();
}

// ─── Frontend-facing commands ───────────────────────────────────────

#[tauri::command]
pub fn get_sidecar_info(state: State<'_, SidecarState>) -> SidecarInfo {
    state.info.lock().unwrap().clone()
}

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
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Runtime, State};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
#[cfg(target_os = "windows")]
use tauri::Manager;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

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

#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
#[derive(Debug)]
enum SidecarLaunch {
    BundledExecutable { executable: PathBuf, cwd: PathBuf },
    PythonModule { python: String, cwd: PathBuf },
}

/// Locate the Python interpreter to launch the sidecar with.
///
/// Preference order:
///   1. `sidecar/.venv/bin/python` next to the sidecar package (dev mode).
///      This matters because v0.2 depends on `bitidea-agent`, which is
///      installed editable-mode into the venv, *not* the user's system
///      python. Falling back to system python would crash the sidecar with
///      `ImportError: run_agent`.
///   2. `python3` on PATH.
///   3. `python` on PATH.
///   4. Literal `python3` as a last resort.
fn find_python(sidecar_dir: &Path) -> String {
    let venv_candidates = [
        sidecar_dir.join(".venv").join("bin").join("python"),
        sidecar_dir.join(".venv").join("Scripts").join("python.exe"),
    ];
    for venv in venv_candidates {
        if venv.exists() {
            return venv.to_string_lossy().into_owned();
        }
    }
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
fn sidecar_dir() -> PathBuf {
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
    PathBuf::from("sidecar")
}

#[cfg(target_os = "windows")]
fn bundled_sidecar_candidates(resource_dir: &Path) -> [PathBuf; 4] {
    [
        resource_dir.join("sidecar.exe"),
        resource_dir.join("bitidea-sidecar.exe"),
        resource_dir.join("sidecar").join("sidecar.exe"),
        resource_dir.join("sidecar").join("bitidea-sidecar.exe"),
    ]
}

#[cfg(target_os = "windows")]
fn bundled_sidecar_launch<R: Runtime>(app: &AppHandle<R>) -> Option<SidecarLaunch> {
    if tauri::is_dev() {
        return None;
    }

    let resource_dir = app.path().resource_dir().ok()?;
    let executable = bundled_sidecar_candidates(&resource_dir)
        .into_iter()
        .find(|candidate| candidate.exists())?;
    let cwd = executable
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or(resource_dir);

    Some(SidecarLaunch::BundledExecutable { executable, cwd })
}

#[cfg(not(target_os = "windows"))]
fn bundled_sidecar_launch<R: Runtime>(_app: &AppHandle<R>) -> Option<SidecarLaunch> {
    None
}

fn resolve_launch<R: Runtime>(app: &AppHandle<R>) -> Result<SidecarLaunch, String> {
    if let Some(launch) = bundled_sidecar_launch(app) {
        return Ok(launch);
    }

    let dir = sidecar_dir();
    if !dir.exists() {
        return Err(format!("sidecar dir not found: {}", dir.display()));
    }

    // `python -m sidecar` needs cwd to be the *parent* of the `sidecar/` package,
    // not the package itself.
    let cwd = dir
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| dir.clone());
    let python = find_python(&dir);

    Ok(SidecarLaunch::PythonModule { python, cwd })
}

pub fn spawn<R: Runtime>(app: &AppHandle<R>, state: &SidecarState) {
    let launch = match resolve_launch(app) {
        Ok(launch) => launch,
        Err(msg) => {
            eprintln!("[sidecar] {msg}");
            state.info.lock().unwrap().error = Some(msg);
            return;
        }
    };

    let spawn_result = match &launch {
        SidecarLaunch::BundledExecutable { executable, cwd } => {
            eprintln!(
                "[sidecar] spawning bundled executable: {} (cwd={})",
                executable.display(),
                cwd.display()
            );
            let mut command = Command::new(executable);
            command
                .current_dir(cwd)
                .stdout(Stdio::piped())
                .stderr(Stdio::piped());
            #[cfg(target_os = "windows")]
            command.creation_flags(CREATE_NO_WINDOW);
            command.spawn()
        }
        SidecarLaunch::PythonModule { python, cwd } => {
            eprintln!(
                "[sidecar] spawning: {} -m sidecar (cwd={})",
                python,
                cwd.display()
            );
            let mut command = Command::new(python);
            command
                .arg("-m")
                .arg("sidecar")
                .current_dir(cwd)
                .stdout(Stdio::piped())
                .stderr(Stdio::piped());
            #[cfg(target_os = "windows")]
            command.creation_flags(CREATE_NO_WINDOW);
            command.spawn()
        }
    };

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

use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use serde_json::Value;
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::process::{Child, ChildStdin, Stdio};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Mutex;
use std::thread;
use tauri::{Emitter, Manager};

struct Sidecar {
    child: Child,
    stdin: ChildStdin,
    next_id: u64,
}

fn sidecar_path() -> std::path::PathBuf {
    std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("project root")
        .join("sidecar")
        .join("index.mjs")
}

fn spawn_sidecar(app: &tauri::AppHandle) -> Result<Sidecar, String> {
    let script = sidecar_path();
    let mut child = std::process::Command::new("node")
        .arg(&script)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .map_err(|error| format!("无法启动 Pi Agent sidecar: {error}\n{script:?}"))?;
    let stdin = child.stdin.take().ok_or("sidecar stdin 不可用")?;
    let stdout = child.stdout.take().ok_or("sidecar stdout 不可用")?;
    let handle = app.clone();
    thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if let Ok(message) = serde_json::from_str::<Value>(&line) {
                let _ = handle.emit("agent-message", message);
            }
        }
        let _ = handle.emit("agent-message", serde_json::json!({
            "type": "event",
            "event": { "type": "error", "message": "Pi Agent sidecar 已退出" }
        }));
    });
    Ok(Sidecar { child, stdin, next_id: 1 })
}

struct PtyEntry {
    writer: Box<dyn Write + Send>,
    child: Box<dyn portable_pty::Child + Send + Sync>,
    #[allow(dead_code)]
    master: Option<Box<dyn portable_pty::MasterPty + Send>>,
}

struct PtyPool {
    entries: Mutex<HashMap<u32, PtyEntry>>,
    next_id: AtomicU32,
}

impl Default for PtyPool {
    fn default() -> Self {
        Self {
            entries: Mutex::new(HashMap::new()),
            next_id: AtomicU32::new(1),
        }
    }
}

#[tauri::command]
fn agent_request(state: tauri::State<'_, Mutex<Option<Sidecar>>>, request: Value) -> Result<u64, String> {
    let mut sidecar = state.lock().map_err(|_| "sidecar 状态锁失败")?;
    let instance = sidecar.as_mut().ok_or("Pi Agent 尚未启动")?;
    let id = instance.next_id;
    instance.next_id += 1;
    let mut message = request;
    message["id"] = Value::from(id);
    serde_json::to_writer(&mut instance.stdin, &message).map_err(|e| e.to_string())?;
    instance.stdin.write_all(b"\n").map_err(|e| e.to_string())?;
    instance.stdin.flush().map_err(|e| e.to_string())?;
    Ok(id)
}

#[tauri::command]
fn agent_status(state: tauri::State<'_, Mutex<Option<Sidecar>>>) -> bool {
    state.lock().ok().and_then(|mut guard| guard.as_mut().map(|s| s.child.try_wait().ok().flatten().is_none())).unwrap_or(false)
}

#[tauri::command]
fn pty_spawn(app: tauri::AppHandle, state: tauri::State<'_, PtyPool>, shell: Option<String>) -> Result<u32, String> {
    let pair = native_pty_system()
        .openpty(PtySize { rows: 24, cols: 80, pixel_width: 0, pixel_height: 0 })
        .map_err(|error| format!("无法打开 PTY: {error}"))?;

    #[cfg(windows)]
    let cmd = {
        // 白名单：cmd / powershell / pwsh，其它值回落 cmd.exe。
        let program = match shell.as_deref() {
            Some("powershell") => "powershell.exe",
            Some("pwsh") => "pwsh.exe",
            Some("cmd") => "cmd.exe",
            _ => "cmd.exe",
        };
        CommandBuilder::new(program)
    };
    #[cfg(not(windows))]
    let cmd = CommandBuilder::new("bash");

    let child = pair.slave.spawn_command(cmd).map_err(|error| format!("无法启动 shell: {error}"))?;
    // 释放 slave 句柄：子进程已继承其文件描述符，父进程无需保留。
    drop(pair.slave);
    let reader = pair.master.try_clone_reader().map_err(|error| format!("无法读取 PTY 输出: {error}"))?;
    let writer = pair.master.take_writer().map_err(|error| format!("无法写入 PTY: {error}"))?;

    let id = state.next_id.fetch_add(1, Ordering::SeqCst);
    let handle = app.clone();
    thread::spawn(move || {
        let mut reader = reader;
        let mut buffer = [0u8; 8192];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(length) => {
                    let data = String::from_utf8_lossy(&buffer[..length]).to_string();
                    let _ = handle.emit("pty-output", serde_json::json!({ "id": id, "data": data }));
                }
                Err(_) => break,
            }
        }
        let _ = handle.emit("pty-output", serde_json::json!({ "id": id, "data": "\r\n[process exited]\r\n" }));
    });

    state.entries.lock().map_err(|_| "PTY 状态锁失败")?.insert(id, PtyEntry {
        writer,
        child,
        master: Some(pair.master),
    });

    Ok(id)
}

#[tauri::command]
fn pty_write(id: u32, data: String, state: tauri::State<'_, PtyPool>) -> Result<(), String> {
    let mut entries = state.entries.lock().map_err(|_| "PTY 状态锁失败")?;
    let entry = entries.get_mut(&id).ok_or("该终端不存在或已退出")?;
    entry.writer.write_all(data.as_bytes()).map_err(|error| error.to_string())?;
    entry.writer.flush().map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
fn pty_kill(id: u32, state: tauri::State<'_, PtyPool>) -> Result<(), String> {
    let mut entries = state.entries.lock().map_err(|_| "PTY 状态锁失败")?;
    if let Some(mut entry) = entries.remove(&id) {
        let _ = entry.child.kill();
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let sidecar = spawn_sidecar(app.handle())?;
            app.manage(Mutex::new(Some(sidecar)));
            app.manage(PtyPool::default());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![agent_request, agent_status, pty_spawn, pty_write, pty_kill])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                if let Some(state) = app.try_state::<Mutex<Option<Sidecar>>>() {
                    if let Ok(mut guard) = state.lock() {
                        if let Some(sidecar) = guard.as_mut() { let _ = sidecar.child.kill(); }
                    }
                }
                if let Some(pool) = app.try_state::<PtyPool>() {
                    if let Ok(mut entries) = pool.entries.lock() {
                        for entry in entries.values_mut() {
                            let _ = entry.child.kill();
                        }
                        entries.clear();
                    }
                }
            }
        });
}

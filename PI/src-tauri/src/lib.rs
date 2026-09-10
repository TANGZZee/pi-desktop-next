use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use serde_json::Value;
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
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

fn sidecar_candidates(app: &tauri::AppHandle) -> Vec<PathBuf> {
    let mut paths = Vec::new();
    if let Ok(dir) = app.path().resource_dir() {
        paths.push(dir.join("sidecar").join("index.mjs"));
        paths.push(dir.join("resources").join("sidecar").join("index.mjs"));
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            paths.push(dir.join("sidecar").join("index.mjs"));
            paths.push(dir.join("resources").join("sidecar").join("index.mjs"));
        }
    }
    paths.push(
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .expect("project root")
            .join("sidecar")
            .join("index.mjs"),
    );
    paths
}

fn resolve_sidecar_script(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let paths = sidecar_candidates(app);
    paths.iter().find(|path| path.exists()).cloned().ok_or_else(|| {
        format!(
            "找不到 sidecar/index.mjs。已尝试:\n{}",
            paths.iter().map(|path| path.display().to_string()).collect::<Vec<_>>().join("\n")
        )
    })
}

fn resolve_node(script: &Path) -> PathBuf {
    let mut dirs = Vec::new();
    if let Some(dir) = script.parent() {
        dirs.push(dir.to_path_buf());
        if let Some(parent) = dir.parent() {
            dirs.push(parent.to_path_buf());
            if let Some(grand) = parent.parent() {
                dirs.push(grand.to_path_buf());
            }
        }
    }
    for dir in dirs {
        let windows = dir.join("node.exe");
        if windows.exists() {
            return windows;
        }
        let unix = dir.join("node");
        if unix.exists() {
            return unix;
        }
    }
    PathBuf::from("node")
}

fn runtime_cwd(script: &Path) -> PathBuf {
    let mut dir = script.parent();
    while let Some(current) = dir {
        if current.join("node_modules").exists() {
            return current.to_path_buf();
        }
        dir = current.parent();
    }
    script.parent().unwrap_or(Path::new(".")).to_path_buf()
}

fn spawn_sidecar(app: &tauri::AppHandle) -> Result<Sidecar, String> {
    let script = resolve_sidecar_script(app)?;
    let node = resolve_node(&script);
    let cwd = runtime_cwd(&script);
    let mut command = std::process::Command::new(&node);
    command
        .arg(&script)
        .current_dir(&cwd)
        .env("NODE_PATH", cwd.join("node_modules"))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped());
    if let Ok(log_dir) = app.path().app_log_dir() {
        let _ = std::fs::create_dir_all(&log_dir);
        if let Ok(file) = std::fs::File::create(log_dir.join("sidecar.log")) {
            command.stderr(Stdio::from(file));
        } else {
            command.stderr(Stdio::null());
        }
    } else {
        command.stderr(Stdio::null());
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    let mut child = command.spawn().map_err(|error| {
        format!("无法启动 Pi Agent sidecar: {error}\nnode={node:?}\nscript={script:?}\ncwd={cwd:?}")
    })?;
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
            match spawn_sidecar(app.handle()) {
                Ok(sidecar) => {
                    app.manage(Mutex::new(Some(sidecar)));
                }
                Err(error) => {
                    if let Ok(log_dir) = app.path().app_log_dir() {
                        let _ = std::fs::create_dir_all(&log_dir);
                        let _ = std::fs::write(log_dir.join("sidecar-start-error.txt"), &error);
                    }
                    app.manage(Mutex::new(None::<Sidecar>));
                }
            }
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

use serde_json::Value;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, Stdio};
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let sidecar = spawn_sidecar(app.handle())?;
            app.manage(Mutex::new(Some(sidecar)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![agent_request, agent_status])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                if let Some(state) = app.try_state::<Mutex<Option<Sidecar>>>() {
                    if let Ok(mut guard) = state.lock() {
                        if let Some(sidecar) = guard.as_mut() { let _ = sidecar.child.kill(); }
                    }
                }
            }
        });
}

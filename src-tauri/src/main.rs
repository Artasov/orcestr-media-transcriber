#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::io::{Read, Write};
use std::net::{Ipv4Addr, SocketAddrV4, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use semver::Version;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

const BACKEND_HOST: &str = "127.0.0.1";
const BACKEND_START_TIMEOUT: Duration = Duration::from_secs(45);
const RELEASE_MANIFEST_URL: &str = "https://s3.twcstorage.ru/324718a4-2cc5dd7a-917b-4e82-87c5-b9d5f8de16ba/orcestr-media-transcriber/latest.json";
const RELEASE_DOWNLOAD_URL: &str = "https://orcestr.com/media-transcriber#downloads";

struct BackendConfig {
    origin: String,
}

struct BackendProcess {
    child: Mutex<Option<CommandChild>>,
    shutting_down: AtomicBool,
    failure_reported: AtomicBool,
}

impl BackendProcess {
    fn new(child: CommandChild) -> Self {
        Self {
            child: Mutex::new(Some(child)),
            shutting_down: AtomicBool::new(false),
            failure_reported: AtomicBool::new(false),
        }
    }

    fn stop(&self) {
        self.shutting_down.store(true, Ordering::SeqCst);
        if let Ok(mut child) = self.child.lock() {
            if let Some(child) = child.take() {
                let _ = child.kill();
            }
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MediaFileDetails {
    path: String,
    name: String,
    size: u64,
}

#[derive(Deserialize)]
struct ReleaseManifest {
    version: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AvailableUpdate {
    current_version: String,
    latest_version: String,
    download_url: &'static str,
}

#[tauri::command]
fn backend_origin(config: State<'_, BackendConfig>) -> String {
    config.origin.clone()
}

#[tauri::command]
fn media_file_details(paths: Vec<String>) -> Result<Vec<MediaFileDetails>, String> {
    paths
        .into_iter()
        .map(|raw_path| {
            let path = PathBuf::from(&raw_path);
            let metadata = path
                .metadata()
                .map_err(|error| format!("Cannot read {}: {error}", path.display()))?;
            if !metadata.is_file() {
                return Err(format!("Not a file: {}", path.display()));
            }
            let name = path
                .file_name()
                .map(|value| value.to_string_lossy().into_owned())
                .ok_or_else(|| format!("File name is missing: {}", path.display()))?;
            Ok(MediaFileDetails {
                path: raw_path,
                name,
                size: metadata.len(),
            })
        })
        .collect()
}

fn existing_output_file(raw_path: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(raw_path)
        .canonicalize()
        .map_err(|error| format!("Cannot find output file {raw_path}: {error}"))?;
    if !path.is_file() {
        return Err(format!("Output path is not a file: {}", path.display()));
    }
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .map(str::to_ascii_lowercase);
    if !matches!(extension.as_deref(), Some("txt" | "mp3")) {
        return Err(format!("Unsupported output file: {}", path.display()));
    }
    Ok(path)
}

#[tauri::command]
fn open_output_file(app: AppHandle, path: String) -> Result<(), String> {
    let output_path = existing_output_file(&path)?;
    app.opener()
        .open_path(output_path.to_string_lossy(), None::<&str>)
        .map_err(|error| format!("Cannot open {}: {error}", output_path.display()))
}

#[tauri::command]
fn reveal_output_file(app: AppHandle, path: String) -> Result<(), String> {
    let output_path = existing_output_file(&path)?;
    app.opener()
        .reveal_item_in_dir(&output_path)
        .map_err(|error| format!("Cannot show {}: {error}", output_path.display()))
}

#[tauri::command]
fn open_external_url(app: AppHandle, url: String) -> Result<(), String> {
    if !matches!(
        url.as_str(),
        "https://orcestr.com"
            | "https://orcestr.com/media-transcriber#downloads"
            | "https://github.com/Artasov"
    ) {
        return Err("External URL is not allowed".to_string());
    }
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|error| format!("Cannot open external URL: {error}"))
}

#[tauri::command]
async fn check_for_update() -> Result<Option<AvailableUpdate>, String> {
    let response = reqwest::Client::builder()
        .timeout(Duration::from_secs(8))
        .user_agent(concat!(
            "orcestr-media-transcriber/",
            env!("CARGO_PKG_VERSION")
        ))
        .build()
        .map_err(|error| format!("Cannot create update client: {error}"))?
        .get(RELEASE_MANIFEST_URL)
        .send()
        .await
        .map_err(|error| format!("Cannot check for updates: {error}"))?
        .error_for_status()
        .map_err(|error| format!("Update server returned an error: {error}"))?;
    let manifest = response
        .json::<ReleaseManifest>()
        .await
        .map_err(|error| format!("Cannot read update manifest: {error}"))?;
    available_update(env!("CARGO_PKG_VERSION"), &manifest.version)
}

fn available_update(current: &str, latest: &str) -> Result<Option<AvailableUpdate>, String> {
    let current_version = Version::parse(current)
        .map_err(|error| format!("Current application version is invalid: {error}"))?;
    let latest_version = Version::parse(latest)
        .map_err(|error| format!("Latest release version is invalid: {error}"))?;
    if latest_version <= current_version {
        return Ok(None);
    }
    Ok(Some(AvailableUpdate {
        current_version: current.to_string(),
        latest_version: latest.to_string(),
        download_url: RELEASE_DOWNLOAD_URL,
    }))
}

fn available_port() -> Result<u16, String> {
    let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))
        .map_err(|error| format!("Cannot reserve a local port: {error}"))?;
    listener
        .local_addr()
        .map(|address| address.port())
        .map_err(|error| format!("Cannot read the local port: {error}"))
}

fn start_backend_watch() -> Result<u16, String> {
    let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))
        .map_err(|error| format!("Cannot start backend lifecycle listener: {error}"))?;
    let port = listener
        .local_addr()
        .map_err(|error| format!("Cannot read backend lifecycle port: {error}"))?
        .port();
    std::thread::spawn(move || {
        let Ok((mut stream, _address)) = listener.accept() else {
            return;
        };
        loop {
            std::thread::sleep(Duration::from_secs(1));
            if stream.write_all(&[0]).is_err() {
                break;
            }
        }
    });
    Ok(port)
}

fn ffmpeg_dir(app: &AppHandle) -> Result<PathBuf, String> {
    if cfg!(debug_assertions) {
        return Ok(Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("dist")
            .join("ffmpeg"));
    }
    app.path()
        .resource_dir()
        .map(|path| path.join("ffmpeg"))
        .map_err(|error| format!("Cannot resolve bundled FFmpeg: {error}"))
}

fn start_backend(app: &AppHandle, port: u16, watch_port: u16) -> Result<(), String> {
    let artifacts_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Cannot resolve application data directory: {error}"))?
        .join("artifacts");
    let ffmpeg_dir = ffmpeg_dir(app)?;
    let command = app
        .shell()
        .sidecar("orcestr-media-backend")
        .map_err(|error| format!("Cannot locate backend sidecar: {error}"))?
        .env("HOST", BACKEND_HOST)
        .env("PORT", port.to_string())
        .env("ARTIFACTS_DIR", artifacts_dir)
        .env("ORCESTR_FFMPEG_DIR", ffmpeg_dir)
        .env("ORCESTR_DESKTOP_WATCH_PORT", watch_port.to_string());
    let (mut events, child) = command
        .spawn()
        .map_err(|error| format!("Cannot start backend sidecar: {error}"))?;

    app.manage(BackendProcess::new(child));
    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(event) = events.recv().await {
            match event {
                CommandEvent::Stdout(line) => {
                    println!("[backend] {}", String::from_utf8_lossy(&line));
                }
                CommandEvent::Stderr(line) => {
                    eprintln!("[backend] {}", String::from_utf8_lossy(&line));
                }
                CommandEvent::Terminated(payload) => {
                    let process = app_handle.state::<BackendProcess>();
                    if !process.shutting_down.load(Ordering::SeqCst) {
                        show_fatal_error(
                            &app_handle,
                            format!("Backend stopped unexpectedly: {payload:?}"),
                        );
                    }
                    break;
                }
                CommandEvent::Error(message) => {
                    eprintln!("[backend] {message}");
                }
                _ => {}
            }
        }
    });
    Ok(())
}

fn backend_is_healthy(port: u16) -> bool {
    let address = SocketAddrV4::new(Ipv4Addr::LOCALHOST, port);
    let Ok(mut stream) = TcpStream::connect_timeout(&address.into(), Duration::from_millis(300))
    else {
        return false;
    };
    let _ = stream.set_read_timeout(Some(Duration::from_millis(500)));
    let request = format!(
        "GET /api/health HTTP/1.1\r\nHost: {BACKEND_HOST}:{port}\r\nConnection: close\r\n\r\n"
    );
    if stream.write_all(request.as_bytes()).is_err() {
        return false;
    }
    let mut response = [0_u8; 64];
    let Ok(bytes_read) = stream.read(&mut response) else {
        return false;
    };
    String::from_utf8_lossy(&response[..bytes_read]).starts_with("HTTP/1.1 200")
}

fn wait_for_backend(port: u16) -> Result<(), String> {
    let started_at = Instant::now();
    while started_at.elapsed() < BACKEND_START_TIMEOUT {
        if backend_is_healthy(port) {
            return Ok(());
        }
        std::thread::sleep(Duration::from_millis(250));
    }
    Err(format!(
        "Backend did not start within {} seconds.",
        BACKEND_START_TIMEOUT.as_secs()
    ))
}

fn create_main_window(app: &AppHandle) -> Result<(), String> {
    let window = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
        .title("Orcestr Media Transcriber")
        .inner_size(1100.0, 640.0)
        .min_inner_size(860.0, 560.0)
        .build()
        .map_err(|error| format!("Cannot create application window: {error}"))?;
    let _ = window.center();
    Ok(())
}

fn show_fatal_error(app: &AppHandle, message: String) {
    let process = app.state::<BackendProcess>();
    if process
        .failure_reported
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return;
    }
    let app_handle = app.clone();
    app.dialog()
        .message(message)
        .title("Orcestr Media Transcriber")
        .kind(MessageDialogKind::Error)
        .show(move |_| app_handle.exit(1));
}

fn main() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::CloseRequested { .. }) {
                window.app_handle().state::<BackendProcess>().stop();
                window.app_handle().exit(0);
            }
        })
        .invoke_handler(tauri::generate_handler![
            backend_origin,
            media_file_details,
            open_output_file,
            reveal_output_file,
            open_external_url,
            check_for_update
        ])
        .setup(|app| {
            let port = available_port().map_err(std::io::Error::other)?;
            let watch_port = start_backend_watch().map_err(std::io::Error::other)?;
            app.manage(BackendConfig {
                origin: format!("http://{BACKEND_HOST}:{port}"),
            });
            start_backend(app.handle(), port, watch_port).map_err(std::io::Error::other)?;

            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let result =
                    tauri::async_runtime::spawn_blocking(move || wait_for_backend(port)).await;
                match result {
                    Ok(Ok(())) => {
                        if let Err(error) = create_main_window(&app_handle) {
                            show_fatal_error(&app_handle, error);
                        }
                    }
                    Ok(Err(error)) => show_fatal_error(&app_handle, error),
                    Err(error) => show_fatal_error(
                        &app_handle,
                        format!("Backend startup task failed: {error}"),
                    ),
                }
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("failed to build Orcestr Media Transcriber");

    app.run(|app_handle, event| match event {
        tauri::RunEvent::ExitRequested { .. } => {
            app_handle.state::<BackendProcess>().stop();
        }
        _ => {}
    });
}

#[cfg(test)]
mod tests {
    use super::available_update;

    #[test]
    fn detects_newer_release() {
        let update = available_update("0.1.4", "0.1.5").unwrap().unwrap();
        assert_eq!(update.current_version, "0.1.4");
        assert_eq!(update.latest_version, "0.1.5");
    }

    #[test]
    fn ignores_current_and_older_releases() {
        assert!(available_update("0.1.4", "0.1.4").unwrap().is_none());
        assert!(available_update("0.1.4", "0.1.3").unwrap().is_none());
    }
}

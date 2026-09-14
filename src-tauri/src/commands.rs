//! Commands the manager UI calls. Keep the structs in step with `src/manager/bridge.ts`.

use serde::Serialize;
use tauri::{AppHandle, Manager, State, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_opener::OpenerExt;

use crate::platform;
use crate::server::{LogLine, Server, ServerStatus, SettingsPatch};
use crate::tray;

const SPATT_WINDOW: &str = "spatt";

#[derive(Debug, Serialize)]
pub struct AppInfo {
    version: String,
    os: &'static str,
    arch: &'static str,
    mode: &'static str,
}

#[tauri::command]
pub fn app_info(app: AppHandle) -> AppInfo {
    AppInfo {
        version: app.package_info().version.to_string(),
        os: platform::os_label(),
        arch: std::env::consts::ARCH,
        mode: "window",
    }
}

#[tauri::command]
pub fn server_status(server: State<'_, Server>) -> ServerStatus {
    server.status()
}

#[tauri::command]
pub async fn server_start(
    app: AppHandle,
    server: State<'_, Server>,
) -> Result<ServerStatus, String> {
    let result = server.start().await;
    tray::changed(&app);
    result.map(|()| server.status())
}

#[tauri::command]
pub fn server_stop(app: AppHandle, server: State<'_, Server>) -> ServerStatus {
    server.stop();
    tray::changed(&app);
    server.status()
}

#[tauri::command]
pub async fn server_update(
    app: AppHandle,
    server: State<'_, Server>,
    patch: SettingsPatch,
) -> Result<ServerStatus, String> {
    let result = server.update(patch).await;
    tray::changed(&app);
    result.map(|()| server.status())
}

#[tauri::command]
pub async fn server_regenerate_token(
    app: AppHandle,
    server: State<'_, Server>,
) -> Result<ServerStatus, String> {
    let result = server.regenerate_token().await;
    tray::changed(&app);
    result.map(|()| server.status())
}

#[tauri::command]
pub fn server_logs(server: State<'_, Server>) -> Vec<LogLine> {
    server.logs()
}

/// Opens this computer's own URL for the server in the default browser.
#[tauri::command]
pub fn server_open_in_browser(app: AppHandle, server: State<'_, Server>) -> Result<(), String> {
    app.opener()
        .open_url(server.status().local_url, None::<&str>)
        .map_err(|e| e.to_string())
}

/// Shows the project folder in the file manager.
#[tauri::command]
pub fn open_projects_folder(app: AppHandle, server: State<'_, Server>) -> Result<(), String> {
    let dir = std::path::PathBuf::from(server.status().data_dir);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    app.opener()
        .open_path(dir.display().to_string(), None::<&str>)
        .map_err(|e| e.to_string())
}

/// Focuses the SPATT window, creating it on first use.
///
/// `async` on purpose: building a webview window inside a synchronous command deadlocks on
/// Windows, leaving a window stuck on `about:blank`.
#[tauri::command]
pub async fn open_spatt_window(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(SPATT_WINDOW) {
        let _ = window.unminimize();
        return window.set_focus().map_err(|e| e.to_string());
    }
    WebviewWindowBuilder::new(&app, SPATT_WINDOW, WebviewUrl::App("index.html".into()))
        .title("SPATT")
        .inner_size(1280.0, 800.0)
        .min_inner_size(960.0, 600.0)
        .build()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

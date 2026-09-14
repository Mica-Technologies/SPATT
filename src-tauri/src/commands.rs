//! Commands the manager UI calls. Keep the structs in step with `src/manager/bridge.ts`.

use serde::Serialize;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

use crate::platform;

const SPATT_WINDOW: &str = "spatt";

#[derive(Debug, Serialize)]
pub struct AppInfo {
    version: String,
    os: &'static str,
    arch: &'static str,
    mode: &'static str,
}

#[derive(Debug, Serialize)]
pub struct ServerStatus {
    running: bool,
    url: Option<String>,
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
pub fn server_status() -> ServerStatus {
    // The in-process server is not started by this build yet.
    ServerStatus {
        running: false,
        url: None,
    }
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

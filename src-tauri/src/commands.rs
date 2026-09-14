//! Commands the manager UI calls. Keep the structs in step with `src/manager/bridge.ts`.

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_opener::OpenerExt;

use crate::background::{self, BackgroundInstaller, BackgroundStatus, Mode, ServiceServer};
use crate::cli;
use crate::platform;
use crate::server::{LogLine, Server, ServerStatus, SettingsPatch};
use crate::tray;
use crate::AppMode;

const SPATT_WINDOW: &str = "spatt";

#[derive(Debug, Serialize)]
pub struct AppInfo {
    version: String,
    os: &'static str,
    arch: &'static str,
    mode: &'static str,
}

#[tauri::command]
pub fn app_info(app: AppHandle, mode: State<'_, AppMode>) -> AppInfo {
    AppInfo {
        version: app.package_info().version.to_string(),
        os: platform::os_label(),
        arch: std::env::consts::ARCH,
        mode: mode.label(),
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

/// Focuses the SPATT window, creating it on first use: over this user's library, or over the
/// system service's library (through its local address) while the service is serving.
///
/// `async` on purpose: building a webview window inside a synchronous command deadlocks on
/// Windows, leaving a window stuck on `about:blank`.
#[tauri::command]
pub async fn open_spatt_window(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(SPATT_WINDOW) {
        let _ = window.show();
        let _ = window.unminimize();
        return window.set_focus().map_err(|e| e.to_string());
    }
    let url = match background::running_service() {
        Some(service) => {
            WebviewUrl::External(service.local_url.parse().map_err(|e| format!("{e}"))?)
        }
        None if *app.state::<AppMode>() == AppMode::Tray => {
            return Err("The SPATT service is not running".to_owned());
        }
        None => WebviewUrl::App("index.html".into()),
    };
    WebviewWindowBuilder::new(&app, SPATT_WINDOW, url)
        .title("SPATT")
        .inner_size(1280.0, 800.0)
        .min_inner_size(960.0, 600.0)
        .build()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// Mirrors `BackgroundInfo` in `src/manager/bridge.ts`.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackgroundInfo {
    installed: BackgroundStatus,
    /// The system service's server, while it is serving.
    service: Option<ServiceServer>,
    /// This user's data folder, the one start at login serves.
    user_data_dir: String,
}

#[tauri::command]
pub async fn background_status(app: AppHandle) -> Result<BackgroundInfo, String> {
    let user_data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || BackgroundInfo {
        installed: platform::installer().status(),
        service: background::running_service(),
        user_data_dir: user_data_dir.display().to_string(),
    })
    .await
    .map_err(|e| e.to_string())
}

/// Installs a background mode. The service takes over serving, so the in-app server stops first;
/// start at login keeps (or starts) the in-app server, as the next login will.
#[tauri::command]
pub async fn background_install(
    app: AppHandle,
    server: State<'_, Server>,
    mode: Mode,
    copy_library: bool,
) -> Result<BackgroundInfo, String> {
    let user_data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    if mode == Mode::Service {
        server.stop();
        tray::changed(&app);
    }
    let copy_from = (mode == Mode::Service && copy_library).then(|| user_data_dir.clone());
    tauri::async_runtime::spawn_blocking(move || {
        cli::install(&platform::installer(), mode, copy_from.as_deref())
    })
    .await
    .map_err(|e| e.to_string())??;
    if mode == Mode::Login && !server.is_running() {
        let _ = server.start().await;
    }
    tray::changed(&app);
    background_status(app).await
}

#[tauri::command]
pub async fn background_uninstall(
    app: AppHandle,
    mode: Mode,
    delete_data: bool,
) -> Result<BackgroundInfo, String> {
    tauri::async_runtime::spawn_blocking(move || {
        cli::uninstall(&platform::installer(), mode, delete_data)
    })
    .await
    .map_err(|e| e.to_string())??;
    tray::changed(&app);
    background_status(app).await
}

/// Mirrors `ServicePatch` in `src/manager/bridge.ts`.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServicePatchArg {
    port: Option<u16>,
    lan: Option<bool>,
    #[serde(default)]
    regenerate_token: bool,
}

/// Changes the service's settings (as administrator) and restarts it.
#[tauri::command]
pub async fn service_configure(
    app: AppHandle,
    patch: ServicePatchArg,
) -> Result<BackgroundInfo, String> {
    let patch = cli::ServicePatch {
        port: patch.port,
        lan: patch.lan,
        regenerate_token: patch.regenerate_token,
    };
    tauri::async_runtime::spawn_blocking(move || {
        cli::configure_service(&platform::installer(), &patch)
    })
    .await
    .map_err(|e| e.to_string())??;
    tray::changed(&app);
    background_status(app).await
}

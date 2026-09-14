//! The tray icon. In the app it is shown while the in-app server runs (Open SPATT, Open manager,
//! Stop server, Quit); closing the manager while serving hides it here instead of stopping the
//! server (a setting). Started at login (`--headless`) or as the service's companion (`--tray`), it
//! is always shown.

use tauri::menu::{Menu, MenuItem};
use tauri::tray::{TrayIcon, TrayIconBuilder};
use tauri::{AppHandle, Emitter, Manager, WebviewWindowBuilder, Wry};
use tauri_plugin_dialog::DialogExt;

use crate::background;
use crate::server::Server;
use crate::AppMode;

pub const MANAGER_WINDOW: &str = "manager";
/// Tells the manager window to reload the server status.
pub const SERVER_CHANGED: &str = "server-changed";

pub struct Tray {
    icon: TrayIcon<Wry>,
    stop: MenuItem<Wry>,
}

pub fn create(app: &AppHandle, mode: AppMode) -> tauri::Result<Tray> {
    let open_spatt = MenuItem::with_id(app, "open-spatt", "Open SPATT", true, None::<&str>)?;
    let manager_item = MenuItem::with_id(app, "open-manager", "Open manager", true, None::<&str>)?;
    let stop = MenuItem::with_id(app, "stop-server", "Stop server", false, None::<&str>)?;
    let quit = MenuItem::with_id(
        app,
        "quit",
        if mode == AppMode::Tray {
            "Close tray icon"
        } else {
            "Quit SPATT"
        },
        true,
        None::<&str>,
    )?;
    let menu = if mode == AppMode::Tray {
        Menu::with_items(app, &[&open_spatt, &manager_item, &quit])?
    } else {
        Menu::with_items(app, &[&open_spatt, &manager_item, &stop, &quit])?
    };
    let mut builder = TrayIconBuilder::with_id("spatt")
        .tooltip("SPATT")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open-spatt" => {
                let app = app.clone();
                tauri::async_runtime::spawn(async move {
                    let _ = crate::commands::open_spatt_window(app).await;
                });
            }
            "open-manager" => {
                let app = app.clone();
                tauri::async_runtime::spawn(async move {
                    let _ = open_manager(&app).await;
                });
            }
            "stop-server" => {
                app.state::<Server>().stop();
                changed(app);
            }
            "quit" => {
                app.state::<Server>().stop();
                app.exit(0);
            }
            _ => {}
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    let icon = builder.build(app)?;
    icon.set_visible(mode != AppMode::Window)?;
    Ok(Tray { icon, stop })
}

/// Shows the manager, creating it from its configuration on first use. `async` for the same
/// reason as `open_spatt_window`: building a window synchronously deadlocks on Windows.
pub async fn open_manager(app: &AppHandle) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window(MANAGER_WINDOW) {
        window.show()?;
        let _ = window.unminimize();
        return window.set_focus();
    }
    let config = app
        .config()
        .app
        .windows
        .iter()
        .find(|w| w.label == MANAGER_WINDOW)
        .cloned();
    if let Some(config) = config {
        WebviewWindowBuilder::from_config(app, &config)?.build()?;
    }
    Ok(())
}

/// Brings the tray and the manager up to date after the server started or stopped.
pub fn changed(app: &AppHandle) {
    let mode = *app.state::<AppMode>();
    let running = app.state::<Server>().is_running();
    if let Some(tray) = app.try_state::<Tray>() {
        let _ = tray.icon.set_visible(running || mode != AppMode::Window);
        let _ = tray.stop.set_enabled(running);
        let tooltip = if running {
            "SPATT: serving".to_owned()
        } else if let Some(service) = background::running_service() {
            format!("SPATT service: serving at {}", service.local_url)
        } else if mode == AppMode::Tray {
            "SPATT service: not running".to_owned()
        } else {
            "SPATT".to_owned()
        };
        let _ = tray.icon.set_tooltip(Some(tooltip));
    }
    let _ = app.emit(SERVER_CHANGED, ());
}

/// The manager's close button: hide to the tray while serving (if the setting allows) or when the
/// tray is the app's home (headless and tray modes), otherwise stop the server and let the window
/// close.
pub fn on_manager_close(app: &AppHandle, api: &tauri::CloseRequestApi) {
    let mode = *app.state::<AppMode>();
    let server = app.state::<Server>();
    if mode != AppMode::Window {
        return; // The window closes; the process keeps running in the tray.
    }
    if !server.is_running() {
        return;
    }
    if server.settings().keep_serving_on_close {
        api.prevent_close();
        if let Some(window) = app.get_webview_window(MANAGER_WINDOW) {
            let _ = window.hide();
        }
        if !server.take_tray_notice() {
            app.dialog()
                .message("SPATT is still serving projects. Use the SPATT icon in the system tray to open the manager, stop the server or quit.")
                .title("SPATT keeps serving")
                .show(|_| {});
        }
    } else {
        server.stop();
        changed(app);
    }
}

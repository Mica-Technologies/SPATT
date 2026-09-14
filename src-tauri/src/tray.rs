//! The tray icon, shown while the server runs: Open SPATT, Open manager, Stop server, Quit.
//! Closing the manager while serving hides it here instead of stopping the server (a setting).

use tauri::menu::{Menu, MenuItem};
use tauri::tray::{TrayIcon, TrayIconBuilder};
use tauri::{AppHandle, Emitter, Manager, Wry};
use tauri_plugin_dialog::DialogExt;

use crate::server::Server;

pub const MANAGER_WINDOW: &str = "manager";
/// Tells the manager window to reload the server status.
pub const SERVER_CHANGED: &str = "server-changed";

pub struct Tray {
    icon: TrayIcon<Wry>,
    stop: MenuItem<Wry>,
}

pub fn create(app: &AppHandle) -> tauri::Result<Tray> {
    let open_spatt = MenuItem::with_id(app, "open-spatt", "Open SPATT", true, None::<&str>)?;
    let open_manager = MenuItem::with_id(app, "open-manager", "Open manager", true, None::<&str>)?;
    let stop = MenuItem::with_id(app, "stop-server", "Stop server", false, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit SPATT", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open_spatt, &open_manager, &stop, &quit])?;
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
            "open-manager" => show_manager(app),
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
    icon.set_visible(false)?;
    Ok(Tray { icon, stop })
}

pub fn show_manager(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(MANAGER_WINDOW) {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

/// Brings the tray and the manager up to date after the server started or stopped.
pub fn changed(app: &AppHandle) {
    let running = app.state::<Server>().is_running();
    if let Some(tray) = app.try_state::<Tray>() {
        let _ = tray.icon.set_visible(running);
        let _ = tray.stop.set_enabled(running);
        let _ = tray
            .icon
            .set_tooltip(Some(if running { "SPATT: serving" } else { "SPATT" }));
    }
    let _ = app.emit(SERVER_CHANGED, ());
}

/// The manager's close button: hide to the tray while serving (if the setting allows),
/// otherwise stop the server and let the window close.
pub fn on_manager_close(app: &AppHandle, api: &tauri::CloseRequestApi) {
    let server = app.state::<Server>();
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

//! The SPATT desktop app: the manager window, the SPATT window, the in-process network server
//! and its tray icon. Background modes (start at login, system service) come later.

mod commands;
mod platform;
mod projects;
mod server;
mod tray;

use tauri::{Manager, WindowEvent};

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            let projects = projects::Projects::for_app(app.handle())?;
            // The server serves the same store the SPATT window uses, so they share one lock.
            app.manage(server::Server::load(data_dir, projects.0.clone()));
            app.manage(projects);
            let tray = tray::create(app.handle())?;
            app.manage(tray);
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == tray::MANAGER_WINDOW {
                    tray::on_manager_close(window.app_handle(), api);
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::app_info,
            commands::server_status,
            commands::server_start,
            commands::server_stop,
            commands::server_update,
            commands::server_regenerate_token,
            commands::server_logs,
            commands::server_open_in_browser,
            commands::open_projects_folder,
            commands::open_spatt_window,
            projects::projects_list,
            projects::projects_read,
            projects::projects_write,
            projects::projects_remove,
            projects::project_export,
        ])
        .run(tauri::generate_context!())
        .expect("error while running the SPATT application");
}

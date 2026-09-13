//! The SPATT desktop app: the manager window, the SPATT window, and (later) the in-process
//! network server, tray and background modes.

mod commands;
mod platform;
mod projects;

use tauri::Manager;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let projects = projects::Projects::for_app(app.handle())?;
            app.manage(projects);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::app_info,
            commands::server_status,
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

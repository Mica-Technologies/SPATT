//! The SPATT desktop app: the manager window, the SPATT window, and (later) the in-process
//! network server, tray and background modes.

mod commands;
mod platform;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            commands::app_info,
            commands::server_status,
            commands::open_spatt_window,
        ])
        .run(tauri::generate_context!())
        .expect("error while running the SPATT application");
}

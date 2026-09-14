//! The SPATT desktop app: the manager window, the SPATT window, the in-process network server,
//! its tray icon, and the background modes (start at login, system service).
//!
//! How it runs depends on the command line (`cli.rs`):
//! - **window** (`spatt`): the manager, over this user's library;
//! - **headless** (`spatt --headless`, start at login): the same, with the server started and no
//!   window until asked for;
//! - **tray** (`spatt --tray`): only a tray icon for the system service;
//! - the service and the installers never start Tauri at all.
//!
//! Only one of the window, headless and tray processes runs per user: launching SPATT again shows
//! the manager in the one already running. When the system service is serving, the SPATT window
//! opens the service's library through its local address instead of this user's files.

mod background;
mod cli;
mod commands;
mod platform;
mod projects;
mod server;
mod service;
mod tray;

use spatt_server::datalock::{DataLock, LockError};
use tauri::{Manager, WindowEvent};
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};

/// How this process was started; mirrors `AppInfo.mode` in `src/manager/bridge.ts`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AppMode {
    Window,
    Headless,
    Tray,
}

impl AppMode {
    pub fn label(self) -> &'static str {
        match self {
            AppMode::Window => "window",
            AppMode::Headless => "headless",
            AppMode::Tray => "tray",
        }
    }
}

/// Holds this user's library for as long as the app runs (see `spatt_server::datalock`).
pub struct LibraryLock(#[allow(dead_code)] Option<DataLock>);

/// The program's entry point: command-line actions run and exit; everything else starts the app.
pub fn start() {
    match cli::launch() {
        cli::Launch::Exit(code) => std::process::exit(code),
        cli::Launch::Window => run(AppMode::Window),
        cli::Launch::Headless => run(AppMode::Headless),
        cli::Launch::Tray => run(AppMode::Tray),
    }
}

fn run(mode: AppMode) {
    tauri::Builder::default()
        // First, so a second launch hands over before anything else starts.
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            // A background entry starting while SPATT already runs changes nothing; a user
            // launching SPATT gets the manager.
            if !args.iter().any(|a| a == "--headless" || a == "--tray") {
                let app = app.clone();
                tauri::async_runtime::spawn(async move {
                    let _ = tray::open_manager(&app).await;
                });
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(move |app| {
            app.manage(mode);
            let data_dir = app.path().app_data_dir()?;
            let lock = if mode == AppMode::Tray {
                None
            } else {
                match DataLock::acquire(&data_dir, &format!("the SPATT app ({})", mode.label())) {
                    Ok(lock) => Some(lock),
                    Err(LockError::Held { holder }) => {
                        let who = holder.unwrap_or_else(|| "another SPATT program".to_owned());
                        app.dialog()
                            .message(format!("Your SPATT projects are already open in {who}. Close it, then start SPATT again."))
                            .title("SPATT is already running")
                            .kind(MessageDialogKind::Warning)
                            .blocking_show();
                        std::process::exit(1);
                    }
                    Err(error) => return Err(error.to_string().into()),
                }
            };
            app.manage(LibraryLock(lock));
            let projects = projects::Projects::for_app(app.handle())?;
            // The server serves the same store the SPATT window uses, so they share one lock.
            app.manage(server::Server::load(data_dir, projects.0.clone()));
            app.manage(projects);
            let tray = tray::create(app.handle(), mode)?;
            app.manage(tray);

            let handle = app.handle().clone();
            match mode {
                AppMode::Window => {
                    tauri::async_runtime::spawn(async move {
                        let _ = tray::open_manager(&handle).await;
                    });
                }
                AppMode::Headless => {
                    tauri::async_runtime::spawn(async move {
                        // A service serving this computer owns the port; start at login then only
                        // keeps the tray.
                        if background::running_service().is_none() {
                            let _ = handle.state::<server::Server>().start().await;
                        }
                        tray::changed(&handle);
                    });
                }
                AppMode::Tray => tray::changed(&handle),
            }
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
            commands::background_status,
            commands::background_install,
            commands::background_uninstall,
            commands::service_configure,
            projects::projects_list,
            projects::projects_read,
            projects::projects_write,
            projects::projects_remove,
            projects::project_export,
        ])
        .build(tauri::generate_context!())
        .expect("error while starting the SPATT application")
        .run(move |_app, event| {
            // Started at login or as the tray companion, SPATT lives in the tray: closing its last
            // window must not end the process.
            if let tauri::RunEvent::ExitRequested { api, code: None, .. } = event {
                if mode != AppMode::Window {
                    api.prevent_exit();
                }
            }
        });
}

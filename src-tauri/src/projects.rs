//! The project library and project export for the SPATT window. Keep in step with
//! `src/io/tauri-store.ts` and `src/io/files.ts`.
//!
//! Projects live in `<app data dir>/projects`, one `<id>.spatt.json` per project, through the
//! same store the network server uses.

use std::path::PathBuf;

use spatt_server::store::{FileProjectStore, ProjectSummary};
use tauri::{AppHandle, Manager, State, WebviewWindow};
use tauri_plugin_dialog::DialogExt;

/// The store as Tauri state, rooted at the app data folder when the app starts.
pub struct Projects(FileProjectStore);

impl Projects {
    pub fn for_app(app: &AppHandle) -> tauri::Result<Self> {
        Ok(Self(FileProjectStore::new(
            app.path().app_data_dir()?.join("projects"),
        )))
    }
}

/// File IO runs on the blocking pool so a slow disk never stalls the async runtime.
async fn blocking<T: Send + 'static>(
    job: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(job)
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn projects_list(projects: State<'_, Projects>) -> Result<Vec<ProjectSummary>, String> {
    let store = projects.0.clone();
    blocking(move || store.list().map_err(|e| e.to_string())).await
}

#[tauri::command]
pub async fn projects_read(
    projects: State<'_, Projects>,
    id: String,
) -> Result<Option<String>, String> {
    let store = projects.0.clone();
    blocking(move || store.read(&id).map_err(|e| e.to_string())).await
}

#[tauri::command]
pub async fn projects_write(
    projects: State<'_, Projects>,
    id: String,
    text: String,
) -> Result<(), String> {
    let store = projects.0.clone();
    blocking(move || store.write(&id, &text).map_err(|e| e.to_string())).await
}

#[tauri::command]
pub async fn projects_remove(projects: State<'_, Projects>, id: String) -> Result<(), String> {
    let store = projects.0.clone();
    blocking(move || store.remove(&id).map_err(|e| e.to_string())).await
}

/// Asks where to save the project with the native Save dialog and writes it there. Resolves with
/// the chosen path, or `None` if the user cancelled.
///
/// The filter is `*.json`: `.spatt.json` is a double extension, which not every platform's dialog
/// can filter on, so the suggested file name carries the full extension instead.
#[tauri::command]
pub async fn project_export(
    window: WebviewWindow,
    suggested_name: String,
    text: String,
) -> Result<Option<String>, String> {
    blocking(move || {
        let chosen = window
            .dialog()
            .file()
            .set_parent(&window)
            .set_title("Export project")
            .set_file_name(suggested_name)
            .add_filter("SPATT project", &["json"])
            .blocking_save_file();
        let Some(chosen) = chosen else {
            return Ok(None);
        };
        let path: PathBuf = chosen.into_path().map_err(|e| e.to_string())?;
        std::fs::write(&path, text).map_err(|e| format!("{}: {e}", path.display()))?;
        Ok(Some(path.display().to_string()))
    })
    .await
}

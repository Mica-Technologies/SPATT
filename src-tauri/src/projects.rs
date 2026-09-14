//! The project library and project export for the SPATT window. Keep in step with
//! `src/io/tauri-store.ts` and `src/io/files.ts`.
//!
//! Projects live in `<app data dir>/projects`, one `<id>.spatt.json` per project, through the
//! same store the network server uses.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use spatt_server::store::{self, FileProjectStore, ProjectSummary, StoreError};
use tauri::{AppHandle, Manager, State, WebviewWindow};
use tauri_plugin_dialog::DialogExt;

/// The store as Tauri state, rooted at the app data folder when the app starts. The in-app
/// server serves a clone of the same store, so both check and write under one lock.
pub struct Projects(pub FileProjectStore);

impl Projects {
    pub fn for_app(app: &AppHandle) -> tauri::Result<Self> {
        Ok(Self(FileProjectStore::new(spatt_server::projects_dir(
            &app.path().app_data_dir()?,
        ))))
    }
}

/// Mirrors `StoredProject` in `src/io/store.ts`.
#[derive(Serialize)]
pub struct StoredProject {
    text: String,
    version: String,
}

/// Mirrors `ExpectedArg` in `src/io/tauri-store.ts`.
#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Expected {
    Any,
    Absent,
    Version { version: String },
}

impl Expected {
    fn as_store(&self) -> store::Expected<'_> {
        match self {
            Expected::Any => store::Expected::Any,
            Expected::Absent => store::Expected::Absent,
            Expected::Version { version } => store::Expected::Version(version),
        }
    }
}

/// Mirrors `CommandError` in `src/io/tauri-store.ts`.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandError {
    kind: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    current: Option<Option<String>>,
    message: String,
}

impl From<StoreError> for CommandError {
    fn from(error: StoreError) -> Self {
        let message = error.to_string();
        match error {
            StoreError::Conflict { current } => Self {
                kind: "conflict",
                current: Some(current),
                message,
            },
            _ => Self::failed(message),
        }
    }
}

impl CommandError {
    fn failed(message: impl Into<String>) -> Self {
        Self {
            kind: "failed",
            current: None,
            message: message.into(),
        }
    }
}

/// File IO runs on the blocking pool so a slow disk never stalls the async runtime.
async fn blocking<T: Send + 'static>(
    job: impl FnOnce() -> Result<T, StoreError> + Send + 'static,
) -> Result<T, CommandError> {
    tauri::async_runtime::spawn_blocking(job)
        .await
        .map_err(|e| CommandError::failed(e.to_string()))?
        .map_err(CommandError::from)
}

#[tauri::command]
pub async fn projects_list(
    projects: State<'_, Projects>,
) -> Result<Vec<ProjectSummary>, CommandError> {
    let store = projects.0.clone();
    blocking(move || store.list()).await
}

#[tauri::command]
pub async fn projects_read(
    projects: State<'_, Projects>,
    id: String,
) -> Result<Option<StoredProject>, CommandError> {
    let store = projects.0.clone();
    blocking(move || {
        Ok(store
            .read_versioned(&id)?
            .map(|(text, version)| StoredProject { text, version }))
    })
    .await
}

#[tauri::command]
pub async fn projects_write(
    projects: State<'_, Projects>,
    id: String,
    text: String,
    expected: Expected,
) -> Result<String, CommandError> {
    let store = projects.0.clone();
    blocking(move || store.write_if(&id, &text, expected.as_store())).await
}

#[tauri::command]
pub async fn projects_remove(
    projects: State<'_, Projects>,
    id: String,
) -> Result<(), CommandError> {
    let store = projects.0.clone();
    blocking(move || store.remove(&id)).await
}

/// Asks where to save a JSON file (a project, or a controller plan) with the native Save dialog and
/// writes it there. Resolves with the chosen path, or `None` if the user cancelled.
///
/// The filter is `*.json` under `file_type` (default "SPATT project"): `.spatt.json` and
/// `.csm.json` are double extensions, which not every platform's dialog can filter on, so the
/// suggested file name carries the full extension instead.
#[tauri::command]
pub async fn project_export(
    window: WebviewWindow,
    suggested_name: String,
    text: String,
    file_type: Option<String>,
) -> Result<Option<String>, String> {
    // The dialog blocks until the user answers, so it waits on the blocking pool too.
    tauri::async_runtime::spawn_blocking(move || -> Result<Option<String>, String> {
        let chosen = window
            .dialog()
            .file()
            .set_parent(&window)
            .set_title("Export")
            .set_file_name(suggested_name)
            .add_filter(file_type.as_deref().unwrap_or("SPATT project"), &["json"])
            .blocking_save_file();
        let Some(chosen) = chosen else {
            return Ok(None);
        };
        let path: PathBuf = chosen.into_path().map_err(|e| e.to_string())?;
        std::fs::write(&path, text).map_err(|e| format!("{}: {e}", path.display()))?;
        Ok(Some(path.display().to_string()))
    })
    .await
    .map_err(|e| e.to_string())?
}

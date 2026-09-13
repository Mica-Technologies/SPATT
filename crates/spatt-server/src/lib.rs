//! The SPATT HTTP server: the web UI plus its API.
//!
//! One crate serves both the headless `spatt-server` binary and the Tauri app, which runs the
//! same router in-process. The web UI (`dist/`) is embedded into the binary at compile time, so
//! a release is a single file; `--dist` serves a directory from disk instead during development.

pub mod store;

use std::net::SocketAddr;
use std::path::PathBuf;

use axum::body::Body;
use axum::extract::State;
use axum::http::{header, StatusCode, Uri};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::{Json, Router};
use rust_embed::RustEmbed;
use serde::Serialize;
use tower_http::services::{ServeDir, ServeFile};

/// The built web UI. `allow_missing` lets `cargo check` and `cargo test` run before
/// `npm run build` has produced `dist/`; such a binary answers the API and 404s the UI.
///
/// The folder is relative to this crate's manifest. Do not write `$CARGO_MANIFEST_DIR` here:
/// without rust-embed's `interpolate-folder-path` feature it is taken literally, and
/// `allow_missing` then silently embeds nothing. `embeds_the_built_ui` guards against that.
#[derive(RustEmbed)]
#[folder = "../../dist"]
#[allow_missing = true]
struct EmbeddedUi;

/// Where the web UI comes from.
#[derive(Clone, Debug)]
pub enum UiSource {
    Embedded,
    Directory(PathBuf),
}

#[derive(Clone, Debug)]
pub struct ServerConfig {
    pub bind: SocketAddr,
    pub ui: UiSource,
}

impl Default for ServerConfig {
    fn default() -> Self {
        Self {
            // Localhost only unless the user explicitly opts into the network.
            bind: SocketAddr::from(([127, 0, 0, 1], DEFAULT_PORT)),
            ui: UiSource::Embedded,
        }
    }
}

pub const DEFAULT_PORT: u16 = 8787;

/// Body of `GET /api/health`. The web UI recognises a SPATT server by `app`.
#[derive(Debug, Serialize)]
pub struct Health {
    pub app: &'static str,
    pub version: &'static str,
}

#[derive(Clone)]
struct AppState {
    version: &'static str,
}

pub fn version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

pub fn router(ui: UiSource) -> Router {
    let api = Router::new().route("/health", get(health));
    let router = Router::new()
        .nest("/api", api)
        .with_state(AppState { version: version() });
    match ui {
        UiSource::Embedded => router.fallback(embedded_ui),
        UiSource::Directory(dir) => {
            let index = dir.join("index.html");
            router.fallback_service(ServeDir::new(dir).fallback(ServeFile::new(index)))
        }
    }
}

async fn health(State(state): State<AppState>) -> Json<Health> {
    Json(Health {
        app: "spatt",
        version: state.version,
    })
}

async fn embedded_ui(uri: Uri) -> Response {
    let path = uri.path().trim_start_matches('/');
    let path = if path.is_empty() { "index.html" } else { path };
    match EmbeddedUi::get(path) {
        Some(file) => embedded_response(path, file.data.into_owned()),
        // Unknown non-asset paths get the app shell, so client-side routes survive a reload.
        None if !path.contains('.') => match EmbeddedUi::get("index.html") {
            Some(index) => embedded_response("index.html", index.data.into_owned()),
            None => ui_missing(),
        },
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

fn embedded_response(path: &str, bytes: Vec<u8>) -> Response {
    let mime = mime_guess::from_path(path).first_or_octet_stream();
    Response::builder()
        .header(header::CONTENT_TYPE, mime.as_ref())
        .body(Body::from(bytes))
        .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
}

fn ui_missing() -> Response {
    (
        StatusCode::NOT_FOUND,
        "This spatt-server was built without the web UI. Run `npm run build` and rebuild, or pass --dist.",
    )
        .into_response()
}

/// Binds and serves until `shutdown` resolves.
pub async fn serve(
    config: ServerConfig,
    shutdown: impl std::future::Future<Output = ()> + Send + 'static,
) -> anyhow::Result<()> {
    let listener = tokio::net::TcpListener::bind(config.bind).await?;
    tracing::info!(
        "SPATT server listening on http://{}",
        listener.local_addr()?
    );
    axum::serve(listener, router(config.ui))
        .with_graceful_shutdown(shutdown)
        .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::Request;
    use http_body_util::BodyExt;
    use tower::ServiceExt;

    #[tokio::test]
    async fn health_identifies_spatt() {
        let response = router(UiSource::Embedded)
            .oneshot(Request::get("/api/health").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let body = response.into_body().collect().await.unwrap().to_bytes();
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(json["app"], "spatt");
        assert_eq!(json["version"], version());
    }

    #[tokio::test]
    async fn unknown_asset_is_404() {
        let response = router(UiSource::Embedded)
            .oneshot(
                Request::get("/assets/missing.js")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }

    /// When a web build exists, the embed must find it. Skipped (passes) without `dist/`.
    #[test]
    fn embeds_the_built_ui() {
        let dist_index =
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../dist/index.html");
        if dist_index.exists() {
            assert!(
                EmbeddedUi::get("index.html").is_some(),
                "dist/index.html exists but the embedded UI does not contain it"
            );
        }
    }

    #[test]
    fn default_bind_is_localhost() {
        assert!(ServerConfig::default().bind.ip().is_loopback());
    }
}

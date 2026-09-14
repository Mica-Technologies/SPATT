//! The SPATT HTTP server: the web UI plus its project API.
//!
//! One crate serves both the headless `spatt-server` binary and the Tauri app, which runs the
//! same router in-process over its own project folder. The web UI (`dist/`) is embedded into the
//! binary at compile time, so a release is a single file; `--dist` serves a directory from disk
//! instead during development.

pub mod api;
pub mod auth;
pub mod config;
pub mod datalock;
pub mod store;

use std::net::{IpAddr, SocketAddr, UdpSocket};
use std::path::PathBuf;
use std::sync::Arc;

use axum::body::Body;
use axum::extract::{Request, State};
use axum::http::{header, StatusCode, Uri};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::{Json, Router};
use rust_embed::RustEmbed;
use serde::Serialize;
use tower_http::services::{ServeDir, ServeFile};

use crate::store::FileProjectStore;

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

/// Receives one line per notable event (listening, each request, errors), for the manager's log.
pub type LogSink = Arc<dyn Fn(String) + Send + Sync>;

#[derive(Clone)]
pub struct ServerConfig {
    pub bind: SocketAddr,
    pub ui: UiSource,
    pub store: FileProjectStore,
    /// Required whenever `bind` is not a loopback address (`serve` refuses otherwise).
    pub token: Option<String>,
    pub log: Option<LogSink>,
}

impl ServerConfig {
    /// This computer only, on the default port, over `store`.
    pub fn local(store: FileProjectStore) -> Self {
        Self {
            bind: SocketAddr::from(([127, 0, 0, 1], DEFAULT_PORT)),
            ui: UiSource::Embedded,
            store,
            token: None,
            log: None,
        }
    }
}

pub const DEFAULT_PORT: u16 = 8787;

/// The app's data folder, the same one Tauri's `app_data_dir()` names: `%APPDATA%\<identifier>`,
/// `$XDG_DATA_HOME/<identifier>` or `~/Library/Application Support/<identifier>`.
pub fn default_data_dir() -> Option<PathBuf> {
    directories::BaseDirs::new().map(|dirs| dirs.data_dir().join(APP_IDENTIFIER))
}

/// The machine-wide data folder the system service uses: `%ProgramData%\Mica Technologies\SPATT`,
/// `/var/lib/spatt` or `/Library/Application Support/SPATT`.
pub fn machine_data_dir() -> PathBuf {
    #[cfg(target_os = "windows")]
    {
        let base = std::env::var_os("ProgramData")
            .map_or_else(|| PathBuf::from(r"C:\ProgramData"), PathBuf::from);
        base.join("Mica Technologies").join("SPATT")
    }
    #[cfg(target_os = "macos")]
    {
        PathBuf::from("/Library/Application Support/SPATT")
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        PathBuf::from("/var/lib/spatt")
    }
}

/// Must match `identifier` in `src-tauri/tauri.conf.json`.
pub const APP_IDENTIFIER: &str = "com.micatechnologies.spatt";

/// Projects live in `<data dir>/projects`.
pub fn projects_dir(data_dir: &std::path::Path) -> PathBuf {
    data_dir.join("projects")
}

/// This computer's address on the local network (the one it would use to reach the internet), or
/// `None` without a network. Nothing is sent: connecting a UDP socket only picks a route.
pub fn lan_ip() -> Option<IpAddr> {
    let socket = UdpSocket::bind("0.0.0.0:0").ok()?;
    socket.connect("192.0.2.1:9").ok()?; // TEST-NET-1: routable, never answered
    let ip = socket.local_addr().ok()?.ip();
    (!ip.is_loopback() && !ip.is_unspecified()).then_some(ip)
}

/// The URL a browser should open: with the access token, if one is needed.
pub fn access_url(host: IpAddr, port: u16, token: Option<&str>) -> String {
    let host = match host {
        IpAddr::V6(v6) => format!("[{v6}]"),
        IpAddr::V4(v4) => v4.to_string(),
    };
    match token {
        Some(token) => format!("http://{host}:{port}/?token={token}"),
        None => format!("http://{host}:{port}/"),
    }
}

/// Body of `GET /api/health`. The web UI recognises a SPATT server by `app`.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Health {
    pub app: &'static str,
    pub version: &'static str,
    /// `true` when browsers on other devices need the access token.
    pub token_required: bool,
}

#[derive(Clone)]
pub struct AppState {
    version: &'static str,
    store: FileProjectStore,
    token: Option<String>,
    log: Option<LogSink>,
}

pub fn version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

pub fn router(config: &ServerConfig) -> Router {
    let state = AppState {
        version: version(),
        store: config.store.clone(),
        token: config.token.clone(),
        log: config.log.clone(),
    };
    let api = Router::new()
        .route("/health", get(health))
        .merge(api::routes())
        .layer(axum::extract::DefaultBodyLimit::max(
            api::MAX_PROJECT_BYTES + 1,
        ));
    let router = Router::new().nest("/api", api);
    let router = match &config.ui {
        UiSource::Embedded => router.fallback(embedded_ui),
        UiSource::Directory(dir) => {
            let index = dir.join("index.html");
            router.fallback_service(ServeDir::new(dir).fallback(ServeFile::new(index)))
        }
    };
    router
        .layer(middleware::from_fn_with_state(state.clone(), auth::guard))
        .layer(middleware::from_fn_with_state(state.clone(), request_log))
        .with_state(state)
}

async fn health(State(state): State<AppState>) -> Json<Health> {
    Json(Health {
        app: "spatt",
        version: state.version,
        token_required: state.token.is_some(),
    })
}

/// One line per API request (the UI's assets would drown the log). Never logs the query string,
/// which may carry the token.
async fn request_log(State(state): State<AppState>, request: Request, next: Next) -> Response {
    let method = request.method().clone();
    let path = request.uri().path().to_owned();
    let response = next.run(request).await;
    if path.starts_with("/api/") && path != "/api/health" {
        let line = format!("{method} {path} {}", response.status().as_u16());
        tracing::info!("{line}");
        if let Some(log) = &state.log {
            log(line);
        }
    }
    response
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

/// Checks that the configuration is safe to serve.
pub fn check(config: &ServerConfig) -> anyhow::Result<()> {
    if !config.bind.ip().is_loopback() && config.token.is_none() {
        anyhow::bail!(
            "binding to {} exposes SPATT to the network, which needs an access token",
            config.bind.ip()
        );
    }
    Ok(())
}

/// Binds the listener, so the caller learns about a port in use before anything is spawned.
pub async fn bind(config: &ServerConfig) -> anyhow::Result<tokio::net::TcpListener> {
    check(config)?;
    Ok(tokio::net::TcpListener::bind(config.bind).await?)
}

/// Serves on a bound listener until `shutdown` resolves.
pub async fn serve_on(
    listener: tokio::net::TcpListener,
    config: ServerConfig,
    shutdown: impl std::future::Future<Output = ()> + Send + 'static,
) -> anyhow::Result<()> {
    check(&config)?;
    let line = format!("Listening on http://{}", listener.local_addr()?);
    tracing::info!("{line}");
    if let Some(log) = &config.log {
        log(line);
    }
    let app = router(&config).into_make_service_with_connect_info::<SocketAddr>();
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown)
        .await?;
    Ok(())
}

/// Binds and serves until `shutdown` resolves.
pub async fn serve(
    config: ServerConfig,
    shutdown: impl std::future::Future<Output = ()> + Send + 'static,
) -> anyhow::Result<()> {
    let listener = bind(&config).await?;
    serve_on(listener, config, shutdown).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::extract::ConnectInfo;
    use axum::http::Request;
    use http_body_util::BodyExt;
    use tower::ServiceExt;

    struct Fixture {
        _temp: tempfile::TempDir,
        config: ServerConfig,
    }

    fn fixture(token: Option<&str>) -> Fixture {
        let temp = tempfile::tempdir().unwrap();
        let mut config = ServerConfig::local(FileProjectStore::new(temp.path().join("projects")));
        config.token = token.map(str::to_owned);
        Fixture {
            _temp: temp,
            config,
        }
    }

    /// A request as a browser on `peer` would send it to host `host`.
    fn request(method: &str, uri: &str, host: &str, peer: [u8; 4]) -> axum::http::request::Builder {
        Request::builder()
            .method(method)
            .uri(uri)
            .header(header::HOST, host)
            .extension(ConnectInfo(SocketAddr::from((peer, 50_000))))
    }

    const LOCAL: [u8; 4] = [127, 0, 0, 1];
    const PHONE: [u8; 4] = [192, 168, 1, 20];

    async fn send(
        config: &ServerConfig,
        req: Request<Body>,
    ) -> (StatusCode, axum::http::HeaderMap, String) {
        let response = router(config).oneshot(req).await.unwrap();
        let status = response.status();
        let headers = response.headers().clone();
        let body = response.into_body().collect().await.unwrap().to_bytes();
        (status, headers, String::from_utf8_lossy(&body).into_owned())
    }

    fn get_req(uri: &str, host: &str, peer: [u8; 4]) -> Request<Body> {
        request("GET", uri, host, peer).body(Body::empty()).unwrap()
    }

    #[tokio::test]
    async fn health_identifies_spatt() {
        let f = fixture(None);
        let (status, _, body) =
            send(&f.config, get_req("/api/health", "localhost:8787", LOCAL)).await;
        assert_eq!(status, StatusCode::OK);
        let json: serde_json::Value = serde_json::from_str(&body).unwrap();
        assert_eq!(json["app"], "spatt");
        assert_eq!(json["version"], version());
        assert_eq!(json["tokenRequired"], false);
    }

    #[tokio::test]
    async fn unknown_asset_is_404() {
        let f = fixture(None);
        let (status, _, _) = send(
            &f.config,
            get_req("/assets/missing.js", "localhost:8787", LOCAL),
        )
        .await;
        assert_eq!(status, StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn project_round_trip_with_versions() {
        let f = fixture(None);
        let host = "127.0.0.1:8787";
        let put = |uri: &str, condition: (&'static str, String), body: &str| {
            request("PUT", uri, host, LOCAL)
                .header(condition.0, condition.1)
                .body(Body::from(body.to_owned()))
                .unwrap()
        };

        // Create: If-None-Match: *
        let (status, headers, body) = send(
            &f.config,
            put(
                "/api/projects/p-one",
                ("if-none-match", "*".into()),
                r#"{"name":"One"}"#,
            ),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{body}");
        let v1 = headers[header::ETAG].to_str().unwrap().to_owned();
        assert_eq!(
            v1,
            format!("\"{}\"", store::version_of(r#"{"name":"One"}"#))
        );

        // Read back with the same ETag; list shows it.
        let (status, headers, body) =
            send(&f.config, get_req("/api/projects/p-one", host, LOCAL)).await;
        assert_eq!(
            (status, body.as_str()),
            (StatusCode::OK, r#"{"name":"One"}"#)
        );
        assert_eq!(headers[header::ETAG], v1.as_str());
        let (_, _, list) = send(&f.config, get_req("/api/projects", host, LOCAL)).await;
        assert!(list.contains(r#""id":"p-one""#));

        // Update from v1 succeeds; a second device still on v1 gets 412 and the new ETag.
        let (status, headers, _) = send(
            &f.config,
            put(
                "/api/projects/p-one",
                ("if-match", v1.clone()),
                r#"{"name":"Two"}"#,
            ),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        let v2 = headers[header::ETAG].to_str().unwrap().to_owned();
        let (status, headers, body) = send(
            &f.config,
            put(
                "/api/projects/p-one",
                ("if-match", v1.clone()),
                r#"{"name":"Stale"}"#,
            ),
        )
        .await;
        assert_eq!(status, StatusCode::PRECONDITION_FAILED);
        assert_eq!(headers[header::ETAG], v2.as_str());
        assert!(body.contains("conflict"));

        // Overwrite on purpose, then an unconditional PUT is refused.
        let (status, _, _) = send(
            &f.config,
            put(
                "/api/projects/p-one",
                ("if-match", "*".into()),
                r#"{"name":"Mine"}"#,
            ),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        let bare = request("PUT", "/api/projects/p-one", host, LOCAL)
            .body(Body::from("{}"))
            .unwrap();
        assert_eq!(
            send(&f.config, bare).await.0,
            StatusCode::PRECONDITION_REQUIRED
        );

        // Delete, then read is 404 and a write from an old version conflicts with no ETag.
        let del = request("DELETE", "/api/projects/p-one", host, LOCAL)
            .body(Body::empty())
            .unwrap();
        assert_eq!(send(&f.config, del).await.0, StatusCode::NO_CONTENT);
        assert_eq!(
            send(&f.config, get_req("/api/projects/p-one", host, LOCAL))
                .await
                .0,
            StatusCode::NOT_FOUND
        );
        let (status, headers, _) = send(
            &f.config,
            put("/api/projects/p-one", ("if-match", v2), "{}"),
        )
        .await;
        assert_eq!(status, StatusCode::PRECONDITION_FAILED);
        assert!(headers.get(header::ETAG).is_none());
    }

    #[tokio::test]
    async fn rejects_bad_ids_and_oversized_bodies() {
        let f = fixture(None);
        let host = "localhost:8787";
        assert_eq!(
            send(&f.config, get_req("/api/projects/Bad_Id", host, LOCAL))
                .await
                .0,
            StatusCode::BAD_REQUEST
        );
        let huge = request("PUT", "/api/projects/p-big", host, LOCAL)
            .header("if-none-match", "*")
            .body(Body::from(vec![b' '; api::MAX_PROJECT_BYTES + 10]))
            .unwrap();
        assert_eq!(send(&f.config, huge).await.0, StatusCode::PAYLOAD_TOO_LARGE);
    }

    #[tokio::test]
    async fn without_a_token_only_loopback_host_names_are_answered() {
        let f = fixture(None);
        for host in ["localhost:8787", "127.0.0.1:8787", "[::1]:8787"] {
            assert_eq!(
                send(&f.config, get_req("/api/projects", host, LOCAL))
                    .await
                    .0,
                StatusCode::OK,
                "{host}"
            );
        }
        // DNS rebinding: a page on evil.example resolved to 127.0.0.1.
        assert_eq!(
            send(
                &f.config,
                get_req("/api/projects", "evil.example:8787", LOCAL)
            )
            .await
            .0,
            StatusCode::MISDIRECTED_REQUEST
        );
        assert_eq!(
            send(&f.config, get_req("/", "evil.example:8787", LOCAL))
                .await
                .0,
            StatusCode::MISDIRECTED_REQUEST
        );
    }

    #[tokio::test]
    async fn with_a_token_other_devices_must_present_it() {
        let f = fixture(Some("s3cret"));
        let lan = "192.168.1.10:8787";

        assert_eq!(
            send(&f.config, get_req("/api/health", lan, PHONE)).await.0,
            StatusCode::OK
        );
        assert_eq!(
            send(&f.config, get_req("/api/projects", lan, PHONE))
                .await
                .0,
            StatusCode::UNAUTHORIZED
        );
        assert_eq!(
            send(&f.config, get_req("/api/session", lan, PHONE)).await.0,
            StatusCode::UNAUTHORIZED
        );

        let bearer = request("GET", "/api/projects", lan, PHONE)
            .header(header::AUTHORIZATION, "Bearer s3cret")
            .body(Body::empty())
            .unwrap();
        assert_eq!(send(&f.config, bearer).await.0, StatusCode::OK);
        let wrong = request("GET", "/api/projects", lan, PHONE)
            .header(header::COOKIE, "spatt_access=nope")
            .body(Body::empty())
            .unwrap();
        assert_eq!(send(&f.config, wrong).await.0, StatusCode::UNAUTHORIZED);

        // The access link sets the cookie and drops the token from the address.
        let (status, headers, _) = send(&f.config, get_req("/?token=s3cret", lan, PHONE)).await;
        assert_eq!(status, StatusCode::SEE_OTHER);
        assert_eq!(headers[header::LOCATION], "/");
        let cookie = headers[header::SET_COOKIE]
            .to_str()
            .unwrap()
            .split(';')
            .next()
            .unwrap()
            .to_owned();
        let signed_in = request("GET", "/api/session", lan, PHONE)
            .header(header::COOKIE, cookie)
            .body(Body::empty())
            .unwrap();
        assert_eq!(send(&f.config, signed_in).await.0, StatusCode::NO_CONTENT);

        // Pasting the token also works.
        let post = |token: &str| {
            request("POST", "/api/session", lan, PHONE)
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(format!(r#"{{"token":"{token}"}}"#)))
                .unwrap()
        };
        assert_eq!(
            send(&f.config, post("nope")).await.0,
            StatusCode::UNAUTHORIZED
        );
        let (status, headers, _) = send(&f.config, post("s3cret")).await;
        assert_eq!(status, StatusCode::NO_CONTENT);
        assert!(headers[header::SET_COOKIE]
            .to_str()
            .unwrap()
            .starts_with("spatt_access=s3cret"));
    }

    #[tokio::test]
    async fn with_a_token_this_computer_needs_none_but_rebinding_still_does() {
        let f = fixture(Some("s3cret"));
        assert_eq!(
            send(&f.config, get_req("/api/projects", "localhost:8787", LOCAL))
                .await
                .0,
            StatusCode::OK
        );
        assert_eq!(
            send(&f.config, get_req("/api/session", "127.0.0.1:8787", LOCAL))
                .await
                .0,
            StatusCode::NO_CONTENT
        );
        assert_eq!(
            send(
                &f.config,
                get_req("/api/projects", "evil.example:8787", LOCAL)
            )
            .await
            .0,
            StatusCode::UNAUTHORIZED
        );
        // Without connection info (not served through serve_on) nothing counts as local.
        let bare = Request::get("/api/projects")
            .header(header::HOST, "localhost")
            .body(Body::empty())
            .unwrap();
        assert_eq!(send(&f.config, bare).await.0, StatusCode::UNAUTHORIZED);
    }

    #[test]
    fn network_binding_requires_a_token() {
        let f = fixture(None);
        let mut config = f.config.clone();
        config.bind = SocketAddr::from(([0, 0, 0, 0], DEFAULT_PORT));
        assert!(check(&config).is_err());
        config.token = Some("t".into());
        assert!(check(&config).is_ok());
        assert!(check(&f.config).is_ok());
    }

    #[test]
    fn access_urls() {
        assert_eq!(
            access_url("192.168.1.4".parse().unwrap(), 8787, Some("ab")),
            "http://192.168.1.4:8787/?token=ab"
        );
        assert_eq!(
            access_url("::1".parse().unwrap(), 80, None),
            "http://[::1]:80/"
        );
    }

    #[tokio::test]
    async fn logs_api_requests_without_the_query() {
        let lines = Arc::new(std::sync::Mutex::new(Vec::<String>::new()));
        let mut f = fixture(None);
        let sink = lines.clone();
        f.config.log = Some(Arc::new(move |line| sink.lock().unwrap().push(line)));
        send(
            &f.config,
            get_req("/api/projects?token=zzz", "localhost", LOCAL),
        )
        .await;
        send(&f.config, get_req("/api/health", "localhost", LOCAL)).await;
        send(&f.config, get_req("/index.html", "localhost", LOCAL)).await;
        assert_eq!(
            *lines.lock().unwrap(),
            vec!["GET /api/projects 200".to_owned()]
        );
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
    fn default_config_is_localhost() {
        let f = fixture(None);
        assert!(f.config.bind.ip().is_loopback());
    }
}

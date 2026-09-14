//! The network server run inside the desktop app, over the app's own project folder, controlled
//! from the manager window and the tray. Keep `ServerStatus`, `ServerSettingsPatch` and `LogLine`
//! in step with `src/manager/bridge.ts`.
//!
//! Settings persist in `<app data>/server.json`. The access token is created once and kept, so
//! links and QR codes handed out stay valid until someone asks for a new token.

use std::collections::VecDeque;
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::path::PathBuf;
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use spatt_server::store::FileProjectStore;
use spatt_server::{access_url, auth, lan_ip, LogSink, ServerConfig, UiSource, DEFAULT_PORT};
use tokio::sync::oneshot;

pub const SETTINGS_FILE: &str = "server.json";
const LOG_LINES: usize = 200;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub port: u16,
    /// Serve every network interface (with the token) instead of this computer only.
    pub lan: bool,
    pub token: String,
    /// Closing the manager while serving hides it to the tray instead of stopping the server.
    pub keep_serving_on_close: bool,
    /// The one-time notice about the tray has been shown.
    pub tray_notice_shown: bool,
}

impl Settings {
    /// Reads `server.json` from `data_dir`: `None` if it is missing, unreadable or has a bad token.
    pub fn read(data_dir: &std::path::Path) -> Option<Self> {
        std::fs::read_to_string(data_dir.join(SETTINGS_FILE))
            .ok()
            .and_then(|text| serde_json::from_str::<Settings>(&text).ok())
            .filter(|s| spatt_server::config::validate_token(&s.token).is_ok())
    }

    /// Reads `server.json`, or creates it with defaults (and a new token).
    pub fn read_or_create(data_dir: &std::path::Path) -> Result<Self, String> {
        match Self::read(data_dir) {
            Some(settings) => Ok(settings),
            None => {
                let settings = Self::default();
                settings.write(data_dir)?;
                Ok(settings)
            }
        }
    }

    pub fn write(&self, data_dir: &std::path::Path) -> Result<(), String> {
        std::fs::create_dir_all(data_dir)
            .and_then(|()| {
                std::fs::write(
                    data_dir.join(SETTINGS_FILE),
                    serde_json::to_string_pretty(self).unwrap_or_default(),
                )
            })
            .map_err(|error| format!("Could not save server settings: {error}"))
    }

    /// The address to bind: every interface when sharing on the network, else this computer only.
    pub fn bind(&self) -> SocketAddr {
        let ip = if self.lan {
            IpAddr::V4(Ipv4Addr::UNSPECIFIED)
        } else {
            IpAddr::V4(Ipv4Addr::LOCALHOST)
        };
        SocketAddr::new(ip, self.port)
    }
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            port: DEFAULT_PORT,
            lan: false,
            token: auth::generate_token(),
            keep_serving_on_close: true,
            tray_notice_shown: false,
        }
    }
}

/// Mirrors `ServerSettingsPatch` in `src/manager/bridge.ts`: only the fields given change.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsPatch {
    pub port: Option<u16>,
    pub lan: Option<bool>,
    pub keep_serving_on_close: Option<bool>,
}

/// Mirrors `ServerStatus` in `src/manager/bridge.ts`.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerStatus {
    pub running: bool,
    pub port: u16,
    pub lan: bool,
    /// Where this computer's browser opens SPATT.
    pub local_url: String,
    /// The access link for other devices (with the token), when sharing on the network and this
    /// computer has a network address.
    pub lan_url: Option<String>,
    pub token: String,
    pub data_dir: String,
    pub keep_serving_on_close: bool,
    /// Why the last start failed (a port in use, say), until the next successful start.
    pub error: Option<String>,
}

/// Mirrors `LogLine` in `src/manager/bridge.ts`.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogLine {
    /// Milliseconds since the Unix epoch.
    pub at: u64,
    pub text: String,
}

struct Running {
    stop: oneshot::Sender<()>,
}

pub struct Server {
    settings_path: PathBuf,
    store: FileProjectStore,
    settings: Mutex<Settings>,
    running: Mutex<Option<Running>>,
    error: Mutex<Option<String>>,
    log: Arc<Mutex<VecDeque<LogLine>>>,
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn push_line(log: &Mutex<VecDeque<LogLine>>, text: String) {
    let at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| u64::try_from(d.as_millis()).unwrap_or(u64::MAX));
    let mut lines = lock(log);
    if lines.len() == LOG_LINES {
        lines.pop_front();
    }
    lines.push_back(LogLine { at, text });
}

impl Server {
    /// Loads `server.json` from `data_dir`, creating it with defaults (and a new token) if it is
    /// missing or unreadable.
    pub fn load(data_dir: PathBuf, store: FileProjectStore) -> Self {
        let settings_path = data_dir.join(SETTINGS_FILE);
        let loaded = Settings::read(&data_dir);
        let server = Self {
            settings_path,
            store,
            settings: Mutex::new(loaded.clone().unwrap_or_default()),
            running: Mutex::new(None),
            error: Mutex::new(None),
            log: Arc::new(Mutex::new(VecDeque::new())),
        };
        if loaded.is_none() {
            server.save();
        }
        server
    }

    fn save(&self) {
        let settings = lock(&self.settings).clone();
        if let Err(error) =
            settings.write(self.settings_path.parent().unwrap_or(&self.settings_path))
        {
            self.note(error);
        }
    }

    fn note(&self, text: String) {
        push_line(&self.log, text);
    }

    pub fn settings(&self) -> Settings {
        lock(&self.settings).clone()
    }

    pub fn is_running(&self) -> bool {
        lock(&self.running).is_some()
    }

    pub fn status(&self) -> ServerStatus {
        let settings = self.settings();
        ServerStatus {
            running: self.is_running(),
            port: settings.port,
            lan: settings.lan,
            local_url: access_url(IpAddr::V4(Ipv4Addr::LOCALHOST), settings.port, None),
            lan_url: settings
                .lan
                .then(lan_ip)
                .flatten()
                .map(|ip| access_url(ip, settings.port, Some(&settings.token))),
            token: settings.token,
            data_dir: self.store.dir().display().to_string(),
            keep_serving_on_close: settings.keep_serving_on_close,
            error: lock(&self.error).clone(),
        }
    }

    pub fn logs(&self) -> Vec<LogLine> {
        lock(&self.log).iter().cloned().collect()
    }

    /// Binds and starts serving. Starting a running server does nothing.
    pub async fn start(&self) -> Result<(), String> {
        if self.is_running() {
            return Ok(());
        }
        let settings = self.settings();
        let log = self.log.clone();
        let sink: LogSink = Arc::new(move |line| push_line(&log, line));
        let config = ServerConfig {
            bind: settings.bind(),
            ui: UiSource::Embedded,
            store: self.store.clone(),
            token: settings.lan.then(|| settings.token.clone()),
            log: Some(sink),
        };
        let listener = match spatt_server::bind(&config).await {
            Ok(listener) => listener,
            Err(error) => {
                let message = format!("Could not start on port {}: {error}", settings.port);
                self.note(message.clone());
                *lock(&self.error) = Some(message.clone());
                return Err(message);
            }
        };
        let (stop, stopped) = oneshot::channel::<()>();
        let log = self.log.clone();
        tauri::async_runtime::spawn(async move {
            let result = spatt_server::serve_on(listener, config, async {
                let _ = stopped.await;
            })
            .await;
            push_line(
                &log,
                match result {
                    Ok(()) => "Stopped".to_owned(),
                    Err(error) => format!("Server error: {error}"),
                },
            );
        });
        *lock(&self.running) = Some(Running { stop });
        *lock(&self.error) = None;
        Ok(())
    }

    pub fn stop(&self) {
        if let Some(running) = lock(&self.running).take() {
            let _ = running.stop.send(());
        }
    }

    async fn restart_if_running(&self, was_running: bool) -> Result<(), String> {
        if was_running {
            self.stop();
            // Let the old listener close before binding the same port again.
            tokio::time::sleep(std::time::Duration::from_millis(150)).await;
            self.start().await
        } else {
            Ok(())
        }
    }

    /// Applies the patch and saves it; a running server restarts when its address changes.
    pub async fn update(&self, patch: SettingsPatch) -> Result<(), String> {
        let (restart, was_running) = {
            let mut settings = lock(&self.settings);
            let before = (settings.port, settings.lan);
            if let Some(port) = patch.port {
                if port < 1024 {
                    return Err("Choose a port from 1024 to 65535".to_owned());
                }
                settings.port = port;
            }
            if let Some(lan) = patch.lan {
                settings.lan = lan;
            }
            if let Some(keep) = patch.keep_serving_on_close {
                settings.keep_serving_on_close = keep;
            }
            (before != (settings.port, settings.lan), self.is_running())
        };
        self.save();
        self.restart_if_running(restart && was_running).await
    }

    /// Replaces the access token, signing every other device out.
    pub async fn regenerate_token(&self) -> Result<(), String> {
        let lan = {
            let mut settings = lock(&self.settings);
            settings.token = auth::generate_token();
            settings.lan
        };
        self.save();
        self.note("New access token: devices must use the new link".to_owned());
        self.restart_if_running(lan && self.is_running()).await
    }

    /// Marks the tray notice as shown; returns whether it had been shown before.
    pub fn take_tray_notice(&self) -> bool {
        let shown = {
            let mut settings = lock(&self.settings);
            std::mem::replace(&mut settings.tray_notice_shown, true)
        };
        if !shown {
            self.save();
        }
        shown
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn server(dir: &std::path::Path) -> Server {
        Server::load(
            dir.to_path_buf(),
            FileProjectStore::new(dir.join("projects")),
        )
    }

    #[test]
    fn first_load_creates_settings_with_a_token_and_keeps_it() {
        let temp = tempfile_dir();
        let first = server(temp.path());
        let token = first.settings().token;
        assert_eq!(token.len(), 48);
        assert!(temp.path().join(SETTINGS_FILE).is_file());
        assert_eq!(server(temp.path()).settings().token, token);
    }

    #[test]
    fn unreadable_settings_fall_back_to_defaults() {
        let temp = tempfile_dir();
        std::fs::write(temp.path().join(SETTINGS_FILE), "{ nope").unwrap();
        let settings = server(temp.path()).settings();
        assert_eq!(settings.port, DEFAULT_PORT);
        assert!(!settings.lan);
    }

    #[test]
    fn log_keeps_the_latest_lines() {
        let log = Mutex::new(VecDeque::new());
        for n in 0..LOG_LINES + 5 {
            push_line(&log, format!("line {n}"));
        }
        let lines = lock(&log);
        assert_eq!(lines.len(), LOG_LINES);
        assert_eq!(lines.front().unwrap().text, "line 5");
    }

    #[test]
    fn serves_projects_and_stops() {
        let temp = tempfile_dir();
        let runtime = tokio::runtime::Runtime::new().unwrap();
        runtime.block_on(async {
            let server = server(temp.path());
            // Port 0 is refused by `update`; pick a free port directly.
            let port = std::net::TcpListener::bind("127.0.0.1:0")
                .unwrap()
                .local_addr()
                .unwrap()
                .port();
            lock(&server.settings).port = port;
            server.start().await.unwrap();
            assert!(server.status().running);
            assert_eq!(
                server.status().local_url,
                format!("http://127.0.0.1:{port}/")
            );
            assert!(server.status().lan_url.is_none());

            let mut stream = tokio::net::TcpStream::connect(("127.0.0.1", port))
                .await
                .unwrap();
            use tokio::io::{AsyncReadExt, AsyncWriteExt};
            stream
                .write_all(
                    b"GET /api/projects HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n",
                )
                .await
                .unwrap();
            let mut response = String::new();
            stream.read_to_string(&mut response).await.unwrap();
            assert!(response.starts_with("HTTP/1.1 200"), "{response}");

            server.stop();
            assert!(!server.status().running);
            assert!(server
                .logs()
                .iter()
                .any(|l| l.text.starts_with("Listening on")));
        });
    }

    #[test]
    fn a_port_in_use_is_reported() {
        let temp = tempfile_dir();
        let runtime = tokio::runtime::Runtime::new().unwrap();
        runtime.block_on(async {
            let taken = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
            let server = server(temp.path());
            lock(&server.settings).port = taken.local_addr().unwrap().port();
            assert!(server.start().await.is_err());
            assert!(!server.is_running());
            assert!(server
                .status()
                .error
                .unwrap()
                .starts_with("Could not start on port"));
        });
    }

    fn tempfile_dir() -> tempfile::TempDir {
        tempfile::tempdir().unwrap()
    }
}

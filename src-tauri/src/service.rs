//! The server as a system service (`spatt --service`): no window, no tray, no Tauri. The platform
//! module runs it under the service manager (`platform::run_service`); this is the part every
//! platform shares.

use std::future::Future;
use std::io::Write;
use std::path::Path;
use std::sync::{Arc, Mutex};

use spatt_server::datalock::DataLock;
use spatt_server::store::FileProjectStore;
use spatt_server::{machine_data_dir, projects_dir, LogSink, ServerConfig, UiSource};

use crate::server::Settings;

pub const LOG_FILE: &str = "server.log";
/// The log starts over when it grows past this.
const LOG_LIMIT_BYTES: u64 = 1024 * 1024;

/// Appends log lines to `<data dir>/server.log`, starting a new file when it is too large.
fn file_log(data_dir: &Path) -> LogSink {
    let path = data_dir.join(LOG_FILE);
    if std::fs::metadata(&path).is_ok_and(|m| m.len() > LOG_LIMIT_BYTES) {
        let _ = std::fs::remove_file(&path);
    }
    let file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .ok()
        .map(|f| Arc::new(Mutex::new(f)));
    Arc::new(move |line: String| {
        if let Some(file) = &file {
            let secs = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map_or(0, |d| d.as_secs());
            if let Ok(mut file) = file.lock() {
                let _ = writeln!(file, "{secs} {line}");
            }
        }
    })
}

/// Serves the machine-wide library until `shutdown` completes.
pub async fn serve_machine_library(
    shutdown: impl Future<Output = ()> + Send + 'static,
) -> Result<(), String> {
    serve_library(&machine_data_dir(), "the SPATT service", shutdown).await
}

/// Serves the library in `data_dir` with the settings there, holding the folder while it runs.
pub async fn serve_library(
    data_dir: &Path,
    holder: &str,
    shutdown: impl Future<Output = ()> + Send + 'static,
) -> Result<(), String> {
    let _lock = DataLock::acquire(data_dir, holder).map_err(|e| e.to_string())?;
    let settings = Settings::read_or_create(data_dir)?;
    let log = file_log(data_dir);
    log(format!(
        "SPATT {} service starting on {}",
        spatt_server::version(),
        settings.bind()
    ));
    let config = ServerConfig {
        bind: settings.bind(),
        ui: UiSource::Embedded,
        store: FileProjectStore::new(projects_dir(data_dir)),
        token: settings.lan.then(|| settings.token.clone()),
        log: Some(log.clone()),
    };
    let result = spatt_server::serve(config, shutdown)
        .await
        .map_err(|e| e.to_string());
    log(match &result {
        Ok(()) => "Stopped".to_owned(),
        Err(error) => format!("Server error: {error}"),
    });
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serves_a_library_and_refuses_a_second_server_on_it() {
        let temp = tempfile::tempdir().unwrap();
        let port = std::net::TcpListener::bind("127.0.0.1:0")
            .unwrap()
            .local_addr()
            .unwrap()
            .port();
        Settings {
            port,
            ..Settings::default()
        }
        .write(temp.path())
        .unwrap();
        let runtime = tokio::runtime::Runtime::new().unwrap();
        runtime.block_on(async {
            let (stop, stopped) = tokio::sync::oneshot::channel::<()>();
            let dir = temp.path().to_path_buf();
            let server = tokio::spawn(async move {
                serve_library(&dir, "test service", async {
                    let _ = stopped.await;
                })
                .await
            });
            // Wait for it to listen.
            let mut connected = None;
            for _ in 0..50 {
                if let Ok(stream) = tokio::net::TcpStream::connect(("127.0.0.1", port)).await {
                    connected = Some(stream);
                    break;
                }
                tokio::time::sleep(std::time::Duration::from_millis(20)).await;
            }
            let mut stream = connected.expect("the service never listened");
            use tokio::io::{AsyncReadExt, AsyncWriteExt};
            stream
                .write_all(
                    b"GET /api/health HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n",
                )
                .await
                .unwrap();
            let mut response = String::new();
            stream.read_to_string(&mut response).await.unwrap();
            assert!(response.starts_with("HTTP/1.1 200"), "{response}");

            let second = serve_library(temp.path(), "second", async {}).await;
            assert!(second.unwrap_err().contains("in use by test service"));

            stop.send(()).unwrap();
            server.await.unwrap().unwrap();
        });
        let log = std::fs::read_to_string(temp.path().join(LOG_FILE)).unwrap();
        assert!(log.contains("service starting"), "{log}");
        assert!(log.contains("Stopped"), "{log}");
    }
}

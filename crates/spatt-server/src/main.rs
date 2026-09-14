//! Headless SPATT server, for machines without a desktop (or without WebKitGTK on Linux).

use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::path::PathBuf;

use anyhow::Context;
use clap::Parser;
use spatt_server::config::{validate_token, FileConfig};
use spatt_server::store::FileProjectStore;
use spatt_server::{
    access_url, auth, default_data_dir, lan_ip, projects_dir, serve, ServerConfig, UiSource,
    DEFAULT_PORT,
};

#[derive(Debug, Parser)]
#[command(name = "spatt-server", version = spatt_server::version(), about = "Serve SPATT over HTTP")]
struct Args {
    /// Settings file (TOML: bind, port, data_dir, token). Flags override it.
    #[arg(long)]
    config: Option<PathBuf>,

    /// Address to bind. The default serves this computer only; 0.0.0.0 serves the network and
    /// requires an access token.
    #[arg(long)]
    bind: Option<IpAddr>,

    #[arg(long)]
    port: Option<u16>,

    /// Folder for the project library (projects are kept in <data>/projects). Defaults to the
    /// desktop app's data folder for this user.
    #[arg(long)]
    data: Option<PathBuf>,

    /// Access token for other devices. When serving the network without one, a token is
    /// generated for this run and printed with the access link.
    #[arg(long)]
    token: Option<String>,

    /// Serve the web UI from this directory instead of the copy built into the binary.
    #[arg(long)]
    dist: Option<PathBuf>,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt().with_target(false).init();
    let args = Args::parse();
    let file = match &args.config {
        Some(path) => FileConfig::load(path)?,
        None => FileConfig::default(),
    };

    let bind = args
        .bind
        .or(file.bind)
        .unwrap_or(IpAddr::V4(Ipv4Addr::LOCALHOST));
    let port = args.port.or(file.port).unwrap_or(DEFAULT_PORT);
    let data_dir = args
        .data
        .or(file.data_dir)
        .or_else(default_data_dir)
        .context("no data folder: pass --data")?;
    let mut token = args.token.or(file.token);
    if let Some(token) = &token {
        validate_token(token)?;
    }
    if !bind.is_loopback() && token.is_none() {
        token = Some(auth::generate_token());
        tracing::warn!("No access token configured; generated one for this run. Set `token` in the config file to keep it.");
    }

    let store = FileProjectStore::new(projects_dir(&data_dir));
    tracing::info!("Projects folder: {}", store.dir().display());
    if !bind.is_loopback() {
        let host = if bind.is_unspecified() {
            lan_ip().unwrap_or(bind)
        } else {
            bind
        };
        tracing::info!(
            "Access link for other devices: {}",
            access_url(host, port, token.as_deref())
        );
    }

    let config = ServerConfig {
        bind: SocketAddr::new(bind, port),
        ui: args.dist.map_or(UiSource::Embedded, UiSource::Directory),
        store,
        token,
        log: None,
    };
    serve(config, async {
        let _ = tokio::signal::ctrl_c().await;
    })
    .await
}

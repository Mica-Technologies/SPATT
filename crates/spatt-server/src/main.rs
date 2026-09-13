//! Headless SPATT server, for machines without a desktop (or without WebKitGTK on Linux).

use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::path::PathBuf;

use clap::Parser;
use spatt_server::{serve, ServerConfig, UiSource, DEFAULT_PORT};

#[derive(Debug, Parser)]
#[command(name = "spatt-server", version = spatt_server::version(), about = "Serve SPATT over HTTP")]
struct Args {
    /// Address to bind. The default serves this computer only; use 0.0.0.0 for the network.
    #[arg(long, default_value_t = IpAddr::V4(Ipv4Addr::LOCALHOST))]
    bind: IpAddr,

    #[arg(long, default_value_t = DEFAULT_PORT)]
    port: u16,

    /// Serve the web UI from this directory instead of the copy built into the binary.
    #[arg(long)]
    dist: Option<PathBuf>,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt().with_target(false).init();
    let args = Args::parse();
    let config = ServerConfig {
        bind: SocketAddr::new(args.bind, args.port),
        ui: args.dist.map_or(UiSource::Embedded, UiSource::Directory),
    };
    serve(config, async {
        let _ = tokio::signal::ctrl_c().await;
    })
    .await
}

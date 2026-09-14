//! Background modes: running SPATT's server without the app open.
//!
//! - **Start at login** (`Mode::Login`): the app starts with the user's session as `spatt --headless`
//!   (server and tray, no window), over the user's own library. No administrator rights.
//! - **System service** (`Mode::Service`): `spatt --service` runs under the operating system's
//!   service manager before anyone logs in, as a low-privilege account, over the machine-wide
//!   library (`spatt_server::machine_data_dir`). A `spatt --tray` companion starts at login to show
//!   it in the tray. Installing needs administrator rights.
//!
//! The operating-system work (registry, service manager, systemd, launchd, firewall) is in
//! `platform::{windows,linux,macos}` behind [`BackgroundInstaller`]; this module holds what is
//! shared: the modes, their status, the files the installers write, and copying a library.

pub mod templates;

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use spatt_server::{datalock, machine_data_dir, projects_dir};

use crate::server::Settings;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, clap::ValueEnum)]
#[serde(rename_all = "camelCase")]
pub enum Mode {
    /// Start with your session, over your own projects (no administrator rights).
    Login,
    /// A system service that runs before anyone logs in, over the machine-wide projects.
    Service,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ServiceState {
    NotInstalled,
    Running,
    Stopped,
    /// Starting, stopping or another transitional state, as the service manager names it.
    Other(String),
}

/// What is installed on this computer. Mirrors `BackgroundStatus` in `src/manager/bridge.ts`.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackgroundStatus {
    /// Start at login is registered for this user.
    pub login: bool,
    pub service: ServiceState,
    /// The tray companion for the service starts at login for this user.
    pub tray: bool,
    /// A firewall rule lets other devices reach the server (Windows only; `None` elsewhere).
    pub firewall_rule: Option<bool>,
    /// The machine-wide data folder the service uses.
    pub service_data_dir: String,
    /// Whether this process could install the service without asking for administrator rights.
    pub elevated: bool,
}

/// The operating system's side of the background modes. Each method is idempotent: installing
/// what is installed, or removing what is not, succeeds.
pub trait BackgroundInstaller {
    fn status(&self) -> BackgroundStatus;
    /// Registers `exe --headless` to start at login for this user.
    fn install_login(&self, exe: &Path) -> Result<(), String>;
    fn uninstall_login(&self) -> Result<(), String>;
    /// Registers `exe --tray` to start at login for this user (the service's tray companion).
    fn install_tray(&self, exe: &Path) -> Result<(), String>;
    fn uninstall_tray(&self) -> Result<(), String>;
    /// Registers and starts `exe --service` under the service manager. Needs administrator rights.
    fn install_service(&self, exe: &Path) -> Result<(), String>;
    /// Stops and removes the service. Needs administrator rights.
    fn uninstall_service(&self) -> Result<(), String>;
    /// Restarts the service so it reads changed settings. Needs administrator rights.
    fn restart_service(&self) -> Result<(), String>;
    /// Adds (`Some(port)`) or removes (`None`) the inbound firewall rule for private networks.
    /// Needs administrator rights where a firewall rule exists (Windows); a no-op elsewhere.
    fn set_firewall_rule(&self, exe: &Path, port: Option<u16>) -> Result<(), String>;
    /// Prepares the machine-wide data folder so the service account can write it.
    fn prepare_service_data_dir(&self, dir: &Path) -> Result<(), String>;
}

/// The running executable, for the entries the installers write.
pub fn current_exe() -> Result<PathBuf, String> {
    std::env::current_exe().map_err(|error| format!("Could not find the SPATT program: {error}"))
}

/// A service that is running and serving, as seen from this user's side.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceServer {
    pub port: u16,
    pub lan: bool,
    pub local_url: String,
    pub lan_url: Option<String>,
    pub token: Option<String>,
    pub data_dir: String,
}

/// The system service's server, if one holds the machine-wide library right now.
pub fn running_service() -> Option<ServiceServer> {
    let dir = machine_data_dir();
    if !datalock::is_held(&dir) {
        return None;
    }
    let settings = Settings::read(&dir)?;
    let local = std::net::IpAddr::V4(std::net::Ipv4Addr::LOCALHOST);
    Some(ServiceServer {
        port: settings.port,
        lan: settings.lan,
        local_url: spatt_server::access_url(local, settings.port, None),
        lan_url: settings
            .lan
            .then(spatt_server::lan_ip)
            .flatten()
            .map(|ip| spatt_server::access_url(ip, settings.port, Some(&settings.token))),
        token: settings.lan.then_some(settings.token),
        data_dir: dir.display().to_string(),
    })
}

/// Copies every project in `from` (a data folder) into `to`'s library, keeping projects already
/// there. Returns how many were copied.
pub fn copy_library(from: &Path, to: &Path) -> Result<usize, String> {
    let source = projects_dir(from);
    let target = projects_dir(to);
    std::fs::create_dir_all(&target).map_err(|e| format!("{}: {e}", target.display()))?;
    let Ok(entries) = std::fs::read_dir(&source) else {
        return Ok(0);
    };
    let mut copied = 0;
    for entry in entries.flatten() {
        let path = entry.path();
        let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        if !name.ends_with(".spatt.json") {
            continue;
        }
        let destination = target.join(name);
        if destination.exists() {
            continue;
        }
        std::fs::copy(&path, &destination).map_err(|e| format!("{}: {e}", path.display()))?;
        copied += 1;
    }
    Ok(copied)
}

/// Sets up the machine-wide data folder and its settings for the service: creates the folder,
/// lets the service account write it, copies a library in if asked, and writes default settings.
pub fn prepare_service(
    installer: &dyn BackgroundInstaller,
    copy_from: Option<&Path>,
) -> Result<Settings, String> {
    let dir = machine_data_dir();
    std::fs::create_dir_all(projects_dir(&dir)).map_err(|e| format!("{}: {e}", dir.display()))?;
    if let Some(from) = copy_from {
        copy_library(from, &dir)?;
    }
    let settings = Settings::read_or_create(&dir)?;
    installer.prepare_service_data_dir(&dir)?;
    Ok(settings)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn copies_projects_without_overwriting() {
        let from = tempfile::tempdir().unwrap();
        let to = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(projects_dir(from.path())).unwrap();
        std::fs::create_dir_all(projects_dir(to.path())).unwrap();
        std::fs::write(projects_dir(from.path()).join("a.spatt.json"), "mine").unwrap();
        std::fs::write(projects_dir(from.path()).join("b.spatt.json"), "mine").unwrap();
        std::fs::write(projects_dir(from.path()).join("notes.txt"), "not a project").unwrap();
        std::fs::write(projects_dir(to.path()).join("b.spatt.json"), "theirs").unwrap();

        assert_eq!(copy_library(from.path(), to.path()).unwrap(), 1);
        assert_eq!(
            std::fs::read_to_string(projects_dir(to.path()).join("a.spatt.json")).unwrap(),
            "mine"
        );
        assert_eq!(
            std::fs::read_to_string(projects_dir(to.path()).join("b.spatt.json")).unwrap(),
            "theirs"
        );
        assert!(!projects_dir(to.path()).join("notes.txt").exists());
    }

    #[test]
    fn copying_from_an_empty_folder_copies_nothing() {
        let from = tempfile::tempdir().unwrap();
        let to = tempfile::tempdir().unwrap();
        assert_eq!(copy_library(from.path(), to.path()).unwrap(), 0);
    }
}

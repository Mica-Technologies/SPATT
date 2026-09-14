//! macOS: LaunchAgents for start at login and the tray companion, a LaunchDaemon for the service,
//! and an administrator prompt through AppleScript. There is no firewall rule to manage (the
//! application firewall asks by itself).

use std::path::{Path, PathBuf};
use std::process::Command;

use crate::background::templates::{
    launchd_plist, LAUNCHD_HEADLESS, LAUNCHD_SERVICE, LAUNCHD_TRAY,
};
use crate::background::{BackgroundInstaller, BackgroundStatus, ServiceState};

/// The daemon runs as this built-in unprivileged user, which owns the data folder.
const DAEMON_USER: &str = "nobody";

pub fn os_label() -> &'static str {
    "macOS"
}

pub fn attach_console() {}

pub fn is_elevated() -> bool {
    Command::new("id")
        .arg("-u")
        .output()
        .is_ok_and(|out| String::from_utf8_lossy(&out.stdout).trim() == "0")
}

fn shell_quote(text: &str) -> String {
    format!("'{}'", text.replace('\'', r"'\''"))
}

/// Runs `exe args` with administrator rights (the system password prompt) and returns its exit code.
pub fn run_elevated(exe: &Path, args: &[String]) -> Result<i32, String> {
    let command = std::iter::once(exe.display().to_string())
        .chain(args.iter().cloned())
        .map(|a| shell_quote(&a))
        .collect::<Vec<_>>()
        .join(" ");
    let script = format!(
        "do shell script \"{}\" with administrator privileges",
        command.replace('\\', "\\\\").replace('"', "\\\"")
    );
    let status = Command::new("osascript")
        .args(["-e", &script])
        .status()
        .map_err(|e| format!("Could not ask for administrator permission: {e}"))?;
    Ok(status.code().unwrap_or(1))
}

/// `spatt --service`: launchd runs it in the foreground and stops it with SIGTERM.
pub fn run_service() -> Result<(), String> {
    let runtime = tokio::runtime::Runtime::new().map_err(|e| e.to_string())?;
    runtime.block_on(crate::service::serve_machine_library(async {
        let mut term = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()).ok();
        tokio::select! {
            _ = tokio::signal::ctrl_c() => {}
            _ = async { if let Some(term) = term.as_mut() { term.recv().await; } else { std::future::pending::<()>().await } } => {}
        }
    }))
}

pub struct MacInstaller;

pub fn installer() -> MacInstaller {
    MacInstaller
}

fn agent_path(label: &str) -> Result<PathBuf, String> {
    directories::BaseDirs::new()
        .map(|dirs| {
            dirs.home_dir()
                .join("Library/LaunchAgents")
                .join(format!("{label}.plist"))
        })
        .ok_or_else(|| "No home folder".to_owned())
}

fn daemon_path() -> PathBuf {
    PathBuf::from("/Library/LaunchDaemons").join(format!("{LAUNCHD_SERVICE}.plist"))
}

fn launchctl(args: &[&str]) -> bool {
    Command::new("launchctl")
        .args(args)
        .output()
        .is_ok_and(|out| out.status.success())
}

fn install_agent(label: &str, exe: &Path, arg: &str) -> Result<(), String> {
    let path = agent_path(label)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("{}: {e}", parent.display()))?;
    }
    std::fs::write(&path, launchd_plist(label, exe, arg, false, None))
        .map_err(|e| format!("{}: {e}", path.display()))
}

fn remove_agent(label: &str) -> Result<(), String> {
    let path = agent_path(label)?;
    match std::fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("{}: {error}", path.display())),
    }
}

impl BackgroundInstaller for MacInstaller {
    fn status(&self) -> BackgroundStatus {
        let agent = |label: &str| agent_path(label).is_ok_and(|p| p.is_file());
        let service = if !daemon_path().is_file() {
            ServiceState::NotInstalled
        } else if launchctl(&["print", &format!("system/{LAUNCHD_SERVICE}")]) {
            ServiceState::Running
        } else {
            ServiceState::Stopped
        };
        BackgroundStatus {
            login: agent(LAUNCHD_HEADLESS),
            service,
            tray: agent(LAUNCHD_TRAY),
            firewall_rule: None,
            service_data_dir: spatt_server::machine_data_dir().display().to_string(),
            elevated: is_elevated(),
        }
    }

    fn install_login(&self, exe: &Path) -> Result<(), String> {
        install_agent(LAUNCHD_HEADLESS, exe, "--headless")
    }

    fn uninstall_login(&self) -> Result<(), String> {
        remove_agent(LAUNCHD_HEADLESS)
    }

    fn install_tray(&self, exe: &Path) -> Result<(), String> {
        install_agent(LAUNCHD_TRAY, exe, "--tray")
    }

    fn uninstall_tray(&self) -> Result<(), String> {
        remove_agent(LAUNCHD_TRAY)
    }

    fn install_service(&self, exe: &Path) -> Result<(), String> {
        let path = daemon_path();
        std::fs::write(
            &path,
            launchd_plist(LAUNCHD_SERVICE, exe, "--service", true, Some(DAEMON_USER)),
        )
        .map_err(|e| format!("{}: {e}", path.display()))?;
        let _ = launchctl(&["bootout", &format!("system/{LAUNCHD_SERVICE}")]);
        if launchctl(&["bootstrap", "system", &path.display().to_string()]) {
            Ok(())
        } else {
            Err("launchctl could not start the SPATT service".to_owned())
        }
    }

    fn uninstall_service(&self) -> Result<(), String> {
        let _ = launchctl(&["bootout", &format!("system/{LAUNCHD_SERVICE}")]);
        match std::fs::remove_file(daemon_path()) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(format!("{}: {error}", daemon_path().display())),
        }
    }

    fn restart_service(&self) -> Result<(), String> {
        if launchctl(&["kickstart", "-k", &format!("system/{LAUNCHD_SERVICE}")]) {
            Ok(())
        } else {
            Err("launchctl could not restart the SPATT service".to_owned())
        }
    }

    fn set_firewall_rule(&self, _exe: &Path, _port: Option<u16>) -> Result<(), String> {
        Ok(())
    }

    fn prepare_service_data_dir(&self, dir: &Path) -> Result<(), String> {
        let status = Command::new("chown")
            .args(["-R", DAEMON_USER, &dir.display().to_string()])
            .status()
            .map_err(|e| format!("Could not run chown: {e}"))?;
        if status.success() {
            Ok(())
        } else {
            Err(format!(
                "Could not give {} to the {DAEMON_USER} user",
                dir.display()
            ))
        }
    }
}

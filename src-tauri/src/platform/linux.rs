//! Linux: XDG autostart for start at login and the tray companion, a systemd system unit for the
//! service, and pkexec for administrator steps. There is no firewall rule to manage.

use std::path::{Path, PathBuf};
use std::process::Command;

use crate::background::templates::{systemd_unit, xdg_autostart, SYSTEMD_UNIT, SYSTEMD_USER};
use crate::background::{BackgroundInstaller, BackgroundStatus, ServiceState};

const AUTOSTART_HEADLESS: &str = "spatt-headless.desktop";
const AUTOSTART_TRAY: &str = "spatt-tray.desktop";

pub fn os_label() -> &'static str {
    "Linux"
}

pub fn attach_console() {}

pub fn is_elevated() -> bool {
    Command::new("id")
        .arg("-u")
        .output()
        .is_ok_and(|out| String::from_utf8_lossy(&out.stdout).trim() == "0")
}

/// Runs `exe args` through pkexec (a graphical password prompt) and returns its exit code.
pub fn run_elevated(exe: &Path, args: &[String]) -> Result<i32, String> {
    let status = Command::new("pkexec").arg(exe).args(args).status().map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            "This needs administrator rights and there is no graphical password prompt (pkexec): run the same spatt command with sudo".to_owned()
        } else {
            format!("Could not ask for administrator permission (pkexec): {e}")
        }
    })?;
    Ok(status.code().unwrap_or(1))
}

/// `spatt --service`: systemd runs it in the foreground and stops it with SIGTERM.
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

pub struct LinuxInstaller;

pub fn installer() -> LinuxInstaller {
    LinuxInstaller
}

fn autostart_dir() -> Result<PathBuf, String> {
    directories::BaseDirs::new()
        .map(|dirs| dirs.config_dir().join("autostart"))
        .ok_or_else(|| "No home folder".to_owned())
}

fn unit_path() -> PathBuf {
    PathBuf::from("/etc/systemd/system").join(SYSTEMD_UNIT)
}

fn write_autostart(name: &str, exe: &Path, arg: &str, title: &str) -> Result<(), String> {
    let dir = autostart_dir()?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    std::fs::write(dir.join(name), xdg_autostart(exe, arg, title))
        .map_err(|e| format!("{}: {e}", dir.display()))
}

fn remove_file(path: &Path) -> Result<(), String> {
    match std::fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("{}: {error}", path.display())),
    }
}

fn systemctl(args: &[&str]) -> Result<(), String> {
    let output = Command::new("systemctl")
        .args(args)
        .output()
        .map_err(|e| format!("Could not run systemctl: {e}"))?;
    if output.status.success() {
        Ok(())
    } else {
        Err(format!(
            "systemctl {}: {}",
            args.join(" "),
            String::from_utf8_lossy(&output.stderr).trim()
        ))
    }
}

impl BackgroundInstaller for LinuxInstaller {
    fn status(&self) -> BackgroundStatus {
        let autostart = |name: &str| autostart_dir().is_ok_and(|dir| dir.join(name).is_file());
        let service = if !unit_path().is_file() {
            ServiceState::NotInstalled
        } else {
            match Command::new("systemctl")
                .args(["is-active", SYSTEMD_UNIT])
                .output()
            {
                Ok(out) => match String::from_utf8_lossy(&out.stdout).trim() {
                    "active" => ServiceState::Running,
                    "inactive" | "failed" => ServiceState::Stopped,
                    other => ServiceState::Other(other.to_owned()),
                },
                Err(error) => ServiceState::Other(error.to_string()),
            }
        };
        BackgroundStatus {
            login: autostart(AUTOSTART_HEADLESS),
            service,
            tray: autostart(AUTOSTART_TRAY),
            firewall_rule: None,
            service_data_dir: spatt_server::machine_data_dir().display().to_string(),
            elevated: is_elevated(),
        }
    }

    fn install_login(&self, exe: &Path) -> Result<(), String> {
        write_autostart(AUTOSTART_HEADLESS, exe, "--headless", "SPATT")
    }

    fn uninstall_login(&self) -> Result<(), String> {
        remove_file(&autostart_dir()?.join(AUTOSTART_HEADLESS))
    }

    fn install_tray(&self, exe: &Path) -> Result<(), String> {
        write_autostart(AUTOSTART_TRAY, exe, "--tray", "SPATT tray")
    }

    fn uninstall_tray(&self) -> Result<(), String> {
        remove_file(&autostart_dir()?.join(AUTOSTART_TRAY))
    }

    fn install_service(&self, exe: &Path) -> Result<(), String> {
        std::fs::write(unit_path(), systemd_unit(exe))
            .map_err(|e| format!("{}: {e}", unit_path().display()))?;
        systemctl(&["daemon-reload"])?;
        systemctl(&["enable", "--now", SYSTEMD_UNIT])
    }

    fn uninstall_service(&self) -> Result<(), String> {
        if !unit_path().is_file() {
            return Ok(());
        }
        let _ = systemctl(&["disable", "--now", SYSTEMD_UNIT]);
        remove_file(&unit_path())?;
        systemctl(&["daemon-reload"])
    }

    fn restart_service(&self) -> Result<(), String> {
        systemctl(&["restart", SYSTEMD_UNIT])
    }

    fn set_firewall_rule(&self, _exe: &Path, _port: Option<u16>) -> Result<(), String> {
        Ok(())
    }

    fn prepare_service_data_dir(&self, dir: &Path) -> Result<(), String> {
        // The unit runs as a system user that owns the data folder.
        let exists = Command::new("id")
            .arg(SYSTEMD_USER)
            .output()
            .is_ok_and(|out| out.status.success());
        if !exists {
            let status = Command::new("useradd")
                .args([
                    "--system",
                    "--no-create-home",
                    "--shell",
                    "/usr/sbin/nologin",
                    SYSTEMD_USER,
                ])
                .status()
                .map_err(|e| format!("Could not run useradd: {e}"))?;
            if !status.success() {
                return Err(format!("Could not create the {SYSTEMD_USER} system user"));
            }
        }
        let status = Command::new("chown")
            .args([
                "-R",
                &format!("{SYSTEMD_USER}:{SYSTEMD_USER}"),
                &dir.display().to_string(),
            ])
            .status()
            .map_err(|e| format!("Could not run chown: {e}"))?;
        if status.success() {
            Ok(())
        } else {
            Err(format!(
                "Could not give {} to the {SYSTEMD_USER} user",
                dir.display()
            ))
        }
    }
}

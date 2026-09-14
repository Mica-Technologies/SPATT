//! Command-line modes, parsed before any window or webview exists.
//!
//! ```text
//! spatt                          the manager window (the default)
//! spatt --headless               server and tray, no window (start at login runs this)
//! spatt --tray                   tray companion for the system service
//! spatt --service                the server under the service manager (no Tauri, no webview)
//! spatt --status                 what is installed and running
//! spatt --install-headless [--mode login|service] [--copy-library-from <data dir>]
//! spatt --uninstall-headless [--mode login|service] [--delete-data]
//! spatt --configure-service [--port N] [--lan true|false] [--regenerate-token]
//! ```
//!
//! Installing or changing the service needs administrator rights: without them, SPATT re-launches
//! itself elevated for that step (the hidden `--elevated-*` flags) and reads the outcome back from a
//! result file.

use std::path::{Path, PathBuf};

use clap::Parser;
use spatt_server::{datalock, default_data_dir, machine_data_dir};

use crate::background::{self, current_exe, BackgroundInstaller, Mode, ServiceState};
use crate::platform;
use crate::server::Settings;

#[derive(Debug, Parser)]
#[command(name = "spatt", version = spatt_server::version(), about = "SPATT — Signal Programming and Timing Tool")]
pub struct Cli {
    /// Run the server with a tray icon and no window.
    #[arg(long, group = "run")]
    pub headless: bool,
    /// Run the tray companion for the system service.
    #[arg(long, group = "run")]
    pub tray: bool,
    /// Run the server under the operating system's service manager.
    #[arg(long, group = "run")]
    pub service: bool,
    /// Show what is installed and running.
    #[arg(long, group = "run")]
    pub status: bool,
    /// Install a background mode.
    #[arg(long, group = "run")]
    pub install_headless: bool,
    /// Remove a background mode.
    #[arg(long, group = "run")]
    pub uninstall_headless: bool,
    /// Change the system service's settings and restart it.
    #[arg(long, group = "run")]
    pub configure_service: bool,

    /// Which background mode to install or remove.
    #[arg(long, value_enum, default_value = "login")]
    pub mode: Mode,
    /// With `--mode service`: copy the projects from this data folder into the service's library.
    #[arg(long)]
    pub copy_library_from: Option<PathBuf>,
    /// With `--uninstall-headless --mode service`: also delete the service's data folder.
    #[arg(long)]
    pub delete_data: bool,
    /// With `--configure-service`: the port the service listens on.
    #[arg(long)]
    pub port: Option<u16>,
    /// With `--configure-service`: share on the local network (true) or serve this computer only.
    #[arg(long)]
    pub lan: Option<bool>,
    /// With `--configure-service`: replace the access token, signing every other device out.
    #[arg(long)]
    pub regenerate_token: bool,

    #[arg(long, hide = true, group = "run")]
    pub elevated_install_service: bool,
    #[arg(long, hide = true, group = "run")]
    pub elevated_uninstall_service: bool,
    #[arg(long, hide = true, group = "run")]
    pub elevated_configure_service: bool,
    /// Adds the firewall rule for this port, or removes it with 0.
    #[arg(long, hide = true, group = "run")]
    pub elevated_firewall_rule: Option<u16>,
    /// Where an elevated step writes its outcome (empty on success, the error otherwise).
    #[arg(long, hide = true)]
    pub result_file: Option<PathBuf>,
}

/// What `main` should do after parsing.
pub enum Launch {
    Window,
    Headless,
    Tray,
    /// A command-line action that has finished, with its exit code.
    Exit(i32),
}

pub fn launch() -> Launch {
    let args: Vec<String> = std::env::args().collect();
    let cli = match Cli::try_parse_from(&args) {
        Ok(cli) => cli,
        // Launched from a file manager or dock with arguments SPATT does not know: open the window.
        Err(error) if !args.iter().skip(1).any(|a| a.starts_with("--")) => {
            let _ = error;
            return Launch::Window;
        }
        Err(error) => {
            platform::attach_console();
            let _ = error.print();
            return Launch::Exit(if error.use_stderr() { 2 } else { 0 });
        }
    };
    if cli.headless {
        return Launch::Headless;
    }
    if cli.tray {
        return Launch::Tray;
    }
    if !(cli.service
        || cli.status
        || cli.install_headless
        || cli.uninstall_headless
        || cli.configure_service
        || cli.elevated_install_service
        || cli.elevated_uninstall_service
        || cli.elevated_configure_service
        || cli.elevated_firewall_rule.is_some())
    {
        return Launch::Window;
    }
    if cli.service {
        return Launch::Exit(match platform::run_service() {
            Ok(()) => 0,
            Err(error) => {
                eprintln!("{error}");
                1
            }
        });
    }

    platform::attach_console();
    let installer = platform::installer();
    let outcome = if cli.status {
        Ok(status_text(&installer))
    } else if cli.install_headless {
        install(&installer, cli.mode, cli.copy_library_from.as_deref())
            .map(|()| format!("Installed: {}", mode_label(cli.mode)))
    } else if cli.uninstall_headless {
        uninstall(&installer, cli.mode, cli.delete_data)
            .map(|()| format!("Removed: {}", mode_label(cli.mode)))
    } else if cli.configure_service {
        configure_service(&installer, &ServicePatch::from(&cli))
            .map(|()| "Service settings changed".to_owned())
    } else {
        let result = if cli.elevated_install_service {
            elevated_install_service(&installer, cli.copy_library_from.as_deref())
        } else if cli.elevated_uninstall_service {
            elevated_uninstall_service(&installer, cli.delete_data)
        } else if let Some(port) = cli.elevated_firewall_rule {
            current_exe()
                .and_then(|exe| installer.set_firewall_rule(&exe, (port != 0).then_some(port)))
        } else {
            elevated_configure_service(&installer, &ServicePatch::from(&cli))
        };
        if let Some(path) = &cli.result_file {
            let _ = std::fs::write(path, result.as_ref().err().map_or("", String::as_str));
        }
        result.map(|()| String::new())
    };
    match outcome {
        Ok(text) => {
            if !text.is_empty() {
                println!("{text}");
            }
            Launch::Exit(0)
        }
        Err(error) => {
            eprintln!("{error}");
            Launch::Exit(1)
        }
    }
}

pub fn mode_label(mode: Mode) -> &'static str {
    match mode {
        Mode::Login => "start at login",
        Mode::Service => "system service",
    }
}

fn status_text(installer: &impl BackgroundInstaller) -> String {
    let status = installer.status();
    let mut lines = vec![
        format!(
            "Start at login: {}",
            if status.login {
                "installed"
            } else {
                "not installed"
            }
        ),
        format!(
            "System service: {}",
            match &status.service {
                ServiceState::NotInstalled => "not installed".to_owned(),
                ServiceState::Running => "running".to_owned(),
                ServiceState::Stopped => "stopped".to_owned(),
                ServiceState::Other(state) => state.to_lowercase(),
            }
        ),
        format!(
            "Service tray companion: {}",
            if status.tray {
                "installed"
            } else {
                "not installed"
            }
        ),
    ];
    if let Some(rule) = status.firewall_rule {
        lines.push(format!(
            "Firewall rule (private networks): {}",
            if rule { "present" } else { "none" }
        ));
    }
    lines.push(format!("Service data folder: {}", status.service_data_dir));
    if let Some(service) = background::running_service() {
        lines.push(format!(
            "Service serving at {}{}",
            service.local_url,
            service
                .lan_url
                .map_or_else(String::new, |url| format!(" and {url}"))
        ));
    }
    if let Some(user_dir) = default_data_dir() {
        if datalock::is_held(&user_dir) {
            lines.push(format!(
                "Your library is open in {}",
                datalock::holder_of(&user_dir)
                    .unwrap_or_else(|| "another SPATT process".to_owned())
            ));
        }
    }
    lines.join("\n")
}

/// Runs an administrator-only step: directly when this process has the rights, otherwise in a
/// re-launched elevated copy of SPATT, whose error (if any) comes back through a result file.
fn as_administrator(
    args: &[String],
    direct: impl FnOnce() -> Result<(), String>,
) -> Result<(), String> {
    if platform::is_elevated() {
        return direct();
    }
    let result_file =
        std::env::temp_dir().join(format!("spatt-elevated-{}.txt", std::process::id()));
    let _ = std::fs::remove_file(&result_file);
    let mut full: Vec<String> = args.to_vec();
    full.push("--result-file".to_owned());
    full.push(result_file.display().to_string());
    let code = platform::run_elevated(&current_exe()?, &full)?;
    let message = std::fs::read_to_string(&result_file).unwrap_or_default();
    let _ = std::fs::remove_file(&result_file);
    match (code, message.trim()) {
        (0, "") => Ok(()),
        (_, "") => Err(format!(
            "The administrator step did not finish (exit code {code})"
        )),
        (_, message) => Err(message.to_owned()),
    }
}

/// Installs a background mode, removing the other one first (only one runs at a time).
pub fn install(
    installer: &impl BackgroundInstaller,
    mode: Mode,
    copy_library_from: Option<&Path>,
) -> Result<(), String> {
    let exe = current_exe()?;
    match mode {
        Mode::Login => {
            if installer.status().service != ServiceState::NotInstalled {
                uninstall(installer, Mode::Service, false)?;
            }
            installer.install_login(&exe)?;
            let settings = default_data_dir()
                .and_then(|dir| Settings::read(&dir))
                .unwrap_or_default();
            if settings.lan && installer.status().firewall_rule == Some(false) {
                firewall_rule(installer, Some(settings.port)).map_err(|error| format!("Start at login is installed, but the firewall rule for other devices was not added: {error}"))?;
            }
            Ok(())
        }
        Mode::Service => {
            installer.uninstall_login()?;
            let mut args = vec!["--elevated-install-service".to_owned()];
            if let Some(from) = copy_library_from {
                args.push("--copy-library-from".to_owned());
                args.push(from.display().to_string());
            }
            as_administrator(&args, || {
                elevated_install_service(installer, copy_library_from)
            })?;
            installer.install_tray(&exe)
        }
    }
}

pub fn uninstall(
    installer: &impl BackgroundInstaller,
    mode: Mode,
    delete_data: bool,
) -> Result<(), String> {
    match mode {
        Mode::Login => {
            installer.uninstall_login()?;
            if installer.status().service == ServiceState::NotInstalled
                && installer.status().firewall_rule == Some(true)
            {
                firewall_rule(installer, None)?;
            }
            Ok(())
        }
        Mode::Service => {
            installer.uninstall_tray()?;
            if installer.status().service == ServiceState::NotInstalled && !delete_data {
                return Ok(());
            }
            let mut args = vec!["--elevated-uninstall-service".to_owned()];
            if delete_data {
                args.push("--delete-data".to_owned());
            }
            as_administrator(&args, || elevated_uninstall_service(installer, delete_data))
        }
    }
}

/// Adds (`Some(port)`) or removes the private-network firewall rule, as administrator.
pub fn firewall_rule(
    installer: &impl BackgroundInstaller,
    port: Option<u16>,
) -> Result<(), String> {
    let exe = current_exe()?;
    as_administrator(
        &[
            "--elevated-firewall-rule".to_owned(),
            port.unwrap_or(0).to_string(),
        ],
        || installer.set_firewall_rule(&exe, port),
    )
}

fn elevated_install_service(
    installer: &impl BackgroundInstaller,
    copy_from: Option<&Path>,
) -> Result<(), String> {
    let exe = current_exe()?;
    let settings = background::prepare_service(installer, copy_from)?;
    installer.set_firewall_rule(&exe, settings.lan.then_some(settings.port))?;
    installer.install_service(&exe)
}

fn elevated_uninstall_service(
    installer: &impl BackgroundInstaller,
    delete_data: bool,
) -> Result<(), String> {
    installer.uninstall_service()?;
    installer.set_firewall_rule(&current_exe()?, None)?;
    if delete_data {
        let dir = machine_data_dir();
        if dir.exists() {
            std::fs::remove_dir_all(&dir).map_err(|e| format!("{}: {e}", dir.display()))?;
        }
    }
    Ok(())
}

#[derive(Debug, Default, Clone)]
pub struct ServicePatch {
    pub port: Option<u16>,
    pub lan: Option<bool>,
    pub regenerate_token: bool,
}

impl From<&Cli> for ServicePatch {
    fn from(cli: &Cli) -> Self {
        Self {
            port: cli.port,
            lan: cli.lan,
            regenerate_token: cli.regenerate_token,
        }
    }
}

impl ServicePatch {
    fn args(&self) -> Vec<String> {
        let mut args = vec!["--elevated-configure-service".to_owned()];
        if let Some(port) = self.port {
            args.extend(["--port".to_owned(), port.to_string()]);
        }
        if let Some(lan) = self.lan {
            args.extend(["--lan".to_owned(), lan.to_string()]);
        }
        if self.regenerate_token {
            args.push("--regenerate-token".to_owned());
        }
        args
    }
}

pub fn configure_service(
    installer: &impl BackgroundInstaller,
    patch: &ServicePatch,
) -> Result<(), String> {
    as_administrator(&patch.args(), || {
        elevated_configure_service(installer, patch)
    })
}

fn elevated_configure_service(
    installer: &impl BackgroundInstaller,
    patch: &ServicePatch,
) -> Result<(), String> {
    let dir = machine_data_dir();
    let mut settings = Settings::read_or_create(&dir)?;
    if let Some(port) = patch.port {
        if port < 1024 {
            return Err("Choose a port from 1024 to 65535".to_owned());
        }
        settings.port = port;
    }
    if let Some(lan) = patch.lan {
        settings.lan = lan;
    }
    if patch.regenerate_token {
        settings.token = spatt_server::auth::generate_token();
    }
    settings.write(&dir)?;
    installer.set_firewall_rule(&current_exe()?, settings.lan.then_some(settings.port))?;
    if installer.status().service != ServiceState::NotInstalled {
        installer.restart_service()?;
    }
    Ok(())
}

//! Windows: the service control manager, the per-user Run key, Windows Defender Firewall and UAC.

use std::ffi::{OsStr, OsString};
use std::os::windows::ffi::OsStrExt;
use std::path::Path;
use std::process::Command;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use windows_service::service::{
    ServiceAccess, ServiceAction, ServiceActionType, ServiceControl, ServiceControlAccept,
    ServiceErrorControl, ServiceExitCode, ServiceFailureActions, ServiceFailureResetPeriod,
    ServiceInfo, ServiceStartType, ServiceState as WinServiceState, ServiceStatus, ServiceType,
};
use windows_service::service_control_handler::{self, ServiceControlHandlerResult};
use windows_service::service_dispatcher;
use windows_service::service_manager::{ServiceManager, ServiceManagerAccess};
use winreg::enums::{HKEY_CURRENT_USER, KEY_READ, KEY_SET_VALUE};
use winreg::RegKey;

use crate::background::{BackgroundInstaller, BackgroundStatus, ServiceState};

pub const SERVICE_NAME: &str = "SPATT";
const SERVICE_DISPLAY_NAME: &str = "SPATT Server";
const SERVICE_DESCRIPTION: &str = "Serves SPATT (Signal Programming and Timing Tool) projects to browsers on this computer and, when enabled, the local network.";
/// The LocalService account: a low-privilege built-in account (SID S-1-5-19).
const SERVICE_ACCOUNT: &str = r"NT AUTHORITY\LocalService";
const LOCAL_SERVICE_SID: &str = "*S-1-5-19";
const RUN_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";
const RUN_HEADLESS: &str = "SPATT";
const RUN_TRAY: &str = "SPATT Tray";
const FIREWALL_RULE: &str = "SPATT Server";
const ERROR_SERVICE_DOES_NOT_EXIST: i32 = 1060;
const ERROR_FAILED_SERVICE_CONTROLLER_CONNECT: i32 = 1063;
const ERROR_CANCELLED: u32 = 1223;
/// Keeps console windows from flashing up for the helper tools (CREATE_NO_WINDOW).
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

pub fn os_label() -> &'static str {
    "Windows"
}

/// Lets a command-line action print to the terminal it was started from. Release builds are GUI
/// programs without a console of their own.
pub fn attach_console() {
    // SAFETY: plain Win32 call; failure (no parent console) is harmless.
    unsafe {
        windows_sys::Win32::System::Console::AttachConsole(
            windows_sys::Win32::System::Console::ATTACH_PARENT_PROCESS,
        );
    }
}

pub fn is_elevated() -> bool {
    // SAFETY: plain Win32 call without arguments.
    unsafe { windows_sys::Win32::UI::Shell::IsUserAnAdmin() != 0 }
}

fn wide(text: &OsStr) -> Vec<u16> {
    text.encode_wide().chain(std::iter::once(0)).collect()
}

/// Quotes one argument for a Windows command line (the rules `CommandLineToArgvW` reads).
fn quote_arg(arg: &str) -> String {
    if !arg.is_empty() && !arg.contains([' ', '\t', '"']) {
        return arg.to_owned();
    }
    let mut out = String::from('"');
    let mut backslashes = 0;
    for c in arg.chars() {
        match c {
            '\\' => backslashes += 1,
            '"' => {
                out.push_str(&"\\".repeat(backslashes * 2 + 1));
                out.push('"');
                backslashes = 0;
            }
            _ => {
                out.push_str(&"\\".repeat(backslashes));
                out.push(c);
                backslashes = 0;
            }
        }
    }
    out.push_str(&"\\".repeat(backslashes * 2));
    out.push('"');
    out
}

/// Runs `exe args` as administrator (the UAC prompt) and waits for it, returning its exit code.
pub fn run_elevated(exe: &Path, args: &[String]) -> Result<i32, String> {
    use windows_sys::Win32::Foundation::{CloseHandle, GetLastError};
    use windows_sys::Win32::System::Threading::{
        GetExitCodeProcess, WaitForSingleObject, INFINITE,
    };
    use windows_sys::Win32::UI::Shell::{
        ShellExecuteExW, SEE_MASK_NOCLOSEPROCESS, SHELLEXECUTEINFOW,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::SW_HIDE;

    let verb = wide(OsStr::new("runas"));
    let file = wide(exe.as_os_str());
    let parameters = wide(OsStr::new(
        &args
            .iter()
            .map(|a| quote_arg(a))
            .collect::<Vec<_>>()
            .join(" "),
    ));
    // SAFETY: the structure is zeroed and sized, the strings outlive the call, and the process
    // handle is closed below.
    unsafe {
        let mut info: SHELLEXECUTEINFOW = std::mem::zeroed();
        info.cbSize = u32::try_from(std::mem::size_of::<SHELLEXECUTEINFOW>()).unwrap_or(0);
        info.fMask = SEE_MASK_NOCLOSEPROCESS;
        info.lpVerb = verb.as_ptr();
        info.lpFile = file.as_ptr();
        info.lpParameters = parameters.as_ptr();
        info.nShow = SW_HIDE;
        if ShellExecuteExW(&mut info) == 0 {
            let error = GetLastError();
            return Err(if error == ERROR_CANCELLED {
                "Administrator permission was not given".to_owned()
            } else {
                format!("Could not ask for administrator permission (error {error})")
            });
        }
        if info.hProcess.is_null() {
            return Ok(0);
        }
        WaitForSingleObject(info.hProcess, INFINITE);
        let mut code = 1u32;
        GetExitCodeProcess(info.hProcess, &mut code);
        CloseHandle(info.hProcess);
        Ok(i32::try_from(code).unwrap_or(1))
    }
}

// ---- The service itself ----

windows_service::define_windows_service!(ffi_service_main, service_main);

/// `spatt --service`: under the service control manager, report to it and serve until stopped.
/// Started by hand from a terminal instead, it serves in the foreground until Ctrl+C.
pub fn run_service() -> Result<(), String> {
    match service_dispatcher::start(SERVICE_NAME, ffi_service_main) {
        Ok(()) => Ok(()),
        Err(windows_service::Error::Winapi(error))
            if error.raw_os_error() == Some(ERROR_FAILED_SERVICE_CONTROLLER_CONNECT) =>
        {
            attach_console();
            let runtime = tokio::runtime::Runtime::new().map_err(|e| e.to_string())?;
            runtime.block_on(crate::service::serve_machine_library(async {
                let _ = tokio::signal::ctrl_c().await;
            }))
        }
        Err(error) => Err(error.to_string()),
    }
}

fn service_main(_arguments: Vec<OsString>) {
    let _ = run_under_scm();
}

fn run_under_scm() -> windows_service::Result<()> {
    let (stop, stopped) = tokio::sync::oneshot::channel::<()>();
    let stop = Mutex::new(Some(stop));
    let handler = move |control| match control {
        ServiceControl::Stop | ServiceControl::Shutdown => {
            if let Some(stop) = stop.lock().ok().and_then(|mut s| s.take()) {
                let _ = stop.send(());
            }
            ServiceControlHandlerResult::NoError
        }
        ServiceControl::Interrogate => ServiceControlHandlerResult::NoError,
        _ => ServiceControlHandlerResult::NotImplemented,
    };
    let handle = service_control_handler::register(SERVICE_NAME, handler)?;
    let status = |state, accepted, code| ServiceStatus {
        service_type: ServiceType::OWN_PROCESS,
        current_state: state,
        controls_accepted: accepted,
        exit_code: ServiceExitCode::ServiceSpecific(code),
        checkpoint: 0,
        wait_hint: Duration::from_secs(10),
        process_id: None,
    };
    handle.set_service_status(status(
        WinServiceState::Running,
        ServiceControlAccept::STOP | ServiceControlAccept::SHUTDOWN,
        0,
    ))?;
    let result = tokio::runtime::Runtime::new()
        .map_err(|e| e.to_string())
        .and_then(|runtime| {
            runtime.block_on(crate::service::serve_machine_library(async {
                let _ = stopped.await;
            }))
        });
    handle.set_service_status(status(
        WinServiceState::Stopped,
        ServiceControlAccept::empty(),
        u32::from(result.is_err()),
    ))?;
    Ok(())
}

// ---- Installer ----

pub struct WindowsInstaller;

pub fn installer() -> WindowsInstaller {
    WindowsInstaller
}

fn service_error(error: windows_service::Error) -> String {
    match &error {
        windows_service::Error::Winapi(io) if io.raw_os_error() == Some(5) => {
            "Administrator rights are needed to change the SPATT service".to_owned()
        }
        _ => format!("Service manager: {error}"),
    }
}

fn is_missing(error: &windows_service::Error) -> bool {
    matches!(error, windows_service::Error::Winapi(io) if io.raw_os_error() == Some(ERROR_SERVICE_DOES_NOT_EXIST))
}

fn run_key(write: bool) -> Result<RegKey, String> {
    RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey_with_flags(
            RUN_KEY,
            if write {
                KEY_READ | KEY_SET_VALUE
            } else {
                KEY_READ
            },
        )
        .map_err(|e| format!("Could not open the startup programs registry key: {e}"))
}

fn has_run_value(name: &str) -> bool {
    run_key(false).is_ok_and(|key| key.get_value::<String, _>(name).is_ok())
}

fn set_run_value(name: &str, exe: &Path, arg: &str) -> Result<(), String> {
    run_key(true)?
        .set_value(
            name,
            &format!("{} {arg}", quote_arg(&exe.display().to_string())),
        )
        .map_err(|e| format!("Could not add SPATT to startup programs: {e}"))
}

fn remove_run_value(name: &str) -> Result<(), String> {
    match run_key(true)?.delete_value(name) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!(
            "Could not remove SPATT from startup programs: {error}"
        )),
    }
}

fn tool(program: &str, args: &[&str]) -> Result<std::process::Output, String> {
    use std::os::windows::process::CommandExt;
    Command::new(program)
        .args(args)
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|e| format!("Could not run {program}: {e}"))
}

fn wait_for(
    service: &windows_service::service::Service,
    state: WinServiceState,
) -> Result<(), String> {
    let deadline = Instant::now() + Duration::from_secs(20);
    loop {
        let current = service.query_status().map_err(service_error)?.current_state;
        if current == state {
            return Ok(());
        }
        if Instant::now() > deadline {
            return Err(format!(
                "The SPATT service did not reach {state:?} in time (it is {current:?})"
            ));
        }
        std::thread::sleep(Duration::from_millis(250));
    }
}

impl BackgroundInstaller for WindowsInstaller {
    fn status(&self) -> BackgroundStatus {
        let service = ServiceManager::local_computer(None::<&str>, ServiceManagerAccess::CONNECT)
            .and_then(|manager| manager.open_service(SERVICE_NAME, ServiceAccess::QUERY_STATUS))
            .and_then(|service| service.query_status());
        let service = match service {
            Ok(status) => match status.current_state {
                WinServiceState::Running => ServiceState::Running,
                WinServiceState::Stopped => ServiceState::Stopped,
                other => ServiceState::Other(format!("{other:?}")),
            },
            Err(error) if is_missing(&error) => ServiceState::NotInstalled,
            Err(error) => ServiceState::Other(error.to_string()),
        };
        let firewall_rule = tool(
            "netsh",
            &[
                "advfirewall",
                "firewall",
                "show",
                "rule",
                &format!("name={FIREWALL_RULE}"),
            ],
        )
        .is_ok_and(|out| out.status.success());
        BackgroundStatus {
            login: has_run_value(RUN_HEADLESS),
            service,
            tray: has_run_value(RUN_TRAY),
            firewall_rule: Some(firewall_rule),
            service_data_dir: spatt_server::machine_data_dir().display().to_string(),
            elevated: is_elevated(),
        }
    }

    fn install_login(&self, exe: &Path) -> Result<(), String> {
        set_run_value(RUN_HEADLESS, exe, "--headless")
    }

    fn uninstall_login(&self) -> Result<(), String> {
        remove_run_value(RUN_HEADLESS)
    }

    fn install_tray(&self, exe: &Path) -> Result<(), String> {
        set_run_value(RUN_TRAY, exe, "--tray")
    }

    fn uninstall_tray(&self) -> Result<(), String> {
        remove_run_value(RUN_TRAY)
    }

    fn install_service(&self, exe: &Path) -> Result<(), String> {
        let manager = ServiceManager::local_computer(
            None::<&str>,
            ServiceManagerAccess::CONNECT | ServiceManagerAccess::CREATE_SERVICE,
        )
        .map_err(service_error)?;
        let info = ServiceInfo {
            name: OsString::from(SERVICE_NAME),
            display_name: OsString::from(SERVICE_DISPLAY_NAME),
            service_type: ServiceType::OWN_PROCESS,
            start_type: ServiceStartType::AutoStart,
            error_control: ServiceErrorControl::Normal,
            executable_path: exe.to_path_buf(),
            launch_arguments: vec![OsString::from("--service")],
            dependencies: vec![],
            account_name: Some(OsString::from(SERVICE_ACCOUNT)),
            account_password: None,
        };
        let access =
            ServiceAccess::QUERY_STATUS | ServiceAccess::START | ServiceAccess::CHANGE_CONFIG;
        let service = match manager.open_service(SERVICE_NAME, access) {
            Ok(service) => {
                service.change_config(&info).map_err(service_error)?;
                service
            }
            Err(error) if is_missing(&error) => manager
                .create_service(&info, access)
                .map_err(service_error)?,
            Err(error) => return Err(service_error(error)),
        };
        service
            .set_description(SERVICE_DESCRIPTION)
            .map_err(service_error)?;
        service
            .update_failure_actions(ServiceFailureActions {
                reset_period: ServiceFailureResetPeriod::After(Duration::from_secs(24 * 3600)),
                reboot_msg: None,
                command: None,
                actions: Some(vec![
                    ServiceAction {
                        action_type: ServiceActionType::Restart,
                        delay: Duration::from_secs(5),
                    },
                    ServiceAction {
                        action_type: ServiceActionType::Restart,
                        delay: Duration::from_secs(30),
                    },
                    ServiceAction {
                        action_type: ServiceActionType::None,
                        delay: Duration::ZERO,
                    },
                ]),
            })
            .map_err(service_error)?;
        if service.query_status().map_err(service_error)?.current_state != WinServiceState::Running
        {
            service.start(&[] as &[&OsStr]).map_err(service_error)?;
            wait_for(&service, WinServiceState::Running)?;
        }
        Ok(())
    }

    fn uninstall_service(&self) -> Result<(), String> {
        let manager = ServiceManager::local_computer(None::<&str>, ServiceManagerAccess::CONNECT)
            .map_err(service_error)?;
        let service = match manager.open_service(
            SERVICE_NAME,
            ServiceAccess::QUERY_STATUS | ServiceAccess::STOP | ServiceAccess::DELETE,
        ) {
            Ok(service) => service,
            Err(error) if is_missing(&error) => return Ok(()),
            Err(error) => return Err(service_error(error)),
        };
        if service.query_status().map_err(service_error)?.current_state != WinServiceState::Stopped
        {
            let _ = service.stop();
            wait_for(&service, WinServiceState::Stopped)?;
        }
        service.delete().map_err(service_error)
    }

    fn restart_service(&self) -> Result<(), String> {
        let manager = ServiceManager::local_computer(None::<&str>, ServiceManagerAccess::CONNECT)
            .map_err(service_error)?;
        let service = manager
            .open_service(
                SERVICE_NAME,
                ServiceAccess::QUERY_STATUS | ServiceAccess::STOP | ServiceAccess::START,
            )
            .map_err(service_error)?;
        if service.query_status().map_err(service_error)?.current_state != WinServiceState::Stopped
        {
            let _ = service.stop();
            wait_for(&service, WinServiceState::Stopped)?;
        }
        service.start(&[] as &[&OsStr]).map_err(service_error)?;
        wait_for(&service, WinServiceState::Running)
    }

    fn set_firewall_rule(&self, exe: &Path, port: Option<u16>) -> Result<(), String> {
        // Remove any earlier rule (a different port, say) before adding the current one.
        let _ = tool(
            "netsh",
            &[
                "advfirewall",
                "firewall",
                "delete",
                "rule",
                &format!("name={FIREWALL_RULE}"),
            ],
        );
        let Some(port) = port else { return Ok(()) };
        let output = tool(
            "netsh",
            &[
                "advfirewall",
                "firewall",
                "add",
                "rule",
                &format!("name={FIREWALL_RULE}"),
                "dir=in",
                "action=allow",
                "protocol=TCP",
                &format!("localport={port}"),
                "profile=private",
                &format!("program={}", exe.display()),
                "enable=yes",
            ],
        )?;
        if output.status.success() {
            Ok(())
        } else {
            Err(format!(
                "Could not add the firewall rule: {}",
                String::from_utf8_lossy(&output.stdout).trim()
            ))
        }
    }

    fn prepare_service_data_dir(&self, dir: &Path) -> Result<(), String> {
        let path = dir.display().to_string();
        let output = tool(
            "icacls",
            &[
                &path,
                "/grant",
                &format!("{LOCAL_SERVICE_SID}:(OI)(CI)M"),
                "/T",
                "/Q",
            ],
        )?;
        if output.status.success() {
            Ok(())
        } else {
            Err(format!(
                "Could not let the service write {path}: {}",
                String::from_utf8_lossy(&output.stdout).trim()
            ))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::quote_arg;

    #[test]
    fn quotes_arguments_the_way_windows_splits_them() {
        assert_eq!(quote_arg("--service"), "--service");
        assert_eq!(
            quote_arg(r"C:\Program Files\SPATT\spatt.exe"),
            r#""C:\Program Files\SPATT\spatt.exe""#
        );
        assert_eq!(quote_arg(r"C:\Users\A B\"), r#""C:\Users\A B\\""#);
        assert_eq!(quote_arg(r#"say "hi""#), r#""say \"hi\"""#);
        assert_eq!(quote_arg(""), r#""""#);
    }
}

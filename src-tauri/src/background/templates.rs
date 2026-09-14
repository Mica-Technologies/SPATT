//! The files the Linux and macOS installers write, as plain text so they can be tested on any
//! platform. Windows registers everything through APIs instead.
#![cfg_attr(target_os = "windows", allow(dead_code))]

use std::path::Path;

pub const SYSTEMD_UNIT: &str = "spatt.service";
pub const SYSTEMD_USER: &str = "spatt";
pub const LAUNCHD_HEADLESS: &str = "com.micatechnologies.spatt.headless";
pub const LAUNCHD_TRAY: &str = "com.micatechnologies.spatt.tray";
pub const LAUNCHD_SERVICE: &str = "com.micatechnologies.spatt.server";

/// Quotes a path for a `.desktop` `Exec` line or a systemd `ExecStart`: double quotes, with `\`,
/// `"` and `$` escaped (and `%` doubled for `.desktop` files).
fn quoted(path: &Path, desktop: bool) -> String {
    let mut out = String::from('"');
    for c in path.display().to_string().chars() {
        match c {
            '\\' | '"' | '$' | '`' => {
                out.push('\\');
                out.push(c);
            }
            '%' if desktop => out.push_str("%%"),
            _ => out.push(c),
        }
    }
    out.push('"');
    out
}

fn xml_escaped(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

/// An XDG autostart entry (`~/.config/autostart/<name>.desktop`) that runs `exe <arg>` at login.
pub fn xdg_autostart(exe: &Path, arg: &str, name: &str) -> String {
    format!(
        "[Desktop Entry]\nType=Application\nName={name}\nComment=Starts SPATT in the background\nExec={} {arg}\nTerminal=false\nX-GNOME-Autostart-enabled=true\nNoDisplay=true\n",
        quoted(exe, true)
    )
}

/// The systemd system unit for the service, with its data in `/var/lib/spatt` owned by the
/// `spatt` system user.
pub fn systemd_unit(exe: &Path) -> String {
    format!(
        "[Unit]\nDescription=SPATT server\nAfter=network-online.target\nWants=network-online.target\n\n[Service]\nType=simple\nUser={SYSTEMD_USER}\nGroup={SYSTEMD_USER}\nExecStart={} --service\nRestart=on-failure\nRestartSec=5\nStateDirectory=spatt\nStateDirectoryMode=0755\nNoNewPrivileges=true\nProtectSystem=strict\nProtectHome=read-only\nPrivateTmp=true\n\n[Install]\nWantedBy=multi-user.target\n",
        quoted(exe, false)
    )
}

/// A launchd property list running `exe <arg>`: at load for agents and daemons, kept alive for the
/// service, as `user` when given (daemons).
pub fn launchd_plist(
    label: &str,
    exe: &Path,
    arg: &str,
    keep_alive: bool,
    user: Option<&str>,
) -> String {
    let user = user.map_or_else(String::new, |u| {
        format!(
            "  <key>UserName</key>\n  <string>{}</string>\n",
            xml_escaped(u)
        )
    });
    format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">\n<plist version=\"1.0\">\n<dict>\n  <key>Label</key>\n  <string>{}</string>\n  <key>ProgramArguments</key>\n  <array>\n    <string>{}</string>\n    <string>{}</string>\n  </array>\n  <key>RunAtLoad</key>\n  <true/>\n  <key>KeepAlive</key>\n  <{}/>\n{user}</dict>\n</plist>\n",
        xml_escaped(label),
        xml_escaped(&exe.display().to_string()),
        xml_escaped(arg),
        if keep_alive { "true" } else { "false" },
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn autostart_entry_quotes_the_program() {
        let text = xdg_autostart(
            &PathBuf::from("/opt/SPATT 100%/spatt"),
            "--headless",
            "SPATT",
        );
        assert!(
            text.contains("Exec=\"/opt/SPATT 100%%/spatt\" --headless\n"),
            "{text}"
        );
        assert!(text.starts_with("[Desktop Entry]\nType=Application\n"));
    }

    #[test]
    fn systemd_unit_runs_the_service_as_the_spatt_user() {
        let text = systemd_unit(&PathBuf::from("/usr/bin/spatt"));
        assert!(text.contains("ExecStart=\"/usr/bin/spatt\" --service\n"));
        assert!(text.contains("User=spatt\n"));
        assert!(text.contains("StateDirectory=spatt\n"));
        assert!(text.contains("WantedBy=multi-user.target\n"));
    }

    #[test]
    fn launchd_plist_escapes_and_sets_the_user() {
        let text = launchd_plist(
            LAUNCHD_SERVICE,
            &PathBuf::from("/Applications/S&P.app/Contents/MacOS/spatt"),
            "--service",
            true,
            Some("nobody"),
        );
        assert!(text.contains("<string>/Applications/S&amp;P.app/Contents/MacOS/spatt</string>"));
        assert!(text.contains("<key>KeepAlive</key>\n  <true/>"));
        assert!(text.contains("<key>UserName</key>\n  <string>nobody</string>"));
        let agent = launchd_plist(
            LAUNCHD_HEADLESS,
            &PathBuf::from("/x/spatt"),
            "--headless",
            false,
            None,
        );
        assert!(!agent.contains("UserName"));
    }
}

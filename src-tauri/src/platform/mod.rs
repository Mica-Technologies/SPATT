//! Platform-specific behaviour lives behind this module, one file per OS, so adding or fixing a
//! platform never means editing shared code. Background installers, tray and data paths join
//! here as they are built.

#[cfg(target_os = "linux")]
mod linux;
#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "windows")]
mod windows;

#[cfg(target_os = "linux")]
pub use linux::*;
#[cfg(target_os = "macos")]
pub use macos::*;
#[cfg(target_os = "windows")]
pub use windows::*;

#[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
pub fn os_label() -> &'static str {
    std::env::consts::OS
}

# Installation

Every release on the [GitHub releases page](https://github.com/Mica-Technologies/SPATT/releases)
carries installers for each platform, a headless server binary per platform, and
`SHA256SUMS.txt`.

Pre-releases are published automatically for every change and may be removed after 90 days. Use
a full release unless you want to try the newest work.

## Windows

| File | Notes |
|---|---|
| `SPATT-<version>-windows-x64-setup.exe` | Installs for the current user; no administrator rights needed |
| `SPATT-<version>-windows-x64.msi` | Windows Installer package, for managed or per-machine installs |

The installers are not code-signed yet, so SmartScreen shows **Windows protected your PC**.
Choose **More info → Run anyway**.

SPATT uses the Microsoft Edge WebView2 runtime, which Windows 10 and 11 already include.

## macOS

| File | Mac |
|---|---|
| `SPATT-<version>-macos-arm64.dmg` | Apple Silicon (M-series) |
| `SPATT-<version>-macos-x64.dmg` | Intel |

macOS 11 Big Sur or later. Open the disk image and drag **SPATT** to **Applications**.

Because the app is not notarized yet, macOS may say it "is damaged and can't be opened". That is
the download quarantine flag, not damage. Clear it once:

```bash
xattr -cr /Applications/SPATT.app
```

## Linux

| File | Distributions |
|---|---|
| `SPATT-<version>-linux-x86_64.deb` | Debian, Ubuntu, Linux Mint, Pop!_OS |
| `SPATT-<version>-linux-x86_64.rpm` | Fedora, RHEL, openSUSE |
| `SPATT-<version>-linux-x86_64.AppImage` | Any distribution; `chmod +x` and run |

```bash
sudo apt install ./SPATT-<version>-linux-x86_64.deb    # Debian/Ubuntu
sudo dnf install ./SPATT-<version>-linux-x86_64.rpm    # Fedora
```

The desktop app needs WebKitGTK 4.1, which the `.deb` and `.rpm` packages pull in. On a server
with no desktop, use `spatt-server` instead (below).

## Headless server only

`spatt-server-<version>-<os>-<arch>` is a single executable with the web UI built in:

```bash
chmod +x spatt-server-<version>-linux-x86_64
./spatt-server-<version>-linux-x86_64 --port 8787                  # this computer only
./spatt-server-<version>-linux-x86_64 --bind 0.0.0.0 --port 8787   # your network
```

Then open `http://<host>:8787/` in a browser.

## Verifying a download

```bash
sha256sum -c SHA256SUMS.txt --ignore-missing
```

On Windows PowerShell, compare `(Get-FileHash .\<file>).Hash` with the value in the release
description.

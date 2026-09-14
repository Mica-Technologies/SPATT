<p align="center">
  <img src="docs/assets/spatt-mark.svg" width="96" height="96" alt="SPATT">
</p>

<h1 align="center">SPATT</h1>

<p align="center">
  <strong>Signal Programming and Timing Tool</strong><br>
  NEMA ring-barrier timing plans, printable timing sheets and coordinated corridor timing.
</p>

<p align="center">
  <a href="https://github.com/Mica-Technologies/SPATT/releases"><img alt="Latest release" src="https://img.shields.io/github/v/release/Mica-Technologies/SPATT?include_prereleases&label=release"></a>
  <a href="https://github.com/Mica-Technologies/SPATT/actions/workflows/build-release-pre-release-main.yml"><img alt="Release build" src="https://github.com/Mica-Technologies/SPATT/actions/workflows/build-release-pre-release-main.yml/badge.svg"></a>
  <a href="LICENSE"><img alt="MIT License" src="https://img.shields.io/badge/license-MIT-blue"></a>
</p>

📖 **[Wiki: mica-technologies.github.io/SPATT](https://mica-technologies.github.io/SPATT/)**

SPATT builds traffic signal timing plans the way a controller is programmed: NEMA dual-ring
phases separated by barriers, per-phase timing, and coordination patterns with cycle, offset and
splits. It sits between a controller programming screen and a full signal-timing package:
general enough to model real intersections, and with a dedicated profile for the ASC-3
controller in the [City Super Mod](https://github.com/Mica-Technologies/minecraft-city-super-mod),
so plans move straight into and out of that controller.

> [!WARNING]
> **Not certified engineering software.** SPATT is a study, simulation and hobby tool. It is not
> validated or reviewed by a licensed engineer, and the timing plans it produces are not for
> deployment on public roads.

> [!NOTE]
> **Status: early development.** The desktop app, web UI, headless server and release pipeline
> are in place. The timing model, editor and diagrams are being built now; see the
> [roadmap](https://mica-technologies.github.io/SPATT/roadmap/).

## Features

Planned for the first release, and tracked on the [roadmap](https://mica-technologies.github.io/SPATT/roadmap/):

- **Intersection timing.** Up to 16 phases in up to 4 rings, editable sequences and barriers
  (lead/lag), overlaps, pedestrian intervals, recalls, and time-of-day patterns, with
  validation that catches splits that cannot fit or rings that would miss a barrier.
- **Ring-barrier diagrams** and **printable timing sheets**.
- **Clearance calculators** for yellow change, red clearance and pedestrian clearance.
- **Controller profiles** that check a plan against a real controller's limits and convert it,
  starting with CSM's ASC-3 (ticks, its offset reference, and split rounding that preserves
  barrier alignment).

Then **corridors**: time-space diagrams with progression bands, drag-to-adjust offsets and
bandwidth-based offset optimization. After that, **demand**: volumes, Webster cycle length,
volume-based splits and HCM-style delay.

## One tool, three ways to run it

| Host | What it is |
|---|---|
| **Desktop app** | Installers for Windows, macOS and Linux. Opens a small manager window that launches SPATT and controls its network server. |
| **Network server** | The same UI served over HTTP, from the desktop app or the standalone `spatt-server`, so any browser on your network can use it. Localhost only unless you opt in. |
| **Browser** | The web UI on a development server, for working on SPATT. |

Background modes (start at login, or a system service with a tray icon) are planned; see
[Desktop, Network and Headless](https://mica-technologies.github.io/SPATT/getting-started/hosts/).

## Install

Download from the [latest release](https://github.com/Mica-Technologies/SPATT/releases):

| Platform | File |
|---|---|
| Windows x64 | `SPATT-<version>-windows-x64-setup.exe` or `.msi` |
| macOS Apple Silicon | `SPATT-<version>-macos-arm64.dmg` |
| macOS Intel | `SPATT-<version>-macos-x64.dmg` |
| Linux x86_64 | `.deb`, `.rpm` or `.AppImage` |
| Headless server | `spatt-server-<version>-<os>-<arch>` |

Installers are not code-signed yet. Every release lists SHA-256, SHA-1 and MD5 hashes and
attaches `SHA256SUMS.txt`. Platform notes (SmartScreen, macOS quarantine, Linux dependencies):
[Installation](https://mica-technologies.github.io/SPATT/getting-started/installation/).

Every push to `main` publishes a pre-release; full releases are cut manually. Pre-releases are
removed after 90 days.

## Build from source

Requirements: Node.js 24, Rust stable, and the
[Tauri prerequisites](https://tauri.app/start/prerequisites/) for your OS.

```bash
npm install

npm run dev            # web UI at http://localhost:5173
npm run tauri:dev      # desktop app with hot reload
npm run check          # typecheck, lint, unit tests
npm run e2e            # end-to-end specs (Playwright, Chromium)
cargo test --workspace # Rust tests
npm run tauri:build    # installers for this OS
npm run build:linux    # Linux installers from any OS, in Docker
```

Details: [Building from Source](https://mica-technologies.github.io/SPATT/developer/building/) ·
[Architecture](https://mica-technologies.github.io/SPATT/developer/architecture/) ·
[Releases and Versioning](https://mica-technologies.github.io/SPATT/developer/releases/)

## Project layout

```
src/model, src/engine, src/profiles   timing model and math (pure TypeScript, no UI)
src/ui, src/manager, src/io           SPATT interface, manager window, host and storage
crates/spatt-server                   HTTP server with the web UI embedded; headless binary
src-tauri                             desktop app (Tauri 2)
scripts, docker                       versioning, release assets, Linux build image
docs                                  the wiki (MkDocs Material)
```

## Design

SPATT follows the [Mica Design Guidelines](https://micatechnologies.com/design): Roboto, the Mica
brand and gray ramps, and light and dark modes as equals.

## License

[MIT](LICENSE) © 2026 Mica Technologies

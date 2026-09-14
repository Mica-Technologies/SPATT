# Building from Source

## Toolchain

| Tool | Version | Notes |
|---|---|---|
| Node.js | 24 (see `.nvmrc`) | nvm / nvm-windows recommended |
| Rust | stable | via [rustup](https://rustup.rs) |
| Tauri prerequisites | — | per [tauri.app/start/prerequisites](https://tauri.app/start/prerequisites/) |
| Docker | optional | only for `npm run build:linux` |

Platform prerequisites for the desktop app:

=== "Windows"

    Visual Studio Build Tools with the **Desktop development with C++** workload (MSVC and the
    Windows SDK). WebView2 is already part of Windows 10 and 11.

=== "macOS"

    Xcode Command Line Tools: `xcode-select --install`.

=== "Linux (Debian/Ubuntu)"

    ```bash
    sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file \
      libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
    ```

## Commands

```bash
npm install                 # once

npm run dev                 # web UI in a browser at http://localhost:5173
npm run tauri:dev           # desktop app with hot reload
npm run server:dev          # spatt-server serving ./dist (run `npm run build` first)

npm run check               # typecheck + lint + unit tests
npm run e2e                 # builds dist/, then Playwright specs in e2e/ (dev server + spatt-server)
cargo test --workspace      # Rust tests
cargo clippy --workspace --all-targets -- -D warnings
cargo fmt --all

npm run build               # web UI into dist/
npm run tauri:build         # installers for the current OS into target/release/bundle/
npm run build:linux         # Linux installers + server in Docker, into release-assets/
```

## End-to-end tests

`e2e/` drives the web UI in Chromium through Playwright, in two projects:

- `chromium`, against the Vite dev server: templates, editing, problems-panel navigation, undo
  and redo, ring moves, patterns, autosave across a reload, export/import, the ring-barrier
  diagram and timing sheets.
- `server`, against a real `spatt-server` serving `dist/` (data in `target/e2e-server-data`),
  reached as `http://spatt.test` so the server treats the browser as another device: the access
  screen, and two devices sharing a project and settling conflicts.

`npm run e2e` builds `dist/` first and `cargo run`s the server, so it needs the Rust toolchain.
The first run on a machine also needs the browser: `npx playwright install chromium`. Servers
already running on the two ports are reused locally. Failures leave a trace in `test-results/`
(`npx playwright show-trace <trace.zip>`).

## Building Linux packages on Windows or macOS

`npm run build:linux` builds `docker/linux-build` (Ubuntu 22.04, the same base as the release
workflow) and runs the Linux build inside it. The repository is copied into the container rather
than built in place, so the host's `node_modules/` and `target/` are never overwritten with Linux
binaries. Cargo and npm caches persist in named Docker volumes.

macOS packages can only be built on macOS; the release workflow builds both architectures there.

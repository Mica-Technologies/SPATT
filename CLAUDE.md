# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Purpose

SPATT (Signal Programming and Timing Tool): NEMA ring-barrier traffic signal timing plans,
timing sheets, and later coordinated corridors (time-space diagrams, offset optimization) and
volume-based timing. One web UI (React + MUI) runs in three hosts: a browser, a Tauri 2 desktop
app, and `spatt-server` (axum) on the network. A profile converts plans for the ASC-3 controller
in the City Super Mod (`E:\gitRepos\minecraft-city-super-mod`). Not certified engineering software.

SPATT is a professional tool: apart from the CSM profile, no Minecraft theming or references in
the app, its docs or its assets.

## Commands

```bash
npm install
npm run dev                 # web UI, http://localhost:5173 (index.html = SPATT, manager.html = manager)
npm run tauri:dev           # desktop app
npm run check               # typecheck + oxlint + vitest
npx vitest run src/model/units.test.ts   # a single test file
npm run e2e                 # builds dist/, Playwright specs in e2e/ (Vite + cargo-run spatt-server)
cargo test --workspace
cargo test -p spatt-server health        # a single Rust test
cargo clippy --workspace --all-targets -- -D warnings
cargo fmt --all
npm run build               # dist/
npm run tauri:build         # installers for this OS (target/release/bundle)
npm run build:linux         # Linux installers + server in Docker → release-assets/
node scripts/version.mjs    # print the pre-release versions for HEAD (add --apply to stamp; don't commit that)
```

Wiki: `docs/` + `mkdocs.yml`, MkDocs Material pinned in `docs/requirements.txt`. Python is not
installed on the Windows dev machine; check a docs change with
`docker run --rm -v "<repo>:/docs" -w /docs python:3.12-slim sh -c "pip install -q -r docs/requirements.txt && mkdocs build --strict --site-dir /tmp/site"`.

## Architecture

- `src/model`, `src/engine`, `src/profiles` are **pure TypeScript**: no React, MUI, Tauri,
  `src/ui`, `src/io` or `src/manager` imports. `test/boundaries.test.ts` enforces it.
- **All durations are integer tenths of a second** (`src/model/units.ts`). Never float seconds in
  the model. One tenth = 2 CSM ticks.
- `src/model/schema.ts` is the project file format (Zod, shape only); `validate.ts` holds the
  semantic rules, which return `Issue`s with stable codes and paths and never throw. Every rule
  is listed in `docs/developer/project-format.md` and has a test in `validate.test.ts`; keep all
  three in step. Rings are `groups` per barrier: `rings[r].groups[g]` = ordered phases.
- `test/fixtures/projects/*.spatt.json` are generated from `src/model/templates.ts` and pin the
  format; after a deliberate format change run `UPDATE_FIXTURES=1 npx vitest run test/fixtures.test.ts`
  and review the diff. A `schemaVersion` bump needs a step in `migrateProject`.
- `src/io/host.ts` detects the host (`tauri` | `server` | `browser`); host-specific behaviour
  (storage, native dialogs) goes through `src/io`, nowhere else.
- UI state lives in `src/ui/state/workspace.ts` (zustand). **Every project change goes through
  `edit(label, recipe)` / `editIntersection(label, recipe)`**: it clones, the recipe mutates the
  clone, and it becomes one undo step. Autosave (`useAutosave.ts`) writes through the
  `ProjectStore` for the host (`BrowserStore` IndexedDB, `TauriStore` → Rust `projects_*`
  commands over `crates/spatt-server/src/store.rs`, `HttpStore` → the server API).
- **Every store write is versioned** (FNV-1a content hash, identical in `src/io/store.ts` and
  `store.rs`): pass the expected version, get `ConflictError` on a stale one. The workspace keeps
  `storeVersion`; a conflict pauses autosave until the user picks theirs / mine / copy. Never add
  an unconditional write path for the open project.
- Editor controls take `fieldId(path)` ids where `path` equals the validation issue path, so the
  problems panel can focus them (`src/ui/fields/paths.ts`, `src/ui/workspace/navigation.ts`).
  Dense grid inputs are in `src/ui/fields/GridInputs.tsx` (commit on blur/Enter).
- `crates/spatt-server` embeds `dist/` with rust-embed (`allow_missing`, so `cargo test` works
  without a web build). API in `api.rs` (documented in `docs/developer/server-api.md`), access in
  `auth.rs`: localhost by default with a loopback-`Host` check; a network bind requires a token
  (`check()` refuses otherwise). Keep the loopback-peer-and-host exemption intact.
- `src-tauri` runs `spatt-server` in-process (`server.rs`, settings in `<app data>/server.json`)
  over the same `FileProjectStore` clone as the `projects_*` commands, with a tray (`tray.rs`).
  Manager window = `manager.html`; `open_spatt_window` must stay `async` (sync window creation
  deadlocks on Windows). Keep `commands.rs` / `server.rs` structs in step with `src/manager/bridge.ts`.
- Check the real desktop app by attaching Playwright over CDP
  (`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222` + `connectOverCDP`), never
  by screen capture.
- OS-specific Rust goes in `src-tauri/src/platform/{windows,linux,macos}.rs` only. No hard-coded
  paths, no shell-specific scripts (Node or Rust), LF line endings.

## Design

Follow the Mica Design Guidelines (https://micatechnologies.com/design; source
`E:\gitRepos\website-micatechnologies-com\src\pages\Design.tsx`). `src/ui/theme/` is copied from
that site's `shared-theme` (commit noted in `themePrimitives.ts`); mark local changes `SPATT:`.
Roboto / Roboto Mono via @fontsource (no network fonts). Icons: `@mui/icons-material` Rounded
variants only. Use semantic palette tokens, not hard-coded colours. Light and dark both first-class.

## Releases

`.github/workflows/build-release-pre-release-main.yml`: push to `main` → pre-release; manual run
with `release` → full release. Builds Windows x64, Linux x86_64, macOS arm64 and macOS x64
(cross-compiled on the arm64 runner). Versions from `scripts/version.mjs` (tags `YYYY.MM.DD`,
semver `YYYY.M.(D*100+N)`, MSI `(YYYY-2000).M.P.B`); assets renamed by
`scripts/collect-release-assets.mjs`. Keep `docs/developer/releases.md` in step with both scripts.

## Conventions & gotchas

- TypeScript is pinned to `~6.0`: typescript-eslint and friends do not support TS 7 yet.
- Commits: never include a Claude session link or `Claude-Session:` trailer. `Co-Authored-By` is fine.
- Working plans live in `docs/agent-plans/` (gitignored, excluded from the wiki). Never commit them.
- `tauri.conf.json` `version` points at `../package.json`; the Cargo workspace version is separate.
  Both stay `0.0.0` in git and are stamped only in CI.

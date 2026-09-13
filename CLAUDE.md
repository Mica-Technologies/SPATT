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
- `src/io/host.ts` detects the host (`tauri` | `server` | `browser`); host-specific behaviour
  (storage, native dialogs) goes through `src/io`, nowhere else.
- `crates/spatt-server` embeds `dist/` with rust-embed (`allow_missing`, so `cargo test` works
  without a web build). It serves `/api/health` → `{"app":"spatt","version":…}`. Binds
  localhost by default; network exposure is always explicit.
- `src-tauri` depends on `spatt-server` and will run it in-process. Manager window = `manager.html`;
  `open_spatt_window` opens `index.html`. Keep `src-tauri/src/commands.rs` structs in step with
  `src/manager/bridge.ts`.
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

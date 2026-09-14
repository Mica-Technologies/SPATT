# Architecture

## Repository layout

```
src/
├── model/        timing plan types, schema and validation      ┐
├── engine/       timing math: cycle projection, offsets, bands  ├ pure TypeScript
├── profiles/     controller dialects (profiles/csm)             ┘
├── io/           host detection, project storage adapters
├── ui/           the SPATT interface (React + MUI, Mica theme)
└── manager/      the desktop manager window
crates/
└── spatt-server/ axum HTTP server: embedded web UI + API; also a headless binary
src-tauri/        the desktop app (Tauri 2); runs spatt-server in-process
scripts/          versioning, release asset collection, Linux Docker build
docker/           Linux build image
docs/             this wiki (MkDocs Material)
```

## Rules

**The engine has no UI.** `src/model`, `src/engine` and `src/profiles` may not import React, MUI,
Tauri, `src/ui`, `src/io` or `src/manager`. `test/boundaries.test.ts` fails the build if they do.
The math is what has to be right, and keeping it pure makes it testable and reusable from a
worker, a CLI or the server.

**Time is integer tenths of a second.** No floating-point seconds in the model. Cycle sums stay
exact, and a tenth converts exactly to controller units (for CSM, two ticks).

**One web build, three hosts.** The UI detects its host (`src/io/host.ts`): inside Tauri, behind
`spatt-server` (it answers `/api/health` with `{"app": "spatt"}`), or neither. Storage and a few
affordances depend on the host; nothing else may.

**Platform code is isolated.** OS-specific Rust lives in `src-tauri/src/platform/{windows,linux,macos}.rs`
behind shared functions and traits. Paths come from platform directory APIs, never hard-coded.
Scripts are Node or Rust, never shell-specific, so every command works on every OS.

**Diagrams draw projections, never raw splits.** `projectCycle` (`src/engine/projection.ts`)
turns a pattern into interval times; the ring-barrier diagram, the cycle clock and the timing
sheet (`src/ui/diagram`, `src/ui/sheet`) only draw what it returns. It refuses layouts it cannot
draw honestly and passes the remaining errors along, so every view agrees on what is drawable.

**Printing is the browser's.** The timing sheet is ordinary HTML with print CSS (`@page` size,
page breaks, a forced light colour scheme) and `window.print()`. That opens the print dialog in a
browser and in the Windows desktop app (WebView2); the macOS and Linux webviews are not verified
yet.

## Design

The interface follows the [Mica Design Guidelines](https://micatechnologies.com/design): the MUI
theme in `src/ui/theme/` is taken from the Mica Technologies website's shared theme, with Roboto
and Roboto Mono self-hosted so the desktop and LAN builds never need the network for fonts.

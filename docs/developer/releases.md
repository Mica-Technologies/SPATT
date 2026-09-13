# Releases and Versioning

## Pre-releases and releases

The **Build Release/Pre-Release (Main Branch)** workflow publishes:

- a **pre-release** for every push to `main`;
- a **full release** when run manually (Actions → the workflow → Run workflow) with *Create a
  full release* ticked.

Each run builds, in parallel:

| Build | Runner | Artifacts |
|---|---|---|
| Windows x64 | `windows-latest` | NSIS setup `.exe`, `.msi`, `spatt-server.exe` |
| Linux x86_64 | `ubuntu-22.04` | `.deb`, `.rpm`, `.AppImage`, `spatt-server` |
| macOS arm64 | `macos-latest` | `.dmg`, `spatt-server` |
| macOS x64 | `macos-latest`, cross-compiled | `.dmg`, `spatt-server` |

The Intel macOS build is cross-compiled on the Apple Silicon runner so it does not depend on
GitHub's Intel macOS runners, which are being retired.

The publish job hashes every artifact (SHA-256, SHA-1, MD5) into a table in the release
description, attaches `SHA256SUMS.txt`, and creates the release and its tag. The tag is created
only when every build has succeeded, so a failed run leaves no orphan tag.

**Cleanup Old/Outdated Pre-Release(s)** runs after each release build and deletes pre-releases
older than 90 days, keeping the latest 3 and any with 5 or more downloads.

## Version numbers

`scripts/version.mjs` computes every version from the UTC date, in the same scheme as Mica's
other projects.

| | Release | Pre-release |
|---|---|---|
| Git tag | `2026.09.13` (then `2026.09.13+1`, `+2` the same day) | `2026.09.13-pre.0905+b182c98` |
| App version (semver) | `2026.9.1300` | `2026.9.1301-pre.905` |
| MSI version | `26.9.1300.9999` | `26.9.1301.905` |

Why not use the tag everywhere:

- **Semver** forbids leading zeros, and has no place for a second release on the same day. The
  patch field is `day × 100 + N`, where N is that day's release number. A pre-release takes the
  number of the release it leads up to, plus `-pre.<HHMM>`, so it sorts just before it.
- **MSI** caps the major and minor fields at 255, so the year becomes `year − 2000`.

Local builds keep version `0.0.0`. To stamp a version locally:

```bash
node scripts/version.mjs --apply            # pre-release version for HEAD
node scripts/version.mjs --release --apply  # release version
```

Stamping edits `package.json`, `Cargo.toml` and `src-tauri/tauri.conf.json`; don't commit those
changes.

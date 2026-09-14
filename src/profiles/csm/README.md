# src/profiles/csm

The CSM ASC-3 controller profile: `checkCsm` (what the City Super Mod's ASC-3 controller cannot
express), `exportCsm` / `importCsm` (the `csm-asc3-plan` JSON in ticks, with CSM's own offset
reference and barrier numbering) and the format itself (`format.ts`, whose JSON Schema is pinned
at `docs/profiles/csm-asc3-plan.schema.json`). Documented in `docs/profiles/csm-asc3.md`.

Pure TypeScript, same boundary rules as `src/engine`.

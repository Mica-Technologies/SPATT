# Roadmap

SPATT is built in stages. Each stage ends with something usable.

## v1 — one intersection

- [x] Project scaffold: web UI, desktop app, headless server, Windows/macOS/Linux release
      pipeline, this wiki
- [x] Timing model: phases, rings, barriers, sequences, overlaps, pedestrian settings, patterns,
      time-of-day schedule, with validation ([file format](developer/project-format.md))
- [ ] Cycle engine: split windows, force-offs, offset references, clearance calculators
- [ ] Intersection editor
- [ ] Ring-barrier diagram and printable timing sheets
- [ ] Network server with shared project storage, manager controls, background modes
      (start at login, system service) with tray icon
- [ ] CSM ASC-3 profile, and timing-plan import/export in the City Super Mod
- [ ] Verified end to end against the controller in game

## v2 — corridors

- [ ] Corridors: intersection order, distances, speeds
- [ ] Time-space diagram with progression bands, drag-to-adjust offsets
- [ ] Offset optimization (bandwidth)
- [ ] Verified green wave in game

## v3 — demand

- [ ] Volumes and lane groups, saturation flow
- [ ] Webster cycle length and volume-based splits
- [ ] HCM-style delay, v/c and level of service

## Later

- Actuated operation simulation
- Import from other timing tools

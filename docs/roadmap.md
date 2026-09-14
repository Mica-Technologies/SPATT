# Roadmap

SPATT is built in stages. Each stage ends with something usable.

## v1 — one intersection

- [x] Project scaffold: web UI, desktop app, headless server, Windows/macOS/Linux release
      pipeline, this wiki
- [x] Timing model: phases, rings, barriers, sequences, overlaps, pedestrian settings, patterns,
      time-of-day schedule, with validation ([file format](developer/project-format.md))
- [x] Cycle engine: split windows, force-offs, offset references, clearance calculators
- [x] Intersection editor: project library, phase grid, rings and barriers, patterns with
      split balancing, schedule, clearance calculator, live ring-barrier diagram
      ([guide](getting-started/editor.md))
- [x] Ring-barrier diagram, cycle clock and printable timing sheets
- [x] Network server with a shared project library, access links, conflict handling, manager
      controls and tray icon ([sharing on your network](getting-started/hosts.md))
- [ ] Background modes: start at login, system service
- [x] CSM ASC-3 profile: capability check, plan export and import ([CSM ASC-3](profiles/csm-asc3.md))
- [ ] Timing-plan import/export on the controller in the City Super Mod
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

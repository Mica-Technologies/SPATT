# Project File Format

A SPATT project is one JSON file, `<name>.spatt.json`. The format is defined by the Zod schemas
in `src/model/schema.ts`; this page explains it. Example files for every template live in
`test/fixtures/projects/`.

## Conventions

- **Durations are integer tenths of a second.** `"yellow": 35` is 3.5 s. A decimal such as
  `3.5` is rejected, because it almost always means seconds were typed where tenths belong.
- **Phases are numbered 1–16**; overlaps are lettered `A`–`P`.
- **Unknown controller data is kept.** `extensions` objects on intersections, phases, overlaps
  and preempts hold data for a specific controller profile (for example `"csm": {...}`). SPATT
  does not interpret it but always saves it back.
- Files are written with two-space indentation and a trailing newline, so they diff cleanly in
  version control.

## Structure

```text
Project
├── app: "spatt", schemaVersion: 2, id, name, notes
├── units: { length: ft | m | block, speed: mph | km/h | block/s }
├── intersections[]
│   ├── id, name, notes
│   ├── phases[]        number, label, enabled, movement { approach, kind },
│   │                   minGreen, passage, maxGreen1, maxGreen2, yellow, redClear,
│   │                   volumeDensity { … }, recall, pedestrian { enabled, walk, clearance,
│   │                   recall, restInWalk }, lockingDetector, dualEntry, conditionalService,
│   │                   clearanceBasis? { approachSpeed, gradePercent, intersectionWidth,
│   │                   vehicleLength, crossingDistance, walkingSpeed }
│   ├── rings[]         { groups: [[phase, …], …] }   one list per barrier group
│   ├── overlaps[]      id, type, includedPhases, modifierPhases, trail timing
│   ├── preempts[]      track clearance, dwell and exit phases
│   ├── patterns[]      id, name, mode, cycle, offset, offsetReference, coordinatedPhases,
│   │                   splits { "phase": tenths }, sequence, maxGreen, forceOffMode
│   └── schedule[]      { startMinute, patternId | null }   null runs free
├── corridors[]
│   ├── id, name, outbound (direction of travel from the first stop to the last)
│   ├── stops[]         intersectionId, distance (m), speed { outbound, inbound } (m/s),
│   │                   speedLimit (m/s | null), outboundPhases, inboundPhases
│   └── plans[]         id, name, patterns { intersectionId: patternId | null },
│                       weights { outbound, inbound }
└── createdAt, updatedAt
```

### Corridors

A corridor lists its intersections in travel order. Each stop's `distance` and `speed` describe
the link from the previous stop (the first stop's are ignored). Distances are stored in metres and
speeds in metres per second whatever the project's units, which only change how they are shown;
CSM units treat one block as one metre. `outboundPhases` and `inboundPhases` are the phases that
carry through traffic in each direction.

A corridor **plan** picks the pattern each intersection runs together, so a time-space diagram or
offset optimization works on one plan and writes offsets back to those patterns.

### Rings and barriers

Each ring is a list of **barrier groups**, and each group lists that ring's phases in timing
order. The standard eight-phase intersection is:

```json
"rings": [
  { "groups": [[1, 2], [3, 4]] },
  { "groups": [[5, 6], [7, 8]] }
]
```

Every ring has the same number of groups. A ring may have an empty group: with the side street
split-phased, ring 2 has nothing to time while phases 4 and 8 run on their own.

```json
"rings": [
  { "groups": [[1, 2], [4], [8]] },
  { "groups": [[5, 6], [], []] }
]
```

A pattern's `sequence` (or `null` for the intersection's own order) may reorder phases within a
group, which is how lead-lag is expressed, but may not move a phase to another ring or group.

## Versions

`schemaVersion` is the format version. SPATT migrates older files forward when it loads them,
and refuses a file with a newer version rather than misreading it.

| Version | Change |
|---|---|
| 1 | First format; corridors were a placeholder list of intersection ids |
| 2 | Corridors gain stops (distance, speeds, through phases), an outbound direction and timing plans; CSM units. Version 1 corridors load as stops with 300 m links at 13.4 m/s and no plans |

## Validation rules

Loading checks the shape first; a shape error means the file cannot be opened. Then it runs the
rules below, which never block opening a file. **Errors** describe plans a controller would
reject or run incorrectly; **warnings** are legal but unusual.

| Code | Severity | Rule |
|---|---|---|
| `phase.duplicate-number` | error | Each phase number is defined once |
| `phase.max-below-min` | error | Max 1, and Max 2 when programmed, are at least minimum green |
| `phase.no-yellow` | error | A vehicle phase has a yellow change interval |
| `phase.yellow-range` | warning | Yellow is within 3.0–6.0 s |
| `phase.red-clear-range` | warning | Red clearance is at most 6.0 s |
| `phase.ped-incomplete` | error | Pedestrian service has walk and clearance times; a pedestrian phase has pedestrian service |
| `phase.walk-short` | warning | Walk is at least 7.0 s |
| `ring.phase-repeated` | error | A phase appears once in the ring structure |
| `ring.unknown-phase` | error | Rings only list defined phases |
| `ring.phase-unassigned` | error | Every enabled phase is in a ring |
| `barrier.no-groups` | error | The ring structure has at least one barrier group |
| `barrier.group-count-mismatch` | error | All rings have the same number of barrier groups |
| `barrier.empty-group` | error | Each barrier group has an enabled phase in some ring |
| `overlap.duplicate-id` | error | Each overlap letter is used once |
| `overlap.no-included-phases` | error | An enabled overlap has included phases |
| `overlap.unknown-phase` | error | Overlaps only refer to defined phases |
| `preempt.unknown-phase` | error | Preempts only refer to defined phases |
| `pattern.duplicate-id` | error | Each pattern id is used once |
| `pattern.sequence-membership` | error | A pattern sequence only reorders phases within their groups |
| `pattern.cycle-missing` | error | A coordinated pattern has a cycle length |
| `pattern.cycle-long` | warning | The cycle is at most 300 s |
| `pattern.offset-range` | error | The offset is less than the cycle |
| `pattern.coord-missing` | error | A coordinated pattern has a coordinated phase |
| `pattern.coord-invalid` | error | Coordinated phases are enabled phases in the ring structure |
| `pattern.coord-same-ring` | error | At most one coordinated phase per ring |
| `pattern.coord-different-barriers` | error | Coordinated phases share a barrier group |
| `pattern.split-missing` | error | Every enabled phase has a split |
| `pattern.split-for-disabled-phase` | warning | Disabled phases have no split |
| `pattern.split-below-minimum` | error | Split ≥ minimum green + yellow + red clearance |
| `pattern.split-below-pedestrian` | error with pedestrian recall, otherwise warning | Split ≥ walk + pedestrian clearance + yellow + red clearance |
| `pattern.barrier-misaligned` | error | In each barrier group, every ring with phases there has the same split total |
| `pattern.cycle-sum` | error | The barrier group totals add up to the cycle |
| `schedule.duplicate-start` | error | Schedule entries start at different times |
| `schedule.unknown-pattern` | error | Schedule entries use existing patterns |
| `project.duplicate-intersection-id` | error | Each intersection id is used once |
| `project.duplicate-corridor-id` | error | Each corridor id is used once |
| `corridor.too-few-stops` | warning | A corridor has at least two intersections |
| `corridor.unknown-intersection` | error | Corridors only list existing intersections |
| `corridor.repeated-intersection` | error | An intersection appears once in a corridor |
| `corridor.distance-missing` | error | Every link after the first stop has a distance |
| `corridor.speed-missing` | error | Every link after the first stop has a speed in both directions |
| `corridor.unknown-phase` | error | Through phases are defined at their intersection |
| `corridor.no-through-phases` | warning | Each stop has a through phase in at least one direction |
| `corridor.plan-duplicate-id` | error | Each plan id is used once in its corridor |
| `corridor.plan-unknown-pattern` | error | A plan only uses patterns its intersections have |
| `corridor.plan-missing-intersection` | warning | A plan gives every stop a pattern |
| `corridor.plan-free-pattern` | warning | A plan's patterns are coordinated |
| `corridor.plan-cycle-mismatch` | warning | A plan's patterns share one cycle length |

Split rules apply to coordinated patterns only; a free pattern's splits are not used.

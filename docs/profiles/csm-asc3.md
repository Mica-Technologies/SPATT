# CSM ASC-3

The [City Super Mod](https://github.com/Mica-Technologies/minecraft-city-super-mod) (CSM) has a
traffic signal controller whose Advanced mode is a NEMA dual-ring engine modelled on the ASC-3:
per-phase timing, actuation, overlaps, preemption and coordination with time-of-day patterns.
This profile moves SPATT timing plans into and out of that controller as a **CSM ASC-3 plan**, a
JSON file in the controller's own units.

!!! note "Controller side in progress"
    SPATT exports and imports plans today. Importing and exporting them on the controller in game
    is being added to the City Super Mod; until then the plan format below is what it will read.

## Exporting a plan

In the sidebar, open an intersection's menu and choose **Export for CSM ASC-3**. The dialog lists:

- **problems that block the export**, such as a phase numbered above 8 or a schedule entry that
  does not start on the hour, and SPATT's own validation errors;
- **differences** the controller will make, such as treating maximum recall as minimum recall.

Click an item to jump to the field. **Download** saves a `.csm.json` file; **Copy plan** puts the
plan on the clipboard for pasting into the controller.

A plan carries timing, not wiring. Anything it does not include (each phase's signal circuit,
flash settings, overlaps, preempts, pattern slots it does not use) stays as it is on the
controller, so a plan made in SPATT can be dropped onto a controller that is already wired.

## Importing a plan

**Add intersection → Import from CSM ASC-3** takes a pasted plan or a plan file and adds it as a
new intersection. Choose which point offsets should be measured to; the dialog shows what the
conversion changed before you add it. Controller settings SPATT does not model (circuits,
movements, flash, overlaps, preempts, transit priority) are kept with the intersection, which the
sidebar marks **CSM**, and are written back when you export it again.

## What the controller supports

| Feature | CSM ASC-3 | Checked on export |
|---|---|---|
| Phases | Numbered 1–8 | A higher phase number blocks export |
| Rings | Two | A third ring blocks export |
| Phase order | Any order within each ring, including lead/lag, but one order for every pattern | Patterns with different orders block export |
| Barrier groups | Any number run correctly; the controller's screen labels only A and B, and flash alternates between even and odd groups | More than two groups is a warning |
| Times | Game ticks (20 per second), up to 600 s per value | Longer values block export |
| Patterns | 4 slots | More than 4 patterns without a schedule blocks export |
| Schedule | One start hour per slot, whole hours only | More than 4 entries, or a start off the hour, blocks export |
| Recall | None, minimum, soft; maximum recall behaves like minimum recall | Maximum recall is a warning |
| Force-offs | Fixed only | Floating force-offs are a warning |
| Max green in coordination | Max 2 whenever a phase has one | A pattern set to Max 1 with Max 2 phases is a warning |
| Overlaps and preempts | Tied to signal circuits | SPATT-side overlaps and preempts are not exported (warning) |
| Clock | World time, shared by every controller in the world | |

## How a plan is converted

**Units.** One tenth of a second is exactly two ticks, so exported times are exact. An imported
odd tick count has no exact tenth: it is rounded and reported.

**Barriers.** SPATT's barrier groups become barrier numbers 0, 1, 2… in the order they run. On
import, barrier numbers become groups in running order starting from the barrier of ring 1's first
enabled phase, which is where the controller starts its cycle.

**Splits.** SPATT validation already guarantees that the rings meet at every barrier and that the
groups fill the cycle, so splits convert to ticks with no rounding.

**Offsets.** The controller measures its offset to the start of the barrier group holding ring 1's
first phase. SPATT converts each pattern's offset from its own reference. For example, the
standard eight-phase template has a 90 s cycle and an offset of 0 s to the beginning of
coordinated green, which starts 15 s into the ring sequence. Its controller offset is
0 − 15 = −15 s, which wraps to 75 s, or 1500 ticks.

**Schedule.** With a daily schedule, entry *k* in time order becomes slot *k*. A free entry
becomes a FREE slot, and unused slots start at the same hour as slot 0 so they never run. Without
a schedule, patterns 1–4 fill slots 0–3 and time-of-day selection is off, so slot 0 runs all day.
Patterns the schedule never selects are not exported (warning).

**Pedestrian service.** The controller has walk and pedestrian clearance timers on every phase and
decides from the signals wired to it whether a phase has pedestrians. SPATT exports those timers
for phases with pedestrian service. On import, a phase has pedestrian service when the plan says
its circuit has pedestrian signals, or, failing that, when both timers are set. The controller's
*Pedestrian* recall mode imports as pedestrian recall.

**Not in a plan.** A phase's approach, and SPATT's movement kind unless the plan came from a
controller (which stores its own movement). An imported phase without one is a through movement.

## Plan format

The format is `csm-asc3-plan`, version 1. The JSON Schema is
[csm-asc3-plan.schema.json](csm-asc3-plan.schema.json); example plans for every SPATT template are
in the repository under `test/fixtures/csm/`. An excerpt (one phase, part of the splits):

```json
{
  "format": "csm-asc3-plan",
  "formatVersion": 1,
  "generator": "SPATT",
  "name": "Main St & Side St",
  "phases": [
    {
      "number": 2, "enabled": true, "barrier": 0,
      "minGreen": 200, "passage": 60, "maxGreen": 800, "maxGreen2": 0,
      "yellow": 80, "redClear": 40,
      "addedInitial": 0, "maxInitial": 0, "minGap": 0, "timeBeforeReduce": 0, "timeToReduce": 0,
      "recall": "NONE", "pedRecall": false, "restInWalk": false,
      "dualEntry": false, "conditionalService": false, "lockCall": false,
      "walk": 140, "pedClear": 360, "label": "EB Thru"
    }
  ],
  "rings": [[1, 2, 3, 4], [5, 6, 7, 8]],
  "patterns": [
    { "slot": 0, "mode": "COORDINATED", "cycle": 1800, "offset": 1500,
      "coordinatedPhases": [2, 6], "splits": { "1": 300, "2": 700 }, "name": "AM Peak" }
  ],
  "schedule": { "enabled": true, "startHours": [6, 22, 6, 6] }
}
```

Every time is in ticks. Phases listed are set on the controller; a phase the controller has but
the plan does not list is disabled. Enum values are the controller's own constants:

| Field | Values |
|---|---|
| `recall` | `NONE`, `MINIMUM`, `MAXIMUM`, `PEDESTRIAN`, `SOFT` |
| `movement` | `THROUGH`, `LEFT`, `PROTECTED_LEFT`, `RIGHT`, `PED` |
| `flash` | `AUTO`, `YELLOW`, `RED`, `DARK` |
| pattern `mode` | `FREE`, `COORDINATED` |

Optional fields, which the controller keeps its own values for when a plan leaves them out:

| Where | Fields |
|---|---|
| Phase | `walk`, `pedClear`, `movement`, `circuit` (0-based, −1 none), `flash`, `delayedGreen`, `bikeMinGreen`, `permissivePhase` (flashing yellow arrow; 0 = protected only) |
| Plan | `patterns` entries (slots not listed are kept), `overlaps`, `preempts`, `priority` (carried verbatim) |

Informational fields the controller ignores: `generator`, `name`, a phase's `label`, a pattern's
`name`, and `hasPedestrianSignals`, which the controller writes on export.

## Green waves in CSM

Every controller in a world reads the same world clock, so controllers with the same cycle length
and chosen offsets progress together with no interconnect to build. That makes CSM a good place
to try SPATT's corridor offsets: build the corridor, export the offsets, and drive it.

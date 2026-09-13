# CSM ASC-3

The [City Super Mod](https://github.com/Mica-Technologies/minecraft-city-super-mod) (CSM) has a
traffic signal controller whose Advanced mode is a NEMA dual-ring engine modelled on the ASC-3:
per-phase timing, actuation, overlaps, preemption and coordination with time-of-day patterns.
This profile moves SPATT timing plans into and out of that controller.

!!! note "Planned"
    The profile and the controller's timing-plan import/export are on the
    [roadmap](../roadmap.md). This page describes how they will work.

## What the controller supports

| Feature | CSM ASC-3 |
|---|---|
| Phases | 8, in two rings: 1-2-3-4 and 5-6-7-8 |
| Barriers | Two groups: {1, 2, 5, 6} and {3, 4, 7, 8} |
| Timing resolution | Game ticks (20 per second), up to 600 s per value |
| Coordination | Cycle, offset, coordinated phases, splits |
| Patterns | 4, selected by whole-hour time-of-day starts |
| Clock | World time, shared by every controller in the world |

## How export will work

- **Units.** SPATT's tenths of a second become ticks exactly (one tenth is two ticks).
- **Splits.** Rounded so that every ring still adds up to exactly the cycle, and so that both
  rings still reach each barrier on the same tick. The controller does not check barrier
  alignment itself, so SPATT refuses to export splits that break it.
- **Offset.** The controller measures its offset to the start of each ring's first phase, not to
  the coordinated phase's green. SPATT converts from the pattern's own reference.
- **Checks.** Anything the controller cannot express (more than 8 phases, a third ring, more than
  4 patterns, a time-of-day start that is not on the hour) is reported before export.

## Green waves in CSM

Every controller in a world reads the same world clock, so controllers with the same cycle length
and chosen offsets progress together with no interconnect to build. That makes CSM a good place
to try SPATT's corridor offsets: build the corridor, export the offsets, and drive it.

# Coordination and Offsets

Coordination makes neighbouring signals run on a common rhythm, so a platoon of vehicles
released by one signal arrives at the next during its green.

## Cycle length

The **cycle** is the time for the controller to serve every phase once and return. Every signal
in a coordinated group runs the same cycle, or an exact multiple of it.

## Splits

A phase's **split** is its share of the cycle: its green plus its yellow and red clearance. In
each ring the splits add up to the cycle, and at each barrier the rings' split totals match.

## Force-offs and the coordinated phase

In coordination, each non-coordinated phase has a **force-off** point, the latest moment in the
cycle its green may end so the coordinated phase starts on time. Unused time from phases that gap
out early normally returns to the coordinated phase, which typically runs on maximum or soft
recall and holds green until its **yield point**.

## Offset

The **offset** positions each signal's cycle against a shared time reference. It is the time from
the system reference (cycle zero of the common clock) to a chosen point in the local cycle.

## Offset reference point

Controllers disagree about *which* point in the local cycle the offset locates, and the choice
changes the number:

| Reference | Also called | The offset is measured to |
|---|---|---|
| Begin of coordinated green | Lead | The start of the first coordinated phase's green |
| End of coordinated green | Lag, yield point | The start of the first coordinated phase's yellow |
| Start of the first phase | — | The start of the ring sequence (the CSM ASC-3 controller's reference) |

When the coordinated phases in the two rings start or end at different times (with a lagging
left turn, say), "first" means whichever comes first in the cycle.

Two plans with the same offset number but different references are different plans. SPATT stores
the reference with every pattern and converts between references when it exports to a
controller that uses a different one.

### A worked example

Take the standard eight-phase intersection with a 90 s cycle and ring 1 splits of 15, 35, 12 and
28 s (phases 1, 2, 3, 4), coordinated on phases 2 and 6. Phase 2's green starts 15 s into the ring
sequence and its yellow 44 s in. An offset of 30 s measured to the begin of coordinated green is
the same timing as:

| Reference | Offset |
|---|---|
| Begin of coordinated green | 30 s |
| End of coordinated green | 30 + (44 − 15) = 59 s |
| Start of the first phase | 30 − 15 = 15 s |

## Force-offs and latest start points

In local time, with local zero at the begin of coordinated green (15 s sequence time), the
example's force-offs are:

| Phase | Force-off (sequence) | Force-off (local) |
|---|---|---|
| 3 | 57 s | 42 s |
| 4 | 84 s | 69 s |
| 1 | 10 s | 85 s (it wraps past the end of the cycle) |

A phase called too late cannot fit its minimum green before its force-off. Phase 4's latest
start is 84 − 10 = 74 s sequence time for vehicles, and 84 − (7 + 14) = 63 s if it must also
serve its walk and pedestrian clearance.

## Progression and the time-space diagram

A **time-space diagram** plots distance along a corridor against time, with each signal's green
drawn as bands. A line sloped at the progression speed through consecutive greens is a vehicle
travelling without stopping; the widest such band is the **bandwidth**. Choosing offsets that
maximise bandwidth in both directions is the classic offset optimization problem, and one SPATT
will solve for corridors.

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

| Reference | The offset is measured to |
|---|---|
| Begin of coordinated green | The start of the first coordinated phase's green |
| End of coordinated green | The start of the coordinated phase's yellow |
| Yield | The yield point of the coordinated phase |
| Start of the first phase | The start of the ring sequence (the CSM ASC-3 controller's reference) |

Two plans with the same offset number but different references are different plans. SPATT stores
the reference with every pattern and converts between references when it exports to a
controller that uses a different one.

## Progression and the time-space diagram

A **time-space diagram** plots distance along a corridor against time, with each signal's green
drawn as bands. A line sloped at the progression speed through consecutive greens is a vehicle
travelling without stopping; the widest such band is the **bandwidth**. Choosing offsets that
maximise bandwidth in both directions is the classic offset optimization problem, and one SPATT
will solve for corridors.

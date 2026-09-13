# Timing Parameters

SPATT stores every duration in tenths of a second, the resolution controllers program at.

## Green intervals

Minimum green
:   The shortest green a phase shows once it starts, whatever the detection.

Passage (vehicle extension, gap)
:   Each actuation extends the green by this much. When no vehicle arrives within the passage
    time, the phase **gaps out**.

Maximum green (Max 1, Max 2)
:   The longest a phase may be extended once a conflicting call is waiting. Reaching it is a
    **max out**. Max 2 is an alternative limit selected by time of day or by coordination.

## Clearance intervals

Yellow change
:   Warns that the green is ending. A common kinematic estimate (ITE) is
    **Y = t + v / (2a + 2Gg)**, with perception-reaction time *t* (about 1 s), approach speed
    *v*, deceleration *a* (about 10 ft/s²), grade *G* (as a decimal) and gravity *g*.

Red clearance
:   All-red time after the yellow so a vehicle that entered on yellow can clear. A common estimate
    is **R = (W + L) / v**, with the width crossed *W* and vehicle length *L*.

## Pedestrian intervals

Walk
:   The WALK indication; long enough for a pedestrian to leave the curb (often 7 s).

Pedestrian clearance (flashing DON'T WALK)
:   Crossing distance divided by walking speed (3.5 ft/s is the MUTCD basis), so a pedestrian who
    starts at the end of WALK can finish crossing.

A phase that serves pedestrians needs a split at least as long as
walk + pedestrian clearance + yellow + red clearance, or the pedestrian interval cannot fit.

## Recall

A **recall** makes the controller act as if a call is always present:

| Recall | Effect |
|---|---|
| None | The phase is served only when called |
| Minimum | Placed a call; the phase times at least its minimum green |
| Maximum | The phase times to its maximum green regardless of gaps |
| Pedestrian | The walk and pedestrian clearance run every cycle |
| Soft | A call is placed only when no other phase is calling |

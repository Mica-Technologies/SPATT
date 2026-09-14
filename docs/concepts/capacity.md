# Capacity, Cycle Length and Delay

SPATT's Volumes tab estimates how well a pattern serves a traffic count. It follows a simplified
form of the signalized intersection method in the *Highway Capacity Manual 2000* (Transportation
Research Board), chapter 16. This page lists what SPATT calculates and what it leaves out.

## Lane groups and flow

A **lane group** is a set of lanes one phase serves with one saturation flow: a left-turn bay, the
through lanes, or a shared through-and-right lane. Counts are hourly volumes **V** per lane group
and movement. Dividing by the **peak hour factor** gives the peak 15-minute flow rate
**v = V / PHF**.

## Saturation flow

Saturation flow **s** is the flow a lane group would carry through an hour of continuous green:

```text
s = s₀ × N × fw × fHV × fg × fa × fLU × fLT × fRT
```

| Factor | Meaning | SPATT uses |
|---|---|---|
| s₀ | Base saturation flow | 1900 pc/h/g/ln, editable per intersection |
| N | Lanes | Per lane group |
| fw | Lane width | 1 + (W − 3.6) / 9, with W in metres |
| fHV | Heavy vehicles | 100 / (100 + %HV × (E<sub>T</sub> − 1)), E<sub>T</sub> = 2.0 |
| fg | Grade | 1 − %G / 200 |
| fa | Area type | 0.90 in a central business district, otherwise 1.00 |
| fLU | Lane utilization | Through or shared: 1.00, 0.952, 0.908 for 1, 2, 3+ lanes; exclusive left: 1.00, 0.971; exclusive right: 1.00, 0.885 |
| fLT | Left turns | Exclusive lane 0.95; shared lane 1 / (1 + 0.05 P<sub>LT</sub>) |
| fRT | Right turns | Exclusive lane 0.85; shared lane 1 − 0.15 P<sub>RT</sub> |

P<sub>LT</sub> and P<sub>RT</sub> are the shares of left and right turns in the lane group's volume.

Parking, bus blockage and pedestrian or bicycle interference are not modelled; their factors are
taken as 1. **Permitted left turns** (lefts served by a phase that is not a left-turn phase) are
not reduced for opposing traffic, so their saturation flow is optimistic. SPATT marks them in the
analysis, and you can enter a lane group's saturation flow by hand instead.

## Effective green and lost time

Each phase loses its yellow and red clearance. Start-up lost time (2 s) and the extension of
effective green into the yellow (2 s) cancel out. So a phase's **effective green** is:

```text
g = split − yellow − red clearance
```

Capacity is **c = s × g / C**, and the **volume-to-capacity ratio** is **X = v / c**.

## Critical movements and cycle length

The **flow ratio** of a lane group is **y = v / s**, and a phase takes the highest y among its
lane groups. In each barrier group, the ring with the largest sum of flow ratios is the critical
ring. **Y** is the total of those critical sums, and **L** is the lost time along the same
critical rings.

Webster's optimum cycle (F. V. Webster, *Traffic Signal Settings*, Road Research Technical Paper
39, 1958) is:

```text
C₀ = (1.5 L + 5) / (1 − Y)
```

There is no C₀ when Y ≥ 1, because demand is at or over saturation. The critical
volume-to-capacity ratio **Xc = Y × C / (C − L)** summarises the whole intersection at cycle C.

## Delay and level of service

Control delay per vehicle is uniform delay d₁ plus incremental delay d₂ (C and g in seconds):

```text
d₁ = 0.5 C (1 − g/C)² / (1 − min(1, X) × g/C)
d₂ = 900 T [ (X − 1) + √( (X − 1)² + 8 k I X / (c T) ) ]
```

The constants are T = 0.25 h (a 15-minute analysis period), k = 0.5 and I = 1. SPATT assumes random
arrivals, so the progression adjustment factor is 1 and there is no initial queue delay. The
intersection's delay is the flow-weighted average over its lane groups.

| Level of service | Control delay (s/veh) |
|---|---|
| A | ≤ 10 |
| B | > 10–20 |
| C | > 20–35 |
| D | > 35–55 |
| E | > 55–80 |
| F | > 80 |

## Suggested timing

**Suggest timing** adds a new pattern built from the selected one:

1. **Cycle.** Webster's cycle, rounded up to a whole second and kept between 40 and 180 s. It is
   raised if it cannot fit every phase's minimum split, which includes the pedestrian interval of
   any phase with pedestrian service. At or over saturation, the cycle is 180 s.
2. **Green.** The cycle less lost time is shared between barrier groups in proportion to their
   critical flow ratios. Within a group, each ring's green is shared between its phases in
   proportion to their flow ratios.
3. **Balance.** The splits are raised to their minimums and fitted to the cycle, as
   **Balance** does.

The new pattern keeps the original's coordinated phases, offset reference and sequence, and is
linked to the same count. Nothing existing changes.

!!! note "Estimates, not a design"
    These are planning-level estimates for pretimed or coordinated operation. The model does not
    cover actuated behaviour, progression, queue spillback, or the fuller HCM treatment of
    permitted turns. Check anything that matters against the current HCM and local practice.

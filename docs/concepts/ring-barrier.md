# Rings, Barriers and Phases

## Phases

A **phase** is a timing unit that controls one or more non-conflicting movements. The common
eight-phase numbering for a four-leg intersection is:

| Phase | Movement | Phase | Movement |
|---|---|---|---|
| 1 | Main street left turn | 5 | Main street left turn (opposite) |
| 2 | Main street through | 6 | Main street through (opposite) |
| 3 | Side street left turn | 7 | Side street left turn (opposite) |
| 4 | Side street through | 8 | Side street through (opposite) |

Odd phases are left turns, even phases are throughs, and each left turn is numbered so that it
conflicts with the through phase one number higher in the *other* ring. Phases 2 and 6 are
usually the main street, which is why they are the usual **coordinated phases**.

## Rings

A **ring** is a sequence of phases that conflict with each other, so only one phase in a ring
can be green at a time. A dual-ring controller runs two rings at once:

```
Ring 1:  | 1 | 2 || 3 | 4 |
Ring 2:  | 5 | 6 || 7 | 8 |
                 ^^
               barrier
```

Phases in the same column of different rings may time together: 1 with 5 or 6, 2 with 5 or 6,
and so on.

## Barriers

A **barrier** separates groups of phases that must never run at the same time, typically the
main street from the side street. Both rings must cross a barrier together: ring 1 cannot start
phase 3 while ring 2 is still in phase 6.

This gives the rule SPATT checks on every coordination pattern: **within each barrier group, the
splits of each ring must add up to the same total.** If ring 1's phases 1 and 2 total 50 s but
ring 2's phases 5 and 6 total 46 s, the rings would reach the barrier at different moments.

## Sequence: lead and lag

The order of phases inside a barrier group is the **sequence**. A left turn that runs before its
opposing through is **leading**; one that runs after is **lagging**. Swapping 1 and 2 in ring 1
gives a lead-lag arrangement:

```
Ring 1:  | 2 | 1 || 3 | 4 |
Ring 2:  | 5 | 6 || 7 | 8 |
```

Lead-lag sequencing is a common tool for widening a progression band in coordinated corridors.

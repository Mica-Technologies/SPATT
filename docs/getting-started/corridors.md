# Corridors and Green Waves

A **corridor** is an ordered row of intersections along one street. SPATT draws its time-space
diagram, measures the progression bands, and can search for the offsets that make them widest.
See [Coordination and Offsets](../concepts/coordination.md) for the ideas behind it.

## Units

Distances and speeds display in the project's units. Choose them under **Project settings** in
the workspace toolbar:

| Units | Distance | Speed |
|---|---|---|
| US customary | ft | mph |
| Metric | m | km/h |
| CSM blocks | blocks | blocks/s |

The file always stores metres and metres per second, so switching units never changes a corridor.

## Building a corridor

1. Add the intersections to the project first.
2. In the sidebar under **Corridors**, choose **Add corridor**. Name it, pick the outbound
   direction (eastbound, say), then choose which intersections it includes and in what order.
3. The **Layout** tab lists the stops in order. Each stop after the first has a link from the stop
   before it: a distance plus an outbound and an inbound progression speed.
4. Each stop has **through phases** for each direction: the phases whose green carries the
   corridor's traffic. SPATT suggests them from the phases' approaches (eastbound through for an
   eastbound corridor). Click a phase to add or remove it, or use **Suggest** to start over.

Stops can be reordered with the move buttons. An intersection can belong to more than one
corridor. Deleting an intersection removes it from its corridors.

## Timing plans

Intersections usually have several patterns (AM peak, PM peak, off peak). A corridor **timing
plan** picks one pattern at each intersection, such as "AM peak" everywhere. You can leave an
intersection out of a plan.

A plan also carries **direction weights**, which say how much each direction's band counts when
optimizing. 2 : 1 favours the outbound direction.

The **Timing plans** tab lists problems with the selected plan. The most common is intersections
running different cycles, which leaves no repeating band.

## The time-space diagram

The **Time-space diagram** tab draws the selected plan:

- Distance runs up the page, with the first stop at the bottom. Time runs across, for the number
  of cycles you choose.
- Each intersection has two bars showing when its through phases are green: outbound above the
  line, inbound below.
- The shaded bands are the vehicles that meet green at every intersection when travelling at the
  progression speeds. The band cards above the diagram show each band's width in seconds and as
  a share of the cycle.

To change an offset, type it in the table below the diagram, or drag an intersection sideways on
the diagram. A drag moves the offset in whole seconds, and the bands update as you move. Each
change is one undo step.

To change splits, hold **Alt** (Option on a Mac) and drag an intersection sideways. This moves the
end of its coordinated green in whole seconds. When the coordinated phases get longer, the time
comes from the other barrier groups: the group after the coordinated phases first, the same amount
in every ring, each ring's last phase first, and never below a phase's minimum split. When they
get shorter, the time goes to the last phase of each ring in the next group. The cycle stays the
same and coordinated green still starts at the same moment. An offset measured to the end of
coordinated green is converted to match. The label on the diagram shows the change, marked
**(limit)** when minimums stop it.

Offsets are measured to each pattern's own reference point (see
[Offset reference point](../concepts/coordination.md#offset-reference-point)). The table shows
which reference each one uses.

## Printing

With a corridor open, the print button in the header opens the **time-space sheet** preview.
Choose **This plan** or **All** plans, and **Letter**, **Legal** or **A4**. Each plan's sheet has:

- the plan's cycle, the width of each band and the direction weights;
- the time-space diagram over two cycles;
- each intersection's pattern, cycle, offset, the reference the offset is measured to, and its
  through phases;
- each link's distance, progression speeds and travel times, in the project's units.

## Optimizing offsets

**Optimize offsets…** searches in whole seconds for the offsets that give the best bands. The
first intersection keeps its offset: moving every offset by the same amount changes no band, so
the others move relative to it.

Choose an objective:

- **Widest bands, weighted**: the largest weighted sum of the two bandwidths. If two answers tie,
  the one with more even bands wins.
- **Balanced**: widen the narrower direction first, then the weighted sum.

With up to four intersections, the search tries every combination. With more, it improves one
offset at a time from the current offsets and from many random starting points, and keeps the
best result. The random starts are seeded, so the same corridor gives the same answer every time.

The dialog lists the current and proposed offsets and bandwidths side by side. **Apply offsets**
writes the proposed offsets as a single undo step.

Tick **Also try each left turn beside the coordinated phases leading and lagging** to search phase
order as well. At each intersection, a ring whose coordinated barrier group holds just a left turn
and a coordinated phase can run the left before (leading) or after (lagging) it. That is up to four
orders per intersection. The dialog shows each intersection's left turns now and as proposed.
Applying writes those phase orders to the patterns along with the offsets, in one undo step. The
search is exhaustive while there are at most 500,000 combinations; beyond that it uses starting
points. This is slower than an offset-only search.

!!! note "What the search does not change"
    Cycles and splits are left as they are, and so is phase order unless lead and lag are
    searched. If the plan's intersections run different cycles, give them a common cycle first.

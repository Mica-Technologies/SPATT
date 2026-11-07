# Importing Counts and Synchro Files

SPATT reads two kinds of files from other tools: turning-movement counts as CSV, and Synchro's
UTDF file. Both open from a file on this device (or pasted text) in every host: the desktop app,
a browser, and the network server. Each import is one step you can undo.

## Turning-movement counts

**Import CSV…** in the Counts panel of the Volumes tab, or **Import counts from CSV…** in an
intersection's menu in the sidebar, reads interval counts by approach and movement, finds the
peak hour and adds it to the intersection as a count.

### Accepted layouts

Approaches are directions of travel (`NB` is northbound traffic), unless the file names the leg
the traffic comes from (see the second layout).

=== "One column per movement"

    One row per interval, a time column and one column per movement. Headers like `NBL`, `NBT`,
    `NBR`, `NB Left`, `SB Thru`, `Eastbound Right`, `WB_RT` and `NBU` (U-turns) are recognised;
    other columns (pedestrians, bikes, totals) are ignored, and so are rows without a time
    (a totals row, say).

    ```text
    Time,NBL,NBT,NBR,SBL,SBT,SBR,EBL,EBT,EBR,WBL,WBT,WBR,Peds
    07:00,8,59,14,7,49,11,21,126,18,20,133,15,3
    07:15,10,68,16,8,56,12,24,144,20,22,152,18,3
    ```

=== "Approaches over movements"

    Two header rows: the approach in the first, spanning its movements, and `Left`, `Thru`,
    `Right` (or `L`, `T`, `R`, `U-Turn`) in the second. The approach may be a direction of travel
    (`Northbound`, `NB`) or the leg the traffic comes from (`North Approach`, `From North`, `North
    Leg`): traffic from the north leg is southbound.

    ```text
    Interval,North Approach,,,,South Approach,,,
    ,U-Turn,Left,Thru,Right,U-Turn,Left,Thru,Right
    5:00 PM - 5:15 PM,0,7,49,11,1,8,59,14
    ```

=== "One row per movement"

    One row per interval and movement, with a time column, an approach column (`Approach`,
    `Direction`), a movement column (`Movement`, `Turn`) and a count column (`Count`, `Volume`).

    ```text
    Date,Start Time,Approach,Movement,Count
    2026-10-14,16:00,NB,Left,4
    2026-10-14,16:00,NB,Through,28
    ```

Times may be `07:15`, `7:15 AM`, `0715`, `2026-10-14 07:15` or a range such as
`07:00 - 07:15`, whose start is used. Comma-, semicolon- and tab-separated files all work.

- **Intervals.** 15-minute counts are used as they are; 5-minute counts are added up into
  15-minute bins. Hourly rows are taken as hourly volumes, with no PHF (enter one). Other
  intervals are refused.
- **Several days.** A file with a `Date` column holding more than one day uses the first day.
- **U-turns** are counted as left turns.

### Peak hour and PHF

The peak hour is the busiest four consecutive 15-minute bins, over the whole count or starting in
the morning or the afternoon. Its peak hour factor is the hour's total divided by four times its
busiest 15 minutes, PHF = V / (4 × V₁₅), for the intersection as a whole. The dialog shows the
peak hour, its volume and PHF; the count's name and PHF can be changed before it is added.

### Lane groups

Each counted movement goes into a lane group, chosen like this and changeable in the dialog:

1. a lane group on a phase for that direction that carries the movement (an exclusive one first);
2. otherwise a lane group on a phase for that direction: a left without a left-turn phase goes
   into the through lanes as a permitted left, a right into the through lanes;
3. otherwise a new lane group for a phase for that direction that has none (one lane, default
   width); a template intersection with no lane groups gets one per phase this way;
4. otherwise **Not imported**.

A lane group given a movement it did not carry carries it from then on. The count includes every
lane group, and the first count of an intersection is linked to its patterns, as when a count is
added by hand.

## Synchro UTDF

**Add intersection → Import from Synchro UTDF…** reads the combined UTDF CSV file (Universal
Traffic Data Format) that Synchro exports, and adds each signalized node as an intersection. A
summary lists, for each one, what was imported, what was assumed and what was left out; untick the
intersections you do not want.

!!! warning "Tested against a hand-written sample"

    The UTDF import was written from the published layout of the format and tested against
    sample files written by hand (`test/fixtures/utdf/` in the source), not against files
    exported by Synchro. Check every imported value, and the code values below, against the
    original before you rely on it. Please report a file it reads wrongly.

### What is read

| Section | Used for |
|---|---|
| `[Network]` | `Metric`: lane widths are feet when 0, metres when 1 |
| `[Nodes]` | `INTID`, `DESCRIPTION` (the intersection's name; `Node n` when blank), `CBD` |
| `[Phases]` (or `[Phasing]`) | Per phase (`D1` … `D16`): `BRP`, `MinGreen`, `MaxGreen`, `VehExt` (passage), `TimeBeforeReduce`, `TimeToReduce`, `MinGap`, `Yellow`, `AllRed`, `Recall`, `Walk`, `DontWalk` (pedestrian clearance), `DualEntry`, and `Split` if present |
| `[Timeplans]` (or `[Timing]`) | `Control Type`, `Cycle Length`, `Referenced To`, `Reference Phase`, `Offset` |
| `[Lanes]` | Per movement (`NBL` … `WBR`): `Lanes`, `Shared`, `Width`, `Grade`, `Phase1`, `PermPhase1`, `IdealFlow`, `Volume`, `PHF`, `HeavyVehicles` |
| `[Volume]` | Movement volumes per `INTID`, when `[Lanes]` has no `Volume` record (the busiest row) |

Other sections (`[Links]`) and records (`PedCalls`, `MinSplit`, `InhibitMax`, `Start`, `End`,
`Yield`, `LocalStart`…) are not used; the summary names the records it skipped.

### How it maps

- **Phases.** One per phase column with any value. Min green, Max 1 (`MaxGreen`), passage,
  yellow, red clearance and the volume-density times are copied; Max 2 is left unset. A phase has
  pedestrian service when it has a walk or don't-walk time. Its direction and label come from
  the movements that name it in `Phase1` (protected), else `PermPhase1` (permitted): through
  before left before right.
- **Rings.** From `BRP` codes (barrier, ring, position: `112` is barrier 1, ring 1, second). Without
  them, phases 1–4 go in ring 1 and 5–8 in ring 2 with the barrier after 2 and 6, and the summary
  says so.
- **Patterns.** One per timing plan. A file can hold several plans with a `PLANID` column after
  `INTID` in `[Timeplans]`, and in `[Phases]` for values that differ by plan; rows without a plan
  id are the base values. A phase's split is `Split` if given, else `MaxGreen + Yellow + AllRed`,
  which is how Synchro writes a coordinated split. Coordinated phases come from
  `Reference Phase` (`206` is phases 2 and 6), else from C-Max/C-Min recall.
- **Lane groups.** One per approach for the through lanes (with the lefts or rights that share
  them, from `Shared`: 1 left, 2 right, 3 both), and one each for exclusive left and right lanes.
  A lane group is served by its protected phase, else its permitted phase; one whose phases are
  not in the file is left out. Protected-permitted lefts are analysed on the protected phase.
- **Count.** `Volume` becomes a count named *Synchro volumes*, linked to every pattern, with the
  volume-weighted average of the movements' PHFs. U-turn volumes count as lefts; volumes for
  movements with no lane group are left out and listed. The base saturation flow is the
  through movements' `IdealFlow`.
- **Not imported.** Overlaps, preemption, detectors, coordination modes beyond the offset, and
  the schedule (add one on the Schedule tab).

### Code values

The format stores some settings as numbers whose meaning comes from Synchro. SPATT reads them as
follows; the summary repeats any it relied on.

| Record | Values |
|---|---|
| `Control Type` | 0 pretimed (coordinated, every phase on max recall), 1 semi-actuated and 2 actuated (the pattern runs free, its cycle and splits kept), 3 actuated-coordinated |
| `Recall` | 0 none, 1 min, 2 max, 3 pedestrian, 4 C-Max and 5 C-Min (both read as coordination, vehicle recall none) |
| `Referenced To` | 0 begin of green, 1 begin of yellow (end of coordinated green), 2 begin of red (converted to the end of coordinated green), 3 TS2 first green (read as begin of green), 4 170 style (read as the end of coordinated green) |

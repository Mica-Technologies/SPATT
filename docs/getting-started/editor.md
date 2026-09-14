# Using the Editor

This page walks through timing one intersection: from an empty project to a coordinated pattern
on a daily schedule. The terms used here are defined in [Concepts](../concepts/index.md).

## Projects

![The project library](../assets/screenshots/library.png)

SPATT opens on the project library. A project holds any number of intersections (and, later,
corridors). Projects save automatically a moment after every change and again when you close
the window, so there is no Save button:

| Host | Where projects are kept |
|---|---|
| Desktop app | A `projects` folder in the app's data directory (on Windows, `%APPDATA%\com.micatechnologies.spatt\projects`) |
| Browser | This browser's storage, on this device only |
| Network server | The server's data folder, shared by every device that uses it (coming with the network server) |

**Export** (the download button in the header) writes the whole project to a `.spatt.json` file;
**Import** on the library screen reads one back as a new project, so importing the same file
twice never overwrites anything. Use export to move projects between computers or to keep a copy
in version control. The format is documented in [Project File Format](../developer/project-format.md).

## The workspace

![The Phases tab with the ring-barrier diagram docked on the right](../assets/screenshots/editor-phases.png)

- **Sidebar.** The project's intersections. **Add intersection** starts from a template: a
  standard eight-phase intersection, eight-phase with a lagging left, a split-phased side street,
  two-phase, or the CSM ASC-3 controller's defaults. Each intersection's menu renames,
  duplicates or deletes it.
- **Tabs.** Phases, Rings & Barriers, Patterns and Schedule, described below.
- **Ring-barrier diagram.** Docked on the right on wide windows (toggle it from the header). It
  shows the selected pattern's split windows per ring, the barriers, the coordinated phases and
  the offset reference, and lists force-offs and the minimum and maximum cycle.
- **Problems.** Every validation error and warning in the project. Click one to jump to the field
  it is about. A plan with errors still opens and saves, so it can be fixed.
- **Undo and redo.** Every edit is one step: the header buttons, or ++ctrl+z++ and ++ctrl+y++ when
  the cursor is not in a text field.

Values are entered in seconds and stored to the tenth. Grid fields commit when you press
++enter++ or leave the field; ++esc++ puts the old value back.

## Phases

Phases run across the grid in columns, as on a controller's phase timing screen. Rows are grouped
into phase identity (label, direction of travel, movement), vehicle timing, pedestrian timing and
volume density. A dash means the value is not used, for example walk on a phase without
pedestrian service.

**Add phase** under the grid adds the next free phase number (up to 16). The menu on a phase
column's header deletes the phase or opens the **clearance calculator**:

![The clearance calculator](../assets/screenshots/editor-clearance.png)

Enter the approach speed, grade, intersection width and crossing distance, tick the intervals to
apply, and SPATT writes the yellow change, red clearance and pedestrian clearance (rounded up to
the tenth) together with the inputs it used. The pushbutton check compares walk plus pedestrian
clearance with the time to cross from the pushbutton. The results are a starting point for
engineering judgement, not design values.

## Rings & Barriers

![The Rings & Barriers tab](../assets/screenshots/editor-rings.png)

Each row is a ring and each column a barrier group; a ring times its phases left to right. Drag a
phase to move it, or use the phase's menu (the keyboard-friendly way): **Move earlier** and
**Move later** reorder a lead/lag pair within a group, and **Move to** sends it to another ring or
group. A phase dropped on **Unassigned phases** is taken out of the rings and never runs.

A ring can be empty in a group, which is how split phasing is set up: in the screenshot's second
intersection, ring 1 times the side-street approaches one after the other while ring 2 waits at
the barrier.

Moving a phase to another ring or group, or adding or removing a ring or group, resets any
pattern's own phase order that no longer fits.

## Patterns

![The Patterns tab](../assets/screenshots/editor-patterns.png)

A pattern is one coordination plan: mode (coordinated or free), cycle, offset and its reference
point, max green selection, force-off mode, coordinated phases, splits and optionally its own
lead/lag order.

- **Offset reference.** Changing the reference converts the offset so the timing on the ground
  stays the same (untick the option to keep the number instead). The line underneath shows the
  same timing expressed against every reference.
- **Splits.** One row per ring, phases in timing order, grouped by barrier. Under each split are
  its minimums: minimum green plus clearances, and walk plus pedestrian clearance plus
  clearances. Group totals must match across rings, and the groups must add up to the cycle; the
  status line under the grid says what is left over. A ring that waits out a split-phased group
  counts that wait in its ring total.
- **Balance** raises any split below its minimum, lines the rings up at each barrier, then fits
  the groups to the cycle: spare time goes to the coordinated phases, and excess time comes off
  the coordinated phases first and then the other phases, never below a minimum.
- **Distribute evenly** replaces the splits, sharing the cycle in proportion to each phase's
  minimum green and pedestrian time.
- **Phase sequence.** Swap a lead/lag pair for this pattern only; **Use base sequence** returns to
  the order on the Rings & Barriers tab.

## Schedule

![The Schedule tab](../assets/screenshots/editor-schedule.png)

The daily schedule picks a pattern (or free operation) by time of day. Each entry runs from its
start time until the next entry starts, and the last one runs past midnight until the first.
The timeline above the list shows the whole day.

## Problems

![A split that no longer fits its minimum green, in the Problems panel](../assets/screenshots/editor-problems.png)

Validation runs after every change. Here, raising phase 4's minimum green to 24 s left its 28 s
split shorter than green plus clearances: the intersection shows the error in the sidebar, the
diagram waits for the pattern to be fixed, and clicking the problem opens the Patterns tab with
the split selected. **Balance** or a longer split clears it. Every rule and its code is listed in
[Project File Format](../developer/project-format.md).

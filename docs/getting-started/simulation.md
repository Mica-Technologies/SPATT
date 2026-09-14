# Simulation

The **Simulate** tab runs an intersection's controller against random traffic from a count. It
shows how the plan behaves when actuated: how long phases really run, how often they gap out, max
out or are forced off, and how the delay compares with the
[capacity analysis](../concepts/capacity.md), which assumes every split runs as programmed.

## Running a simulation

The simulation needs lane groups and a count, both set up on the **Volumes** tab. Then choose:

- **Pattern:** the pattern the controller runs, or **Free** to run uncoordinated on Max 1.
- **Count:** the volumes to simulate.
- **Controller:** whose controller logic to follow (see [Controllers](#controllers)).
- **Minutes**, **Warm-up** and **Seed:** how long to simulate, how much time to run first and
  leave out of the results (so the run doesn't start from empty queues), and the random seed.
  The same seed gives exactly the same run.
- **Pushbutton calls per hour** for each phase with pedestrian service. Phases on pedestrian
  recall are called every cycle regardless.

**Run** simulates in the background. An hour takes well under a second.

## What is simulated

- **Vehicles** arrive at random (a Poisson process) at the count's peak 15-minute rate, the hourly
  volume divided by the peak hour factor. They wait in a queue at the stop bar and leave at the lane
  group's saturation flow while its phase is green. Queues have no length, and vehicles don't
  block each other between lane groups.
- **Detectors** are stop-bar presence detectors. A phase's detector is occupied while its lane
  groups have a queue, and every arriving vehicle is an actuation.
- **Pedestrians** press the pushbutton at random at the rate you set.
- **Time** advances in steps of 1/20 s, the tick of the City Super Mod's controller.

**Delay** is each vehicle's time in the queue, from arrival to departure. A vehicle that arrives on
green with no queue has none. This is close to the HCM's uniform plus incremental delay, without
the time spent slowing down and speeding up. Under pretimed operation (every phase on maximum
recall), the simulated delay matches the HCM figure to within a few percent.

## Controllers

### NEMA actuated

A generic dual-ring actuated controller built from SPATT's own plan:

- **Timing a phase.** Minimum green (raised by added initial when volume density is set), extension
  by the passage time (reduced towards the minimum gap), then gap-out or max-out on Max 1 or Max 2.
  Pedestrian walk and clearance follow when called, then yellow and red clearance.
- **Choosing the next phase.** Phases without a call are skipped. Rings cross a barrier together,
  once every ring in the group is ready, to the next group with a call. A dual-entry phase times in
  a ring that has no call in that group.
- **Recalls.** Minimum recall places a constant call. Maximum recall also stops the phase gapping
  out. Soft recall calls only when nothing else is calling. Pedestrian recall calls the walk every
  time.
- **Coordination.** Coordinated phases are always called, never gap or max out, and yield at their
  scheduled end of green. Other phases are forced off at their scheduled force-off. With floating
  force-offs, they are also forced off after their own split's green. A phase only starts if its
  minimum green, and a called walk, fits before its force-off. Time a phase doesn't use goes to the
  phases after it.

Not modelled: conditional service, preemption and overlaps. The max timer runs while a conflicting
call is waiting and holds, rather than resets, if the call goes away.

### CSM ASC-3

The City Super Mod's advanced controller, following the mod's own rules. It runs on the plan SPATT
would export to the controller ([CSM ASC-3](../profiles/csm-asc3.md)), so the offset, the barrier
windows and their rounding are the controller's own. Where it differs from the NEMA controller:

- **Timing.** The controller runs every 2 ticks (0.1 s), and every interval lasts at least one run.
- **Detection and the max timer.** Detection is presence only. The max timer starts on the first
  green run that sees a conflicting call, and resets if the call goes away.
- **Recalls.** Maximum recall behaves like minimum recall. The pedestrian recall setting adds a
  walk to a phase that runs anyway, but does not call the phase; recall mode *Pedestrian* does.
- **Calls during coordination.** A non-coordinated phase's call is only accepted inside its window,
  up to its force-off point, and then latches. When a green ends, every waiting conflicting call is
  committed and will be served.
- **Coordinated phases.** They yield when their green has run to the yield point, measured from
  where the green started. A coordinated green that starts late holds for most of a cycle. It can
  yield early when a waiting phase's window is about to open.
- **Pedestrian and conditional service.** A press during walk is lost when the flashing don't walk
  starts. Conditional service has no time check.
- **Rest.** With no calls anywhere, the controller rests on the coordinated phases even when free.

!!! warning "A return to the main street before a side-street through"
    With coordination, a phase that ends before the next phase's window opens leaves its barrier
    with no accepted call, because calls only register inside windows. A typical case is a
    side-street left turn gapping out at its minimum. The controller goes back to the coordinated
    phases for their minimum green and then clears to the side street again. The background cycle
    holds, but main-street traffic gets an extra stop and the side street waits longer. The NEMA
    controller starts the next phase early instead. This follows the mod's code and is waiting to be
    confirmed in the game.

Simplifications: every phase has its own detector and pushbutton, so there are no calls from
shared circuits and no bike calls. Overlaps, flashing yellow arrows, preemption, transit priority
and time-of-day pattern changes are not simulated.

## Results

- **Mean delay** over every vehicle, beside the HCM delay for the same pattern and count.
- **Cycle:** mean, shortest and longest. When coordinated, cycles are measured between yields of
  the coordinated phases, and a second yield within half a cycle counts as the same cycle; when free,
  between returns to the first barrier group.
- **Per phase:** the share of cycles it was served in, its green time (mean, min and max), how
  each green ended (gap-out, max-out, force-off or yield), and the walks it served.
- **Per lane group:** arrivals, delay beside the HCM delay, the longest queue, and the queue at the
  end. A queue still growing at the end means demand exceeds what the phase serves.

## Playback

The playback draws each ring's phases over a three-minute window: green and yellow bars on red,
with walk and pedestrian clearance as a thin strip underneath. Drag the slider, or press play at 1,
5, 20 or 60 times real time. Under the diagram are each phase's signal and each lane group's queue
at the cursor.

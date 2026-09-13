# SPATT

**SPATT, the Signal Programming and Timing Tool**, builds traffic signal timing plans the way a
controller is programmed: NEMA dual-ring phases separated by barriers, per-phase timing, and
coordination patterns with cycle, offset and splits. It produces printable timing sheets and,
across a corridor, time-space diagrams and offsets that give a green wave.

It sits between a controller programming screen and a full signal-timing package. It is general
enough to model real intersections, and it has a dedicated profile for the ASC-3 controller in
the City Super Mod, so timing plans can be moved into and out of that controller.

!!! warning "Not certified engineering software"
    SPATT is a study, simulation and hobby tool. It is not certified, validated or reviewed by
    a licensed engineer, and the timing plans it produces are not for deployment on public
    roads.

!!! info "Early development"
    SPATT is at the beginning of its [roadmap](roadmap.md). The desktop app, the web UI and the
    release pipeline exist; the timing editor and diagrams are being built now.

## One tool, three ways to run it

| Host | What it is | Use it for |
|---|---|---|
| **Desktop app** | Windows, macOS and Linux installers with a small manager window | Everyday use on your own computer |
| **Network server** | The desktop app, or `spatt-server` on its own, serving SPATT to browsers | Using SPATT from any device on your home network |
| **Browser** | The same web UI, served by a development server | Developing SPATT |

See [Desktop, Network and Headless](getting-started/hosts.md).

## Where to start

- [Install SPATT](getting-started/installation.md)
- New to signal timing? Start with [Rings, Barriers and Phases](concepts/ring-barrier.md)
- Timing signals in the City Super Mod? Read the [CSM ASC-3 profile](profiles/csm-asc3.md)
- Building SPATT itself: [Building from Source](developer/building.md)

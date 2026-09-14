/**
 * The City Super Mod ASC-3 ("advanced" ring-barrier) controller, ported rule for rule for the
 * simulator from the mod's `RingBarrierState` (surveyed read-only at CSM commit 136abc1f6; the
 * section numbers in comments refer to that survey's specification).
 *
 * It runs on the plan SPATT would export to the controller (`exportCsm`), so offsets, windows and
 * barriers are the controller's own. Faithful quirks include: the engine runs every 2 ticks and
 * every interval lasts at least one run; presence-only detection; the max timer starts on the first
 * green run with a conflicting call and resets when the call drops; MAXIMUM recall acts as MINIMUM;
 * `pedRecall` adds a walk but places no call; calls on non-coordinated phases are accepted only
 * inside their windows and latch; waiting conflicting calls are committed when a green ends;
 * coordinated phases yield from their green start, dwell when late, and yield early for a window
 * about to open; within-barrier wrap; conditional service without a time check; rest preferring the
 * coordinated phases even when free.
 *
 * Simplifications: each phase has its own detector and pushbutton (no shared circuits, so no bike
 * calls or cross-phase pushbutton calls); overlaps, flashing yellow arrow displays, preemption, transit
 * priority and time-of-day pattern changes are not simulated; the engine runs on even ticks.
 */
import type { ControllerInputs, ControllerModel, PhaseSignal, Termination } from '../../engine';
import type { Intersection } from '../../model';
import { exportCsm } from './export';
import type { CsmPhase, CsmPlan } from './format';

type CsmInterval = 'GREEN' | 'YELLOW' | 'RED';
type PedDisplay = 'WALK' | 'FDW' | 'DONT_WALK' | 'NONE';

interface RingRuntime {
  activePhase: number;
  sequencePos: number;
  interval: CsmInterval;
  intervalStart: number;
  greenStart: number;
  lastActuation: number;
  resting: boolean;
  pedServing: boolean;
  pedStart: number;
  delayActive: boolean;
  delayStart: number;
  walkHold: number;
  queueAtStart: number;
  maxStart: number;
  dualEntry: boolean;
  condServiceUsed: boolean;
  serviceSeq: number;
  clearedAlongside: number;
  coordYieldFor: number;
}

const DEFAULT_WALK = 140;
const DEFAULT_PED_CLEAR = 200;
const PHASES = [1, 2, 3, 4, 5, 6, 7, 8] as const;
const mod = (a: number, n: number) => ((a % n) + n) % n;

function newRing(): RingRuntime {
  return {
    activePhase: 0,
    sequencePos: -1,
    interval: 'GREEN',
    intervalStart: 0,
    greenStart: 0,
    lastActuation: 0,
    resting: false,
    pedServing: false,
    pedStart: 0,
    delayActive: false,
    delayStart: 0,
    walkHold: 0,
    queueAtStart: 0,
    maxStart: -1,
    dualEntry: false,
    condServiceUsed: false,
    serviceSeq: 0,
    clearedAlongside: -1,
    coordYieldFor: 0,
  };
}

export type CsmControllerResult = { ok: true; controller: CsmController } | { ok: false; message: string };

/** The CSM controller for one pattern of an intersection (or free, with `null`), via the CSM export. */
export function csmControllerFor(intersection: Intersection, patternId: string | null): CsmControllerResult {
  const pattern = intersection.patterns.find((p) => p.id === patternId);
  const single: Intersection = { ...intersection, patterns: pattern ? [pattern] : [], schedule: [] };
  const exported = exportCsm(single);
  if (!exported.ok) {
    return { ok: false, message: `The plan cannot run on the CSM controller: ${exported.issues.filter((i) => i.severity === 'error').map((i) => i.message).join('; ')}` };
  }
  return { ok: true, controller: new CsmController(exported.plan) };
}

export class CsmController implements ControllerModel {
  readonly name = 'CSM ASC-3';
  private readonly phase = new Map<number, CsmPhase>();
  private readonly sequences: [number[], number[]];
  private readonly rings: [RingRuntime, RingRuntime] = [newRing(), newRing()];
  private currentBarrier = 0;
  private initialized = false;
  private now = 0;

  // Inputs sampled at the current engine tick.
  private vehicles = new Map<number, number>();
  private readonly pedRequests = new Set<number>();

  // Global latches (§4.1).
  private readonly lockedCalls = new Set<number>();
  private readonly windowAccepted = new Set<number>();
  private readonly servedWindow = new Map<number, number>();
  private readonly committedCalls = new Set<number>();
  private readonly softCalled = new Set<number>();
  private called = new Set<number>();
  private tickRawCalled = new Set<number>();

  // Coordination (§5).
  private readonly coordinated: boolean;
  private readonly cycle: number;
  private readonly offset: number;
  private readonly coordPhase: Set<number>;
  private readonly windowStart = new Map<number, number>();
  private readonly windowEnd = new Map<number, number>();
  /** Slot 0's coordinated phases, preferred for rest even when free (§4.5). */
  private readonly restPreference: number[];
  private localCycle = 0;
  private cycleTime = 0;

  private readonly display = new Map<number, PhaseSignal>();
  private readonly lastPed = new Map<number, PedDisplay>();
  private terminations: { phase: number; reason: Termination; tick: number }[] = [];

  constructor(plan: CsmPlan) {
    for (const p of plan.phases) this.phase.set(p.number, p);
    this.sequences = [plan.rings[0], plan.rings[1]];
    const pattern = plan.patterns.find((p) => p.slot === 0) ?? plan.patterns[0];
    this.coordinated = pattern?.mode === 'COORDINATED';
    this.cycle = Math.max(1, pattern?.cycle ?? 1800);
    this.offset = pattern?.offset ?? 0;
    this.coordPhase = new Set(this.coordinated ? (pattern?.coordinatedPhases ?? []) : []);
    this.restPreference = pattern?.coordinatedPhases ?? [2, 6];
    if (this.coordinated) this.layoutWindows(pattern!.splits);
  }

  // ---- ControllerModel ----

  signal(n: number): PhaseSignal {
    return this.display.get(n) ?? { vehicle: 'red', pedestrian: 'dont-walk' };
  }

  drainTerminations() {
    const out = this.terminations;
    this.terminations = [];
    return out;
  }

  step(inputs: ControllerInputs): void {
    for (const n of inputs.pedestrianPresses) this.pedRequests.add(n);
    // The engine runs every 2 world ticks (§1.1).
    if (inputs.tick % 2 !== 0) return;
    this.now = inputs.tick;
    this.vehicles = new Map(PHASES.map((n) => [n, inputs.queues?.get(n) ?? (inputs.presence.has(n) ? 1 : 0)]));
    this.tick();
  }

  // ---- Helpers ----

  private active(n: number): boolean {
    return this.phase.get(n)?.enabled === true;
  }

  private ringOf(n: number): number {
    if (this.sequences[0].includes(n)) return 1;
    if (this.sequences[1].includes(n)) return 2;
    return 0;
  }

  private seq(ring: number): number[] {
    return this.sequences[ring - 1]!;
  }

  private ring(ring: number): RingRuntime {
    return this.rings[ring - 1]!;
  }

  private vehicleCount(n: number): number {
    return this.phase.get(n)?.movement === 'PED' ? 0 : (this.vehicles.get(n) ?? 0);
  }

  private walk(p: CsmPhase): number {
    return p.walk ?? DEFAULT_WALK;
  }

  private pedClear(p: CsmPhase): number {
    return p.pedClear ?? DEFAULT_PED_CLEAR;
  }

  private isActiveInEitherRing(n: number): boolean {
    return this.rings[0].activePhase === n || this.rings[1].activePhase === n;
  }

  // ---- Tick (§1.3) ----

  private tick(): void {
    if (this.coordinated) {
      this.localCycle = mod(this.now - this.offset, this.cycle);
      this.cycleTime = this.now - this.offset;
    }
    this.updateLockedCalls();
    this.placeSoftRecallCalls();
    const called = new Set<number>();
    const raw = new Set<number>();
    for (const n of PHASES) {
      if (this.isCalled(n)) called.add(n);
      if (this.active(n) && ((this.coordinated && this.coordPhase.has(n)) || this.hasDemand(n))) raw.add(n);
    }
    this.called = called;
    this.tickRawCalled = raw;
    if (!this.initialized) {
      this.currentBarrier = this.firstBarrier();
      this.initialized = true;
    }
    this.advanceRing(1);
    this.advanceRing(2);
    this.fillIdleRing(1);
    this.fillIdleRing(2);
    this.fillDualEntry(1, 2);
    this.fillDualEntry(2, 1);
    this.handleBarrier();
    this.describeAll();
  }

  // ---- Demand (§3) ----

  private hasDemand(n: number): boolean {
    const p = this.phase.get(n);
    if (!p) return false;
    if (p.recall === 'MINIMUM' || p.recall === 'MAXIMUM' || p.recall === 'PEDESTRIAN') return true;
    if (p.recall === 'SOFT' && this.softCalled.has(n)) return true;
    if (p.lockCall && this.lockedCalls.has(n)) return true;
    if (this.vehicleCount(n) > 0) return true;
    return this.pedRequests.has(n);
  }

  private updateLockedCalls(): void {
    for (const n of PHASES) {
      const p = this.phase.get(n);
      if (!p || !this.active(n) || !p.lockCall) this.lockedCalls.delete(n);
      else if (this.rings.some((r) => r.activePhase === n && r.interval === 'GREEN')) this.lockedCalls.delete(n);
      else if (this.vehicleCount(n) > 0) this.lockedCalls.add(n);
    }
  }

  private placeSoftRecallCalls(): void {
    this.softCalled.clear();
    const real = new Set(PHASES.filter((m) => this.active(m) && this.hasDemand(m)));
    for (const n of PHASES) {
      const p = this.phase.get(n);
      if (!p || !this.active(n) || p.recall !== 'SOFT' || this.ringOf(n) === 0) continue;
      const blocked = PHASES.some((m) => m !== n && real.has(m) && !this.isActiveInEitherRing(m) && this.conflicts(n, this.ringOf(n), m));
      if (!blocked) this.softCalled.add(n);
    }
  }

  private isCalled(n: number): boolean {
    const p = this.phase.get(n);
    if (!p || !this.active(n)) {
      this.committedCalls.delete(n);
      return false;
    }
    if (this.coordinated && this.coordPhase.has(n)) return true;
    if (this.committedCalls.has(n)) return true;
    const demand = this.hasDemand(n);
    if (!this.coordinated) return demand;
    if (!demand) {
      this.windowAccepted.delete(n);
      return false;
    }
    if (this.acceptanceOpen(n, p.yellow + p.redClear) && this.servedWindow.get(n) !== this.windowInstance(n)) this.windowAccepted.add(n);
    return this.windowAccepted.has(n);
  }

  /** §3.7 */
  private conflicts(activeN: number, activeRing: number, n: number): boolean {
    const active = this.phase.get(activeN);
    if (!active) return true;
    const other = this.phase.get(n);
    if (!other || other.barrier !== active.barrier) return true;
    const otherRing = this.ringOf(n);
    if (otherRing === 0 || otherRing === activeRing) return true;
    return (other.permissivePhase ?? 0) === active.number || (active.permissivePhase ?? 0) === n;
  }

  private demandConflictsWith(phaseN: number, ring: number, calls: ReadonlySet<number>): boolean {
    return PHASES.some((n) => calls.has(n) && !this.isActiveInEitherRing(n) && n !== phaseN && this.conflicts(phaseN, ring, n));
  }

  private withinBarrierConflict(phaseN: number, ring: number, calls: ReadonlySet<number>): boolean {
    const barrier = this.phase.get(phaseN)?.barrier;
    return PHASES.some((n) => calls.has(n) && !this.isActiveInEitherRing(n) && n !== phaseN && this.phase.get(n)?.barrier === barrier && this.conflicts(phaseN, ring, n));
  }

  private commitConflictingCalls(phaseN: number, ring: number): void {
    for (const n of PHASES) {
      if (this.called.has(n) && !this.isActiveInEitherRing(n) && n !== phaseN && this.conflicts(phaseN, ring, n)) this.committedCalls.add(n);
    }
  }

  // ---- Coordination windows (§5.3-5.5) ----

  private layoutWindows(splits: Record<string, number>): void {
    const cycle = this.cycle;
    const activeSeq = (ring: number) => this.seq(ring).filter((n) => this.active(n));
    const share = (ring: number, n: number) => {
      const split = splits[String(n)] ?? 0;
      return split > 0 ? split : Math.max(1, Math.floor(cycle / Math.max(1, activeSeq(ring).length)));
    };
    const first = this.firstBarrier();
    const barriers = [...new Set(PHASES.filter((n) => this.active(n)).map((n) => this.phase.get(n)!.barrier))].sort((a, b) => a - b);
    const at = barriers.indexOf(first);
    const order = at < 0 ? barriers : [...barriers.slice(at), ...barriers.slice(0, at)];
    const onBarrier = (ring: number, b: number) => activeSeq(ring).filter((n) => this.phase.get(n)!.barrier === b);
    const totals = order.map((b) => [1, 2].map((ring) => onBarrier(ring, b).reduce((sum, n) => sum + share(ring, n), 0)));
    const T = totals.reduce((sum, t) => sum + Math.max(t[0]!, t[1]!), 0);
    if (T <= 0) return;
    let barrierStart = 0;
    order.forEach((b, k) => {
      const len = k === order.length - 1 ? cycle - barrierStart : Math.floor((Math.max(totals[k]![0]!, totals[k]![1]!) * cycle) / T);
      for (const ring of [1, 2]) {
        const list = onBarrier(ring, b);
        const ringTotal = totals[k]![ring - 1]!;
        let cum = barrierStart;
        list.forEach((n, i) => {
          const w = ringTotal > 0 ? Math.floor((share(ring, n) * len) / ringTotal) : Math.floor(len / list.length);
          this.windowStart.set(n, cum);
          cum += w;
          this.windowEnd.set(n, i === list.length - 1 ? barrierStart + len : cum);
        });
      }
      barrierStart += len;
    });
  }

  private windowLen(n: number): number {
    return (this.windowEnd.get(n) ?? 0) - (this.windowStart.get(n) ?? 0);
  }

  private windowPos(n: number): number {
    return mod(this.localCycle - (this.windowStart.get(n) ?? 0), this.cycle);
  }

  private windowInstance(n: number): number {
    return Math.floor((this.cycleTime - (this.windowStart.get(n) ?? 0)) / this.cycle);
  }

  private acceptanceOpen(n: number, clearance: number): boolean {
    const len = this.windowLen(n);
    if (len <= 0) return false;
    return this.windowPos(n) < Math.max(1, len - Math.max(0, clearance));
  }

  private pastYieldPoint(n: number, clearance: number): boolean {
    const len = this.windowLen(n);
    if (len <= 0) return true;
    return this.windowPos(n) >= Math.max(0, len - Math.max(0, clearance));
  }

  private coordYieldReached(n: number, clearance: number, greenElapsed: number): boolean {
    const len = this.windowLen(n);
    if (len <= 0) return false;
    const c = this.cycle;
    const yieldPos = ((this.windowStart.get(n) ?? 0) + Math.max(0, len - Math.max(0, clearance))) % c;
    const startPos = mod(this.localCycle - greenElapsed, c);
    const arcToYield = mod(yieldPos - startPos, c);
    return greenElapsed >= arcToYield;
  }

  private conflictingWindowOpening(n: number, ring: number, clearance: number): number {
    if (this.windowPos(n) < this.windowLen(n)) return 0;
    let best = 0;
    let bestArc = Number.POSITIVE_INFINITY;
    for (const m of PHASES) {
      if (!this.active(m) || this.coordPhase.has(m) || !this.tickRawCalled.has(m) || this.isActiveInEitherRing(m) || this.windowLen(m) <= 0 || !this.conflicts(n, ring, m)) continue;
      const arc = mod((this.windowStart.get(m) ?? 0) - this.localCycle, this.cycle);
      if (arc > 0 && arc <= clearance && arc < bestArc) {
        best = m;
        bestArc = arc;
      }
    }
    return best;
  }

  // ---- Ring machine (§4) ----

  private startGreen(ringNum: number, n: number): void {
    const r = this.ring(ringNum);
    const p = this.phase.get(n)!;
    this.lockedCalls.delete(n);
    this.windowAccepted.delete(n);
    this.committedCalls.delete(n);
    if (this.coordinated) this.servedWindow.set(n, this.windowInstance(n));
    const ped = p.pedRecall || p.recall === 'PEDESTRIAN' || this.pedRequests.has(n);
    const delayedGreen = p.delayedGreen ?? 0;
    Object.assign(r, {
      activePhase: n,
      serviceSeq: r.serviceSeq + 1,
      interval: 'GREEN',
      intervalStart: this.now,
      greenStart: this.now,
      lastActuation: this.now,
      resting: false,
      pedServing: ped,
      pedStart: this.now,
      delayActive: ped && delayedGreen > 0,
      delayStart: this.now,
      walkHold: ped ? Math.max(this.walk(p), delayedGreen) : this.walk(p),
      queueAtStart: this.vehicleCount(n),
      maxStart: -1,
      dualEntry: false,
      coordYieldFor: 0,
    } satisfies Partial<RingRuntime>);
  }

  private ringWorkingBarrier(ringNum: number): boolean {
    const r = this.ring(ringNum);
    if (r.activePhase !== 0) {
      const p = this.phase.get(r.activePhase);
      if (!p || p.barrier !== this.currentBarrier) return false;
      if (r.interval === 'GREEN') return true;
    }
    if (this.peekNextWithinBarrier(ringNum) !== 0) return true;
    if (this.nextBarrierWithDemand() === this.currentBarrier) {
      return this.seq(ringNum).some((n) => this.active(n) && this.phase.get(n)!.barrier === this.currentBarrier && this.called.has(n) && !this.isActiveInEitherRing(n));
    }
    return false;
  }

  private peekNextWithinBarrier(ringNum: number): number {
    const r = this.ring(ringNum);
    const seq = this.seq(ringNum);
    for (let idx = r.sequencePos + 1; idx < seq.length; idx++) {
      const n = seq[idx]!;
      if (!this.active(n)) continue;
      if (this.phase.get(n)!.barrier !== this.currentBarrier) return 0;
      if (this.called.has(n)) return n;
    }
    return 0;
  }

  private advanceRing(ringNum: number): void {
    const r = this.ring(ringNum);
    if (r.activePhase === 0) return;
    const p = this.phase.get(r.activePhase);
    if (!p) {
      r.activePhase = 0;
      return;
    }
    const n = p.number;
    const now = this.now;

    if (r.interval === 'YELLOW') {
      if (now - r.intervalStart >= p.yellow) Object.assign(r, { interval: 'RED', intervalStart: now });
      return;
    }
    if (r.interval === 'RED') {
      if (now - r.intervalStart >= p.redClear) {
        const other = this.ring(ringNum === 1 ? 2 : 1);
        r.clearedAlongside = other.activePhase !== 0 ? other.serviceSeq : -1;
        r.activePhase = 0;
        r.resting = false;
      }
      return;
    }

    // GREEN (§4.3 a-p)
    if (r.delayActive) {
      if (now - r.delayStart < (p.delayedGreen ?? 0)) {
        r.lastActuation = now;
        return;
      }
      Object.assign(r, { delayActive: false, greenStart: now, intervalStart: now, lastActuation: now });
    }
    if (this.vehicleCount(n) > 0) r.lastActuation = now;
    if (r.dualEntry && (this.vehicleCount(n) > 0 || this.pedRequests.has(n))) r.dualEntry = false;

    let conflict = this.demandConflictsWith(n, ringNum, this.called);
    if (r.dualEntry) conflict = this.withinBarrierConflict(n, ringNum, this.called) || !this.ringWorkingBarrier(ringNum === 1 ? 2 : 1);

    const isCoord = this.coordinated && this.coordPhase.has(n);
    const walkHold = r.walkHold;
    const pedClear = this.pedClear(p);
    const pedRemaining = !r.pedServing ? 0 : r.resting ? pedClear : Math.max(0, r.pedStart + walkHold + pedClear - now);
    const coordClearance = p.yellow + p.redClear + pedRemaining;

    if (isCoord && !r.dualEntry && r.coordYieldFor === 0) r.coordYieldFor = this.conflictingWindowOpening(n, ringNum, coordClearance);
    if (r.coordYieldFor !== 0 && !this.tickRawCalled.has(r.coordYieldFor)) r.coordYieldFor = 0;
    const windowOpeningFor = isCoord && !r.dualEntry ? r.coordYieldFor : 0;

    const coordYieldDue = isCoord && !r.dualEntry && ((this.coordYieldReached(n, coordClearance, now - r.greenStart) && this.demandConflictsWith(n, ringNum, this.tickRawCalled)) || windowOpeningFor !== 0);
    const coordHold = isCoord && !r.dualEntry && !coordYieldDue;

    if (r.resting && r.pedServing && p.restInWalk && (conflict || coordYieldDue)) {
      r.resting = false;
      r.pedStart = Math.max(r.pedStart, now - r.walkHold);
    }

    const greenElapsed = now - r.greenStart;
    const addedInit = p.addedInitial <= 0 || r.queueAtStart <= 0 ? 0 : p.maxInitial > 0 ? Math.min(r.queueAtStart * p.addedInitial, p.maxInitial) : r.queueAtStart * p.addedInitial;
    // Bike minimum green needs a bike call from a protected detection zone, which is not simulated.
    const effMin = Math.max(p.minGreen, addedInit);
    const effMax = this.coordinated && p.maxGreen2 > 0 ? p.maxGreen2 : p.maxGreen;
    const effPassage = effectivePassage(p.passage, p.minGap, p.timeBeforeReduce, p.timeToReduce, greenElapsed);

    const minMet = greenElapsed >= effMin;
    let pedDone = !r.pedServing || now - r.pedStart >= r.walkHold + pedClear;

    if (pedDone && !conflict && !coordYieldDue && !r.delayActive && !(r.resting && p.restInWalk) && this.pedRequests.has(n)) {
      Object.assign(r, { pedServing: true, pedStart: now, walkHold: this.walk(p) });
      pedDone = false;
    }

    if (conflict) {
      if (r.maxStart < 0) r.maxStart = now;
    } else {
      r.maxStart = -1;
    }

    const maxOut = !r.resting && !isCoord && r.maxStart >= 0 && now - r.maxStart >= effMax && pedDone;
    const gapOut = now - r.lastActuation >= effPassage;
    const forceOff = this.coordinated && !isCoord && !r.resting && !r.dualEntry && this.pastYieldPoint(n, p.yellow + p.redClear) && pedDone;
    const gapTerminate = !coordHold && minMet && pedDone && gapOut && conflict;
    const terminate = maxOut || forceOff || (coordYieldDue && pedDone) || gapTerminate;

    if (terminate && minMet) {
      this.commitConflictingCalls(n, ringNum);
      if (windowOpeningFor !== 0 && coordYieldDue) this.committedCalls.add(windowOpeningFor);
      if (forceOff) this.windowAccepted.delete(n);
      Object.assign(r, { interval: 'YELLOW', intervalStart: now, pedServing: false });
      this.terminations.push({ phase: n, reason: maxOut ? 'max-out' : forceOff ? 'force-off' : coordYieldDue ? 'yield' : 'gap-out', tick: now });
    } else if (p.restInWalk && !conflict) {
      const clearanceInProgress = r.pedServing && !pedDone && now - r.pedStart >= r.walkHold;
      if (!clearanceInProgress) Object.assign(r, { resting: true, pedServing: true });
    }
  }

  /** §4.4 */
  private fillIdleRing(ringNum: number): void {
    const r = this.ring(ringNum);
    if (r.activePhase !== 0) return;
    const seq = this.seq(ringNum);
    for (let idx = r.sequencePos + 1; idx < seq.length; idx++) {
      r.sequencePos = idx;
      const n = seq[idx]!;
      if (!this.active(n) || this.phase.get(n)!.barrier !== this.currentBarrier) continue;
      if (this.called.has(n)) {
        this.startGreen(ringNum, n);
        return;
      }
    }
    if (!r.condServiceUsed) {
      const n = seq.find((m) => this.active(m) && this.phase.get(m)!.barrier === this.currentBarrier && this.phase.get(m)!.conditionalService && this.called.has(m));
      if (n !== undefined) {
        this.startGreen(ringNum, n);
        r.condServiceUsed = true;
        return;
      }
    }
    if (this.nextBarrierWithDemand() === this.currentBarrier) {
      const idx = seq.findIndex((m) => this.active(m) && this.phase.get(m)!.barrier === this.currentBarrier && this.called.has(m) && !this.isActiveInEitherRing(m));
      if (idx >= 0) {
        this.startGreen(ringNum, seq[idx]!);
        r.sequencePos = idx;
      }
    }
  }

  /** §4.6 */
  private fillDualEntry(idleNum: number, otherNum: number): void {
    const idle = this.ring(idleNum);
    const other = this.ring(otherNum);
    if (idle.activePhase !== 0 || other.activePhase === 0 || other.dualEntry || other.serviceSeq === idle.clearedAlongside) return;
    const otherPhase = this.phase.get(other.activePhase);
    if (!otherPhase || otherPhase.barrier !== this.currentBarrier || other.interval !== 'GREEN') return;
    const seq = this.seq(idleNum);
    for (let idx = 0; idx < seq.length; idx++) {
      const n = seq[idx]!;
      const p = this.phase.get(n);
      if (!p || !this.active(n) || p.barrier !== this.currentBarrier || !p.dualEntry || this.withinBarrierConflict(n, idleNum, this.called)) continue;
      this.startGreen(idleNum, n);
      idle.dualEntry = true;
      idle.sequencePos = idx;
      return;
    }
  }

  private ringParked(ringNum: number): boolean {
    const r = this.ring(ringNum);
    if (r.activePhase !== 0) return false;
    return !this.seq(ringNum).some((n, idx) => idx > r.sequencePos && this.active(n) && this.phase.get(n)!.barrier === this.currentBarrier);
  }

  /** §4.5 */
  private handleBarrier(): void {
    if (!this.ringParked(1) || !this.ringParked(2)) return;
    const target = this.nextBarrierWithDemand();
    if (target < 0) {
      this.restInGreen();
      return;
    }
    this.currentBarrier = target;
    for (const r of this.rings) Object.assign(r, { sequencePos: -1, resting: false, condServiceUsed: false });
    this.fillIdleRing(1);
    this.fillIdleRing(2);
  }

  private nextBarrierWithDemand(): number {
    const barriers = [...new Set(PHASES.filter((n) => this.active(n)).map((n) => this.phase.get(n)!.barrier))].sort((a, b) => a - b);
    if (barriers.length === 0) return -1;
    const at = barriers.indexOf(this.currentBarrier);
    for (let k = 1; k <= barriers.length; k++) {
      const b = at < 0 ? barriers[(k - 1) % barriers.length]! : barriers[(at + k) % barriers.length]!;
      if (PHASES.some((n) => this.active(n) && this.phase.get(n)!.barrier === b && this.called.has(n))) return b;
    }
    return -1;
  }

  private firstBarrier(): number {
    const n = this.sequences[0].find((m) => this.active(m));
    return n === undefined ? 0 : this.phase.get(n)!.barrier;
  }

  private restPhaseForRing(ringNum: number, barrier: number | null): number {
    const candidates = this.seq(ringNum).filter((n) => this.active(n) && (barrier === null || this.phase.get(n)!.barrier === barrier));
    return candidates.find((n) => this.restPreference.includes(n)) ?? candidates.find((n) => this.phase.get(n)!.recall === 'SOFT') ?? candidates[0] ?? 0;
  }

  private restInGreen(): void {
    const rest1 = this.restPhaseForRing(1, null);
    const rest2 = this.restPhaseForRing(2, rest1 !== 0 ? this.phase.get(rest1)!.barrier : null);
    for (const [ringNum, n] of [
      [1, rest1],
      [2, rest2],
    ] as const) {
      const r = this.ring(ringNum);
      if (r.activePhase !== 0 || n === 0) continue;
      const p = this.phase.get(n)!;
      this.currentBarrier = p.barrier;
      this.startGreen(ringNum, n);
      r.resting = true;
      r.pedServing = p.restInWalk || r.pedServing;
      r.delayActive = false;
      r.sequencePos = this.seq(ringNum).indexOf(n);
    }
  }

  // ---- Display (§4.8) ----

  private describeAll(): void {
    this.display.clear();
    this.rings.forEach((r) => {
      if (r.activePhase === 0) return;
      const p = this.phase.get(r.activePhase)!;
      let ped: PedDisplay = 'NONE';
      if (r.pedServing && r.interval === 'GREEN') {
        if (r.resting && p.restInWalk) ped = 'WALK';
        else {
          const elapsed = this.now - r.pedStart;
          ped = elapsed < r.walkHold ? 'WALK' : elapsed < r.walkHold + this.pedClear(p) ? 'FDW' : 'DONT_WALK';
        }
      }
      const vehicle = r.delayActive ? 'RED' : r.interval;
      this.display.set(p.number, {
        vehicle: vehicle === 'GREEN' ? 'green' : vehicle === 'YELLOW' ? 'yellow' : 'red',
        pedestrian: ped === 'WALK' ? 'walk' : ped === 'FDW' ? 'clearance' : 'dont-walk',
      });
    });
    // A pushbutton request is cleared when its phase's walk or flashing don't walk comes on (§3.2).
    for (const n of PHASES) {
      const shown = this.display.get(n)?.pedestrian;
      const now: PedDisplay = shown === 'walk' ? 'WALK' : shown === 'clearance' ? 'FDW' : 'DONT_WALK';
      const before = this.lastPed.get(n) ?? 'DONT_WALK';
      if ((now === 'WALK' || now === 'FDW') && now !== before) this.pedRequests.delete(n);
      this.lastPed.set(n, now);
    }
  }
}

/** `AdvancedActuationTiming.effectivePassage`, integer arithmetic (§4.3.j). */
export function effectivePassage(passage: number, minGap: number, timeBeforeReduce: number, timeToReduce: number, greenElapsed: number): number {
  if (timeToReduce <= 0 || minGap <= 0 || minGap >= passage) return passage;
  if (greenElapsed <= timeBeforeReduce) return passage;
  const into = greenElapsed - timeBeforeReduce;
  if (into >= timeToReduce) return minGap;
  const reduced = passage - Math.trunc(((passage - minGap) * into) / timeToReduce);
  return Math.max(minGap, reduced);
}

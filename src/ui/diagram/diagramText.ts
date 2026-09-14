/** Text and scale helpers shared by the ring-barrier diagram, the cycle clock and the timing sheet. */
import { toLocal, type CycleProjection, type PhaseInterval } from '../../engine';
import { formatSeconds, type OffsetReference } from '../../model';

export const REFERENCE_LABEL: Record<OffsetReference, string> = {
  beginCoordGreen: 'begin of coordinated green',
  beginCoordYellow: 'end of coordinated green',
  firstPhaseStart: 'start of ring sequence',
};

const s = formatSeconds;
const TICK_STEPS = [50, 100, 150, 200, 300, 600, 1200];

/** Picks a tick step (tenths) giving at most one tick per ~44 units of width. */
export function tickStep(cycle: number, plotWidth: number): number {
  const maxTicks = Math.max(2, Math.floor(plotWidth / 44));
  return TICK_STEPS.find((step) => cycle / step <= maxTicks) ?? TICK_STEPS.at(-1)!;
}

export function describeInterval(projection: CycleProjection, interval: PhaseInterval, label: string | undefined): string[] {
  const local = (t: number) => s(toLocal(projection, t));
  const lines = [
    `Phase ${interval.phase}${label ? ` · ${label}` : ''}${interval.coordinated ? ' · coordinated' : ''}`,
    `Split ${s(interval.splitEnd - interval.splitStart)} s: green ${s(interval.yellowStart - interval.greenStart)}, yellow ${s(interval.redClearStart - interval.yellowStart)}, red clear ${s(interval.splitEnd - interval.redClearStart)}`,
    `Green ${local(interval.greenStart)}–${local(interval.yellowStart)} s local`,
    `${interval.coordinated ? 'Yield' : 'Force-off'} ${local(interval.forceOff)} s local`,
  ];
  if (interval.walkEnd !== null && interval.pedestrianClearanceEnd !== null) {
    lines.push(`Walk ${s(interval.walkEnd - interval.greenStart)} s, pedestrian clearance ${s(interval.pedestrianClearanceEnd - interval.walkEnd)} s`);
  }
  return lines;
}

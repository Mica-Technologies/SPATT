/**
 * The default link (distance and progression speed) in round numbers of the project's units:
 * 300 m and 13.4 m/s read as 1000 ft and 30 mph, or 300 m and 50 km/h, rather than 984.3 ft and
 * 29.98 mph. CSM block units are left exact.
 */
import { DEFAULT_LINK, fromMetres, fromMetresPerSecond, newCorridorStop, toMetres, toMetresPerSecond, type Approach, type CorridorStop, type Intersection, type Project } from '../../model';

const round = (value: number, step: number) => (Math.abs(value - Math.round(value)) < 1e-6 ? Math.round(value) : Math.round(value / step) * step);

export function defaultLink(units: Project['units']): { distance: number; speed: number } {
  if (units.length === 'block') return { distance: DEFAULT_LINK.distance, speed: DEFAULT_LINK.speed };
  return {
    distance: toMetres(round(fromMetres(DEFAULT_LINK.distance, units.length), 50), units.length),
    speed: toMetresPerSecond(round(fromMetresPerSecond(DEFAULT_LINK.speed, units.speed), 5), units.speed),
  };
}

/** A new corridor stop with the default link in round numbers of the project's units. */
export function newStop(intersection: Intersection, outbound: Approach, first: boolean, units: Project['units']): CorridorStop {
  const stop = newCorridorStop(intersection, outbound, first);
  const link = defaultLink(units);
  if (!first) stop.distance = link.distance;
  stop.speed = { outbound: link.speed, inbound: link.speed };
  return stop;
}

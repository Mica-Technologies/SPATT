/**
 * Draws a traffic frame on a 2D canvas in plan or oblique view, with the scene's projector and
 * painter's order: vehicles as rectangles in plan and small prisms in the oblique view,
 * pedestrians as dots or posts, and a count where a queue runs past the drawn leg.
 */
import { isoDepth, projectorFor, VEHICLE_LENGTH, VEHICLE_WIDTH, type SceneBounds, type ScenePoint, type ScenePoint3, type SceneView, type TrafficFrame } from '../../engine';

/** Resolved colours (CSS colour strings), read from the theme at draw time. */
export interface TrafficColors {
  body: string;
  bodyShade: string;
  bodyTop: string;
  outline: string;
  brake: string;
  pedestrian: string;
  pedestrianShade: string;
  pedestrianOutline: string;
  badge: string;
  badgeText: string;
}

const VEHICLE_HEIGHT = 1.45;
const PEDESTRIAN_HEIGHT = 1.75;
const PEDESTRIAN_SIZE = 0.6;

type Item = { depth: number; draw: () => void };

/** Footprint corners of a box centred on `c`, heading `h`: front-left, front-right, rear-right, rear-left (y south). */
function footprint(c: ScenePoint, h: number, length: number, width: number): ScenePoint[] {
  const f = { x: Math.cos(h) * (length / 2), y: Math.sin(h) * (length / 2) };
  const s = { x: -Math.sin(h) * (width / 2), y: Math.cos(h) * (width / 2) };
  return [
    { x: c.x + f.x - s.x, y: c.y + f.y - s.y },
    { x: c.x + f.x + s.x, y: c.y + f.y + s.y },
    { x: c.x - f.x + s.x, y: c.y - f.y + s.y },
    { x: c.x - f.x - s.x, y: c.y - f.y - s.y },
  ];
}

function polygon(ctx: CanvasRenderingContext2D, points: ScenePoint[]): void {
  ctx.beginPath();
  points.forEach((p, k) => (k === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.closePath();
}

/** A prism's visible faces in the oblique view: the sides facing the viewer (toward +x +y), then the top. */
function prism(ctx: CanvasRenderingContext2D, base: ScenePoint[], height: number, side: string, top: string, outline: string): void {
  const project = projectorFor('oblique');
  const at = (p: ScenePoint, z: number) => project({ ...p, z } as ScenePoint3);
  const n = base.length;
  // Centroid, to tell each edge's outward side.
  const cx = base.reduce((s, p) => s + p.x, 0) / n;
  const cy = base.reduce((s, p) => s + p.y, 0) / n;
  ctx.lineWidth = 0.06;
  ctx.strokeStyle = outline;
  for (let k = 0; k < n; k++) {
    const a = base[k]!;
    const b = base[(k + 1) % n]!;
    let nx = b.y - a.y;
    let ny = -(b.x - a.x);
    const mx = (a.x + b.x) / 2 - cx;
    const my = (a.y + b.y) / 2 - cy;
    if (nx * mx + ny * my < 0) {
      nx = -nx;
      ny = -ny;
    }
    if (nx + ny <= 0) continue;
    polygon(ctx, [at(a, 0), at(b, 0), at(b, height), at(a, height)]);
    ctx.fillStyle = side;
    ctx.fill();
    ctx.stroke();
  }
  polygon(
    ctx,
    base.map((p) => at(p, height)),
  );
  ctx.fillStyle = top;
  ctx.fill();
  ctx.stroke();
}

/**
 * Draws `frame` in a canvas whose CSS size is `width` × `height` pixels, showing `extent`
 * (projected metres, the drawing's viewBox) the way the SVG beneath it does.
 */
export function drawTraffic(ctx: CanvasRenderingContext2D, frame: TrafficFrame, view: SceneView, extent: SceneBounds, size: { width: number; height: number; ratio: number }, colors: TrafficColors): void {
  const { width, height, ratio } = size;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, width * ratio, height * ratio);
  const w = extent.maxX - extent.minX;
  const h = extent.maxY - extent.minY;
  if (w <= 0 || h <= 0 || width <= 0) return;
  // As SVG's default xMidYMid meet.
  const scale = Math.min(width / w, height / h);
  const offsetX = (width - w * scale) / 2;
  const offsetY = (height - h * scale) / 2;
  ctx.setTransform(scale * ratio, 0, 0, scale * ratio, (offsetX - extent.minX * scale) * ratio, (offsetY - extent.minY * scale) * ratio);
  ctx.lineJoin = 'round';

  const project = projectorFor(view);
  const items: Item[] = [];

  for (const v of frame.vehicles) {
    const base = footprint(v, v.heading, VEHICLE_LENGTH, VEHICLE_WIDTH);
    const queued = v.state === 'queued';
    if (view === 'plan') {
      items.push({
        depth: 0,
        draw: () => {
          polygon(ctx, base);
          ctx.fillStyle = colors.body;
          ctx.fill();
          ctx.lineWidth = 0.08;
          ctx.strokeStyle = colors.outline;
          ctx.stroke();
          // Windscreen, and brake lights while queued.
          const glass = footprint({ x: v.x + Math.cos(v.heading) * 0.75, y: v.y + Math.sin(v.heading) * 0.75 }, v.heading, 0.7, VEHICLE_WIDTH - 0.5);
          polygon(ctx, glass);
          ctx.fillStyle = colors.bodyTop;
          ctx.fill();
          if (queued) {
            for (const side of [-1, 1]) {
              const rear = { x: v.x - Math.cos(v.heading) * (VEHICLE_LENGTH / 2 - 0.15) - Math.sin(v.heading) * side * 0.6, y: v.y - Math.sin(v.heading) * (VEHICLE_LENGTH / 2 - 0.15) + Math.cos(v.heading) * side * 0.6 };
              polygon(ctx, footprint(rear, v.heading, 0.3, 0.45));
              ctx.fillStyle = colors.brake;
              ctx.fill();
            }
          }
        },
      });
    } else {
      items.push({
        depth: isoDepth(v),
        draw: () => {
          prism(ctx, base, VEHICLE_HEIGHT, colors.bodyShade, colors.body, colors.outline);
          if (queued) {
            const [, , rr, rl] = base as [ScenePoint, ScenePoint, ScenePoint, ScenePoint];
            for (const p of [rr, rl]) {
              const q = project({ x: p.x * 0.85 + v.x * 0.15, y: p.y * 0.85 + v.y * 0.15, z: VEHICLE_HEIGHT * 0.6 });
              ctx.beginPath();
              ctx.arc(q.x, q.y, 0.22, 0, Math.PI * 2);
              ctx.fillStyle = colors.brake;
              ctx.fill();
            }
          }
        },
      });
    }
  }

  for (const p of frame.pedestrians) {
    if (view === 'plan') {
      items.push({
        depth: 1,
        draw: () => {
          ctx.beginPath();
          ctx.arc(p.x, p.y, 0.5, 0, Math.PI * 2);
          ctx.fillStyle = colors.pedestrian;
          ctx.fill();
          ctx.lineWidth = 0.16;
          ctx.strokeStyle = colors.pedestrianOutline;
          ctx.stroke();
        },
      });
    } else {
      items.push({
        depth: isoDepth(p),
        draw: () => prism(ctx, footprint(p, p.heading, PEDESTRIAN_SIZE, PEDESTRIAN_SIZE), PEDESTRIAN_HEIGHT, colors.pedestrianShade, colors.pedestrian, colors.pedestrianOutline),
      });
    }
  }

  // Far to near in the oblique view; in plan, vehicles then pedestrians.
  items.sort((a, b) => a.depth - b.depth);
  for (const item of items) item.draw();

  // Spillback: how many more are queued past the end of the drawn leg.
  for (const o of frame.overflow) {
    const at = project({ ...o.at, z: view === 'plan' ? 0 : 0.3 });
    const text = `+${o.count}`;
    ctx.font = '600 1.6px Roboto, sans-serif';
    const textWidth = ctx.measureText(text).width;
    const bw = textWidth + 1.1;
    const bh = 2.2;
    ctx.beginPath();
    ctx.roundRect(at.x - bw / 2, at.y - bh / 2, bw, bh, bh / 2);
    ctx.fillStyle = colors.badge;
    ctx.fill();
    ctx.fillStyle = colors.badgeText;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, at.x, at.y + 0.1);
  }
}

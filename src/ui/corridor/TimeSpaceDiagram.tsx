/**
 * The time-space diagram: distance along the corridor up the side, system time across over a few
 * cycles. Each intersection shows when its through phases are green in each direction, and the
 * progression bands show the vehicles that ride green through every signal at the progression
 * speed. Dragging an intersection's bars sideways moves its offset (snapped to whole seconds);
 * Alt-dragging moves the end of its coordinated green instead.
 */
import { useRef, useState, type PointerEvent } from 'react';
import Box from '@mui/material/Box';
import { useTheme } from '@mui/material/styles';
import type { Band, Direction, Progression } from '../../engine';
import { formatSeconds } from '../../model';
import { fontFamilyMono } from '../theme/themePrimitives';

const WIDTH = 1000;
const LEFT = 170;
const RIGHT = 16;
const TOP = 24;
const BOTTOM = 36;
const PLOT_HEIGHT = 380;
const BAR = 7;

export interface TimeSpaceDiagramProps {
  progression: Progression;
  /** Cycles to draw. */
  cycles: number;
  /** Direction labels, e.g. EB / WB. */
  labels: Record<Direction, string>;
  /** Called while dragging a stop, with the offset change in tenths (whole seconds), and on release. */
  onDrag?: (intersectionId: string, delta: number, done: boolean) => void;
  /**
   * Called while Alt-dragging a stop (the end of coordinated green, tenths) and on release. Returns
   * the change that can actually be made, for the drag label.
   */
  onSplitDrag?: (intersectionId: string, delta: number, done: boolean) => number | undefined;
}

export default function TimeSpaceDiagram({ progression, cycles, labels, onDrag, onSplitDrag }: TimeSpaceDiagramProps) {
  const theme = useTheme();
  const palette = (theme.vars || theme).palette;
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [drag, setDrag] = useState<{ id: string; x: number; delta: number; mode: 'offset' | 'split'; applied: number } | null>(null);

  const timed = progression.stops.filter((s) => s.projection);
  const cycle = progression.cycle ?? Math.max(1, ...timed.map((s) => s.projection!.cycle));
  const span = cycle * cycles;
  const plot = WIDTH - LEFT - RIGHT;
  const x = (t: number) => LEFT + (t / span) * plot;
  const maxPosition = Math.max(0, ...progression.stops.map((s) => s.position));
  const height = TOP + PLOT_HEIGHT + BOTTOM;
  const y = (position: number, index: number) =>
    maxPosition > 0 ? TOP + PLOT_HEIGHT - (position / maxPosition) * PLOT_HEIGHT : TOP + PLOT_HEIGHT - (index / Math.max(1, progression.stops.length - 1)) * PLOT_HEIGHT;
  const tick = cycle >= 1200 ? 200 : 100;
  const bandColor: Record<Direction, string> = { outbound: palette.primary.main, inbound: palette.warning.main };

  /** Tenths of system time per SVG unit, from the rendered width. */
  const tenthsPerPixel = () => {
    const rect = svgRef.current?.getBoundingClientRect();
    return rect && rect.width > 0 ? (span / plot) * (WIDTH / rect.width) : 0;
  };

  const bandPolygons = (direction: Direction, band: Band) => {
    const width = band.bandwidth;
    if (width === null || width <= 0 || band.start === null) return null;
    const order = progression.stops.map((stop, k) => ({ stop, k })).filter(({ k }) => Number.isFinite(band.arrival[k]!));
    const polygons = [];
    for (let r = -2; r <= cycles + 1; r++) {
      const start = band.start + r * cycle;
      const left = order.map(({ stop, k }) => `${x(start + band.arrival[k]!)},${y(stop.position, k)}`);
      const right = [...order].reverse().map(({ stop, k }) => `${x(start + width + band.arrival[k]!)},${y(stop.position, k)}`);
      polygons.push(
        <polygon key={`${direction}-${r}`} points={[...left, ...right].join(' ')} fill={bandColor[direction]} fillOpacity={0.18} stroke={bandColor[direction]} strokeWidth={1.2} strokeDasharray={direction === 'inbound' ? '5 3' : undefined} />,
      );
    }
    return polygons;
  };

  const onPointerDown = (id: string) => (event: PointerEvent<SVGRectElement>) => {
    const mode = event.altKey && onSplitDrag ? 'split' : 'offset';
    if (mode === 'offset' && !onDrag) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({ id, x: event.clientX, delta: 0, mode, applied: 0 });
  };
  const onPointerMove = (event: PointerEvent<SVGRectElement>) => {
    if (!drag) return;
    const delta = Math.round(((event.clientX - drag.x) * tenthsPerPixel()) / 10) * 10;
    if (delta !== drag.delta) {
      if (drag.mode === 'split') {
        setDrag({ ...drag, delta, applied: onSplitDrag?.(drag.id, delta, false) ?? delta });
      } else {
        setDrag({ ...drag, delta, applied: delta });
        onDrag?.(drag.id, delta, false);
      }
    }
  };
  const onPointerUp = () => {
    if (!drag) return;
    if (drag.mode === 'split') onSplitDrag?.(drag.id, drag.delta, true);
    else onDrag?.(drag.id, drag.delta, true);
    setDrag(null);
  };

  return (
    <Box
      component="svg"
      ref={svgRef}
      viewBox={`0 0 ${WIDTH} ${height}`}
      role="img"
      aria-label={`Time-space diagram over ${cycles} cycles`}
      sx={{ width: '100%', height: 'auto', display: 'block', fontFamily: fontFamilyMono, userSelect: 'none', touchAction: 'none' }}
    >
      <defs>
        <clipPath id="tsd-plot">
          <rect x={LEFT} y={0} width={plot} height={height} />
        </clipPath>
      </defs>

      {Array.from({ length: Math.floor(span / tick) + 1 }, (_, i) => i * tick).map((t) => (
        <g key={t}>
          <line x1={x(t)} x2={x(t)} y1={TOP - 8} y2={TOP + PLOT_HEIGHT + 8} stroke={t % cycle === 0 ? palette.text.secondary : palette.divider} strokeWidth={t % cycle === 0 ? 1 : 0.5} />
          <text x={x(t)} y={TOP + PLOT_HEIGHT + 24} fontSize={10} textAnchor="middle" fill={palette.text.secondary}>
            {t / 10}
          </text>
        </g>
      ))}
      <text x={WIDTH - RIGHT} y={height - 2} fontSize={10} textAnchor="end" fill={palette.text.secondary}>
        system time, s
      </text>

      <g clipPath="url(#tsd-plot)">
        {progression.cycle !== null ? (
          <>
            {bandPolygons('outbound', progression.bands.outbound)}
            {bandPolygons('inbound', progression.bands.inbound)}
          </>
        ) : null}
      </g>

      {progression.stops.map((stop, k) => {
        const cy = y(stop.position, k);
        const stopCycle = stop.projection?.cycle ?? cycle;
        const repeats = Math.ceil(span / stopCycle);
        // While dragging, the parent re-analyses with the moved offset, so the bars are already moved.
        const dragging = drag?.id === stop.intersectionId;
        const bar = (direction: Direction, top: number) => (
          <g>
            <rect x={LEFT} y={top} width={plot} height={BAR} fill={stop.projection ? palette.error.main : palette.action.hover} fillOpacity={stop.projection ? 0.85 : 1} />
            {stop.projection
              ? Array.from({ length: repeats + 2 }, (_, r) => r - 1).flatMap((r) =>
                  stop.green[direction].map(([from, to]) => (
                    <rect key={`${r}-${from}`} x={x(from + r * stopCycle)} y={top} width={Math.max(0, x(to) - x(from))} height={BAR} fill={palette.success.main} />
                  )),
                )
              : null}
          </g>
        );
        return (
          <g key={stop.intersectionId} data-stop={stop.intersectionId}>
            <text x={LEFT - 10} y={cy - 2} fontSize={12} fontWeight={600} textAnchor="end" fill={stop.projection ? palette.text.primary : palette.text.disabled} fontFamily={theme.typography.fontFamily}>
              {stop.name.length > 22 ? `${stop.name.slice(0, 21)}…` : stop.name}
            </text>
            <text x={LEFT - 10} y={cy + 11} fontSize={9} textAnchor="end" fill={palette.text.secondary}>
              {stop.projection ? `${labels.outbound} ▲  ${labels.inbound} ▼` : stop.reason === 'free' ? 'runs free' : 'not in plan'}
            </text>
            <g clipPath="url(#tsd-plot)">
              {bar('outbound', cy - BAR - 1)}
              {bar('inbound', cy + 1)}
            </g>
            {stop.projection && (onDrag || onSplitDrag) ? (
              <rect
                x={LEFT}
                y={cy - BAR - 6}
                width={plot}
                height={2 * BAR + 12}
                fill="transparent"
                data-drag-target={stop.intersectionId}
                style={{ cursor: dragging ? 'grabbing' : 'ew-resize' }}
                onPointerDown={onPointerDown(stop.intersectionId)}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
              >
                <title>{`${stop.name}: drag sideways to change the offset${onSplitDrag ? '; Alt-drag to move the end of coordinated green' : ''}`}</title>
              </rect>
            ) : null}
            {dragging ? (
              <text x={LEFT + 4} y={cy - BAR - 8} fontSize={10} fill={palette.primary.main}>
                {`${drag.mode === 'split' ? 'coordinated green' : 'offset'} ${drag.applied >= 0 ? '+' : ''}${formatSeconds(drag.applied)} s${drag.mode === 'split' && drag.applied !== drag.delta ? ' (limit)' : ''}`}
              </text>
            ) : null}
          </g>
        );
      })}
    </Box>
  );
}

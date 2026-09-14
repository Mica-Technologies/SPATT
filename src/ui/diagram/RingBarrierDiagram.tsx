/**
 * The ring-barrier diagram: one lane per ring across one cycle in sequence time, each split drawn
 * as green, yellow and red clearance, with the pedestrian interval underneath, barrier lines,
 * coordinated phases outlined, force-off marks, local zero and a time scale. Used live beside the
 * editor (with tooltips) and on the printed timing sheet (static, wider, with a legend).
 */
import type { ReactElement } from 'react';
import Box from '@mui/material/Box';
import Tooltip from '@mui/material/Tooltip';
import { useTheme } from '@mui/material/styles';
import type { CycleProjection, PhaseInterval } from '../../engine';
import { formatSeconds, type Intersection } from '../../model';
import { fontFamilyMono } from '../theme/themePrimitives';
import { describeInterval, REFERENCE_LABEL, tickStep } from './diagramText';

const LEFT = 30;
const RIGHT = 10;
const TOP = 24;
const BAR = 22;
const PED = 5;
const LANE_GAP = 14;
const AXIS = 22;
const LEGEND = 22;

export interface RingBarrierDiagramProps {
  projection: CycleProjection;
  intersection: Intersection;
  /** Width in SVG units; the drawing scales to its container. */
  width?: number;
  /** Tooltips on each phase (off for print). */
  interactive?: boolean;
  /** Phases to outline as having errors. */
  flagged?: ReadonlySet<number>;
  legend?: boolean;
}

const s = formatSeconds;

export default function RingBarrierDiagram({ projection, intersection, width = 340, interactive = true, flagged, legend = false }: RingBarrierDiagramProps) {
  const theme = useTheme();
  const palette = (theme.vars || theme).palette;
  const { cycle } = projection;
  const plot = width - LEFT - RIGHT;
  const scale = plot / cycle;
  const x = (t: number) => LEFT + t * scale;
  const lane = BAR + 2 + PED + LANE_GAP;
  const lanesBottom = TOP + projection.rings.length * lane - LANE_GAP;
  const height = lanesBottom + AXIS + (legend ? LEGEND : 0);
  const labels = new Map(intersection.phases.map((p) => [p.number, p.label]));
  const step = tickStep(cycle, plot);
  const charWidth = 6.4;

  const phaseGroup = (interval: PhaseInterval, y: number) => {
    const green = interval.yellowStart - interval.greenStart;
    const label = labels.get(interval.phase);
    const greenWidth = green * scale;
    const text = `${interval.phase}${label && greenWidth > 60 ? ` ${label}` : ''}`;
    const fits = Math.floor((greenWidth - 8) / charWidth);
    const shown = fits >= text.length ? text : fits >= String(interval.phase).length ? String(interval.phase) : '';
    const ped = interval.walkEnd !== null && interval.pedestrianClearanceEnd !== null;
    // A pedestrian interval longer than the split is cut at the split's end (validation reports it).
    const pedWidth = (from: number, to: number) => Math.max(0, (Math.min(to, interval.splitEnd) - from) * scale);
    const flag = flagged?.has(interval.phase) === true;
    const group = (
      <g data-phase={interval.phase}>
        <rect x={x(interval.greenStart)} y={y} width={Math.max(0, greenWidth)} height={BAR} fill={palette.success.main} />
        <rect x={x(interval.yellowStart)} y={y} width={(interval.redClearStart - interval.yellowStart) * scale} height={BAR} fill={palette.warning.light} />
        <rect x={x(interval.redClearStart)} y={y} width={(interval.splitEnd - interval.redClearStart) * scale} height={BAR} fill={palette.error.main} />
        {ped ? (
          <>
            <rect x={x(interval.greenStart)} y={y + BAR + 2} width={pedWidth(interval.greenStart, interval.walkEnd!)} height={PED} fill={palette.success.light} />
            <rect x={x(Math.min(interval.walkEnd!, interval.splitEnd))} y={y + BAR + 2} width={pedWidth(interval.walkEnd!, interval.pedestrianClearanceEnd!)} height={PED} fill={palette.warning.main} />
          </>
        ) : null}
        <rect
          x={x(interval.splitStart)}
          y={y}
          width={(interval.splitEnd - interval.splitStart) * scale}
          height={BAR}
          fill="none"
          stroke={interval.coordinated ? palette.text.primary : palette.background.paper}
          strokeWidth={interval.coordinated ? 2 : 1}
        />
        {flag ? (
          <rect
            x={x(interval.splitStart) + 1.5}
            y={y + 1.5}
            width={Math.max(0, (interval.splitEnd - interval.splitStart) * scale - 3)}
            height={BAR - 3}
            fill="none"
            stroke={palette.error.main}
            strokeWidth={2}
            strokeDasharray="4 3"
          />
        ) : null}
        {interval.coordinated ? null : (
          <path d={`M ${x(interval.forceOff)} ${y + BAR + 3} l -3.5 6 h 7 z`} fill={palette.text.primary}>
            {interactive ? null : <title>{`Phase ${interval.phase} force-off`}</title>}
          </path>
        )}
        {shown ? (
          <text x={x(interval.greenStart) + 4} y={y + BAR / 2 + 4} fontSize={11} fontWeight={600} fill={palette.common.white}>
            {shown}
          </text>
        ) : null}
      </g>
    );
    return interactive ? (
      <Tooltip
        key={interval.phase}
        followCursor
        title={<Box sx={{ whiteSpace: 'pre-line' }}>{describeInterval(projection, interval, label).join('\n')}</Box>}
      >
        {group}
      </Tooltip>
    ) : (
      <g key={interval.phase}>{group}</g>
    );
  };

  const legendItems: { label: string; swatch: ReactElement }[] = [
    { label: 'Green', swatch: <rect width={12} height={10} fill={palette.success.main} /> },
    { label: 'Yellow', swatch: <rect width={12} height={10} fill={palette.warning.light} /> },
    { label: 'Red clear', swatch: <rect width={12} height={10} fill={palette.error.main} /> },
    { label: 'Walk', swatch: <rect y={3} width={12} height={5} fill={palette.success.light} /> },
    { label: 'Ped clear', swatch: <rect y={3} width={12} height={5} fill={palette.warning.main} /> },
    { label: 'Coordinated', swatch: <rect x={1} y={1} width={10} height={8} fill="none" stroke={palette.text.primary} strokeWidth={2} /> },
    { label: 'Force-off', swatch: <path d="M 6 2 l -4 7 h 8 z" fill={palette.text.primary} /> },
    { label: 'Local zero', swatch: <path d="M 6 10 l -5 -8 h 10 z" fill={palette.primary.main} /> },
  ];

  return (
    <Box
      component="svg"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`Ring-barrier diagram, ${s(cycle)} s cycle`}
      sx={{ width: '100%', height: 'auto', display: 'block', fontFamily: fontFamilyMono, overflow: 'visible' }}
    >
      {projection.rings.map((ring, r) => {
        const y = TOP + r * lane;
        return (
          <g key={r}>
            <text x={0} y={y + BAR / 2 + 4} fontSize={11} fill={palette.text.secondary}>
              R{r + 1}
            </text>
            <rect x={LEFT} y={y} width={plot} height={BAR} rx={3} fill={palette.action.hover} />
            {ring.map((interval) => phaseGroup(interval, y))}
          </g>
        );
      })}

      {projection.barriers.slice(0, -1).map((t) => (
        <line key={t} x1={x(t)} x2={x(t)} y1={TOP - 6} y2={lanesBottom} stroke={palette.text.primary} strokeWidth={2.5} />
      ))}

      <line x1={x(projection.localZero)} x2={x(projection.localZero)} y1={TOP - 4} y2={lanesBottom} stroke={palette.primary.main} strokeWidth={1} strokeDasharray="2 2" />
      <path d={`M ${x(projection.localZero)} ${TOP - 3} l -5 -8 h 10 z`} fill={palette.primary.main}>
        <title>{`Local zero: ${REFERENCE_LABEL[projection.offsetReference]}`}</title>
      </path>
      {width >= 480 ? (
        <text x={x(projection.localZero) + (projection.localZero > cycle * 0.8 ? -8 : 8)} y={TOP - 5} fontSize={9} textAnchor={projection.localZero > cycle * 0.8 ? 'end' : 'start'} fill={palette.primary.main}>
          local zero ({REFERENCE_LABEL[projection.offsetReference]})
        </text>
      ) : null}

      {Array.from({ length: Math.floor(cycle / step) + 1 }, (_, i) => i * step).map((t) => (
        <g key={t}>
          <line x1={x(t)} x2={x(t)} y1={lanesBottom + 4} y2={lanesBottom + 8} stroke={palette.text.secondary} />
          <text x={x(t)} y={lanesBottom + 18} fontSize={9} textAnchor="middle" fill={palette.text.secondary}>
            {t / 10}
          </text>
        </g>
      ))}

      {legend ? (
        <g transform={`translate(${LEFT}, ${lanesBottom + AXIS + 6})`} fontSize={9} fill={palette.text.secondary}>
          {legendItems.map((item, k) => (
            <g key={item.label} transform={`translate(${k * Math.max(64, plot / legendItems.length)}, 0)`}>
              {item.swatch}
              <text x={16} y={9}>
                {item.label}
              </text>
            </g>
          ))}
        </g>
      ) : null}
    </Box>
  );
}

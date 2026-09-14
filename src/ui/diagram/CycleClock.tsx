/**
 * The cycle clock strip: one cycle of system time (the shared clock every coordinated signal
 * counts from), showing where this pattern's local zero falls (at the offset) and when each
 * coordinated phase is green.
 */
import Box from '@mui/material/Box';
import { useTheme } from '@mui/material/styles';
import { systemSpans, type CycleProjection } from '../../engine';
import { formatSeconds } from '../../model';
import { fontFamilyMono } from '../theme/themePrimitives';
import { tickStep } from './diagramText';

const LEFT = 30;
const RIGHT = 10;
const TOP = 16;
const STRIP = 12;

export default function CycleClock({ projection, width = 340 }: { projection: CycleProjection; width?: number }) {
  const theme = useTheme();
  const palette = (theme.vars || theme).palette;
  const { cycle, offset } = projection;
  const plot = width - LEFT - RIGHT;
  const x = (t: number) => LEFT + (t / cycle) * plot;
  const coordinated = projection.rings.flat().filter((i) => i.coordinated);
  const lanes = Math.max(1, coordinated.length);
  const laneHeight = STRIP / lanes;
  const bottom = TOP + STRIP;
  const height = bottom + 22;
  const step = tickStep(cycle, plot);
  const zero = offset % cycle;

  return (
    <Box
      component="svg"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`Cycle clock: local zero at ${formatSeconds(zero)} s system time`}
      sx={{ width: '100%', height: 'auto', display: 'block', fontFamily: fontFamilyMono, overflow: 'visible' }}
    >
      <text x={0} y={TOP + STRIP - 2} fontSize={9} fill={palette.text.secondary}>
        SYS
      </text>
      <rect x={LEFT} y={TOP} width={plot} height={STRIP} rx={2} fill={palette.action.hover} />
      {coordinated.map((interval, k) =>
        systemSpans(projection, interval.greenStart, interval.yellowStart).map(([from, to]) => (
          <rect key={`${interval.phase}-${from}`} x={x(from)} y={TOP + k * laneHeight} width={x(to) - x(from)} height={laneHeight} fill={palette.success.main}>
            <title>{`Phase ${interval.phase} green, ${formatSeconds(from)}–${formatSeconds(to)} s system time`}</title>
          </rect>
        )),
      )}
      <line x1={x(zero)} x2={x(zero)} y1={TOP - 2} y2={bottom + 2} stroke={palette.primary.main} strokeWidth={2} />
      <path d={`M ${x(zero)} ${TOP - 2} l -5 -8 h 10 z`} fill={palette.primary.main} />
      <text x={x(zero) + (zero > cycle * 0.6 ? -8 : 8)} y={TOP - 5} fontSize={9} textAnchor={zero > cycle * 0.6 ? 'end' : 'start'} fill={palette.primary.main}>
        local zero at {formatSeconds(zero)} s
      </text>
      {Array.from({ length: Math.floor(cycle / step) + 1 }, (_, i) => i * step).map((t) => (
        <g key={t}>
          <line x1={x(t)} x2={x(t)} y1={bottom + 2} y2={bottom + 6} stroke={palette.text.secondary} />
          <text x={x(t)} y={bottom + 16} fontSize={9} textAnchor="middle" fill={palette.text.secondary}>
            {t / 10}
          </text>
        </g>
      ))}
    </Box>
  );
}

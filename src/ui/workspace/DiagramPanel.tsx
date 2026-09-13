/**
 * The live ring-barrier diagram docked beside the editor: one bar per ring across one cycle,
 * split into green, yellow and red clearance, with barriers, coordinated phases and local zero.
 */
import { useMemo } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useTheme } from '@mui/material/styles';
import { convertOffset, cycleBounds, projectCycle, toLocal, type CycleProjection } from '../../engine';
import { formatSeconds, tenthsToTicks, type Intersection, type OffsetReference } from '../../model';
import { fontFamilyMono } from '../theme/themePrimitives';
import { useWorkspace } from '../state/workspace';

const REFERENCE_LABEL: Record<OffsetReference, string> = {
  beginCoordGreen: 'begin of coordinated green',
  beginCoordYellow: 'end of coordinated green',
  firstPhaseStart: 'start of ring sequence',
};

const WIDTH = 340;
const LEFT = 30;
const ROW = 34;
const BAR = 22;
const TOP = 18;

function Row({ label, value }: { label: string; value: string }) {
  return (
    <Stack direction="row" sx={{ justifyContent: 'space-between', gap: 2 }}>
      <Typography variant="body2" sx={{ color: 'text.secondary' }}>
        {label}
      </Typography>
      <Typography variant="body2" sx={{ fontFamily: fontFamilyMono }}>
        {value}
      </Typography>
    </Stack>
  );
}

function RingBarrierSvg({ projection, intersection }: { projection: CycleProjection; intersection: Intersection }) {
  const theme = useTheme();
  const palette = (theme.vars || theme).palette;
  const cycle = projection.cycle;
  const scale = (WIDTH - LEFT - 8) / cycle;
  const x = (t: number) => LEFT + t * scale;
  const height = TOP + projection.rings.length * ROW + 22;
  const labels = new Map(intersection.phases.map((p) => [p.number, p.label]));
  const tickStep = cycle > 1800 ? 300 : cycle > 900 ? 200 : 100;

  return (
    <Box component="svg" viewBox={`0 0 ${WIDTH} ${height}`} role="img" aria-label="Ring-barrier diagram" sx={{ width: '100%', height: 'auto', display: 'block', fontFamily: fontFamilyMono }}>
      {projection.rings.map((ring, r) => {
        const y = TOP + r * ROW;
        return (
          <g key={r}>
            <text x={0} y={y + BAR / 2 + 4} fontSize={11} fill={palette.text.secondary}>
              R{r + 1}
            </text>
            <rect x={LEFT} y={y} width={cycle * scale} height={BAR} rx={3} fill={palette.action.hover} />
            {ring.map((interval) => {
              const green = interval.yellowStart - interval.greenStart;
              const title = `Phase ${interval.phase}${labels.get(interval.phase) ? ` (${labels.get(interval.phase)})` : ''}: split ${formatSeconds(interval.splitEnd - interval.splitStart)} s, green ${formatSeconds(green)} s`;
              return (
                <g key={interval.phase}>
                  <title>{title}</title>
                  <rect x={x(interval.greenStart)} y={y} width={Math.max(0, green * scale)} height={BAR} fill={palette.success.main} />
                  <rect x={x(interval.yellowStart)} y={y} width={(interval.redClearStart - interval.yellowStart) * scale} height={BAR} fill={palette.warning.light} />
                  <rect x={x(interval.redClearStart)} y={y} width={(interval.splitEnd - interval.redClearStart) * scale} height={BAR} fill={palette.error.main} />
                  <rect
                    x={x(interval.splitStart)}
                    y={y}
                    width={(interval.splitEnd - interval.splitStart) * scale}
                    height={BAR}
                    fill="none"
                    stroke={interval.coordinated ? palette.text.primary : palette.background.paper}
                    strokeWidth={interval.coordinated ? 2 : 1}
                  />
                  {green * scale > 14 ? (
                    <text x={x(interval.greenStart) + 4} y={y + BAR / 2 + 4} fontSize={11} fontWeight={600} fill="#fff">
                      {interval.phase}
                    </text>
                  ) : null}
                </g>
              );
            })}
          </g>
        );
      })}
      {projection.barriers.slice(0, -1).map((t) => (
        <line key={t} x1={x(t)} x2={x(t)} y1={TOP - 6} y2={TOP + projection.rings.length * ROW - 6} stroke={palette.text.primary} strokeWidth={2} />
      ))}
      {Array.from({ length: Math.floor(cycle / tickStep) + 1 }, (_, i) => i * tickStep).map((t) => (
        <g key={t}>
          <line x1={x(t)} x2={x(t)} y1={height - 20} y2={height - 16} stroke={palette.text.secondary} />
          <text x={x(t)} y={height - 5} fontSize={9} textAnchor="middle" fill={palette.text.secondary}>
            {t / 10}
          </text>
        </g>
      ))}
      <path d={`M ${x(projection.localZero)} ${TOP - 2} l -5 -8 h 10 z`} fill={palette.primary.main}>
        <title>Local zero ({REFERENCE_LABEL[projection.offsetReference]})</title>
      </path>
    </Box>
  );
}

export default function DiagramPanel({ intersection, patternId }: { intersection: Intersection; patternId: string | null }) {
  const selectPattern = useWorkspace((s) => s.selectPattern);
  const pattern = intersection.patterns.find((p) => p.id === patternId) ?? intersection.patterns[0] ?? null;
  const result = useMemo(() => (pattern ? projectCycle(intersection, pattern.id) : null), [intersection, pattern]);
  const bounds = useMemo(() => cycleBounds(intersection, pattern?.maxGreen === 'max2'), [intersection, pattern]);

  return (
    <Box component="aside" aria-label="Ring-barrier diagram" sx={{ borderLeft: 1, borderColor: 'divider', bgcolor: 'background.paper', p: 2, overflowY: 'auto' }}>
      <Stack spacing={2}>
        <Typography variant="subtitle2" component="h2">
          Ring-barrier diagram
        </Typography>
        {pattern ? (
          <TextField select size="small" label="Pattern" value={pattern.id} onChange={(e) => selectPattern(e.target.value)}>
            {intersection.patterns.map((p) => (
              <MenuItem key={p.id} value={p.id}>
                {p.name}
                {p.mode === 'free' ? ' (free)' : ''}
              </MenuItem>
            ))}
          </TextField>
        ) : (
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            No patterns yet. Coordinated patterns appear here as a diagram.
          </Typography>
        )}

        {result && result.ok ? (
          <>
            <RingBarrierSvg projection={result.projection} intersection={intersection} />
            <Stack spacing={0.5}>
              <Row label="Cycle" value={`${formatSeconds(result.projection.cycle)} s`} />
              <Row label={`Offset (${REFERENCE_LABEL[result.projection.offsetReference]})`} value={`${formatSeconds(result.projection.offset)} s`} />
              <Row label="CSM offset (ticks)" value={String(tenthsToTicks(convertOffset(result.projection, 'firstPhaseStart')))} />
            </Stack>
            <Box>
              <Typography variant="overline" sx={{ color: 'text.secondary' }}>
                Force-offs (local)
              </Typography>
              <Stack spacing={0.25}>
                {result.projection.rings.flat().filter((i) => !i.coordinated).sort((a, b) => a.phase - b.phase).map((i) => (
                  <Row key={i.phase} label={`Phase ${i.phase}`} value={`${formatSeconds(toLocal(result.projection, i.forceOff))} s`} />
                ))}
              </Stack>
            </Box>
          </>
        ) : null}

        {result && !result.ok ? (
          result.issues[0]?.code === 'projection.free-pattern' ? (
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              This pattern runs free, so it has no fixed cycle to draw.
            </Typography>
          ) : (
            <Alert severity="warning" variant="outlined">
              Fix {result.issues.length} problem{result.issues.length === 1 ? '' : 's'} in this pattern or the ring structure to see its diagram.
            </Alert>
          )
        ) : null}

        <Box>
          <Typography variant="overline" sx={{ color: 'text.secondary' }}>
            Free operation
          </Typography>
          <Stack spacing={0.25}>
            <Row label="Minimum cycle" value={`${formatSeconds(bounds.minimum.cycle)} s`} />
            <Row label="With pedestrians" value={`${formatSeconds(bounds.minimumWithPedestrians.cycle)} s`} />
            <Row label={`Maximum (${pattern?.maxGreen === 'max2' ? 'Max 2' : 'Max 1'})`} value={`${formatSeconds(bounds.maximum.cycle)} s`} />
          </Stack>
        </Box>
      </Stack>
    </Box>
  );
}

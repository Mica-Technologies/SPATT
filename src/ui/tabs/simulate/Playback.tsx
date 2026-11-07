/**
 * Ring-barrier playback of a simulation: each ring's phases as coloured spans over a moving time
 * window, a cursor you can scrub or play, the signals at the cursor, and each lane group's queue.
 * Space plays and pauses. With reduced motion requested, playing advances in whole-second steps
 * once a second instead of animating.
 */
import { useEffect, useMemo, useState } from 'react';
import PauseRoundedIcon from '@mui/icons-material/PauseRounded';
import PlayArrowRoundedIcon from '@mui/icons-material/PlayArrowRounded';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import MenuItem from '@mui/material/MenuItem';
import Slider from '@mui/material/Slider';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { useTheme } from '@mui/material/styles';
import useMediaQuery from '@mui/material/useMediaQuery';
import { TICKS_PER_SECOND, type SimulationResult } from '../../../engine';
import type { Intersection, Ring } from '../../../model';
import { isEditable } from '../../fields/keys';
import { fontFamilyMono } from '../../theme/themePrimitives';
import { indexSpans } from './spanIndex';

const WIDTH = 1000;
const LEFT = 64;
const ROW = 34;
const BAR = 18;
const PED = 6;
const WINDOW_SECONDS = 180;

const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

type Vehicle = 'green' | 'yellow' | 'red';
const VEHICLE_COLOR: Record<Vehicle, string> = { green: 'success.main', yellow: 'warning.main', red: 'error.main' };

export default function Playback({ intersection, sequence, result }: { intersection: Intersection; sequence: Ring[]; result: SimulationResult }) {
  const theme = useTheme();
  const palette = (theme.vars || theme).palette;
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)', { noSsr: true });
  const total = result.ticks / TICKS_PER_SECOND;
  const [cursor, setCursor] = useState(Math.min(total, result.warmUpTicks / TICKS_PER_SECOND + WINDOW_SECONDS));
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(5);

  useEffect(() => {
    if (!playing) return;
    const advance = (dt: number) =>
      setCursor((c) => {
        const next = Math.min(total, c + dt);
        if (next >= total) setPlaying(false);
        return next;
      });
    if (reducedMotion) {
      const timer = setInterval(() => advance(speed), 1000);
      return () => clearInterval(timer);
    }
    let last = performance.now();
    let frame = requestAnimationFrame(function step(now) {
      advance(((now - last) / 1000) * speed);
      last = now;
      frame = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(frame);
  }, [playing, speed, total, reducedMotion]);

  // Space plays and pauses, unless the keyboard is on a field or a control with its own Space.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== ' ' || event.ctrlKey || event.metaKey || event.altKey || event.defaultPrevented || isEditable(event.target)) return;
      if (event.target instanceof Element && event.target.closest('button, a, [role="button"], [role="slider"], [role="combobox"], [role="tab"], [role="dialog"], [role="menu"], [role="listbox"]')) return;
      event.preventDefault();
      setPlaying((p) => !p);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const index = useMemo(() => indexSpans(result.trace.spans), [result]);
  const rows = useMemo(() => sequence.map((ring, r) => ({ r, phases: new Set(ring.groups.flat()) })), [sequence]);
  const from = Math.max(0, cursor - WINDOW_SECONDS * 0.75);
  const to = from + WINDOW_SECONDS;
  const x = (seconds: number) => LEFT + ((seconds - from) / WINDOW_SECONDS) * (WIDTH - LEFT - 8);
  const tick = (seconds: number) => seconds * TICKS_PER_SECOND;
  const visible = index.between(tick(from), tick(to));
  const height = rows.length * ROW + 24;
  const fill = { green: palette.success.main, yellow: palette.warning.main, walk: palette.info.main, clearance: palette.info.light } as const;

  const atCursor = index.at(tick(cursor));
  const signalsOf = (phase: number) => atCursor.filter((s) => s.phase === phase).map((s) => s.signal);
  const vehicleOf = (phase: number): Vehicle => {
    const signals = signalsOf(phase);
    return signals.includes('green') ? 'green' : signals.includes('yellow') ? 'yellow' : 'red';
  };
  const phaseLabel = (n: number) => intersection.phases.find((p) => p.number === n)?.label || `Phase ${n}`;
  const second = Math.min(Math.floor(cursor), total - 1);
  const maxQueue = Math.max(1, ...result.laneGroups.map((l) => l.maxQueue));

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
        <Tooltip title={`${playing ? 'Pause' : 'Play'} (Space)`}>
          <IconButton aria-label={playing ? 'Pause playback' : 'Play'} onClick={() => setPlaying(!playing)}>
            {playing ? <PauseRoundedIcon /> : <PlayArrowRoundedIcon />}
          </IconButton>
        </Tooltip>
        <TextField select size="small" label="Speed" value={speed} onChange={(e) => setSpeed(Number(e.target.value))} sx={{ width: 100 }}>
          {[1, 5, 20, 60].map((s) => (
            <MenuItem key={s} value={s}>
              ×{s}
            </MenuItem>
          ))}
        </TextField>
        <Slider aria-label="Playback time" aria-valuetext={clock(cursor)} value={cursor} min={0} max={total} step={1} onChange={(_, v) => setCursor(v as number)} sx={{ flex: 1, minWidth: 160, mx: 1 }} valueLabelDisplay="auto" valueLabelFormat={clock} />
        <Typography variant="body2" aria-live="off" sx={{ fontFamily: fontFamilyMono, minWidth: 90, textAlign: 'right' }}>
          {clock(cursor)} / {clock(total)}
        </Typography>
      </Box>

      <Box component="svg" viewBox={`0 0 ${WIDTH} ${height}`} role="img" aria-label="Signal playback: each ring's phases over a three-minute window around the cursor" sx={{ width: '100%', height: 'auto', display: 'block', fontFamily: fontFamilyMono }}>
        {rows.map(({ r, phases }) => {
          const y = r * ROW + 4;
          return (
            <g key={r}>
              <text x={LEFT - 10} y={y + BAR / 2 + 5} fontSize={14} fontWeight={600} textAnchor="end" fill={palette.text.secondary}>
                Ring {r + 1}
              </text>
              <rect x={LEFT} y={y} width={WIDTH - LEFT - 8} height={BAR} fill={palette.error.main} fillOpacity={0.25} />
              {visible
                .filter((s) => phases.has(s.phase))
                .map((s) => {
                  const pedestrian = s.signal === 'walk' || s.signal === 'clearance';
                  const x1 = x(Math.max(from, s.start / TICKS_PER_SECOND));
                  const x2 = x(Math.min(to, s.end / TICKS_PER_SECOND));
                  return (
                    <g key={`${s.phase}-${s.signal}-${s.start}`}>
                      <rect x={x1} y={pedestrian ? y + BAR + 2 : y} width={Math.max(0, x2 - x1)} height={pedestrian ? PED : BAR} rx={pedestrian ? 1 : 0} fill={fill[s.signal]} />
                      {s.signal === 'green' && x2 - x1 > 20 ? (
                        <text x={x1 + 4} y={y + 13} fontSize={12} fontWeight={600} fill={palette.common.white}>
                          {s.phase}
                        </text>
                      ) : null}
                    </g>
                  );
                })}
            </g>
          );
        })}
        <line x1={x(cursor)} x2={x(cursor)} y1={0} y2={height - 20} stroke={palette.text.primary} strokeWidth={1.5} />
        {Array.from({ length: Math.floor(WINDOW_SECONDS / 30) + 1 }, (_, k) => Math.ceil(from / 30) * 30 + k * 30)
          .filter((s) => s <= to)
          .map((s) => (
            <text key={s} x={x(s)} y={height - 6} fontSize={11} textAnchor="middle" fill={palette.text.secondary}>
              {clock(s)}
            </text>
          ))}
      </Box>

      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
        <Box role="list" aria-label="Signals at the cursor" sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', alignContent: 'flex-start', flex: '1 1 320px' }}>
          {[...new Set(sequence.flatMap((ring) => ring.groups.flat()))]
            .sort((a, b) => a - b)
            .map((n) => {
              const signals = signalsOf(n);
              const vehicle = vehicleOf(n);
              const walk = signals.includes('walk') ? 'walk' : signals.includes('clearance') ? 'ped clear' : null;
              return (
                <Box role="listitem" key={n} aria-label={`Phase ${n} ${vehicle}${walk ? `, ${walk}` : ''}`} sx={{ display: 'flex', alignItems: 'center', gap: 0.75, px: 1, py: 0.25, border: 1, borderColor: 'divider', borderRadius: 1, fontSize: 12 }}>
                  <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: VEHICLE_COLOR[vehicle] }} />
                  {n} {phaseLabel(n)}
                  {walk ? (
                    <Typography component="span" variant="caption" sx={{ color: 'info.main' }}>
                      {walk}
                    </Typography>
                  ) : null}
                </Box>
              );
            })}
        </Box>
        <Box role="group" aria-label="Queues at the cursor" sx={{ flex: '1 1 260px', minWidth: 0 }}>
          <Box sx={{ display: 'grid', gridTemplateColumns: '110px 1fr 40px', gap: 1, fontSize: 11, color: 'text.secondary', mb: 0.25 }}>
            <span>Queue (veh)</span>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', fontFamily: fontFamilyMono }}>
              <span>0</span>
              <span>{maxQueue}</span>
            </Box>
            <span />
          </Box>
          {result.laneGroups.map((l) => {
            const q = result.trace.queues[l.laneGroupId]?.[second] ?? 0;
            const signal = vehicleOf(l.phase);
            return (
              <Box key={l.laneGroupId} sx={{ display: 'grid', gridTemplateColumns: '110px 1fr 40px', alignItems: 'center', gap: 1, fontSize: 12 }}>
                <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {l.label || 'Lane group'}
                </Box>
                <Box sx={{ height: 8, bgcolor: 'action.hover', borderRadius: 1, overflow: 'hidden' }} title={`Phase ${l.phase} ${signal}`}>
                  <Box sx={{ height: '100%', width: `${(q / maxQueue) * 100}%`, bgcolor: VEHICLE_COLOR[signal] }} />
                </Box>
                <Box component="span" sx={{ fontFamily: fontFamilyMono, textAlign: 'right' }} aria-label={`${l.label} queue`}>
                  {q}
                </Box>
              </Box>
            );
          })}
        </Box>
      </Box>
    </Box>
  );
}

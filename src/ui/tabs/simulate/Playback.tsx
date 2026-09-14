/**
 * Ring-barrier playback of a simulation: each ring's phases as coloured spans over a moving time
 * window, a cursor you can scrub or play, the signals at the cursor, and each lane group's queue.
 */
import { useEffect, useMemo, useState } from 'react';
import PauseRoundedIcon from '@mui/icons-material/PauseRounded';
import PlayArrowRoundedIcon from '@mui/icons-material/PlayArrowRounded';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import MenuItem from '@mui/material/MenuItem';
import Slider from '@mui/material/Slider';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useTheme } from '@mui/material/styles';
import { TICKS_PER_SECOND, type SimulationResult } from '../../../engine';
import type { Intersection, Ring } from '../../../model';
import { fontFamilyMono } from '../../theme/themePrimitives';

const WIDTH = 1000;
const LEFT = 60;
const ROW = 30;
const WINDOW_SECONDS = 180;

const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

export default function Playback({ intersection, sequence, result }: { intersection: Intersection; sequence: Ring[]; result: SimulationResult }) {
  const theme = useTheme();
  const palette = (theme.vars || theme).palette;
  const total = result.ticks / TICKS_PER_SECOND;
  const [cursor, setCursor] = useState(Math.min(total, result.warmUpTicks / TICKS_PER_SECOND + WINDOW_SECONDS));
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(5);

  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    let frame = requestAnimationFrame(function advance(now) {
      const dt = ((now - last) / 1000) * speed;
      last = now;
      setCursor((c) => {
        const next = Math.min(total, c + dt);
        if (next >= total) setPlaying(false);
        return next;
      });
      frame = requestAnimationFrame(advance);
    });
    return () => cancelAnimationFrame(frame);
  }, [playing, speed, total]);

  const rows = useMemo(() => sequence.map((ring, r) => ({ r, phases: new Set(ring.groups.flat()) })), [sequence]);
  const from = Math.max(0, cursor - WINDOW_SECONDS * 0.75);
  const to = from + WINDOW_SECONDS;
  const x = (seconds: number) => LEFT + ((seconds - from) / WINDOW_SECONDS) * (WIDTH - LEFT - 8);
  const tick = (seconds: number) => seconds * TICKS_PER_SECOND;
  const visible = result.trace.spans.filter((s) => s.end > tick(from) && s.start < tick(to));
  const height = rows.length * ROW + 24;
  const fill = { green: palette.success.main, yellow: palette.warning.main, walk: palette.info.main, clearance: palette.info.light } as const;

  const at = tick(cursor);
  const now = (phase: number) => result.trace.spans.filter((s) => s.phase === phase && s.start <= at && s.end > at).map((s) => s.signal);
  const phaseLabel = (n: number) => intersection.phases.find((p) => p.number === n)?.label || `Phase ${n}`;
  const second = Math.min(Math.floor(cursor), total - 1);
  const maxQueue = Math.max(1, ...result.laneGroups.map((l) => l.maxQueue));

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
        <IconButton aria-label={playing ? 'Pause playback' : 'Play'} onClick={() => setPlaying(!playing)}>
          {playing ? <PauseRoundedIcon /> : <PlayArrowRoundedIcon />}
        </IconButton>
        <TextField select size="small" label="Speed" value={speed} onChange={(e) => setSpeed(Number(e.target.value))} sx={{ width: 100 }}>
          {[1, 5, 20, 60].map((s) => (
            <MenuItem key={s} value={s}>
              ×{s}
            </MenuItem>
          ))}
        </TextField>
        <Slider aria-label="Playback time" value={cursor} min={0} max={total} step={1} onChange={(_, v) => setCursor(v as number)} sx={{ flex: 1, minWidth: 200, mx: 1 }} valueLabelDisplay="auto" valueLabelFormat={clock} />
        <Typography variant="body2" aria-live="off" sx={{ fontFamily: fontFamilyMono, minWidth: 90, textAlign: 'right' }}>
          {clock(cursor)} / {clock(total)}
        </Typography>
      </Box>

      <Box component="svg" viewBox={`0 0 ${WIDTH} ${height}`} role="img" aria-label={`Signal playback at ${clock(cursor)}`} sx={{ width: '100%', height: 'auto', display: 'block', fontFamily: fontFamilyMono }}>
        {rows.map(({ r, phases }) => {
          const y = r * ROW + 4;
          return (
            <g key={r}>
              <text x={LEFT - 8} y={y + 16} fontSize={11} textAnchor="end" fill={palette.text.secondary}>
                Ring {r + 1}
              </text>
              <rect x={LEFT} y={y} width={WIDTH - LEFT - 8} height={20} fill={palette.error.main} fillOpacity={0.25} />
              {visible
                .filter((s) => phases.has(s.phase))
                .map((s, k) => {
                  const pedestrian = s.signal === 'walk' || s.signal === 'clearance';
                  const x1 = x(Math.max(from, s.start / TICKS_PER_SECOND));
                  const x2 = x(Math.min(to, s.end / TICKS_PER_SECOND));
                  return (
                    <g key={k}>
                      <rect x={x1} y={pedestrian ? y + 16 : y} width={Math.max(0, x2 - x1)} height={pedestrian ? 4 : 16} fill={fill[s.signal]} />
                      {s.signal === 'green' && x2 - x1 > 18 ? (
                        <text x={x1 + 3} y={y + 12} fontSize={10} fill={palette.common.white}>
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
            <text key={s} x={x(s)} y={height - 6} fontSize={10} textAnchor="middle" fill={palette.text.secondary}>
              {clock(s)}
            </text>
          ))}
      </Box>

      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
        <Box role="list" aria-label="Signals at the cursor" sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
          {[...new Set(sequence.flatMap((ring) => ring.groups.flat()))]
            .sort((a, b) => a - b)
            .map((n) => {
              const signals = now(n);
              const vehicle = signals.includes('green') ? 'green' : signals.includes('yellow') ? 'yellow' : 'red';
              const color = vehicle === 'green' ? 'success.main' : vehicle === 'yellow' ? 'warning.main' : 'error.main';
              const walk = signals.includes('walk') ? 'walk' : signals.includes('clearance') ? 'ped clear' : null;
              return (
                <Box role="listitem" key={n} aria-label={`Phase ${n} ${vehicle}${walk ? `, ${walk}` : ''}`} sx={{ display: 'flex', alignItems: 'center', gap: 0.75, px: 1, py: 0.25, border: 1, borderColor: 'divider', borderRadius: 1, fontSize: 12 }}>
                  <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: color }} />
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
        <Box sx={{ flex: 1, minWidth: 240 }}>
          {result.laneGroups.map((l) => {
            const q = result.trace.queues[l.laneGroupId]?.[second] ?? 0;
            return (
              <Box key={l.laneGroupId} sx={{ display: 'grid', gridTemplateColumns: '110px 1fr 40px', alignItems: 'center', gap: 1, fontSize: 12 }}>
                <span>{l.label || 'Lane group'}</span>
                <Box sx={{ height: 8, bgcolor: 'action.hover', borderRadius: 1, overflow: 'hidden' }}>
                  <Box sx={{ height: '100%', width: `${(q / maxQueue) * 100}%`, bgcolor: 'primary.main' }} />
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

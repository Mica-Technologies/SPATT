/**
 * Simulation of the intersection's controller against random traffic from a count: settings, a run
 * in a worker, statistics beside the HCM analysis, and a ring-barrier playback.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import PlayArrowRoundedIcon from '@mui/icons-material/PlayArrowRounded';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import LinearProgress from '@mui/material/LinearProgress';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { analyzePattern, DEFAULT_SIMULATION, type SimulationResult, type Stat } from '../../engine';
import { effectiveSequence } from '../../model';
import { fontFamilyMono } from '../theme/themePrimitives';
import { Section } from './patterns/Section';
import Playback from './simulate/Playback';
import type { ControllerBehaviour, SimulationMessage, SimulationRequest } from './simulate/simulation.worker';
import type { TabProps } from './types';
import { cellSx, headSx, numberCellSx } from './volumes/tableStyles';

const FREE = '';
const BEHAVIOURS: { value: ControllerBehaviour; label: string }[] = [
  { value: 'nema', label: 'NEMA actuated' },
  { value: 'csm', label: 'CSM ASC-3' },
];

const n1 = (v: number | null) => (v === null ? '—' : v.toFixed(1));
const statText = (s: Stat) => (s.count === 0 ? '—' : `${n1(s.mean)} (${n1(s.min)}–${n1(s.max)})`);

export default function SimulateTab({ intersection }: TabProps) {
  const [patternId, setPatternId] = useState<string>(intersection.patterns[0]?.id ?? FREE);
  const [volumeSetId, setVolumeSetId] = useState<string>(intersection.patterns.find((p) => p.id === patternId)?.volumeSetId ?? intersection.volumeSets[0]?.id ?? '');
  const [behaviour, setBehaviour] = useState<ControllerBehaviour>('nema');
  const [minutes, setMinutes] = useState(60);
  const [warmUp, setWarmUp] = useState(5);
  const [seed, setSeed] = useState(1);
  const [pedestrianRates, setPedestrianRates] = useState<Record<string, number>>({});
  const [running, setRunning] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [result, setResult] = useState<{ result: SimulationResult; patternId: string | null; volumeSetId: string } | null>(null);
  const worker = useRef<Worker | null>(null);
  useEffect(() => () => worker.current?.terminate(), []);

  const pattern = intersection.patterns.find((p) => p.id === patternId) ?? null;
  const set = intersection.volumeSets.find((s) => s.id === volumeSetId) ?? null;
  const pedestrianPhases = intersection.phases.filter((p) => p.enabled && p.pedestrian.enabled);
  const sequence = pattern ? effectiveSequence(pattern, intersection.rings) : intersection.rings;
  const blocked = intersection.laneGroups.length === 0 ? 'Add lane groups and a count on the Volumes tab to simulate traffic.' : !set ? 'Choose a count to simulate.' : null;

  const run = () => {
    worker.current?.terminate();
    setRunning(true);
    setFailure(null);
    const w = new Worker(new URL('./simulate/simulation.worker.ts', import.meta.url), { type: 'module' });
    worker.current = w;
    const settings = { ...DEFAULT_SIMULATION, patternId: pattern?.id ?? null, volumeSetId, durationSeconds: minutes * 60, warmUpSeconds: warmUp * 60, seed, pedestrianCallsPerHour: pedestrianRates };
    w.onmessage = (event: MessageEvent<SimulationMessage>) => {
      if (event.data.type === 'done') setResult({ result: event.data.result, patternId: settings.patternId, volumeSetId });
      else setFailure(event.data.message);
      setRunning(false);
      w.terminate();
    };
    w.onerror = (event) => {
      setFailure(event.message || 'The simulation stopped unexpectedly');
      setRunning(false);
    };
    const request: SimulationRequest = { intersection, settings, behaviour };
    w.postMessage(request);
  };

  // HCM figures for the same pattern and count, where the pattern has a cycle.
  const hcm = useMemo(() => {
    if (!result?.patternId) return null;
    const linked = { ...intersection, patterns: intersection.patterns.map((p) => (p.id === result.patternId ? { ...p, volumeSetId: result.volumeSetId } : p)) };
    const analysis = analyzePattern(linked, result.patternId);
    return analysis.ok ? analysis : null;
  }, [intersection, result]);

  const number = (label: string, value: number, set: (v: number) => void, min: number, max: number, width = 110) => (
    <TextField
      key={label}
      size="small"
      type="number"
      label={label}
      value={value}
      onChange={(e) => {
        const v = Number(e.target.value);
        if (Number.isFinite(v)) set(Math.min(max, Math.max(min, Math.round(v))));
      }}
      slotProps={{ htmlInput: { min, max } }}
      sx={{ width }}
    />
  );

  const card = (label: string, value: string, hint?: string) => (
    <Box role="group" aria-label={label} sx={{ px: 1.25, py: 0.5, border: 1, borderColor: 'divider', borderRadius: 2, minWidth: 120 }}>
      <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>
        {label}
      </Typography>
      <Typography variant="subtitle1" component="p" sx={{ fontFamily: fontFamilyMono, m: 0 }}>
        {value}
      </Typography>
      {hint ? (
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          {hint}
        </Typography>
      ) : null}
    </Box>
  );

  return (
    <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
      <Section title="Simulation">
        <Box sx={{ p: 1.5, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', alignItems: 'center' }}>
            <TextField select size="small" label="Pattern" value={patternId} onChange={(e) => setPatternId(e.target.value)} sx={{ minWidth: 180 }}>
              <MenuItem value={FREE}>Free (no pattern)</MenuItem>
              {intersection.patterns.map((p) => (
                <MenuItem key={p.id} value={p.id}>
                  {p.name || p.id}
                </MenuItem>
              ))}
            </TextField>
            <TextField select size="small" label="Count" value={volumeSetId} onChange={(e) => setVolumeSetId(e.target.value)} sx={{ minWidth: 160 }} disabled={intersection.volumeSets.length === 0}>
              {intersection.volumeSets.map((s) => (
                <MenuItem key={s.id} value={s.id}>
                  {s.name || s.id}
                </MenuItem>
              ))}
            </TextField>
            <TextField select size="small" label="Controller" value={behaviour} onChange={(e) => setBehaviour(e.target.value as ControllerBehaviour)} sx={{ minWidth: 160 }}>
              {BEHAVIOURS.map((b) => (
                <MenuItem key={b.value} value={b.value} disabled={b.value === 'csm'}>
                  {b.label}
                </MenuItem>
              ))}
            </TextField>
            {number('Minutes', minutes, setMinutes, 1, 480, 100)}
            {number('Warm-up (min)', warmUp, setWarmUp, 0, 60, 120)}
            {number('Seed', seed, setSeed, 1, 1_000_000, 100)}
            <Button variant="contained" startIcon={<PlayArrowRoundedIcon />} onClick={run} disabled={running || blocked !== null}>
              Run
            </Button>
          </Box>
          {pedestrianPhases.length > 0 ? (
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
              <Typography variant="body2" sx={{ color: 'text.secondary', mr: 1 }}>
                Pushbutton calls per hour
              </Typography>
              {pedestrianPhases.map((p) =>
                number(
                  `Phase ${p.number}`,
                  pedestrianRates[String(p.number)] ?? 0,
                  (v) => setPedestrianRates({ ...pedestrianRates, [String(p.number)]: v }),
                  0,
                  3600,
                  96,
                ),
              )}
            </Box>
          ) : null}
          {blocked ? (
            <Alert severity="info" variant="outlined">
              {blocked}
            </Alert>
          ) : null}
          {running ? <LinearProgress aria-label="Simulating" /> : null}
          {failure ? <Alert severity="error">{failure}</Alert> : null}
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            Vehicles arrive at random at the count&apos;s peak 15-minute rate, queue at the stop bar and leave at saturation flow while their phase is green. Runs with the same seed repeat exactly.
          </Typography>
        </Box>
      </Section>

      {result ? (
        <>
          <Section title={`Results · ${result.result.controller}`}>
            <Box sx={{ p: 1.5, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                {card('Mean delay', result.result.meanDelay === null ? '—' : `${result.result.meanDelay.toFixed(1)} s`, hcm?.delay != null ? `HCM ${hcm.delay.toFixed(1)} s` : undefined)}
                {card('Cycle', statText(result.result.cycle), `${result.result.cycle.count} cycles`)}
                {card('Simulated', `${((result.result.ticks - result.result.warmUpTicks) / 20 / 60).toFixed(0)} min`, `after ${(result.result.warmUpTicks / 20 / 60).toFixed(0)} min warm-up`)}
              </Box>

              <Box sx={{ overflowX: 'auto', border: 1, borderColor: 'divider', borderRadius: 1 }}>
                <Box component="table" aria-label="Phase results" sx={{ borderCollapse: 'separate', borderSpacing: 0, fontSize: 13, width: '100%', minWidth: 680 }}>
                  <thead>
                    <tr>
                      {['Phase', 'Served', 'Green, s: mean (min–max)', 'Gap-out', 'Max-out', 'Force-off', 'Yield', 'Walks'].map((h, k) => (
                        <Box component="th" key={h} scope="col" sx={{ ...headSx, textAlign: k >= 1 ? 'right' : 'left' }}>
                          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                            {h}
                          </Typography>
                        </Box>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.result.phases.map((p) => (
                      <tr key={p.phase}>
                        <Box component="td" sx={cellSx}>
                          {p.phase} {intersection.phases.find((x) => x.number === p.phase)?.label}
                        </Box>
                        {[
                          p.servedShare === null ? '—' : `${Math.round(p.servedShare * 100)} %`,
                          statText(p.green),
                          p.terminations['gap-out'],
                          p.terminations['max-out'],
                          p.terminations['force-off'],
                          p.terminations.yield,
                          p.walks,
                        ].map((v, k) => (
                          <Box component="td" key={k} sx={{ ...numberCellSx, fontFamily: fontFamilyMono }}>
                            {v}
                          </Box>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </Box>
              </Box>

              <Box sx={{ overflowX: 'auto', border: 1, borderColor: 'divider', borderRadius: 1 }}>
                <Box component="table" aria-label="Lane group results" sx={{ borderCollapse: 'separate', borderSpacing: 0, fontSize: 13, width: '100%', minWidth: 620 }}>
                  <thead>
                    <tr>
                      {['Lane group', 'Phase', 'Arrivals', 'Delay, s', 'HCM delay, s', 'Max queue', 'Queue at end'].map((h, k) => (
                        <Box component="th" key={h} scope="col" sx={{ ...headSx, textAlign: k >= 1 ? 'right' : 'left' }}>
                          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                            {h}
                          </Typography>
                        </Box>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.result.laneGroups.map((l) => {
                      const h = hcm?.laneGroups.find((g) => g.laneGroupId === l.laneGroupId);
                      return (
                        <tr key={l.laneGroupId}>
                          <Box component="td" sx={cellSx}>
                            {l.label || 'Lane group'}
                          </Box>
                          {[l.phase, l.arrivals, n1(l.meanDelay), h ? n1(h.delay) : '—', l.maxQueue, l.finalQueue].map((v, k) => (
                            <Box component="td" key={k} sx={{ ...numberCellSx, fontFamily: fontFamilyMono }}>
                              {v}
                            </Box>
                          ))}
                        </tr>
                      );
                    })}
                  </tbody>
                </Box>
              </Box>
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                Delay is time spent queued at the stop bar, from arrival to departure. The HCM column is the Volumes tab&apos;s analysis of the same pattern and count, which assumes the splits run as programmed. Cycles are counted between
                {pattern?.mode === 'coordinated' ? ' yields of the coordinated phases' : ' returns to the first barrier group'}. A growing queue at the end means demand exceeds what the phase serves.
              </Typography>
            </Box>
          </Section>

          <Section title="Playback">
            <Box sx={{ p: 1.5 }}>
              <Playback intersection={intersection} sequence={sequence} result={result.result} />
            </Box>
          </Section>
        </>
      ) : null}
    </Box>
  );
}

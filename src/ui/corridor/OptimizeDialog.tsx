/**
 * Offset optimization for a corridor timing plan: choose the objective, run the search in a
 * worker, compare current and proposed offsets and bands, and apply them as one undo step.
 */
import { useEffect, useRef, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import FormControlLabel from '@mui/material/FormControlLabel';
import LinearProgress from '@mui/material/LinearProgress';
import Radio from '@mui/material/Radio';
import RadioGroup from '@mui/material/RadioGroup';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { prepareOptimization, type Objective, type OptimizeResult } from '../../engine';
import { formatSeconds, type Corridor, type CorridorPlan, type Project } from '../../model';
import { useWorkspace } from '../state/workspace';
import { fontFamilyMono } from '../theme/themePrimitives';
import type { OptimizerMessage, OptimizerRequest } from './optimizer.worker';

interface OptimizeDialogProps {
  open: boolean;
  onClose: () => void;
  project: Project;
  corridor: Corridor;
  plan: CorridorPlan;
  labels: { outbound: string; inbound: string };
}

const REASONS = {
  'cycle-mismatch': 'The intersections in this plan run different cycles. Give them a common cycle first.',
  'too-few-intersections': 'At least two intersections in this plan need a coordinated pattern.',
  'no-bands': 'No intersection has through phases chosen, so there is no band to widen.',
} as const;

export default function OptimizeDialog({ open, onClose, project, corridor, plan, labels }: OptimizeDialogProps) {
  const edit = useWorkspace((s) => s.edit);
  const [objective, setObjective] = useState<Objective>('weighted');
  const [progress, setProgress] = useState<number | null>(null);
  const [result, setResult] = useState<OptimizeResult | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const worker = useRef<Worker | null>(null);
  const prepared = open ? prepareOptimization(project, corridor, plan) : null;

  const stop = () => {
    worker.current?.terminate();
    worker.current = null;
    setProgress(null);
  };
  useEffect(() => stop, []);

  const close = () => {
    stop();
    setResult(null);
    setFailure(null);
    onClose();
  };

  const run = () => {
    if (!prepared?.ok) return;
    stop();
    setResult(null);
    setFailure(null);
    setProgress(0);
    const w = new Worker(new URL('./optimizer.worker.ts', import.meta.url), { type: 'module' });
    worker.current = w;
    w.onmessage = (event: MessageEvent<OptimizerMessage>) => {
      const message = event.data;
      if (message.type === 'progress') setProgress(message.fraction);
      else {
        if (message.type === 'done') setResult(message.result);
        else setFailure(message.message);
        stop();
      }
    };
    w.onerror = (event) => {
      setFailure(event.message || 'The optimizer stopped unexpectedly');
      stop();
    };
    const request: OptimizerRequest = { prepared, options: { objective } };
    w.postMessage(request);
  };

  const apply = () => {
    if (!result || !prepared?.ok) return;
    edit(`Optimize offsets for ${plan.name}`, (p) => {
      prepared.stops.forEach((stop, k) => {
        const intersection = p.intersections.find((i) => i.id === stop.intersectionId);
        const pattern = intersection?.patterns.find((x) => x.id === plan.patterns[stop.intersectionId]);
        if (pattern) pattern.offset = result.offsets[k]!;
      });
    });
    close();
  };

  const cell = { px: 1, py: 0.5, borderBottom: 1, borderColor: 'divider', fontSize: 13 } as const;
  const num = { ...cell, textAlign: 'right', fontFamily: fontFamilyMono } as const;
  const head = { ...cell, fontWeight: 500, fontSize: 12, color: 'text.secondary' } as const;

  return (
    <Dialog open={open} onClose={close} fullWidth maxWidth="sm" aria-labelledby="optimize-title">
      <DialogTitle id="optimize-title">Optimize offsets · {plan.name}</DialogTitle>
      <DialogContent dividers>
        {prepared && !prepared.ok ? (
          <Alert severity="info">{REASONS[prepared.reason]}</Alert>
        ) : prepared?.ok ? (
          <Stack spacing={2}>
            <Typography variant="body2">
              Searches every intersection&apos;s offset in whole seconds for the widest green bands at the progression speeds. {prepared.stops[0]!.name} keeps its offset; the others move relative to it.
              {prepared.stops.length > 4 ? ' With more than four intersections the search tries many starting points rather than every combination.' : ''}
            </Typography>
            <RadioGroup value={objective} onChange={(e) => setObjective(e.target.value as Objective)} aria-label="Objective">
              <FormControlLabel value="weighted" control={<Radio size="small" />} label={`Widest bands, weighted ${labels.outbound} ${plan.weights.outbound} : ${labels.inbound} ${plan.weights.inbound}`} />
              <FormControlLabel value="balanced" control={<Radio size="small" />} label="Balanced: widen the narrower direction first" />
            </RadioGroup>
            {progress !== null ? <LinearProgress variant="determinate" value={progress * 100} aria-label="Optimization progress" /> : null}
            {failure ? <Alert severity="error">{failure}</Alert> : null}
            {result ? (
              <Box>
                <Box component="table" aria-label="Optimization results" sx={{ borderCollapse: 'collapse', width: '100%' }}>
                  <thead>
                    <tr>
                      <Box component="th" sx={head}>
                        Intersection
                      </Box>
                      <Box component="th" sx={{ ...head, textAlign: 'right' }}>
                        Current offset
                      </Box>
                      <Box component="th" sx={{ ...head, textAlign: 'right' }}>
                        Proposed
                      </Box>
                    </tr>
                  </thead>
                  <tbody>
                    {prepared.stops.map((stop, k) => (
                      <tr key={stop.intersectionId}>
                        <Box component="td" sx={cell}>
                          {stop.name}
                        </Box>
                        <Box component="td" sx={num}>
                          {formatSeconds(stop.currentOffset)} s
                        </Box>
                        <Box component="td" sx={{ ...num, fontWeight: result.offsets[k] !== stop.currentOffset ? 600 : 400 }}>
                          {formatSeconds(result.offsets[k]!)} s
                        </Box>
                      </tr>
                    ))}
                    {(['outbound', 'inbound'] as const).map((direction) => (
                      <tr key={direction}>
                        <Box component="td" sx={{ ...cell, color: 'text.secondary' }}>
                          {labels[direction]} band
                        </Box>
                        <Box component="td" sx={num}>
                          {formatSeconds(result.current.bandwidth[direction])} s
                        </Box>
                        <Box component="td" sx={{ ...num, fontWeight: 600, color: direction === 'outbound' ? 'primary.main' : 'warning.main' }}>
                          {formatSeconds(result.bandwidth[direction])} s
                        </Box>
                      </tr>
                    ))}
                  </tbody>
                </Box>
                <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 0.5 }}>
                  {result.method === 'exhaustive' ? 'Every combination was checked' : 'Best of many starting points'} ({result.evaluations.toLocaleString()} evaluated). Offsets are measured to each pattern&apos;s own reference point.
                </Typography>
              </Box>
            ) : null}
          </Stack>
        ) : null}
      </DialogContent>
      <DialogActions>
        <Button onClick={close}>{result ? 'Cancel' : 'Close'}</Button>
        {result ? (
          <Button variant="contained" onClick={apply} disabled={!prepared?.ok || result.offsets.every((o, k) => o === prepared.stops[k]!.currentOffset)}>
            Apply offsets
          </Button>
        ) : (
          <Button variant="contained" onClick={run} disabled={!prepared?.ok || progress !== null}>
            {progress !== null ? 'Optimizing…' : 'Optimize'}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}

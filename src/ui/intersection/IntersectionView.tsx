/**
 * The intersection view in the diagram panel: the scene inferred from the plan, drawn in plan or
 * oblique view, with every signal head showing its interval at a point of the cycle that can be
 * scrubbed or played. Without a projection (a free pattern, or one with blocking errors) the
 * geometry is still drawn and the heads are dark.
 */
import { useMemo, useState } from 'react';
import PauseRoundedIcon from '@mui/icons-material/PauseRounded';
import PlayArrowRoundedIcon from '@mui/icons-material/PlayArrowRounded';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Slider from '@mui/material/Slider';
import Stack from '@mui/material/Stack';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Typography from '@mui/material/Typography';
import { buildScene, headStatesAt, overlapStatesAt, PEDESTRIAN_SIGNAL_LABEL, signalFor, VEHICLE_SIGNAL_LABEL, type ProjectionResult, type SceneView } from '../../engine';
import { formatSeconds, type Intersection } from '../../model';
import { useWorkspace } from '../state/workspace';
import { fontFamilyMono } from '../theme/themePrimitives';
import IntersectionDrawing from './IntersectionDrawing';
import { useCyclePlayer } from './useCyclePlayer';

const visuallyHidden = {
  position: 'absolute',
  width: '1px',
  height: '1px',
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
} as const;

export interface IntersectionViewProps {
  intersection: Intersection;
  /** The selected pattern's projection; `null` when there is no pattern. */
  result: ProjectionResult | null;
}

export default function IntersectionView({ intersection, result }: IntersectionViewProps) {
  const lengthUnit = useWorkspace((s) => s.project?.units.length ?? 'm');
  const [view, setView] = useState<SceneView>('plan');
  const scene = useMemo(() => buildScene(intersection, { lengthUnit }), [intersection, lengthUnit]);
  const projection = result?.ok ? result.projection : null;
  const cycle = projection?.cycle ?? 0;
  const player = useCyclePlayer(cycle);
  const time = Math.min(player.time, Math.max(0, cycle - 1));
  const states = useMemo(() => (projection ? headStatesAt(projection, time) : null), [projection, time]);
  const overlaps = useMemo(() => (projection ? overlapStatesAt(projection, intersection, time) : null), [projection, intersection, time]);
  const flashOn = !player.playing || player.reducedMotion || Math.floor(time / 5) % 2 === 0;

  const phases = intersection.phases.filter((p) => p.enabled);
  const signalled = new Set(scene.heads.flatMap((h) => h.phases));
  const viewName = view === 'plan' ? 'Plan' : 'Oblique';

  return (
    <Stack spacing={1}>
      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
        <ToggleButtonGroup size="small" exclusive value={view} onChange={(_, next: SceneView | null) => next && setView(next)} aria-label="Intersection view">
          <ToggleButton value="plan" sx={{ px: 1.25, py: 0.25 }}>
            Plan
          </ToggleButton>
          <ToggleButton value="oblique" sx={{ px: 1.25, py: 0.25 }}>
            Oblique
          </ToggleButton>
        </ToggleButtonGroup>
        {projection ? (
          <IconButton size="small" aria-label={player.playing ? 'Pause cycle' : 'Play cycle'} onClick={() => player.setPlaying(!player.playing)}>
            {player.playing ? <PauseRoundedIcon /> : <PlayArrowRoundedIcon />}
          </IconButton>
        ) : null}
      </Stack>

      {scene.legs.length > 0 ? (
        <IntersectionDrawing scene={scene} view={view} states={states} overlaps={overlaps} flashOn={flashOn} label={`${viewName} view of ${intersection.name}`} />
      ) : (
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          Give the phases directions of travel on the Phases tab to draw the intersection.
        </Typography>
      )}

      {projection ? (
        <Stack direction="row" sx={{ alignItems: 'center', gap: 1.5 }}>
          <Slider
            size="small"
            aria-label="Cycle time"
            value={time}
            min={0}
            max={Math.max(0, cycle - 1)}
            step={1}
            shiftStep={50}
            onChange={(_, value) => player.setTime(value as number)}
            getAriaValueText={(value) => `${formatSeconds(value)} s`}
            sx={{ flex: 1, mx: 1 }}
          />
          <Typography
            variant="body2"
            sx={{
              fontFamily: fontFamilyMono,
              minWidth: 92,
              textAlign: 'right',
              whiteSpace: 'nowrap',
            }}
          >
            {formatSeconds(time)} / {formatSeconds(cycle)} s
          </Typography>
        </Stack>
      ) : (
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          {result && !result.ok && result.issues[0]?.code === 'projection.free-pattern'
            ? 'This pattern runs free, so its signals have no fixed point in a cycle. Heads are shown dark.'
            : result
              ? 'Fix the problems in this pattern to see its signals. Heads are shown dark.'
              : 'Add a coordinated pattern to see its signals. Heads are shown dark.'}
        </Typography>
      )}

      {scene.assumptions.length > 0 || scene.unplacedPhases.length > 0 ? (
        <Box component="ul" sx={{ m: 0, pl: 2, color: 'text.secondary', typography: 'caption' }}>
          {scene.assumptions.map((a) => (
            <li key={a}>{a}</li>
          ))}
          {scene.unplacedPhases.length > 0 ? <li>Not drawn (no direction of travel): phase {scene.unplacedPhases.join(', ')}.</li> : null}
        </Box>
      ) : null}

      <Box component="ul" aria-label="Signal heads" sx={visuallyHidden}>
        {phases
          .filter((p) => signalled.has(p.number))
          .map((p) => {
            const signal = signalFor(states, p.number);
            const name = p.label && p.label !== `Phase ${p.number}` ? `Phase ${p.number} ${p.label}` : `Phase ${p.number}`;
            const parts = [
              ...(p.movement.kind === 'pedestrian' ? [] : [VEHICLE_SIGNAL_LABEL[signal.vehicle]]),
              ...(signal.pedestrian ? [signal.pedestrian === 'dark' ? 'pedestrian signal dark' : PEDESTRIAN_SIGNAL_LABEL[signal.pedestrian]] : []),
            ];
            return <li key={p.number}>{`${name}: ${parts.join(', ')}`}</li>;
          })}
        {scene.heads
          .filter((h) => h.overlap !== undefined)
          .map((h) => (
            <li key={h.id}>{`Overlap ${h.overlap}: ${VEHICLE_SIGNAL_LABEL[overlaps?.get(h.overlap!) ?? 'dark']}`}</li>
          ))}
      </Box>
    </Stack>
  );
}

/**
 * The live ring-barrier diagram docked beside the editor, with the cycle clock, the pattern's
 * offset, force-offs and the free-operation cycle bounds.
 */
import { useMemo } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { convertOffset, cycleBounds, projectCycle, toLocal } from '../../engine';
import { formatSeconds, tenthsToTicks, type Intersection } from '../../model';
import CycleClock from '../diagram/CycleClock';
import { flaggedPhases } from '../diagram/flags';
import { REFERENCE_LABEL } from '../diagram/diagramText';
import RingBarrierDiagram from '../diagram/RingBarrierDiagram';
import { fontFamilyMono } from '../theme/themePrimitives';
import { useWorkspace } from '../state/workspace';

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

export default function DiagramPanel({ intersection, patternId }: { intersection: Intersection; patternId: string | null }) {
  const selectPattern = useWorkspace((s) => s.selectPattern);
  const pattern = intersection.patterns.find((p) => p.id === patternId) ?? intersection.patterns[0] ?? null;
  const result = useMemo(() => (pattern ? projectCycle(intersection, pattern.id) : null), [intersection, pattern]);
  const bounds = useMemo(() => cycleBounds(intersection, pattern?.maxGreen === 'max2'), [intersection, pattern]);
  const errors = result?.ok ? result.issues.length : 0;

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
            {errors > 0 ? (
              <Alert severity="warning" variant="outlined">
                This pattern has {errors} error{errors === 1 ? '' : 's'}. The diagram shows the timing as entered; outlined phases need attention.
              </Alert>
            ) : null}
            <RingBarrierDiagram projection={result.projection} intersection={intersection} flagged={flaggedPhases(intersection, result.issues)} />
            <Box>
              <Typography variant="overline" sx={{ color: 'text.secondary' }}>
                Cycle clock
              </Typography>
              <CycleClock projection={result.projection} />
            </Box>
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
                {result.projection.rings
                  .flat()
                  .filter((i) => !i.coordinated)
                  .sort((a, b) => a.phase - b.phase)
                  .map((i) => (
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

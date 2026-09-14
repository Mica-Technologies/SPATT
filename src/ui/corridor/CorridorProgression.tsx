/**
 * The time-space tab: a timing plan's diagram, its bands, and each intersection's offset, which
 * can be typed or changed by dragging the intersection on the diagram.
 */
import { useMemo, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { analyzeProgression, mod, type Direction, type OffsetOverrides } from '../../engine';
import { formatSeconds, oppositeDirection, type Corridor, type Project } from '../../model';
import { REFERENCE_LABEL } from '../diagram/diagramText';
import { SecondsInput } from '../fields/GridInputs';
import { useWorkspace } from '../state/workspace';
import { fontFamilyMono } from '../theme/themePrimitives';
import TimeSpaceDiagram from './TimeSpaceDiagram';

export default function CorridorProgression({ project, corridor }: { project: Project; corridor: Corridor }) {
  const edit = useWorkspace((s) => s.edit);
  const selectedPlanId = useWorkspace((s) => s.selectedPlanId);
  const selectPlan = useWorkspace((s) => s.selectPlan);
  const [cycles, setCycles] = useState(2);
  const [preview, setPreview] = useState<OffsetOverrides>({});
  const plan = corridor.plans.find((p) => p.id === selectedPlanId) ?? corridor.plans[0] ?? null;
  const progression = useMemo(() => (plan ? analyzeProgression(project, corridor, plan, preview) : null), [project, corridor, plan, preview]);
  const labels: Record<Direction, string> = { outbound: `${corridor.outbound}B`, inbound: `${oppositeDirection(corridor.outbound)}B` };
  const intersections = new Map(project.intersections.map((i) => [i.id, i]));

  const patternOf = (intersectionId: string) => {
    const intersection = intersections.get(intersectionId);
    const patternId = plan?.patterns[intersectionId];
    const pattern = intersection?.patterns.find((p) => p.id === patternId);
    return intersection && pattern ? { intersection, pattern, intersectionIndex: project.intersections.indexOf(intersection) } : null;
  };

  const setOffset = (intersectionId: string, offset: number, label: string) => {
    const found = patternOf(intersectionId);
    if (!found) return;
    edit(label, (p) => {
      const pattern = p.intersections[found.intersectionIndex]?.patterns.find((x) => x.id === found.pattern.id);
      if (pattern) pattern.offset = mod(offset, pattern.cycle);
    });
  };

  if (!plan || !progression) {
    return (
      <Typography variant="body2" sx={{ color: 'text.secondary', p: 2 }}>
        Add a timing plan to see its time-space diagram.
      </Typography>
    );
  }

  const weights = plan.weights;
  const stat = (direction: Direction) => {
    const band = progression.bands[direction];
    return (
      <Box key={direction} role="group" aria-label={`${labels[direction]} band`} sx={{ px: 1.5, py: 1, border: 1, borderColor: 'divider', borderRadius: 2, bgcolor: 'background.paper', minWidth: 170 }}>
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          {direction === 'outbound' ? 'Outbound' : 'Inbound'} {labels[direction]} band · weight {weights[direction]}
        </Typography>
        <Typography variant="h6" component="p" sx={{ fontFamily: fontFamilyMono, color: direction === 'outbound' ? 'primary.main' : 'warning.main' }}>
          {band.bandwidth === null ? '—' : `${formatSeconds(band.bandwidth)} s`}
        </Typography>
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          {band.efficiency === null ? 'not computed' : `${Math.round(band.efficiency * 100)} % of the cycle`}
        </Typography>
      </Box>
    );
  };

  return (
    <Stack spacing={2} sx={{ p: 2 }}>
      <Stack direction="row" spacing={2} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}>
        <TextField select size="small" label="Timing plan" value={plan.id} onChange={(e) => selectPlan(e.target.value)} sx={{ minWidth: 180 }}>
          {corridor.plans.map((p) => (
            <MenuItem key={p.id} value={p.id}>
              {p.name || 'Untitled plan'}
            </MenuItem>
          ))}
        </TextField>
        <TextField select size="small" label="Cycles shown" value={cycles} onChange={(e) => setCycles(Number(e.target.value))} sx={{ width: 130 }}>
          {[1, 2, 3, 4].map((n) => (
            <MenuItem key={n} value={n}>
              {n}
            </MenuItem>
          ))}
        </TextField>
        {stat('outbound')}
        {stat('inbound')}
        <Box sx={{ flexGrow: 1 }} />
      </Stack>

      {progression.cycle === null ? (
        <Alert severity="warning">The intersections in this plan run different cycles, so there is no repeating green band. Give them a common cycle to see the bands.</Alert>
      ) : null}

      <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 2, bgcolor: 'background.paper', p: 1 }}>
        <TimeSpaceDiagram
          progression={progression}
          cycles={cycles}
          labels={labels}
          onDrag={(id, delta, done) => {
            const found = patternOf(id);
            if (!found) return;
            if (done) {
              setPreview({});
              if (delta !== 0) setOffset(id, found.pattern.offset + delta, `Move ${found.intersection.name}'s offset`);
            } else {
              setPreview({ [id]: mod(found.pattern.offset + delta, found.pattern.cycle) });
            }
          }}
        />
      </Box>
      <Typography variant="caption" sx={{ color: 'text.secondary' }}>
        Green and red bars show when each intersection&apos;s through phases are green ({labels.outbound} above the line, {labels.inbound} below). The shaded bands are the vehicles that meet green at every intersection at the progression speed. Drag an intersection sideways to move its offset in whole seconds.
      </Typography>

      <Box sx={{ overflowX: 'auto', border: 1, borderColor: 'divider', borderRadius: 2, bgcolor: 'background.paper' }}>
        <Box component="table" sx={{ borderCollapse: 'separate', borderSpacing: 0, width: '100%', fontSize: 13 }}>
          <thead>
            <tr>
              {['Intersection', 'Pattern', 'Cycle', 'Offset (s)', 'Measured to'].map((h) => (
                <Box component="th" key={h} sx={{ px: 1, py: 0.75, textAlign: 'left', fontWeight: 500, fontSize: 12, color: 'text.secondary', borderBottom: 1, borderColor: 'divider' }}>
                  {h}
                </Box>
              ))}
            </tr>
          </thead>
          <tbody>
            {corridor.stops.map((stop) => {
              const found = patternOf(stop.intersectionId);
              const cell = { px: 1, py: 0.5, borderBottom: 1, borderColor: 'divider' } as const;
              return (
                <tr key={stop.intersectionId}>
                  <Box component="td" sx={{ ...cell, fontWeight: 500 }}>
                    {intersections.get(stop.intersectionId)?.name ?? 'Missing intersection'}
                  </Box>
                  <Box component="td" sx={cell}>
                    {found ? found.pattern.name : 'Not in this plan'}
                  </Box>
                  <Box component="td" sx={{ ...cell, fontFamily: fontFamilyMono }}>
                    {found?.pattern.mode === 'coordinated' ? `${formatSeconds(found.pattern.cycle)} s` : '—'}
                  </Box>
                  <Box component="td" sx={{ ...cell, width: 110 }}>
                    {found?.pattern.mode === 'coordinated' ? (
                      <SecondsInput
                        path={['intersections', found.intersectionIndex, 'patterns', found.intersection.patterns.indexOf(found.pattern), 'offset']}
                        label={`Offset at ${found.intersection.name}`}
                        value={preview[stop.intersectionId] ?? found.pattern.offset}
                        onCommit={(v) => setOffset(stop.intersectionId, v, `${found.intersection.name} offset`)}
                      />
                    ) : null}
                  </Box>
                  <Box component="td" sx={{ ...cell, color: 'text.secondary' }}>
                    {found?.pattern.mode === 'coordinated' ? REFERENCE_LABEL[found.pattern.offsetReference] : ''}
                  </Box>
                </tr>
              );
            })}
          </tbody>
        </Box>
      </Box>
    </Stack>
  );
}

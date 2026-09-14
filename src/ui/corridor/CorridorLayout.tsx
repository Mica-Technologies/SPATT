/**
 * A corridor's layout: its intersections in travel order (drag or move to reorder), the link
 * from each to the next (distance, progression speed each way, speed limit), and the phases
 * carrying through traffic each way.
 */
import { useState } from 'react';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import ArrowDownwardRoundedIcon from '@mui/icons-material/ArrowDownwardRounded';
import ArrowUpwardRoundedIcon from '@mui/icons-material/ArrowUpwardRounded';
import AutoFixHighRoundedIcon from '@mui/icons-material/AutoFixHighRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import DragIndicatorRoundedIcon from '@mui/icons-material/DragIndicatorRounded';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import {
  fromMetres,
  fromMetresPerSecond,
  LENGTH_LABEL,
  newCorridorStop,
  oppositeDirection,
  SPEED_LABEL,
  suggestThroughPhases,
  toMetres,
  toMetresPerSecond,
  type Approach,
  type Corridor,
  type Intersection,
  type Issue,
  type Project,
} from '../../model';
import { MeasureInput } from '../fields/GridInputs';
import { APPROACHES } from '../fields/phaseOptions';
import { fieldId, issuesFor, type FieldPath } from '../fields/paths';
import { useWorkspace } from '../state/workspace';

const DIRECTIONS = APPROACHES.filter((a) => a.value !== '') as { value: Approach; label: string }[];
const directionLabel = (d: Approach) => `${d}B`;

interface CorridorLayoutProps {
  project: Project;
  corridor: Corridor;
  corridorIndex: number;
  issues: readonly Issue[];
}

function PhaseToggles({ intersection, value, onChange, label, path, issues }: { intersection: Intersection; value: number[]; onChange: (phases: number[]) => void; label: string; path: FieldPath; issues: readonly Issue[] }) {
  const enabled = intersection.phases.filter((p) => p.enabled);
  const flagged = issuesFor(issues, path).length > 0;
  return (
    <ToggleButtonGroup
      id={fieldId(path)}
      size="small"
      value={value}
      onChange={(_, next: number[]) => onChange([...next].sort((a, b) => a - b))}
      aria-label={label}
      sx={{ flexWrap: 'wrap', ...(flagged ? { outline: 2, outlineColor: 'error.main', outlineStyle: 'solid', borderRadius: 1 } : {}) }}
    >
      {enabled.map((phase) => (
        <Tooltip key={phase.number} title={`${phase.label || `Phase ${phase.number}`}${phase.movement.approach ? ` · ${phase.movement.approach}B ${phase.movement.kind}` : ''}`}>
          <ToggleButton value={phase.number} aria-label={`Phase ${phase.number}`} sx={{ minWidth: 30, px: 0.75, py: 0.25 }}>
            {phase.number}
          </ToggleButton>
        </Tooltip>
      ))}
    </ToggleButtonGroup>
  );
}

export default function CorridorLayout({ project, corridor, corridorIndex, issues }: CorridorLayoutProps) {
  const editCorridor = useWorkspace((s) => s.editCorridor);
  const [adding, setAdding] = useState('');
  const [dragging, setDragging] = useState<number | null>(null);
  const units = project.units;
  const intersections = new Map(project.intersections.map((i) => [i.id, i]));
  const available = project.intersections.filter((i) => !corridor.stops.some((s) => s.intersectionId === i.id));
  const base: FieldPath = ['corridors', corridorIndex];
  const len = { toDisplay: (m: number) => fromMetres(m, units.length), fromDisplay: (v: number) => toMetres(v, units.length) };
  const spd = { toDisplay: (v: number) => fromMetresPerSecond(v, units.speed), fromDisplay: (v: number) => toMetresPerSecond(v, units.speed) };

  const move = (from: number, to: number) => {
    if (from === to || to < 0 || to >= corridor.stops.length) return;
    editCorridor('Reorder intersections', (c) => {
      const [stop] = c.stops.splice(from, 1);
      c.stops.splice(to, 0, stop!);
      // The first stop has no link before it; a stop that was first gets a default link.
      c.stops.forEach((s, k) => {
        if (k === 0) s.distance = 0;
        else if (s.distance === 0) s.distance = 300;
      });
    });
  };

  const headCell = { px: 1, py: 0.75, textAlign: 'left', fontWeight: 500, fontSize: 12, color: 'text.secondary', borderBottom: 1, borderColor: 'divider', whiteSpace: 'nowrap' } as const;
  const cell = { px: 1, py: 0.75, borderBottom: 1, borderColor: 'divider', verticalAlign: 'middle' } as const;

  return (
    <Stack spacing={2} sx={{ p: 2 }}>
      <Stack direction="row" spacing={2} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}>
        <TextField
          select
          size="small"
          label="Outbound direction"
          value={corridor.outbound}
          onChange={(e) => editCorridor('Change outbound direction', (c) => (c.outbound = e.target.value as Approach))}
          sx={{ width: 180 }}
        >
          {DIRECTIONS.map((d) => (
            <MenuItem key={d.value} value={d.value}>
              {d.label}
            </MenuItem>
          ))}
        </TextField>
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          Outbound runs from the first intersection to the last ({directionLabel(corridor.outbound)}); inbound is {directionLabel(oppositeDirection(corridor.outbound))}.
        </Typography>
        <Box sx={{ flexGrow: 1 }} />
        <Tooltip title="Choose each intersection's through phases from their directions of travel">
          <span>
            <Button
              size="small"
              variant="outlined"
              startIcon={<AutoFixHighRoundedIcon />}
              disabled={corridor.stops.length === 0}
              onClick={() =>
                editCorridor('Suggest through phases', (c, p) => {
                  for (const stop of c.stops) {
                    const intersection = p.intersections.find((i) => i.id === stop.intersectionId);
                    if (intersection) Object.assign(stop, suggestThroughPhases(intersection, c.outbound));
                  }
                })
              }
            >
              Suggest through phases
            </Button>
          </span>
        </Tooltip>
      </Stack>

      <Box sx={{ overflowX: 'auto', border: 1, borderColor: 'divider', borderRadius: 2, bgcolor: 'background.paper' }}>
        <Box component="table" sx={{ borderCollapse: 'separate', borderSpacing: 0, width: '100%', fontSize: 13 }}>
          <thead>
            <tr>
              <Box component="th" sx={{ ...headCell, width: 28 }} />
              <Box component="th" sx={headCell}>
                Intersection
              </Box>
              <Box component="th" sx={{ ...headCell, textAlign: 'right' }}>
                Distance from previous ({LENGTH_LABEL[units.length]})
              </Box>
              <Box component="th" sx={{ ...headCell, textAlign: 'right' }}>
                Speed {directionLabel(corridor.outbound)} ({SPEED_LABEL[units.speed]})
              </Box>
              <Box component="th" sx={{ ...headCell, textAlign: 'right' }}>
                Speed {directionLabel(oppositeDirection(corridor.outbound))} ({SPEED_LABEL[units.speed]})
              </Box>
              <Box component="th" sx={{ ...headCell, textAlign: 'right' }}>
                Speed limit
              </Box>
              <Box component="th" sx={headCell}>
                Through phases {directionLabel(corridor.outbound)}
              </Box>
              <Box component="th" sx={headCell}>
                Through phases {directionLabel(oppositeDirection(corridor.outbound))}
              </Box>
              <Box component="th" sx={{ ...headCell, width: 104 }} />
            </tr>
          </thead>
          <tbody>
            {corridor.stops.map((stop, k) => {
              const intersection = intersections.get(stop.intersectionId);
              const at: FieldPath = [...base, 'stops', k];
              const set = (label: string, recipe: (s: typeof stop) => void) => editCorridor(label, (c) => recipe(c.stops[k]!));
              return (
                <Box
                  component="tr"
                  key={stop.intersectionId}
                  aria-label={`Stop ${k + 1}, ${intersection?.name ?? 'missing intersection'}`}
                  onDragOver={(e) => dragging !== null && e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (dragging !== null) move(dragging, k);
                    setDragging(null);
                  }}
                  sx={{ opacity: dragging === k ? 0.5 : 1 }}
                >
                  <Box component="td" sx={{ ...cell, cursor: 'grab', color: 'text.disabled' }} draggable onDragStart={() => setDragging(k)} onDragEnd={() => setDragging(null)}>
                    <DragIndicatorRoundedIcon fontSize="small" aria-hidden />
                  </Box>
                  <Box component="td" id={fieldId([...at, 'intersectionId'])} tabIndex={-1} sx={{ ...cell, fontWeight: 500, color: intersection ? 'text.primary' : 'error.main' }}>
                    {intersection?.name ?? 'Missing intersection'}
                  </Box>
                  <Box component="td" sx={{ ...cell, width: 130 }}>
                    {k === 0 ? (
                      <Typography variant="body2" sx={{ color: 'text.disabled', textAlign: 'right' }}>
                        start
                      </Typography>
                    ) : (
                      <MeasureInput path={[...at, 'distance']} label={`Distance to ${intersection?.name ?? 'stop'}`} value={stop.distance} {...len} issues={issuesFor(issues, [...at, 'distance'])} onCommit={(v) => set('Change distance', (s) => (s.distance = v ?? 0))} />
                    )}
                  </Box>
                  {(['outbound', 'inbound'] as const).map((direction) => (
                    <Box component="td" key={direction} sx={{ ...cell, width: 110 }}>
                      {k === 0 ? null : (
                        <MeasureInput
                          path={[...at, 'speed', direction]}
                          label={`${direction === 'outbound' ? 'Outbound' : 'Inbound'} speed to ${intersection?.name ?? 'stop'}`}
                          value={stop.speed[direction]}
                          {...spd}
                          issues={issuesFor(issues, [...at, 'speed', direction])}
                          onCommit={(v) => set('Change speed', (s) => (s.speed[direction] = v ?? 0))}
                        />
                      )}
                    </Box>
                  ))}
                  <Box component="td" sx={{ ...cell, width: 100 }}>
                    {k === 0 ? null : <MeasureInput path={[...at, 'speedLimit']} label={`Speed limit to ${intersection?.name ?? 'stop'}`} value={stop.speedLimit} optional {...spd} onCommit={(v) => set('Change speed limit', (s) => (s.speedLimit = v))} />}
                  </Box>
                  {(['outboundPhases', 'inboundPhases'] as const).map((key) => (
                    <Box component="td" key={key} sx={cell}>
                      {intersection ? (
                        <PhaseToggles
                          intersection={intersection}
                          value={stop[key]}
                          path={[...at, key]}
                          issues={issues}
                          label={`${key === 'outboundPhases' ? 'Outbound' : 'Inbound'} through phases at ${intersection.name}`}
                          onChange={(phases) => set('Change through phases', (s) => (s[key] = phases))}
                        />
                      ) : null}
                    </Box>
                  ))}
                  <Box component="td" sx={{ ...cell, whiteSpace: 'nowrap', textAlign: 'right' }}>
                    <IconButton size="small" aria-label={`Move ${intersection?.name ?? 'stop'} earlier`} disabled={k === 0} onClick={() => move(k, k - 1)}>
                      <ArrowUpwardRoundedIcon fontSize="small" />
                    </IconButton>
                    <IconButton size="small" aria-label={`Move ${intersection?.name ?? 'stop'} later`} disabled={k === corridor.stops.length - 1} onClick={() => move(k, k + 1)}>
                      <ArrowDownwardRoundedIcon fontSize="small" />
                    </IconButton>
                    <IconButton
                      size="small"
                      aria-label={`Remove ${intersection?.name ?? 'stop'} from the corridor`}
                      onClick={() =>
                        editCorridor('Remove intersection from corridor', (c) => {
                          c.stops.splice(k, 1);
                          if (c.stops[0]) c.stops[0].distance = 0;
                          for (const plan of c.plans) delete plan.patterns[stop.intersectionId];
                        })
                      }
                    >
                      <DeleteOutlineRoundedIcon fontSize="small" />
                    </IconButton>
                  </Box>
                </Box>
              );
            })}
          </tbody>
        </Box>
        {corridor.stops.length === 0 ? (
          <Typography variant="body2" sx={{ color: 'text.secondary', p: 2 }}>
            No intersections yet. Add them in travel order.
          </Typography>
        ) : null}
      </Box>

      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <TextField select size="small" label="Intersection" value={adding} onChange={(e) => setAdding(e.target.value)} sx={{ minWidth: 240 }} disabled={available.length === 0}>
          {available.map((i) => (
            <MenuItem key={i.id} value={i.id}>
              {i.name}
            </MenuItem>
          ))}
        </TextField>
        <Button
          variant="outlined"
          startIcon={<AddRoundedIcon />}
          disabled={!adding}
          sx={{ whiteSpace: 'nowrap', flexShrink: 0 }}
          onClick={() => {
            const intersection = intersections.get(adding);
            if (!intersection) return;
            editCorridor(`Add ${intersection.name} to corridor`, (c) => {
              c.stops.push(newCorridorStop(intersection, c.outbound, c.stops.length === 0));
              for (const plan of c.plans) plan.patterns[intersection.id] = intersection.patterns.find((p) => p.mode === 'coordinated')?.id ?? null;
            });
            setAdding('');
          }}
        >
          Add to corridor
        </Button>
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          Distances and speeds describe the link from the previous intersection. Speeds are progression speeds, the speed the green band is designed for.
        </Typography>
      </Stack>
    </Stack>
  );
}

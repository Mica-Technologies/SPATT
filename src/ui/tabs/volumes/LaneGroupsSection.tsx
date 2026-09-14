/** Lane groups: the lanes each phase serves, and what their saturation flow is calculated from. */
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { saturationFlow } from '../../../engine';
import {
  fromMetres,
  LENGTH_LABEL,
  MOVEMENT_LABEL,
  MOVEMENTS,
  newLaneGroup,
  phasesWithoutLaneGroups,
  randomId,
  removeLaneGroup,
  toMetres,
  type Intersection,
  type Issue,
  type LaneGroup,
  type LengthUnit,
} from '../../../model';
import { CheckboxInput, MeasureInput, NumberInput, SelectInput, TextInput } from '../../fields/GridInputs';
import { issuesFor, type FieldPath } from '../../fields/paths';
import { useWorkspace } from '../../state/workspace';
import { IssueLines, Section } from '../patterns/Section';
import { cellSx, headSx, visuallyHidden } from './tableStyles';

interface LaneGroupsSectionProps {
  intersection: Intersection;
  basePath: FieldPath;
  issues: readonly Issue[];
  lengthUnit: LengthUnit;
}

export default function LaneGroupsSection({ intersection, basePath, issues, lengthUnit }: LaneGroupsSectionProps) {
  const editIntersection = useWorkspace((s) => s.editIntersection);
  const uncovered = phasesWithoutLaneGroups(intersection);
  const vehiclePhases = intersection.phases.filter((p) => p.movement.kind !== 'pedestrian');
  const phaseOptions = vehiclePhases.map((p) => ({ value: String(p.number), label: p.label ? `${p.number} ${p.label}` : `Phase ${p.number}` }));

  const update = (group: LaneGroup, label: string, recipe: (g: LaneGroup) => void) =>
    editIntersection(label, (i) => {
      const found = i.laneGroups.find((g) => g.id === group.id);
      if (found) recipe(found);
    });

  const addForPhases = () =>
    editIntersection(uncovered.length === 1 ? `Add lane group for phase ${uncovered[0]!.number}` : `Add ${uncovered.length} lane groups`, (i) => {
      for (const phase of uncovered) i.laneGroups.push(newLaneGroup(randomId('lanes'), phase));
    });
  const addOne = () =>
    editIntersection('Add lane group', (i) => {
      const phase = uncovered[0] ?? vehiclePhases[0];
      if (phase) i.laneGroups.push(newLaneGroup(randomId('lanes'), phase));
    });

  const headers = ['Lane group', 'Phase', 'Left', 'Through', 'Right', 'Lanes', `Width (${LENGTH_LABEL[lengthUnit]})`, 'Heavy veh. %', 'Grade %', 'Sat. flow'];

  return (
    <Section
      title="Lane groups"
      actions={
        <>
          {uncovered.length > 0 ? (
            <Button size="small" onClick={addForPhases}>
              Add for {uncovered.length === 1 ? `phase ${uncovered[0]!.number}` : `${uncovered.length} phases`}
            </Button>
          ) : null}
          <Button size="small" variant="outlined" startIcon={<AddRoundedIcon />} onClick={addOne} disabled={vehiclePhases.length === 0}>
            Add lane group
          </Button>
        </>
      }
    >
      <Box sx={{ overflowX: 'auto' }}>
        <Box component="table" aria-label="Lane groups" sx={{ borderCollapse: 'separate', borderSpacing: 0, fontSize: 13, width: '100%', minWidth: 760 }}>
          <thead>
            <tr>
              {headers.map((h) => (
                <Box component="th" scope="col" key={h} sx={{ ...headSx, textAlign: ['Left', 'Through', 'Right'].includes(h) ? 'center' : 'left' }}>
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                    {h}
                  </Typography>
                </Box>
              ))}
              <Box component="th" scope="col" sx={{ ...headSx, width: 40 }}>
                <Box component="span" sx={visuallyHidden}>
                  Actions
                </Box>
              </Box>
            </tr>
          </thead>
          <tbody>
            {intersection.laneGroups.length === 0 ? (
              <tr>
                <Box component="td" colSpan={headers.length + 1} sx={{ ...cellSx, py: 2, color: 'text.secondary', whiteSpace: 'normal' }}>
                  No lane groups yet. Add one per set of lanes a phase serves: a left-turn bay, the through lanes, a shared through-and-right lane.
                </Box>
              </tr>
            ) : null}
            {intersection.laneGroups.map((group, index) => {
              const path = [...basePath, 'laneGroups', index];
              const name = group.label || `lane group ${index + 1}`;
              const calculated = saturationFlow(intersection, group, undefined);
              const rowIssues = issues.filter((i) => i.path.length >= path.length && path.every((p, k) => i.path[k] === p));
              return (
                <Box component="tr" key={group.id} sx={{ '&:hover td': { bgcolor: 'action.hover' } }}>
                  <Box component="td" sx={{ ...cellSx, minWidth: 110 }}>
                    <TextInput path={[...path, 'label']} label={`Name of ${name}`} value={group.label} onCommit={(v) => update(group, 'Rename lane group', (g) => (g.label = v))} />
                    <IssueLines issues={rowIssues.filter((i) => !['phase', 'laneWidth', 'movements'].includes(String(i.path[path.length])))} />
                  </Box>
                  <Box component="td" sx={{ ...cellSx, width: 130 }}>
                    <SelectInput
                      path={[...path, 'phase']}
                      label={`Phase serving ${name}`}
                      value={String(group.phase)}
                      options={phaseOptions.some((o) => o.value === String(group.phase)) ? phaseOptions : [...phaseOptions, { value: String(group.phase), label: `Phase ${group.phase} (missing)` }]}
                      issues={issuesFor(issues, [...path, 'phase'])}
                      onCommit={(v) => update(group, `${name} served by phase ${v}`, (g) => (g.phase = Number(v)))}
                    />
                  </Box>
                  {MOVEMENTS.map((m) => (
                    <Box component="td" key={m} sx={{ ...cellSx, textAlign: 'center', width: 44 }}>
                      <CheckboxInput
                        path={[...path, 'movements', m]}
                        label={`${name} carries ${MOVEMENT_LABEL[m].toLowerCase()} turns`.replace('through turns', 'through traffic')}
                        value={group.movements[m]}
                        issues={m === 'through' ? issuesFor(issues, [...path, 'movements']) : []}
                        onCommit={(v) => update(group, `${name} ${MOVEMENT_LABEL[m].toLowerCase()} ${v ? 'on' : 'off'}`, (g) => (g.movements[m] = v))}
                      />
                    </Box>
                  ))}
                  <Box component="td" sx={{ ...cellSx, width: 48 }}>
                    <NumberInput path={[...path, 'lanes']} label={`Lanes in ${name}`} value={group.lanes} min={1} max={8} integer onCommit={(v) => update(group, `${name} lanes`, (g) => (g.lanes = v!))} />
                  </Box>
                  <Box component="td" sx={{ ...cellSx, width: 64 }}>
                    <MeasureInput
                      path={[...path, 'laneWidth']}
                      label={`Lane width in ${name}`}
                      value={group.laneWidth}
                      toDisplay={(m) => fromMetres(m, lengthUnit)}
                      fromDisplay={(v) => Math.min(6, Math.max(2, toMetres(v, lengthUnit)))}
                      issues={issuesFor(issues, [...path, 'laneWidth'])}
                      onCommit={(v) => update(group, `${name} lane width`, (g) => (g.laneWidth = v!))}
                    />
                  </Box>
                  <Box component="td" sx={{ ...cellSx, width: 64 }}>
                    <NumberInput path={[...path, 'heavyVehiclesPercent']} label={`Heavy vehicles in ${name}`} value={group.heavyVehiclesPercent} min={0} max={100} onCommit={(v) => update(group, `${name} heavy vehicles`, (g) => (g.heavyVehiclesPercent = v!))} />
                  </Box>
                  <Box component="td" sx={{ ...cellSx, width: 56 }}>
                    <NumberInput path={[...path, 'gradePercent']} label={`Grade at ${name}`} value={group.gradePercent} min={-10} max={10} onCommit={(v) => update(group, `${name} grade`, (g) => (g.gradePercent = v!))} />
                  </Box>
                  <Box component="td" sx={{ ...cellSx, width: 72 }}>
                    <Tooltip title={group.saturationFlow === null ? 'Calculated. Type a value to override it.' : `Entered by hand; calculated ${Math.round(calculated.calculated)}. Clear to calculate.`}>
                      <span>
                        <NumberInput
                          path={[...path, 'saturationFlow']}
                          label={`Saturation flow of ${name}`}
                          value={group.saturationFlow}
                          placeholder={String(Math.round(calculated.calculated))}
                          min={1}
                          max={20000}
                          integer
                          optional
                          onCommit={(v) => update(group, v === null ? `Calculate ${name} saturation flow` : `${name} saturation flow`, (g) => (g.saturationFlow = v))}
                        />
                      </span>
                    </Tooltip>
                  </Box>
                  <Box component="td" sx={{ ...cellSx, textAlign: 'center' }}>
                    <Tooltip title="Delete lane group">
                      <IconButton size="small" aria-label={`Delete ${name}`} onClick={() => editIntersection(`Delete ${name}`, (i) => removeLaneGroup(i, group.id))} sx={{ width: 26, height: 26, border: 'none' }}>
                        <DeleteOutlineRoundedIcon sx={{ fontSize: 18 }} />
                      </IconButton>
                    </Tooltip>
                  </Box>
                </Box>
              );
            })}
          </tbody>
        </Box>
      </Box>
      <Typography variant="caption" component="p" sx={{ color: 'text.secondary', px: 1.5, py: 1, m: 0 }}>
        Saturation flow (veh/h of green) is calculated from the base flow per lane with the HCM lane width, heavy vehicle, grade, area type, lane utilization and turn factors. Shown here without turn shares; the analysis uses each count&apos;s turning volumes.
      </Typography>
    </Section>
  );
}

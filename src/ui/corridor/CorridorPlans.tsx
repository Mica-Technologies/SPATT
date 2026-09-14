/**
 * A corridor's timing plans: each picks the pattern every intersection runs together and weights
 * the two directions of progression.
 */
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemText from '@mui/material/ListItemText';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { formatSeconds, newCorridorPlan, randomId, uniqueName, type Corridor, type Issue, type Project } from '../../model';
import IssueList from '../dialogs/IssueList';
import { SelectInput, TextInput } from '../fields/GridInputs';
import { fieldId, issuesFor, type FieldPath } from '../fields/paths';
import { useWorkspace } from '../state/workspace';
import { navigateTo } from '../workspace/navigation';
import { REFERENCE_LABEL } from '../diagram/diagramText';

const NOT_IN_PLAN = '';

interface CorridorPlansProps {
  project: Project;
  corridor: Corridor;
  corridorIndex: number;
  issues: readonly Issue[];
}

const WEIGHTS = ['0', '0.5', '1', '1.5', '2', '3'].map((w) => ({ value: w, label: w }));

export default function CorridorPlans({ project, corridor, corridorIndex, issues }: CorridorPlansProps) {
  const editCorridor = useWorkspace((s) => s.editCorridor);
  const selectedPlanId = useWorkspace((s) => s.selectedPlanId);
  const selectPlan = useWorkspace((s) => s.selectPlan);
  const planIndex = Math.max(0, corridor.plans.findIndex((p) => p.id === selectedPlanId));
  const plan = corridor.plans[planIndex] ?? null;
  const intersections = new Map(project.intersections.map((i) => [i.id, i]));
  const base: FieldPath = ['corridors', corridorIndex, 'plans', planIndex];
  const planIssues = plan ? issues.filter((i) => i.path.length >= base.length && base.every((part, k) => String(part) === String(i.path[k]))) : [];

  const addPlan = (copyOf?: typeof plan) => {
    const id = randomId('plan');
    const name = uniqueName(copyOf ? `${copyOf.name} copy` : 'Plan', corridor.plans.map((p) => p.name));
    editCorridor(`Add plan ${name}`, (c, p) => {
      const fresh = copyOf
        ? { ...structuredClone(copyOf), id, name }
        : newCorridorPlan(id, name, c.stops.flatMap((s) => p.intersections.filter((i) => i.id === s.intersectionId)));
      c.plans.push(fresh);
    });
    selectPlan(id);
  };

  const headCell = { px: 1, py: 0.75, textAlign: 'left', fontWeight: 500, fontSize: 12, color: 'text.secondary', borderBottom: 1, borderColor: 'divider', whiteSpace: 'nowrap' } as const;
  const cell = { px: 1, py: 0.75, borderBottom: 1, borderColor: 'divider', fontSize: 13 } as const;

  return (
    <Box sx={{ p: 2, display: 'grid', gridTemplateColumns: { xs: '1fr', md: '220px minmax(0, 1fr)' }, gap: 2, alignItems: 'start' }}>
      <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 2, bgcolor: 'background.paper' }}>
        <Stack direction="row" sx={{ alignItems: 'center', px: 1.5, py: 1, borderBottom: 1, borderColor: 'divider' }}>
          <Typography variant="overline" sx={{ flexGrow: 1, color: 'text.secondary' }}>
            Timing plans
          </Typography>
          <Tooltip title="Add plan">
            <IconButton size="small" aria-label="Add plan" onClick={() => addPlan()}>
              <AddRoundedIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Stack>
        <List dense sx={{ py: 0.5 }}>
          {corridor.plans.map((p, k) => (
            <ListItemButton key={p.id} selected={k === planIndex} onClick={() => selectPlan(p.id)} sx={{ mx: 0.5, borderRadius: 1 }}>
              <ListItemText primary={p.name || 'Untitled plan'} />
            </ListItemButton>
          ))}
        </List>
        {corridor.plans.length === 0 ? (
          <Box sx={{ px: 1.5, pb: 1.5 }}>
            <Typography variant="body2" sx={{ color: 'text.secondary', mb: 1 }}>
              No plans yet.
            </Typography>
            <Button size="small" variant="outlined" startIcon={<AddRoundedIcon />} onClick={() => addPlan()}>
              Add plan
            </Button>
          </Box>
        ) : null}
      </Box>

      {plan ? (
        <Stack spacing={2} sx={{ minWidth: 0 }}>
          <Stack direction="row" spacing={2} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}>
            <Box sx={{ width: 220 }}>
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                Plan name
              </Typography>
              <TextInput path={[...base, 'name']} label="Plan name" value={plan.name} onCommit={(v) => editCorridor('Rename plan', (c) => (c.plans[planIndex]!.name = v))} />
            </Box>
            {(['outbound', 'inbound'] as const).map((direction) => (
              <Box key={direction} sx={{ width: 120 }}>
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                  {direction === 'outbound' ? 'Outbound' : 'Inbound'} weight
                </Typography>
                <SelectInput
                  path={[...base, 'weights', direction]}
                  label={`${direction === 'outbound' ? 'Outbound' : 'Inbound'} weight`}
                  value={String(plan.weights[direction])}
                  options={WEIGHTS.some((w) => w.value === String(plan.weights[direction])) ? WEIGHTS : [...WEIGHTS, { value: String(plan.weights[direction]), label: String(plan.weights[direction]) }]}
                  onCommit={(v) => editCorridor('Change direction weight', (c) => (c.plans[planIndex]!.weights[direction] = Number(v)))}
                />
              </Box>
            ))}
            <Box sx={{ flexGrow: 1 }} />
            <Button size="small" startIcon={<ContentCopyRoundedIcon />} onClick={() => addPlan(plan)}>
              Duplicate
            </Button>
            <Button
              size="small"
              color="error"
              startIcon={<DeleteOutlineRoundedIcon />}
              onClick={() => {
                const next = corridor.plans[planIndex + 1]?.id ?? corridor.plans[planIndex - 1]?.id ?? null;
                editCorridor(`Delete plan ${plan.name}`, (c) => c.plans.splice(planIndex, 1));
                selectPlan(next);
              }}
            >
              Delete
            </Button>
          </Stack>

          <Box sx={{ overflowX: 'auto', border: 1, borderColor: 'divider', borderRadius: 2, bgcolor: 'background.paper' }}>
            <Box component="table" sx={{ borderCollapse: 'separate', borderSpacing: 0, width: '100%' }}>
              <thead>
                <tr>
                  <Box component="th" sx={headCell}>
                    Intersection
                  </Box>
                  <Box component="th" sx={headCell}>
                    Pattern
                  </Box>
                  <Box component="th" sx={{ ...headCell, textAlign: 'right' }}>
                    Cycle
                  </Box>
                  <Box component="th" sx={{ ...headCell, textAlign: 'right' }}>
                    Offset
                  </Box>
                </tr>
              </thead>
              <tbody>
                {corridor.stops.map((stop) => {
                  const intersection = intersections.get(stop.intersectionId);
                  if (!intersection) return null;
                  const patternId = plan.patterns[stop.intersectionId] ?? null;
                  const pattern = intersection.patterns.find((p) => p.id === patternId);
                  const path: FieldPath = [...base, 'patterns', stop.intersectionId];
                  return (
                    <tr key={stop.intersectionId}>
                      <Box component="td" sx={{ ...cell, fontWeight: 500 }}>
                        {intersection.name}
                      </Box>
                      <Box component="td" sx={{ ...cell, width: 240 }}>
                        <SelectInput
                          path={path}
                          label={`Pattern at ${intersection.name}`}
                          value={pattern ? pattern.id : NOT_IN_PLAN}
                          issues={issuesFor(issues, path)}
                          options={[{ value: NOT_IN_PLAN, label: 'Not in this plan' }, ...intersection.patterns.map((p) => ({ value: p.id, label: `${p.name}${p.mode === 'free' ? ' (free)' : ''}` }))]}
                          onCommit={(v) => editCorridor('Change plan pattern', (c) => (c.plans[planIndex]!.patterns[stop.intersectionId] = v === NOT_IN_PLAN ? null : v))}
                        />
                      </Box>
                      <Box component="td" sx={{ ...cell, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                        {pattern?.mode === 'coordinated' ? `${formatSeconds(pattern.cycle)} s` : '—'}
                      </Box>
                      <Box component="td" sx={{ ...cell, textAlign: 'right', color: 'text.secondary' }}>
                        {pattern?.mode === 'coordinated' ? `${formatSeconds(pattern.offset)} s to ${REFERENCE_LABEL[pattern.offsetReference]}` : '—'}
                      </Box>
                    </tr>
                  );
                })}
              </tbody>
            </Box>
          </Box>
          <Typography id={fieldId([...base, 'patterns'])} tabIndex={-1} variant="caption" sx={{ color: 'text.secondary', outline: 'none' }}>
            Offsets belong to each intersection&apos;s pattern: changing them here, on the time-space diagram or with offset optimization changes that pattern.
          </Typography>
          {planIssues.length > 0 ? (
            <IssueList label="Plan problems" issues={planIssues} onSelect={(issue) => navigateTo(issue.path)} />
          ) : null}
        </Stack>
      ) : null}
    </Box>
  );
}

/**
 * The phase timing grid: parameters down the side, phases across, as on a controller's phase
 * timing screen and a printed timing sheet.
 */
import { Fragment, useState, type ReactNode } from 'react';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import MoreVertRoundedIcon from '@mui/icons-material/MoreVertRounded';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Typography from '@mui/material/Typography';
import {
  addPhase,
  nextPhaseNumber,
  removePhase,
  type Intersection,
  type Issue,
  type Phase,
} from '../../model';
import { CheckboxInput, SecondsInput, SelectInput, TextInput } from '../fields/GridInputs';
import { APPROACHES, MOVEMENTS, RECALLS } from '../fields/phaseOptions';
import { fieldId, issuesFor, type FieldPath } from '../fields/paths';
import { useWorkspace } from '../state/workspace';

type TenthsKey = 'minGreen' | 'passage' | 'maxGreen1' | 'maxGreen2' | 'yellow' | 'redClear';
type VolumeKey = keyof Phase['volumeDensity'];

interface CellContext {
  phase: Phase;
  path: FieldPath;
  issues: readonly Issue[];
  update: (label: string, recipe: (phase: Phase) => void) => void;
}

interface RowSpec {
  label: string;
  hint?: string;
  render: (ctx: CellContext) => ReactNode;
}

const seconds = (key: TenthsKey, label: string, options: { zeroAsBlank?: boolean; vehicleOnly?: boolean } = {}): RowSpec => ({
  label,
  render: ({ phase, path, issues, update }) => {
    const cellPath = [...path, key];
    return (
      <SecondsInput
        path={cellPath}
        label={`${label}, phase ${phase.number}`}
        value={phase[key]}
        zeroAsBlank={options.zeroAsBlank}
        disabled={options.vehicleOnly && phase.movement.kind === 'pedestrian'}
        issues={issuesFor(issues, cellPath)}
        onCommit={(v) => update(`Phase ${phase.number} ${label}`, (p) => (p[key] = v))}
      />
    );
  },
});

const volume = (key: VolumeKey, label: string): RowSpec => ({
  label,
  render: ({ phase, path, issues, update }) => {
    const cellPath = [...path, 'volumeDensity', key];
    return (
      <SecondsInput
        path={cellPath}
        label={`${label}, phase ${phase.number}`}
        value={phase.volumeDensity[key]}
        zeroAsBlank
        issues={issuesFor(issues, cellPath)}
        onCommit={(v) => update(`Phase ${phase.number} ${label}`, (p) => (p.volumeDensity[key] = v))}
      />
    );
  },
});

const flag = (label: string, get: (p: Phase) => boolean, set: (p: Phase, v: boolean) => void, pathSuffix: FieldPath): RowSpec => ({
  label,
  render: ({ phase, path, issues, update }) => {
    const cellPath = [...path, ...pathSuffix];
    return (
      <CheckboxInput
        path={cellPath}
        label={`${label}, phase ${phase.number}`}
        value={get(phase)}
        issues={issuesFor(issues, cellPath)}
        onCommit={(v) => update(`Phase ${phase.number} ${label}`, (p) => set(p, v))}
      />
    );
  },
});

const SECTIONS: { title: string; rows: RowSpec[] }[] = [
  {
    title: 'Phase',
    rows: [
      {
        label: 'Label',
        render: ({ phase, path, issues, update }) => (
          <TextInput path={[...path, 'label']} label={`Label, phase ${phase.number}`} value={phase.label} issues={issuesFor(issues, [...path, 'label'])} onCommit={(v) => update(`Phase ${phase.number} label`, (p) => (p.label = v))} />
        ),
      },
      flag('Enabled', (p) => p.enabled, (p, v) => (p.enabled = v), ['enabled']),
      {
        label: 'Approach',
        render: ({ phase, path, update }) => (
          <SelectInput
            path={[...path, 'movement', 'approach']}
            label={`Approach, phase ${phase.number}`}
            value={phase.movement.approach ?? ''}
            options={APPROACHES}
            onCommit={(v) => update(`Phase ${phase.number} approach`, (p) => (p.movement.approach = v === '' ? null : v))}
          />
        ),
      },
      {
        label: 'Movement',
        render: ({ phase, path, issues, update }) => (
          <SelectInput
            path={[...path, 'movement', 'kind']}
            label={`Movement, phase ${phase.number}`}
            value={phase.movement.kind}
            options={MOVEMENTS}
            issues={issuesFor(issues, [...path, 'movement'])}
            onCommit={(v) => update(`Phase ${phase.number} movement`, (p) => (p.movement.kind = v))}
          />
        ),
      },
    ],
  },
  {
    title: 'Vehicle',
    rows: [
      seconds('minGreen', 'Min green', { vehicleOnly: true }),
      seconds('passage', 'Passage', { vehicleOnly: true }),
      seconds('maxGreen1', 'Max 1', { vehicleOnly: true }),
      seconds('maxGreen2', 'Max 2', { zeroAsBlank: true, vehicleOnly: true }),
      seconds('yellow', 'Yellow', { vehicleOnly: true }),
      seconds('redClear', 'Red clear'),
      {
        label: 'Recall',
        render: ({ phase, path, update }) => (
          <SelectInput path={[...path, 'recall']} label={`Recall, phase ${phase.number}`} value={phase.recall} options={RECALLS} onCommit={(v) => update(`Phase ${phase.number} recall`, (p) => (p.recall = v))} />
        ),
      },
    ],
  },
  {
    title: 'Pedestrian',
    rows: [
      flag('Ped service', (p) => p.pedestrian.enabled, (p, v) => (p.pedestrian.enabled = v), ['pedestrian', 'enabled']),
      {
        label: 'Walk',
        render: ({ phase, path, issues, update }) => {
          const cellPath = [...path, 'pedestrian', 'walk'];
          return (
            <SecondsInput path={cellPath} label={`Walk, phase ${phase.number}`} value={phase.pedestrian.walk} zeroAsBlank disabled={!phase.pedestrian.enabled} issues={issuesFor(issues, cellPath)} onCommit={(v) => update(`Phase ${phase.number} walk`, (p) => (p.pedestrian.walk = v))} />
          );
        },
      },
      {
        label: 'Ped clear',
        render: ({ phase, path, issues, update }) => {
          const cellPath = [...path, 'pedestrian', 'clearance'];
          return (
            <SecondsInput path={cellPath} label={`Pedestrian clearance, phase ${phase.number}`} value={phase.pedestrian.clearance} zeroAsBlank disabled={!phase.pedestrian.enabled} issues={issuesFor(issues, cellPath)} onCommit={(v) => update(`Phase ${phase.number} pedestrian clearance`, (p) => (p.pedestrian.clearance = v))} />
          );
        },
      },
      flag('Ped recall', (p) => p.pedestrian.recall, (p, v) => (p.pedestrian.recall = v), ['pedestrian', 'recall']),
      flag('Rest in walk', (p) => p.pedestrian.restInWalk, (p, v) => (p.pedestrian.restInWalk = v), ['pedestrian', 'restInWalk']),
    ],
  },
  {
    title: 'Volume density',
    rows: [
      volume('addedInitialPerActuation', 'Added initial'),
      volume('maxInitial', 'Max initial'),
      volume('timeBeforeReduction', 'Time before reduce'),
      volume('timeToReduce', 'Time to reduce'),
      volume('minGap', 'Min gap'),
    ],
  },
  {
    title: 'Options',
    rows: [
      flag('Locking detector', (p) => p.lockingDetector, (p, v) => (p.lockingDetector = v), ['lockingDetector']),
      flag('Dual entry', (p) => p.dualEntry, (p, v) => (p.dualEntry = v), ['dualEntry']),
      flag('Conditional service', (p) => p.conditionalService, (p, v) => (p.conditionalService = v), ['conditionalService']),
    ],
  },
];

export interface PhaseMenuAction {
  label: string;
  onSelect: (phase: Phase) => void;
}

interface PhasesTabProps {
  intersection: Intersection;
  intersectionIndex: number;
  issues: readonly Issue[];
  /** Extra actions for each phase's header menu (e.g. the clearance calculator). */
  phaseActions?: PhaseMenuAction[];
}

const COLUMN_WIDTH = 88;
const LABEL_WIDTH = 150;

export default function PhasesTab({ intersection, intersectionIndex, issues, phaseActions = [] }: PhasesTabProps) {
  const editIntersection = useWorkspace((s) => s.editIntersection);
  const [menu, setMenu] = useState<{ anchor: HTMLElement; phase: Phase } | null>(null);
  const next = nextPhaseNumber(intersection);

  const update = (number: number) => (label: string, recipe: (phase: Phase) => void) =>
    editIntersection(label, (i) => {
      const phase = i.phases.find((p) => p.number === number);
      if (phase) recipe(phase);
    });

  const phases = intersection.phases;
  const basePath = ['intersections', intersectionIndex, 'phases'];

  return (
    <Box sx={{ p: 2 }}>
      <Box sx={{ overflowX: 'auto', width: 'fit-content', maxWidth: '100%', border: 1, borderColor: 'divider', borderRadius: 2, bgcolor: 'background.paper' }}>
        <Box component="table" sx={{ borderCollapse: 'separate', borderSpacing: 0, fontSize: 13, minWidth: LABEL_WIDTH + phases.length * COLUMN_WIDTH }}>
          <thead>
            <tr>
              <Box component="th" scope="col" sx={{ position: 'sticky', left: 0, zIndex: 2, bgcolor: 'background.paper', width: LABEL_WIDTH, textAlign: 'left', px: 1.5, borderBottom: 1, borderColor: 'divider' }}>
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                  Phase
                </Typography>
              </Box>
              {phases.map((phase, index) => (
                <Box
                  component="th"
                  scope="col"
                  key={phase.number}
                  id={fieldId([...basePath, index, 'number'])}
                  sx={{ width: COLUMN_WIDTH, minWidth: COLUMN_WIDTH, height: 36, borderBottom: 1, borderColor: 'divider', opacity: phase.enabled ? 1 : 0.55 }}
                >
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.25 }}>
                    <Typography variant="subtitle2" component="span">
                      {phase.number}
                    </Typography>
                    <IconButton size="small" aria-label={`Phase ${phase.number} actions`} onClick={(e) => setMenu({ anchor: e.currentTarget, phase })} sx={{ width: 22, height: 22, border: 'none' }}>
                      <MoreVertRoundedIcon sx={{ fontSize: 16 }} />
                    </IconButton>
                  </Box>
                </Box>
              ))}
            </tr>
          </thead>
          <tbody>
            {SECTIONS.map((section) => (
              <Fragment key={section.title}>
                <tr>
                  <Box component="th" scope="rowgroup" colSpan={phases.length + 1} sx={{ textAlign: 'left', px: 1.5, pt: 1.5, pb: 0.5, bgcolor: 'background.default' }}>
                    <Typography variant="overline" sx={{ color: 'text.secondary', lineHeight: 1.5 }}>
                      {section.title}
                    </Typography>
                  </Box>
                </tr>
                {section.rows.map((row) => (
                  <Box component="tr" key={row.label} sx={{ '&:hover td, &:hover th': { bgcolor: 'action.hover' } }}>
                    <Box component="th" scope="row" sx={{ position: 'sticky', left: 0, zIndex: 1, bgcolor: 'background.paper', textAlign: 'left', fontWeight: 400, px: 1.5, whiteSpace: 'nowrap' }}>
                      {row.label}
                    </Box>
                    {phases.map((phase, index) => (
                      <Box component="td" key={phase.number} sx={{ px: 0.5, py: 0.25, textAlign: 'center', opacity: phase.enabled ? 1 : 0.55 }}>
                        {row.render({ phase, path: [...basePath, index], issues, update: update(phase.number) })}
                      </Box>
                    ))}
                  </Box>
                ))}
              </Fragment>
            ))}
          </tbody>
        </Box>
      </Box>

      <Box sx={{ mt: 1.5, display: 'flex', alignItems: 'center', gap: 2 }}>
        <Button
          size="small"
          variant="outlined"
          startIcon={<AddRoundedIcon />}
          disabled={next === null}
          onClick={() => next !== null && editIntersection(`Add phase ${next}`, (i) => addPhase(i, next))}
        >
          {next === null ? 'All 16 phases defined' : `Add phase ${next}`}
        </Button>
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          Times in seconds. A new phase needs a place in Rings &amp; Barriers before it runs.
        </Typography>
      </Box>

      <Menu anchorEl={menu?.anchor} open={menu !== null} onClose={() => setMenu(null)}>
        {phaseActions.map((action) => (
          <MenuItem
            key={action.label}
            onClick={() => {
              action.onSelect(menu!.phase);
              setMenu(null);
            }}
          >
            {action.label}
          </MenuItem>
        ))}
        <MenuItem
          sx={{ color: 'error.main' }}
          onClick={() => {
            const n = menu!.phase.number;
            editIntersection(`Delete phase ${n}`, (i) => removePhase(i, n));
            setMenu(null);
          }}
        >
          Delete phase
        </MenuItem>
      </Menu>
    </Box>
  );
}

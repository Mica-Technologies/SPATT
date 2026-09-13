/**
 * Clearance calculator for one phase: yellow change, red clearance and pedestrian clearance
 * estimated from the approach and crossing geometry (engine/clearance.ts), shown beside the
 * phase's current values, with the chosen results applied as one undoable edit.
 */
import { useState, type ReactNode } from 'react';
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded';
import ErrorRoundedIcon from '@mui/icons-material/ErrorRounded';
import InfoRoundedIcon from '@mui/icons-material/InfoRounded';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import InputAdornment from '@mui/material/InputAdornment';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { CLEARANCE_DEFAULTS, pedestrianClearance, pedestrianTotalMinimum, redClearance, yellowChange, type UnitSystem } from '../../engine/clearance';
import { formatSeconds, type ClearanceBasis, type Intersection, type Phase, type Project, type Tenths } from '../../model';
import { useWorkspace } from '../state/workspace';
import { fontFamilyMono } from '../theme/themePrimitives';

export interface ClearanceDialogProps {
  open: boolean;
  onClose(): void;
  intersectionIndex: number;
  phase: Phase | null;
  units: Project['units'];
}

type FieldKey = keyof Required<ClearanceBasis>;
type Form = Record<FieldKey, string>;
type IntervalKey = 'yellow' | 'redClear' | 'pedClearance';

/** The inputs each interval is calculated from. */
const INPUTS_FOR: Record<IntervalKey, FieldKey[]> = {
  yellow: ['approachSpeed', 'gradePercent'],
  redClear: ['approachSpeed', 'intersectionWidth', 'vehicleLength'],
  pedClearance: ['crossingDistance', 'walkingSpeed'],
};

const KMH_PER_MPH = 1.609344;
const GRADE_LIMIT = 15;

/** The engine works in one system; lengths decide it, and a mismatched speed is converted. */
const unitSystem = (units: Project['units']): UnitSystem => (units.length === 'm' ? 'metric' : 'us');

function engineSpeed(speed: number, units: Project['units']): number {
  const system = unitSystem(units);
  if (system === 'us' && units.speed === 'km/h') return speed / KMH_PER_MPH;
  if (system === 'metric' && units.speed === 'mph') return speed * KMH_PER_MPH;
  return speed;
}

const show = (value: number | undefined, fallback: number | '' = ''): string => String(value ?? fallback);

function initialForm(phase: Phase | null, units: Project['units']): Form {
  const basis = phase?.clearanceBasis ?? {};
  const defaults = CLEARANCE_DEFAULTS[unitSystem(units)];
  return {
    approachSpeed: show(basis.approachSpeed),
    gradePercent: show(basis.gradePercent, 0),
    intersectionWidth: show(basis.intersectionWidth),
    vehicleLength: show(basis.vehicleLength, defaults.vehicleLength),
    crossingDistance: show(basis.crossingDistance),
    walkingSpeed: show(basis.walkingSpeed, defaults.walkingSpeed),
  };
}

/** A parsed input: `value` undefined when blank; `error` when the text is not usable. */
interface Parsed {
  value: number | undefined;
  error: string | null;
}

function parseField(key: FieldKey, text: string): Parsed {
  const trimmed = text.trim();
  if (trimmed === '') {
    return { value: undefined, error: null };
  }
  const value = Number(trimmed);
  if (!Number.isFinite(value)) {
    return { value: undefined, error: 'Not a number' };
  }
  if (key === 'gradePercent' && Math.abs(value) > GRADE_LIMIT) {
    return { value: undefined, error: `Between −${GRADE_LIMIT} and ${GRADE_LIMIT} %` };
  }
  if (value < 0 && key !== 'gradePercent') {
    return { value: undefined, error: 'Cannot be negative' };
  }
  return { value, error: null };
}

type Result = { ok: true; tenths: Tenths } | { ok: false; message: string };

/** Runs an engine calculation, turning its RangeErrors into a message instead of a throw. */
function attempt(missing: string | null, calculate: () => Tenths): Result {
  if (missing) {
    return { ok: false, message: missing };
  }
  try {
    return { ok: true, tenths: calculate() };
  } catch (err) {
    if (err instanceof RangeError) {
      return { ok: false, message: err.message };
    }
    throw err;
  }
}

/** The first missing or invalid input among `keys`, as a message; null when all are usable. */
function firstProblem(parsed: Record<FieldKey, Parsed>, keys: FieldKey[], labels: Record<FieldKey, string>): string | null {
  for (const key of keys) {
    if (parsed[key].error) return `Check ${labels[key].toLowerCase()}`;
    if (parsed[key].value === undefined) return `Enter ${labels[key].toLowerCase()}`;
  }
  return null;
}

/** Applies a recipe to the phase in the intersection at `intersectionIndex`, as one undo step. */
function editPhase(intersectionIndex: number, number: number, label: string, recipe: (phase: Phase) => void) {
  const state = useWorkspace.getState();
  const onPhase = (intersection: Intersection | undefined) => {
    const phase = intersection?.phases.find((p) => p.number === number);
    if (phase) recipe(phase);
  };
  const selectedIndex = state.project?.intersections.findIndex((i) => i.id === state.selectedIntersectionId) ?? -1;
  if (selectedIndex === intersectionIndex) {
    state.editIntersection(label, (intersection) => onPhase(intersection));
  } else {
    state.edit(label, (project) => onPhase(project.intersections[intersectionIndex]));
  }
}

const seconds = (tenths: Tenths) => `${formatSeconds(tenths)} s`;

export default function ClearanceDialog({ open, onClose, intersectionIndex, phase, units }: ClearanceDialogProps) {
  const system = unitSystem(units);
  const [form, setForm] = useState<Form>(() => initialForm(phase, units));
  const [chosen, setChosen] = useState<Record<IntervalKey, boolean>>({ yellow: true, redClear: true, pedClearance: true });

  // Reload the inputs whenever the dialog opens for a phase, during render so stale values
  // from a previous phase are never painted.
  const loadKey = open && phase ? `${phase.number}|${units.length}|${units.speed}` : null;
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  if (loadKey !== loadedKey) {
    setLoadedKey(loadKey);
    if (loadKey !== null) {
      setForm(initialForm(phase, units));
      setChosen({ yellow: true, redClear: true, pedClearance: true });
    }
  }

  const lengthUnit = units.length;
  const labels: Record<FieldKey, string> = {
    approachSpeed: 'Approach speed',
    gradePercent: 'Grade',
    intersectionWidth: 'Intersection width',
    vehicleLength: 'Vehicle length',
    crossingDistance: 'Crossing distance',
    walkingSpeed: 'Walking speed',
  };
  const adornments: Record<FieldKey, string> = {
    approachSpeed: units.speed,
    gradePercent: '%',
    intersectionWidth: lengthUnit,
    vehicleLength: lengthUnit,
    crossingDistance: lengthUnit,
    walkingSpeed: `${lengthUnit}/s`,
  };
  const helpers: Partial<Record<FieldKey, string>> = {
    gradePercent: 'Uphill positive',
    intersectionWidth: 'Stop line to far side of last conflicting lane',
    crossingDistance: 'Curb to far side of travelled way',
  };

  const parsed = Object.fromEntries((Object.keys(form) as FieldKey[]).map((key) => [key, parseField(key, form[key])])) as Record<FieldKey, Parsed>;
  const value = (key: FieldKey) => parsed[key].value ?? 0;
  const pedEnabled = phase?.pedestrian.enabled ?? false;

  const results: Record<IntervalKey, Result> = {
    yellow: attempt(firstProblem(parsed, INPUTS_FOR.yellow, labels), () =>
      yellowChange({ approachSpeed: engineSpeed(value('approachSpeed'), units), gradePercent: value('gradePercent'), units: system }),
    ),
    redClear: attempt(firstProblem(parsed, INPUTS_FOR.redClear, labels), () =>
      redClearance({ approachSpeed: engineSpeed(value('approachSpeed'), units), intersectionWidth: value('intersectionWidth'), vehicleLength: value('vehicleLength'), units: system }),
    ),
    pedClearance: attempt(firstProblem(parsed, INPUTS_FOR.pedClearance, labels), () =>
      pedestrianClearance({ crossingDistance: value('crossingDistance'), walkingSpeed: value('walkingSpeed'), units: system }),
    ),
  };
  const pushbuttonMinimum = attempt(firstProblem(parsed, ['crossingDistance'], labels), () => pedestrianTotalMinimum({ crossingDistance: value('crossingDistance'), units: system }));

  const unavailable: Record<IntervalKey, string | null> = {
    yellow: null,
    redClear: null,
    pedClearance: pedEnabled ? null : 'This phase has no pedestrian service',
  };
  const applies = (key: IntervalKey) => chosen[key] && results[key].ok && unavailable[key] === null;
  const anyApplies = (['yellow', 'redClear', 'pedClearance'] as const).some(applies);

  const apply = () => {
    if (!phase || !anyApplies) return;
    // The basis records the inputs behind each applied value; others keep what was stored. Every
    // input used produced a result, so each satisfies the file format's ranges.
    const basis: ClearanceBasis = {};
    (Object.keys(INPUTS_FOR) as IntervalKey[])
      .filter(applies)
      .flatMap((key) => INPUTS_FOR[key])
      .forEach((key) => {
        const v = parsed[key].value;
        if (v !== undefined) basis[key] = v;
      });
    const tenths = (key: IntervalKey) => (results[key] as { tenths: Tenths }).tenths;
    editPhase(intersectionIndex, phase.number, `Phase ${phase.number} clearance from calculator`, (p) => {
      if (applies('yellow')) p.yellow = tenths('yellow');
      if (applies('redClear')) p.redClear = tenths('redClear');
      if (applies('pedClearance')) p.pedestrian.clearance = tenths('pedClearance');
      p.clearanceBasis = { ...p.clearanceBasis, ...basis };
    });
    onClose();
  };

  const field = (key: FieldKey) => (
    <TextField
      key={key}
      size="small"
      fullWidth
      label={labels[key]}
      value={form[key]}
      error={parsed[key].error !== null}
      helperText={parsed[key].error ?? helpers[key]}
      onChange={(event) => setForm((f) => ({ ...f, [key]: event.target.value }))}
      slotProps={{
        input: { endAdornment: <InputAdornment position="end">{adornments[key]}</InputAdornment> },
        htmlInput: { inputMode: 'decimal', 'data-field': key },
      }}
    />
  );

  const defaults = CLEARANCE_DEFAULTS[system];
  const rows: { key: IntervalKey; label: string; formula: string; current: Tenths | null }[] = [
    { key: 'yellow', label: 'Yellow change', formula: `Y = t + v / (2a + 2Gg), t = ${defaults.perceptionReaction} s, a = ${defaults.deceleration} ${lengthUnit}/s²`, current: phase?.yellow ?? null },
    { key: 'redClear', label: 'Red clearance', formula: 'R = (W + L) / v', current: phase?.redClear ?? null },
    { key: 'pedClearance', label: 'Pedestrian clearance', formula: 'PC = distance / walking speed', current: pedEnabled ? (phase?.pedestrian.clearance ?? null) : null },
  ];

  const headCell = (children: ReactNode, align: 'left' | 'right' = 'left') => (
    <Box component="th" scope="col" sx={{ textAlign: align, fontWeight: 400, px: 1, py: 0.75, borderBottom: 1, borderColor: 'divider' }}>
      <Typography variant="caption" sx={{ color: 'text.secondary' }}>
        {children}
      </Typography>
    </Box>
  );

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md" aria-labelledby="clearance-dialog-title">
      <DialogTitle id="clearance-dialog-title">
        Clearance calculator
        {phase && (
          <Typography component="span" variant="body2" sx={{ color: 'text.secondary', ml: 1 }}>
            Phase {phase.number}
            {phase.label ? ` · ${phase.label}` : ''}
          </Typography>
        )}
      </DialogTitle>
      <DialogContent dividers>
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '260px 1fr' }, gap: 3 }}>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
            <Typography variant="overline" sx={{ color: 'text.secondary', lineHeight: 1.5 }}>
              Vehicle
            </Typography>
            {(['approachSpeed', 'gradePercent', 'intersectionWidth', 'vehicleLength'] as const).map(field)}
            <Typography variant="overline" sx={{ color: 'text.secondary', lineHeight: 1.5, mt: 1 }}>
              Pedestrian
            </Typography>
            {(['crossingDistance', 'walkingSpeed'] as const).map(field)}
          </Box>

          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
            <Box sx={{ overflowX: 'auto', border: 1, borderColor: 'divider', borderRadius: 2 }}>
              <Box component="table" sx={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, fontSize: 13 }}>
                <thead>
                  <tr>
                    {headCell('Apply')}
                    {headCell('Interval')}
                    {headCell('Current', 'right')}
                    {headCell('Computed', 'right')}
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ key, label, formula, current }) => {
                    const result = results[key];
                    const blocked = unavailable[key];
                    return (
                      <tr key={key}>
                        <Box component="td" sx={{ px: 0.5, borderBottom: 1, borderColor: 'divider', width: 44 }}>
                          <Checkbox
                            size="small"
                            checked={applies(key)}
                            disabled={!result.ok || blocked !== null}
                            onChange={(event) => setChosen((c) => ({ ...c, [key]: event.target.checked }))}
                            slotProps={{ input: { 'aria-label': `Apply ${label.toLowerCase()}` } }}
                          />
                        </Box>
                        <Box component="td" sx={{ px: 1, py: 0.75, borderBottom: 1, borderColor: 'divider' }}>
                          <Typography variant="body2">{label}</Typography>
                          <Typography variant="caption" sx={{ color: 'text.secondary', fontFamily: fontFamilyMono, fontSize: 11 }}>
                            {formula}
                          </Typography>
                        </Box>
                        <Box component="td" sx={{ px: 1, borderBottom: 1, borderColor: 'divider', textAlign: 'right', fontFamily: fontFamilyMono, whiteSpace: 'nowrap', color: 'text.secondary' }}>
                          {current === null ? '—' : seconds(current)}
                        </Box>
                        <Box component="td" data-testid={`computed-${key}`} sx={{ px: 1, borderBottom: 1, borderColor: 'divider', textAlign: 'right', maxWidth: 200 }}>
                          {result.ok ? (
                            <Typography variant="body2" sx={{ fontFamily: fontFamilyMono, fontWeight: 600, whiteSpace: 'nowrap', color: blocked ? 'text.disabled' : 'text.primary' }}>
                              {seconds(result.tenths)}
                            </Typography>
                          ) : (
                            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                              {result.message}
                            </Typography>
                          )}
                          {blocked && result.ok && (
                            <Typography variant="caption" component="div" sx={{ color: 'text.secondary' }}>
                              {blocked}
                            </Typography>
                          )}
                        </Box>
                      </tr>
                    );
                  })}
                </tbody>
              </Box>
            </Box>

            <PushbuttonCheck phase={phase} pedClearance={results.pedClearance} minimum={pushbuttonMinimum} lengthUnit={lengthUnit} />

            <Alert severity="info" variant="outlined" icon={<InfoRoundedIcon fontSize="inherit" />}>
              These are estimates to start engineering judgement from, not design values. Check them against local practice and the governing standards.
            </Alert>
          </Box>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" disabled={!phase || !anyApplies} onClick={apply}>
          Apply
        </Button>
      </DialogActions>
    </Dialog>
  );
}

interface PushbuttonCheckProps {
  phase: Phase | null;
  pedClearance: Result;
  minimum: Result;
  lengthUnit: string;
}

/** MUTCD 4I.06: walk + pedestrian clearance must let someone from the pushbutton cross at 3.0 ft/s. */
function PushbuttonCheck({ phase, pedClearance, minimum, lengthUnit }: PushbuttonCheckProps) {
  const setback = lengthUnit === 'm' ? '1.8 m' : '6 ft';
  const speed = lengthUnit === 'm' ? '0.91 m/s' : '3.0 ft/s';
  let body: ReactNode;
  let met: boolean | null = null;
  if (!phase?.pedestrian.enabled) {
    body = 'This phase has no pedestrian service.';
  } else if (!pedClearance.ok || !minimum.ok) {
    body = !minimum.ok ? minimum.message : pedClearance.ok ? '' : pedClearance.message;
  } else {
    const total = phase.pedestrian.walk + pedClearance.tenths;
    met = total >= minimum.tenths;
    body = (
      <>
        Walk {seconds(phase.pedestrian.walk)} + computed clearance {seconds(pedClearance.tenths)} = <b>{seconds(total)}</b>
        {met ? ' meets ' : ' is below '}
        the {seconds(minimum.tenths)} minimum
        {!met && ` (walk needs at least ${seconds(minimum.tenths - pedClearance.tenths)})`}.
      </>
    );
  }
  const Icon = met === null ? InfoRoundedIcon : met ? CheckCircleRoundedIcon : ErrorRoundedIcon;
  return (
    <Box data-testid="pushbutton-check" sx={{ display: 'flex', gap: 1, alignItems: 'flex-start', p: 1.25, border: 1, borderColor: 'divider', borderRadius: 2 }}>
      <Icon fontSize="small" sx={{ mt: 0.25, color: met === null ? 'text.secondary' : met ? 'success.main' : 'error.main' }} />
      <Box>
        <Typography variant="body2" sx={{ fontWeight: 500 }}>
          Pushbutton check
        </Typography>
        <Typography variant="body2">{body}</Typography>
        <Typography variant="caption" sx={{ color: 'text.secondary', fontFamily: fontFamilyMono, fontSize: 11 }}>
          Walk + PC ≥ (distance + {setback}) / {speed}
        </Typography>
      </Box>
    </Box>
  );
}

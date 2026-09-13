/** A pattern's own settings: name, mode, cycle, offset and its reference, coordination options. */
import { useState, type ReactNode } from 'react';
import CheckRoundedIcon from '@mui/icons-material/CheckRounded';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Typography from '@mui/material/Typography';
import { convertOffset, cycleBounds, type ProjectionResult } from '../../../engine';
import { effectiveSequence, formatSeconds, type Intersection, type Issue, type OffsetReference, type Pattern } from '../../../model';
import { CheckboxInput, SecondsInput, SelectInput, TextInput } from '../../fields/GridInputs';
import { fieldId, issuesFor, type FieldPath } from '../../fields/paths';
import { useWorkspace } from '../../state/workspace';
import { toggleCoordinatedPhase } from './patternEdits';
import { IssueLines, Section } from './Section';

const OFFSET_REFERENCES: { value: OffsetReference; label: string; short: string }[] = [
  { value: 'beginCoordGreen', label: 'Begin of coordinated green (lead)', short: 'begin of coordinated green' },
  { value: 'beginCoordYellow', label: 'End of coordinated green (lag / yield)', short: 'end of coordinated green' },
  { value: 'firstPhaseStart', label: 'Start of ring sequence (CSM)', short: 'start of ring sequence' },
];

const MODES = [
  { value: 'coordinated', label: 'Coordinated' },
  { value: 'free', label: 'Free' },
] as const;

const MAX_GREENS = [
  { value: 'max1', label: 'Max 1' },
  { value: 'max2', label: 'Max 2' },
] as const;

const FORCE_OFF_MODES = [
  { value: 'fixed', label: 'Fixed' },
  { value: 'floating', label: 'Floating' },
] as const;

interface PatternSettingsProps {
  intersection: Intersection;
  pattern: Pattern;
  /** Project-rooted path of the pattern. */
  path: FieldPath;
  issues: readonly Issue[];
  projection: ProjectionResult;
}

function Field({ label, path, children, hint }: { label: string; path: FieldPath; children: ReactNode; hint?: ReactNode }) {
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: '120px minmax(0, 1fr)', alignItems: 'center', columnGap: 1, minHeight: 32 }}>
      <Box component="label" htmlFor={fieldId(path)} sx={{ fontSize: 13, color: 'text.secondary', whiteSpace: 'nowrap' }}>
        {label}
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>{children}</Box>
      {hint ? (
        <Typography variant="caption" sx={{ gridColumn: 2, color: 'text.secondary', lineHeight: 1.3, pb: 0.5 }}>
          {hint}
        </Typography>
      ) : null}
    </Box>
  );
}

export default function PatternSettings({ intersection, pattern, path, issues, projection }: PatternSettingsProps) {
  const editIntersection = useWorkspace((s) => s.editIntersection);
  const [keepTiming, setKeepTiming] = useState(true);
  const free = pattern.mode === 'free';
  const p = (...rest: FieldPath) => [...path, ...rest];

  const update = (label: string, recipe: (pattern: Pattern) => void) =>
    editIntersection(label, (i) => {
      const found = i.patterns.find((x) => x.id === pattern.id);
      if (found) recipe(found);
    });

  const minimumCycle = cycleBounds(intersection).minimumWithPedestrians.cycle;

  const changeReference = (to: OffsetReference) => {
    const toLabel = OFFSET_REFERENCES.find((r) => r.value === to)!.short;
    if (keepTiming && projection.ok) {
      const offset = convertOffset(projection.projection, to);
      update(`Offset reference to ${toLabel}, offset ${formatSeconds(offset)} s`, (x) => {
        x.offsetReference = to;
        x.offset = offset;
      });
    } else {
      update(`Offset reference to ${toLabel}`, (x) => (x.offsetReference = to));
    }
  };

  const equivalents = projection.ok
    ? OFFSET_REFERENCES.map((ref) => `${formatSeconds(convertOffset(projection.projection, ref.value))} s to ${ref.short}`).join(' · ')
    : null;

  // Enabled phases in ring order, for the coordinated phase chips.
  const phases = new Map(intersection.phases.map((ph) => [ph.number, ph]));
  const ordered = effectiveSequence(pattern, intersection.rings)
    .flatMap((ring) => ring.groups.flat())
    .filter((n, index, all) => phases.get(n)?.enabled && all.indexOf(n) === index);
  const coordPath = p('coordinatedPhases');
  const coordIssues = issuesFor(issues, coordPath);

  return (
    <Section title="Pattern">
      <Box sx={{ p: 1.5, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', columnGap: 3, rowGap: 0.5 }}>
        <Field label="Name" path={p('name')}>
          <TextInput path={p('name')} label="Pattern name" value={pattern.name} issues={issuesFor(issues, p('name'))} onCommit={(v) => update('Rename pattern', (x) => (x.name = v))} />
        </Field>
        <Field label="Mode" path={p('mode')}>
          <SelectInput path={p('mode')} label="Mode" value={pattern.mode} options={MODES} issues={issuesFor(issues, p('mode'))} onCommit={(v) => update(`Pattern mode ${v}`, (x) => (x.mode = v))} />
        </Field>
        <Field label="Cycle" path={p('cycle')} hint={free ? undefined : `Minimum with pedestrians ${formatSeconds(minimumCycle)} s`}>
          <Box sx={{ width: 96 }}>
            <SecondsInput path={p('cycle')} label="Cycle length" value={pattern.cycle} disabled={free} issues={issuesFor(issues, p('cycle'))} onCommit={(v) => update('Cycle length', (x) => (x.cycle = v))} />
          </Box>
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            s
          </Typography>
        </Field>
        <Field label="Offset" path={p('offset')}>
          <Box sx={{ width: 96 }}>
            <SecondsInput path={p('offset')} label="Offset" value={pattern.offset} disabled={free} issues={issuesFor(issues, p('offset'))} onCommit={(v) => update('Offset', (x) => (x.offset = v))} />
          </Box>
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            s
          </Typography>
        </Field>
        <Field label="Offset reference" path={p('offsetReference')}>
          <SelectInput path={p('offsetReference')} label="Offset reference" value={pattern.offsetReference} options={OFFSET_REFERENCES} disabled={free} issues={issuesFor(issues, p('offsetReference'))} onCommit={changeReference} />
        </Field>
        <Field label="Max green" path={p('maxGreen')}>
          <SelectInput path={p('maxGreen')} label="Max green" value={pattern.maxGreen} options={MAX_GREENS} issues={issuesFor(issues, p('maxGreen'))} onCommit={(v) => update('Max green selection', (x) => (x.maxGreen = v))} />
        </Field>
        <Field label="Force-off" path={p('forceOffMode')}>
          <SelectInput path={p('forceOffMode')} label="Force-off mode" value={pattern.forceOffMode} options={FORCE_OFF_MODES} disabled={free} issues={issuesFor(issues, p('forceOffMode'))} onCommit={(v) => update('Force-off mode', (x) => (x.forceOffMode = v))} />
        </Field>
      </Box>

      {free ? null : (
        <Box sx={{ px: 1.5, pb: 1.5, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
          <Box component="label" sx={{ display: 'flex', alignItems: 'center', gap: 1, fontSize: 13, cursor: 'pointer', width: 'fit-content' }}>
            <CheckboxInput path={p('offsetReference', 'keepTiming')} label="Convert the offset when the reference changes" value={keepTiming} onCommit={setKeepTiming} />
            Convert the offset when the reference changes, so the timing on the ground stays the same
          </Box>
          <Typography variant="caption" sx={{ color: 'text.secondary', pl: 3 }}>
            {equivalents ? `Same timing as: ${equivalents}` : 'The offset cannot be converted until this pattern’s errors are fixed; changing the reference keeps the number as entered.'}
          </Typography>
        </Box>
      )}

      <Box id={fieldId(coordPath)} tabIndex={-1} sx={{ px: 1.5, py: 1, borderTop: 1, borderColor: 'divider', outline: 'none' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
          <Typography variant="body2" component="span" sx={{ fontSize: 13, color: 'text.secondary', width: 120, flexShrink: 0 }}>
            Coordinated phases
          </Typography>
          {ordered.map((n) => {
            const on = pattern.coordinatedPhases.includes(n);
            const label = phases.get(n)?.label;
            return (
              <Chip
                key={n}
                label={label ? `${n} ${label}` : String(n)}
                icon={on ? <CheckRoundedIcon /> : undefined}
                color={on ? 'primary' : 'default'}
                variant={on ? 'filled' : 'outlined'}
                disabled={free}
                aria-pressed={on}
                onClick={() => editIntersection(`${on ? 'Uncoordinate' : 'Coordinate'} phase ${n}`, (i) => toggleCoordinatedPhase(i, pattern.id, n))}
              />
            );
          })}
        </Box>
        <Typography variant="caption" component="p" sx={{ color: 'text.secondary', m: 0, mt: 0.5 }}>
          {free ? 'Not used while the pattern runs free.' : 'One per ring, all in one barrier group. Choosing a phase replaces any it conflicts with.'}
        </Typography>
        <IssueLines issues={coordIssues} />
      </Box>
    </Section>
  );
}

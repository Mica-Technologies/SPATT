/**
 * One intersection's timing sheet, laid out for paper: phase timing, ring structure, each
 * pattern with its splits, force-offs and diagram, the daily schedule, unresolved problems and
 * notes. Always drawn in the light colour scheme, whatever the app's theme.
 */
import type { ReactNode } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { projectCycle, toLocal } from '../../engine';
import { effectiveSequence, formatClock, formatDuration, formatSeconds, scheduleSpans, validateIntersection, type Intersection, type Pattern, type Phase, type Project } from '../../model';
import CycleClock from '../diagram/CycleClock';
import { REFERENCE_LABEL } from '../diagram/diagramText';
import { flaggedPhases } from '../diagram/flags';
import RingBarrierDiagram from '../diagram/RingBarrierDiagram';
import { APPROACHES, MOVEMENTS, RECALLS, optionLabel } from '../fields/phaseOptions';
import { fontFamilyMono } from '../theme/themePrimitives';

const DIAGRAM_WIDTH = 720;
const s = formatSeconds;
const sec = (tenths: number) => (tenths === 0 ? '—' : s(tenths));
const yes = (value: boolean) => (value ? 'Yes' : '');
const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

const cellSx = { border: 1, borderColor: 'divider', px: 0.75, py: 0.25, textAlign: 'right', whiteSpace: 'nowrap', fontFamily: fontFamilyMono, fontVariantNumeric: 'tabular-nums' } as const;
const headSx = { ...cellSx, textAlign: 'left', fontFamily: 'inherit', fontWeight: 500, bgcolor: 'action.hover' } as const;

/** A titled block. Short sections keep together; long ones may break, but never right after the title. */
function Section({ title, children, keepTogether = true }: { title: string; children: ReactNode; keepTogether?: boolean }) {
  return (
    <Box component="section" sx={{ mt: 2.5, breakInside: keepTogether ? 'avoid-page' : 'auto' }}>
      <Typography variant="overline" component="h3" sx={{ display: 'block', breakAfter: 'avoid-page', lineHeight: 1.6, color: 'text.secondary', borderBottom: 1, borderColor: 'divider', mb: 0.75 }}>
        {title}
      </Typography>
      {children}
    </Box>
  );
}

function Table({ head, rows, firstColumnLabel }: { head: ReactNode[]; rows: { label: string; cells: ReactNode[] }[]; firstColumnLabel: string }) {
  return (
    <Box component="table" sx={{ borderCollapse: 'collapse', fontSize: 10.5, width: '100%' }}>
      <thead>
        <tr>
          <Box component="th" scope="col" sx={headSx}>
            {firstColumnLabel}
          </Box>
          {head.map((cell, k) => (
            <Box component="th" scope="col" key={k} sx={{ ...headSx, textAlign: 'right' }}>
              {cell}
            </Box>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.label}>
            <Box component="th" scope="row" sx={headSx}>
              {row.label}
            </Box>
            {row.cells.map((cell, k) => (
              <Box component="td" key={k} sx={cellSx}>
                {cell}
              </Box>
            ))}
          </tr>
        ))}
      </tbody>
    </Box>
  );
}

function PhaseTable({ phases }: { phases: Phase[] }) {
  const row = (label: string, value: (phase: Phase) => ReactNode) => ({ label, cells: phases.map((p) => (p.enabled ? value(p) : '')) });
  const hasVolumeDensity = phases.some((p) => Object.values(p.volumeDensity).some((v) => v > 0));
  const vd = (key: keyof Phase['volumeDensity']) => (p: Phase) => sec(p.volumeDensity[key]);
  const ped = (value: (phase: Phase) => ReactNode) => (p: Phase) => (p.pedestrian.enabled ? value(p) : '—');
  const rows = [
    { label: 'Label', cells: phases.map((p) => (p.enabled ? p.label : 'Disabled')) },
    row('Direction', (p) => `${p.movement.approach ? optionLabel(APPROACHES, p.movement.approach) : '—'} ${optionLabel(MOVEMENTS, p.movement.kind)}`),
    row('Min green', (p) => s(p.minGreen)),
    row('Passage', (p) => s(p.passage)),
    row('Max 1', (p) => s(p.maxGreen1)),
    row('Max 2', (p) => sec(p.maxGreen2)),
    row('Yellow', (p) => s(p.yellow)),
    row('Red clear', (p) => s(p.redClear)),
    row('Recall', (p) => optionLabel(RECALLS, p.recall)),
    row('Walk', ped((p) => s(p.pedestrian.walk))),
    row('Ped clear', ped((p) => s(p.pedestrian.clearance))),
    row('Ped recall', ped((p) => yes(p.pedestrian.recall))),
    row('Rest in walk', ped((p) => yes(p.pedestrian.restInWalk))),
    ...(hasVolumeDensity
      ? [
          row('Added initial', vd('addedInitialPerActuation')),
          row('Max initial', vd('maxInitial')),
          row('Time before reduce', vd('timeBeforeReduction')),
          row('Time to reduce', vd('timeToReduce')),
          row('Min gap', vd('minGap')),
        ]
      : []),
    row('Dual entry', (p) => yes(p.dualEntry)),
    row('Locking detector', (p) => yes(p.lockingDetector)),
    row('Conditional service', (p) => yes(p.conditionalService)),
  ];
  return <Table firstColumnLabel="Phase" head={phases.map((p) => p.number)} rows={rows} />;
}

function RingTable({ intersection }: { intersection: Intersection }) {
  const groupCount = intersection.rings[0]?.groups.length ?? 0;
  return (
    <Table
      firstColumnLabel="Ring"
      head={Array.from({ length: groupCount }, (_, g) => `Barrier group ${g + 1}`)}
      rows={intersection.rings.map((ring, r) => ({ label: `Ring ${r + 1}`, cells: ring.groups.map((group) => (group.length > 0 ? group.join(' → ') : '—')) }))}
    />
  );
}

function PatternBlock({ intersection, pattern }: { intersection: Intersection; pattern: Pattern }) {
  const coordinated = pattern.mode === 'coordinated';
  const result = coordinated ? projectCycle(intersection, pattern.id) : null;
  const projection = result?.ok ? result.projection : null;
  const sequence = effectiveSequence(pattern, intersection.rings);
  const order = sequence.flatMap((ring) => ring.groups.flat());
  const phases = intersection.phases.filter((p) => p.enabled && order.includes(p.number)).sort((a, b) => a.number - b.number);
  const interval = (n: number) => projection?.rings.flat().find((i) => i.phase === n);
  const facts = coordinated
    ? [
        ['Cycle', `${s(pattern.cycle)} s`],
        ['Offset', `${s(pattern.offset)} s to ${REFERENCE_LABEL[pattern.offsetReference]}`],
        ['Coordinated', pattern.coordinatedPhases.join(', ') || '—'],
        ['Max green', pattern.maxGreen === 'max2' ? 'Max 2' : 'Max 1'],
        ['Force-off', pattern.forceOffMode === 'fixed' ? 'Fixed' : 'Floating'],
        ['Sequence', pattern.sequence ? sequence.map((ring, r) => `R${r + 1} ${ring.groups.map((g) => g.join(' ')).join(' | ')}`).join('; ') : 'Base'],
      ]
    : [['Mode', 'Free (no cycle, offset or splits)']];

  return (
    <Box sx={{ mt: 1.5, breakInside: 'avoid-page' }}>
      <Typography variant="subtitle2" component="h4">
        {pattern.name}
      </Typography>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', columnGap: 2.5, rowGap: 0.25, fontSize: 10.5, mb: 0.75 }}>
        {facts.map(([label, value]) => (
          <span key={label}>
            <Box component="span" sx={{ color: 'text.secondary' }}>
              {label}
            </Box>{' '}
            <Box component="span" sx={{ fontFamily: fontFamilyMono }}>
              {value}
            </Box>
          </span>
        ))}
      </Box>
      {coordinated ? (
        <>
          <Table
            firstColumnLabel="Phase"
            head={phases.map((p) => (pattern.coordinatedPhases.includes(p.number) ? `${p.number} C` : p.number))}
            rows={[
              { label: 'Split', cells: phases.map((p) => s(pattern.splits[String(p.number)] ?? 0)) },
              { label: 'Green start (local)', cells: phases.map((p) => (interval(p.number) && projection ? s(toLocal(projection, interval(p.number)!.greenStart)) : '')) },
              {
                label: 'Force-off / yield (local)',
                cells: phases.map((p) => (interval(p.number) && projection ? s(toLocal(projection, interval(p.number)!.forceOff)) : '')),
              },
            ]}
          />
          {projection && result?.ok ? (
            <Box sx={{ mt: 1 }}>
              <RingBarrierDiagram projection={projection} intersection={intersection} width={DIAGRAM_WIDTH} interactive={false} legend flagged={flaggedPhases(intersection, result.issues)} />
              <Box sx={{ mt: 0.5 }}>
                <CycleClock projection={projection} width={DIAGRAM_WIDTH} />
              </Box>
            </Box>
          ) : (
            <Typography variant="caption" component="p" sx={{ color: 'error.main', mt: 0.5 }}>
              No diagram: this pattern has problems that leave its layout undefined (listed under Problems).
            </Typography>
          )}
        </>
      ) : null}
    </Box>
  );
}

export default function TimingSheet({ project, intersection, printedAt }: { project: Project; intersection: Intersection; printedAt: Date }) {
  const issues = validateIntersection(intersection);
  const errors = issues.filter((i) => i.severity === 'error');
  const warnings = issues.length - errors.length;
  const phases = [...intersection.phases].sort((a, b) => a.number - b.number);
  const patternName = new Map(intersection.patterns.map((p) => [p.id, p.name]));

  return (
    <Box component="article" className="sheet-page" aria-label={`Timing sheet, ${intersection.name}`}>
      <Box component="header" sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 2, borderBottom: 2, borderColor: 'text.primary', pb: 0.75 }}>
        <Box>
          <Typography variant="overline" sx={{ display: 'block', lineHeight: 1.4, color: 'text.secondary' }}>
            Signal timing sheet · {project.name}
          </Typography>
          <Typography variant="h5" component="h2" sx={{ fontWeight: 600 }}>
            {intersection.name}
          </Typography>
        </Box>
        <Typography variant="caption" sx={{ color: 'text.secondary', textAlign: 'right' }}>
          Printed {dateFormat.format(printedAt)}
          <br />
          Edited {dateFormat.format(new Date(project.updatedAt))}
        </Typography>
      </Box>

      <Section title="Phase timing (seconds)" keepTogether={false}>
        <PhaseTable phases={phases} />
      </Section>

      <Section title="Rings and barriers">
        <RingTable intersection={intersection} />
      </Section>

      <Section title="Patterns" keepTogether={false}>
        {intersection.patterns.length === 0 ? (
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            No patterns: the intersection runs free.
          </Typography>
        ) : (
          intersection.patterns.map((pattern) => <PatternBlock key={pattern.id} intersection={intersection} pattern={pattern} />)
        )}
      </Section>

      <Section title="Daily schedule">
        {intersection.schedule.length === 0 ? (
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            No schedule entries.
          </Typography>
        ) : (
          <Table
            firstColumnLabel="Start"
            head={['Ends', 'Duration', 'Pattern']}
            rows={scheduleSpans(intersection.schedule).map((span) => ({
              label: formatClock(span.startMinute),
              cells: [`${formatClock(span.endMinute % 1440)}${span.endMinute > 1440 ? ' +1 day' : ''}`, formatDuration(span.durationMinutes), span.entry.patternId === null ? 'Free' : (patternName.get(span.entry.patternId) ?? 'Unknown pattern')],
            }))}
          />
        )}
      </Section>

      {issues.length > 0 ? (
        <Section title={`Problems (${errors.length} error${errors.length === 1 ? '' : 's'}, ${warnings} warning${warnings === 1 ? '' : 's'})`}>
          <Box component="ul" sx={{ m: 0, pl: 2.5, fontSize: 10.5 }}>
            {issues.map((issue, k) => (
              <Box component="li" key={k} sx={{ color: issue.severity === 'error' ? 'error.main' : 'text.primary' }}>
                {issue.message}
              </Box>
            ))}
          </Box>
        </Section>
      ) : null}

      {intersection.notes.trim() ? (
        <Section title="Notes">
          <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
            {intersection.notes}
          </Typography>
        </Section>
      ) : null}

      <Typography component="footer" variant="caption" sx={{ display: 'block', mt: 3, pt: 0.75, borderTop: 1, borderColor: 'divider', color: 'text.secondary' }}>
        Produced with SPATT. Not certified engineering software: check every value against local practice and the governing standards before use.
      </Typography>
    </Box>
  );
}

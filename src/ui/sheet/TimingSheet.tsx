/**
 * One intersection's timing sheet, laid out for paper: phase timing, ring structure, each
 * pattern with its splits, force-offs and diagram, the daily schedule, lane groups, counts and
 * capacity analysis, unresolved problems and notes. Always drawn in the light colour scheme, whatever the app's theme.
 */
import type { ReactNode } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { analyzePattern, projectCycle, saturationFlow, toLocal } from '../../engine';
import {
  effectiveSequence,
  formatClock,
  formatDuration,
  formatMeasure,
  formatSeconds,
  fromMetres,
  LENGTH_LABEL,
  MOVEMENT_LABEL,
  MOVEMENTS as TURNS,
  scheduleSpans,
  validateIntersection,
  type Intersection,
  type LengthUnit,
  type Pattern,
  type Phase,
  type Project,
} from '../../model';
import CycleClock from '../diagram/CycleClock';
import { REFERENCE_LABEL } from '../diagram/diagramText';
import { flaggedPhases } from '../diagram/flags';
import RingBarrierDiagram from '../diagram/RingBarrierDiagram';
import { APPROACHES, MOVEMENTS, RECALLS, optionLabel } from '../fields/phaseOptions';
import { Facts, Section, SheetFooter, SheetHeader, Table } from './sheetParts';

const DIAGRAM_WIDTH = 720;
const s = formatSeconds;
const sec = (tenths: number) => (tenths === 0 ? '—' : s(tenths));
const yes = (value: boolean) => (value ? 'Yes' : '');
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
        ...(pattern.volumeSetId ? [['Count', intersection.volumeSets.find((v) => v.id === pattern.volumeSetId)?.name ?? 'Missing']] : []),
      ]
    : [['Mode', 'Free (no cycle, offset or splits)']];

  return (
    <Box sx={{ mt: 1.5, breakInside: 'avoid-page' }}>
      <Typography variant="subtitle2" component="h4">
        {pattern.name}
      </Typography>
      <Facts facts={facts as [string, string][]} />
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

function CapacityTables({ intersection, lengthUnit }: { intersection: Intersection; lengthUnit: LengthUnit }) {
  const groups = intersection.laneGroups;
  const label = (k: number) => groups[k]!.label || `Lane group ${k + 1}`;
  return (
    <>
      <Typography variant="caption" component="p" sx={{ mb: 0.5 }}>
        Base saturation flow {intersection.capacity.baseSaturationFlow} pc/h/g/ln{intersection.capacity.centralBusinessDistrict ? ', central business district' : ''}
      </Typography>
      <Table
        firstColumnLabel="Lane group"
        head={['Phase', 'Movements', 'Lanes', `Width (${LENGTH_LABEL[lengthUnit]})`, 'Heavy veh. %', 'Grade %', 'Sat. flow (veh/h)']}
        rows={groups.map((g, k) => ({
          label: label(k),
          cells: [
            g.phase,
            TURNS.filter((m) => g.movements[m]).map((m) => MOVEMENT_LABEL[m]).join(', '),
            g.lanes,
            formatMeasure(fromMetres(g.laneWidth, lengthUnit)),
            g.heavyVehiclesPercent,
            g.gradePercent,
            g.saturationFlow === null ? Math.round(saturationFlow(intersection, g, undefined).calculated) : `${g.saturationFlow} (entered)`,
          ],
        }))}
      />
      {intersection.volumeSets.map((set) => (
        <Box key={set.id} sx={{ mt: 1.5, breakInside: 'avoid-page' }}>
          <Typography variant="subtitle2" component="h4">
            {set.name || 'Count'} <Box component="span" sx={{ fontWeight: 400, color: 'text.secondary', fontSize: 11 }}>peak hour factor {set.peakHourFactor}</Box>
          </Typography>
          <Table
            firstColumnLabel="Lane group"
            head={[...TURNS.map((m) => `${MOVEMENT_LABEL[m]} (veh/h)`), 'Total']}
            rows={groups.map((g, k) => {
              const v = set.volumes[g.id] ?? { left: 0, through: 0, right: 0 };
              return { label: label(k), cells: [...TURNS.map((m) => (g.movements[m] || v[m] > 0 ? v[m] : '—')), v.left + v.through + v.right] };
            })}
          />
        </Box>
      ))}
      {intersection.patterns.map((pattern) => {
        const analysis = analyzePattern(intersection, pattern.id);
        if (!analysis.ok) return null;
        return (
          <Box key={pattern.id} sx={{ mt: 1.5, breakInside: 'avoid-page' }}>
            <Typography variant="subtitle2" component="h4">
              {pattern.name} with {analysis.volumeSet.name || 'its count'}{' '}
              <Box component="span" sx={{ fontWeight: 400, color: 'text.secondary', fontSize: 11 }}>
                delay {analysis.delay === null ? '—' : `${analysis.delay.toFixed(1)} s/veh, LOS ${analysis.los}`} · Xc {analysis.criticalVolumeToCapacity?.toFixed(2) ?? '—'} · Y {analysis.critical.flowRatio.toFixed(3)} · Webster{' '}
                {analysis.critical.webster === null ? 'none (Y ≥ 1)' : `${s(analysis.critical.webster)} s`}
              </Box>
            </Typography>
            <Table
              firstColumnLabel="Lane group"
              head={['v (veh/h)', 's (veh/h)', 'g (s)', 'c (veh/h)', 'v/c', 'Delay (s)', 'LOS']}
              rows={analysis.laneGroups.map((g, k) => ({
                label: label(k),
                cells: [g.flow.toFixed(0), g.saturation.value.toFixed(0), g.effectiveGreen.toFixed(1), g.capacity.toFixed(0), Number.isFinite(g.volumeToCapacity) ? g.volumeToCapacity.toFixed(2) : '—', g.delay?.toFixed(1) ?? '—', g.los ?? '—'],
              }))}
            />
          </Box>
        );
      })}
    </>
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
      <SheetHeader kind={`Signal timing sheet · ${project.name}`} title={intersection.name} printedAt={printedAt} editedAt={project.updatedAt} />

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

      {intersection.laneGroups.length > 0 ? (
        <Section title="Lane groups, counts and capacity (HCM 2000, simplified)" keepTogether={false}>
          <CapacityTables intersection={intersection} lengthUnit={project.units.length} />
        </Section>
      ) : null}

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

      <SheetFooter />
    </Box>
  );
}

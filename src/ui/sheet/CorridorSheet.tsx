/**
 * One corridor timing plan's time-space sheet, laid out for paper: the plan's cycle and bands, the
 * time-space diagram over two cycles, each intersection's pattern and offset, and the links with
 * their distances and progression speeds. Always drawn in the light colour scheme.
 */
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { analyzeProgression, type Direction } from '../../engine';
import { formatMeasure, formatSeconds, fromMetres, fromMetresPerSecond, LENGTH_LABEL, oppositeDirection, SPEED_LABEL, type Corridor, type CorridorPlan, type Project } from '../../model';
import TimeSpaceDiagram from '../corridor/TimeSpaceDiagram';
import { REFERENCE_LABEL } from '../diagram/diagramText';
import { Facts, Section, SheetFooter, SheetHeader, Table } from './sheetParts';

const s = formatSeconds;

export default function CorridorSheet({ project, corridor, plan, printedAt }: { project: Project; corridor: Corridor; plan: CorridorPlan; printedAt: Date }) {
  const progression = analyzeProgression(project, corridor, plan);
  const labels: Record<Direction, string> = { outbound: `${corridor.outbound}B`, inbound: `${oppositeDirection(corridor.outbound)}B` };
  const intersections = new Map(project.intersections.map((i) => [i.id, i]));
  const { length, speed } = project.units;
  const band = (direction: Direction) => {
    const b = progression.bands[direction];
    return b.bandwidth === null ? '—' : `${s(b.bandwidth)} s (${Math.round((b.efficiency ?? 0) * 100)} %)`;
  };
  const name = (id: string) => intersections.get(id)?.name ?? 'Missing intersection';

  return (
    <Box component="article" className="sheet-page" aria-label={`Time-space sheet, ${corridor.name}, ${plan.name}`}>
      <SheetHeader kind={`Time-space sheet · ${project.name}`} title={corridor.name} subtitle={plan.name || 'Untitled plan'} printedAt={printedAt} editedAt={project.updatedAt} />

      <Section title="Plan">
        <Facts
          facts={[
            ['Cycle', progression.cycle === null ? 'Intersections differ' : `${s(progression.cycle)} s`],
            ['Outbound', labels.outbound],
            [`${labels.outbound} band`, band('outbound')],
            [`${labels.inbound} band`, band('inbound')],
            ['Weights', `${labels.outbound} ${plan.weights.outbound} : ${labels.inbound} ${plan.weights.inbound}`],
          ]}
        />
      </Section>

      <Section title="Time-space diagram">
        <TimeSpaceDiagram progression={progression} cycles={2} labels={labels} />
        <Typography variant="caption" component="p" sx={{ color: 'text.secondary', mt: 0.5 }}>
          Green and red bars: through phases at each intersection ({labels.outbound} above the line, {labels.inbound} below). Shaded bands: vehicles meeting green at every intersection at the
          progression speeds ({labels.outbound} solid, {labels.inbound} dashed).
        </Typography>
      </Section>

      <Section title="Intersections">
        <Table
          firstColumnLabel="Intersection"
          head={['Pattern', 'Cycle (s)', 'Offset (s)', 'Measured to', `${labels.outbound} phases`, `${labels.inbound} phases`]}
          rows={corridor.stops.map((stop) => {
            const intersection = intersections.get(stop.intersectionId);
            const pattern = intersection?.patterns.find((p) => p.id === plan.patterns[stop.intersectionId]);
            const coordinated = pattern?.mode === 'coordinated';
            return {
              label: name(stop.intersectionId),
              cells: [
                pattern ? pattern.name : 'Not in plan',
                coordinated ? s(pattern.cycle) : pattern ? 'Free' : '—',
                coordinated ? s(pattern.offset) : '—',
                coordinated ? REFERENCE_LABEL[pattern.offsetReference] : '—',
                stop.outboundPhases.join(', ') || '—',
                stop.inboundPhases.join(', ') || '—',
              ],
            };
          })}
        />
      </Section>

      {corridor.stops.length > 1 ? (
        <Section title="Links">
          <Table
            firstColumnLabel="Link"
            head={[`Distance (${LENGTH_LABEL[length]})`, `${labels.outbound} speed (${SPEED_LABEL[speed]})`, `${labels.inbound} speed (${SPEED_LABEL[speed]})`, `${labels.outbound} travel (s)`, `${labels.inbound} travel (s)`]}
            rows={corridor.stops.slice(1).map((stop, k) => {
              const travel = (v: number) => (v > 0 ? (stop.distance / v).toFixed(1) : '—');
              return {
                label: `${name(corridor.stops[k]!.intersectionId)} → ${name(stop.intersectionId)}`,
                cells: [
                  formatMeasure(fromMetres(stop.distance, length)),
                  formatMeasure(fromMetresPerSecond(stop.speed.outbound, speed)),
                  formatMeasure(fromMetresPerSecond(stop.speed.inbound, speed)),
                  travel(stop.speed.outbound),
                  travel(stop.speed.inbound),
                ],
              };
            })}
          />
        </Section>
      ) : null}

      <SheetFooter />
    </Box>
  );
}

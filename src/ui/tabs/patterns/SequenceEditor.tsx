/** Lead/lag: the order of phases within each ring's barrier group, for this pattern only. */
import RestartAltRoundedIcon from '@mui/icons-material/RestartAltRounded';
import SwapHorizRoundedIcon from '@mui/icons-material/SwapHorizRounded';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { Fragment } from 'react';
import { effectiveSequence, type Intersection, type Issue, type Pattern, type Phase } from '../../../model';
import { fieldId, issuesFor, type FieldPath } from '../../fields/paths';
import { useWorkspace } from '../../state/workspace';
import { swapSequencePhases } from './patternEdits';
import { IssueLines, Section } from './Section';

interface SequenceEditorProps {
  intersection: Intersection;
  pattern: Pattern;
  path: FieldPath;
  issues: readonly Issue[];
}

/** "Leading left" / "Lagging left" when a group has exactly one left turn at one end. */
function leadLagLabel(order: Phase[]): string | null {
  const lefts = order.filter((p) => p.movement.kind === 'left');
  if (lefts.length !== 1 || order.length < 2) return null;
  const index = order.indexOf(lefts[0]!);
  if (index === 0) return 'Leading left';
  if (index === order.length - 1) return 'Lagging left';
  return null;
}

export default function SequenceEditor({ intersection, pattern, path, issues }: SequenceEditorProps) {
  const editIntersection = useWorkspace((s) => s.editIntersection);
  const phases = new Map(intersection.phases.map((p) => [p.number, p]));
  const enabled = (n: number) => phases.get(n)?.enabled === true;
  const sequence = effectiveSequence(pattern, intersection.rings);
  const own = pattern.sequence !== null;
  const sequencePath = [...path, 'sequence'];

  const rows = sequence.flatMap((ring, r) =>
    ring.groups.map((group, g) => ({ r, g, order: group.filter(enabled), base: (intersection.rings[r]?.groups[g] ?? []).filter(enabled) })).filter((row) => row.order.length >= 2),
  );

  return (
    <Section
      title="Phase sequence"
      id={fieldId(sequencePath)}
      actions={
        <>
          <Chip label={own ? 'Own sequence for this pattern' : 'Base sequence'} color={own ? 'warning' : 'default'} variant="outlined" />
          {own ? (
            <Button size="small" startIcon={<RestartAltRoundedIcon />} onClick={() => editIntersection('Reset phase sequence', (i) => {
              const found = i.patterns.find((x) => x.id === pattern.id);
              if (found) found.sequence = null;
            })}>
              Use base sequence
            </Button>
          ) : null}
        </>
      }
    >
      <Box sx={{ px: 1.5, py: 1, display: 'flex', flexDirection: 'column', gap: 0.75 }}>
        {rows.length === 0 ? (
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            No ring has two phases in one barrier group, so there is no order to change.
          </Typography>
        ) : null}
        {rows.map(({ r, g, order, base }) => {
          const changed = order.join() !== base.join();
          const lead = leadLagLabel(order.map((n) => phases.get(n)!));
          return (
            <Box key={`${r}-${g}`} sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', minHeight: 32 }}>
              <Typography variant="body2" sx={{ fontSize: 13, color: 'text.secondary', width: 150, flexShrink: 0 }}>
                Ring {r + 1} · barrier group {g + 1}
              </Typography>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25 }}>
                {order.map((n, k) => (
                  <Fragment key={n}>
                    {k > 0 ? (
                      <Tooltip title={`Swap ${order[k - 1]} and ${n}`}>
                        <IconButton size="small" aria-label={`Swap phases ${order[k - 1]} and ${n}`} onClick={() => editIntersection(`Swap phases ${order[k - 1]} and ${n}`, (i) => swapSequencePhases(i, pattern.id, r, order[k - 1]!, n))} sx={{ width: 26, height: 26 }}>
                          <SwapHorizRoundedIcon sx={{ fontSize: 18 }} />
                        </IconButton>
                      </Tooltip>
                    ) : null}
                    <Chip label={phases.get(n)?.label ? `${n} ${phases.get(n)!.label}` : String(n)} variant="outlined" color={pattern.coordinatedPhases.includes(n) ? 'primary' : 'default'} />
                  </Fragment>
                ))}
              </Box>
              {lead ? (
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                  {lead}
                </Typography>
              ) : null}
              {changed ? (
                <Typography variant="caption" sx={{ color: 'warning.main', fontWeight: 600 }}>
                  changed from {base.join(' → ')}
                </Typography>
              ) : null}
            </Box>
          );
        })}
        <IssueLines issues={issuesFor(issues, sequencePath)} />
      </Box>
    </Section>
  );
}

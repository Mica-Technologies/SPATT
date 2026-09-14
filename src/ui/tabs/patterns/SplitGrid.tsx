/**
 * The split grid: rings down the side, each ring's phases across in its effective sequence
 * order, grouped by barrier, with ring and group totals and what is left of the cycle.
 */
import { Fragment } from 'react';
import BalanceRoundedIcon from '@mui/icons-material/BalanceRounded';
import InfoRoundedIcon from '@mui/icons-material/InfoRounded';
import ViewWeekRoundedIcon from '@mui/icons-material/ViewWeekRounded';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { splitMinimums } from '../../../engine';
import { effectiveSequence, formatSeconds, type Intersection, type Issue, type Pattern, type Phase } from '../../../model';
import { SecondsInput } from '../../fields/GridInputs';
import { fieldId, issuesFor, type FieldPath } from '../../fields/paths';
import { fontFamilyMono } from '../../theme/themePrimitives';
import { useWorkspace } from '../../state/workspace';
import { applyBalance, applyEven } from './patternEdits';
import { IssueLines, Section } from './Section';

interface SplitGridProps {
  intersection: Intersection;
  pattern: Pattern;
  path: FieldPath;
  issues: readonly Issue[];
}

const CELL_WIDTH = 92;
const s = formatSeconds;
const barrierEdge = { borderLeft: 3, borderLeftStyle: 'double', borderLeftColor: 'text.disabled' } as const;
const mono = { fontFamily: fontFamilyMono, fontVariantNumeric: 'tabular-nums' } as const;

export default function SplitGrid({ intersection, pattern, path, issues }: SplitGridProps) {
  const editIntersection = useWorkspace((st) => st.editIntersection);
  const free = pattern.mode === 'free';
  const phases = new Map(intersection.phases.map((p) => [p.number, p]));
  const enabled = (n: number) => phases.get(n)?.enabled === true;
  const split = (n: number) => pattern.splits[String(n)] ?? 0;
  const sequence = effectiveSequence(pattern, intersection.rings);
  const groupCount = sequence[0]?.groups.length ?? 0;
  const coordinated = new Set(pattern.coordinatedPhases);

  // rows[r][g] = enabled phases of ring r in group g, in timing order.
  const rows = sequence.map((ring) => Array.from({ length: groupCount }, (_, g) => (ring.groups[g] ?? []).filter(enabled)));
  const columns = Array.from({ length: groupCount }, (_, g) => Math.max(1, ...rows.map((row) => row[g]!.length)));
  const ringGroupTotal = (r: number, g: number) => rows[r]![g]!.reduce((sum, n) => sum + split(n), 0);
  // As validation: a group lasts as long as the first ring that serves it.
  const groupTotals = columns.map((_, g) => {
    const serving = rows.findIndex((row) => row[g]!.length > 0);
    return serving < 0 ? 0 : ringGroupTotal(serving, g);
  });
  const groupSpread = columns.map((_, g) => {
    const totals = rows.map((row, r) => (row[g]!.length > 0 ? ringGroupTotal(r, g) : null)).filter((t): t is number => t !== null);
    return totals.length > 0 ? Math.max(...totals) - Math.min(...totals) : 0;
  });
  // A ring that serves no phase in a group waits at the barrier for that group's length, so its
  // total compares with the cycle like every other ring's.
  const ringWait = (r: number) => rows[r]!.reduce((sum, list, g) => sum + (list.length === 0 ? groupTotals[g]! : 0), 0);
  const ringTotal = (r: number) => rows[r]!.reduce((sum, _, g) => sum + ringGroupTotal(r, g), 0) + ringWait(r);
  const splitsTotal = groupTotals.reduce((sum, t) => sum + t, 0);
  const remainder = pattern.cycle - splitsTotal;
  const aligned = groupSpread.every((spread) => spread === 0);
  const splitsPath = [...path, 'splits'];
  const groupIssues = issues.filter((i) => i.path.length === splitsPath.length && i.path.every((part, k) => String(part) === String(splitsPath[k])));

  const commitSplit = (n: number, value: number) =>
    editIntersection(`Phase ${n} split`, (i) => {
      const found = i.patterns.find((x) => x.id === pattern.id);
      if (found) found.splits[String(n)] = value;
    });

  const cell = (n: number, phase: Phase) => {
    const cellPath = [...splitsPath, String(n)];
    const min = splitMinimums(phase);
    const minTip =
      `Minimum ${phase.movement.kind === 'pedestrian' ? 'yellow + red clear' : 'green + yellow + red clear'}: ${s(min.vehicle)} s` +
      (min.pedestrian === null ? '' : `\nWalk + pedestrian clearance + yellow + red clear: ${s(min.pedestrian)} s${phase.pedestrian.recall ? ' (pedestrian recall)' : ''}`);
    return (
      <>
        <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.5, px: 0.5 }}>
          <Typography variant="caption" sx={{ fontWeight: 600 }}>
            {n}
          </Typography>
          {coordinated.has(n) ? (
            <Typography variant="caption" sx={{ color: 'primary.main', fontWeight: 600 }}>
              coord
            </Typography>
          ) : null}
          <Typography variant="caption" noWrap sx={{ color: 'text.secondary', minWidth: 0 }}>
            {phase.label}
          </Typography>
        </Box>
        <SecondsInput path={cellPath} label={`Split, phase ${n}`} value={split(n)} disabled={free} issues={issuesFor(issues, cellPath, splitsPath.length + 1)} onCommit={(v) => commitSplit(n, v)} />
        <Tooltip title={minTip} slotProps={{ tooltip: { sx: { whiteSpace: 'pre-line' } } }}>
          <Box sx={{ color: 'text.secondary', px: 0.5, fontSize: 11, lineHeight: 1.35, ...mono }}>
            <div>min {s(min.vehicle)}</div>
            {min.pedestrian === null ? null : <div>ped {s(min.pedestrian)}</div>}
          </Box>
        </Tooltip>
      </>
    );
  };

  const headCell = { px: 1, py: 0.5, textAlign: 'left', fontWeight: 400, borderBottom: 1, borderColor: 'divider', whiteSpace: 'nowrap' } as const;
  const totalCell = { px: 1, textAlign: 'right', whiteSpace: 'nowrap', bgcolor: 'background.default', ...mono } as const;

  return (
    <Section
      title="Splits"
      actions={
        <>
          <Tooltip title={free ? 'A free pattern does not use splits' : 'Raise splits below their minimum, line the rings up at each barrier, then fit the groups to the cycle on the coordinated phases'}>
            <span>
              <Button size="small" variant="outlined" startIcon={<BalanceRoundedIcon />} disabled={free} onClick={() => editIntersection('Balance splits', (i) => applyBalance(i, pattern.id))}>
                Balance
              </Button>
            </span>
          </Tooltip>
          <Tooltip title="Replace the splits: share the cycle by each phase's minimum green and pedestrian time">
            <span>
              <Button size="small" variant="outlined" startIcon={<ViewWeekRoundedIcon />} disabled={free || pattern.cycle === 0} onClick={() => editIntersection('Distribute splits evenly', (i) => applyEven(i, pattern.id))}>
                Distribute evenly
              </Button>
            </span>
          </Tooltip>
        </>
      }
    >
      {free ? (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1.5, py: 1, color: 'text.secondary', borderBottom: 1, borderColor: 'divider' }}>
          <InfoRoundedIcon fontSize="small" />
          <Typography variant="body2">This pattern runs free, so its cycle, offset and splits are not used.</Typography>
        </Box>
      ) : null}

      <Box sx={{ overflowX: 'auto', opacity: free ? 0.6 : 1 }}>
        <Box component="table" sx={{ borderCollapse: 'separate', borderSpacing: 0, fontSize: 13, width: '100%' }}>
          <thead>
            <tr>
              <Box component="th" scope="col" sx={{ ...headCell, width: 64 }}>
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                  Ring
                </Typography>
              </Box>
              {columns.map((count, g) => (
                <Box component="th" scope="colgroup" key={g} colSpan={count + 1} sx={{ ...headCell, ...(g > 0 ? barrierEdge : {}) }}>
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                    Barrier group {g + 1}
                  </Typography>
                </Box>
              ))}
              <Box component="th" scope="col" sx={{ ...headCell, ...barrierEdge, textAlign: 'right' }}>
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                  Ring total
                </Typography>
              </Box>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, r) => (
              <Box component="tr" key={r} sx={{ '& > td, & > th': { borderBottom: 1, borderColor: 'divider' } }}>
                <Box component="th" scope="row" sx={{ px: 1, textAlign: 'left', fontWeight: 600, whiteSpace: 'nowrap' }}>
                  {r + 1}
                </Box>
                {row.map((groupPhases, g) => {
                  const edge = g > 0 ? barrierEdge : {};
                  if (groupPhases.length === 0) {
                    return (
                      <Fragment key={g}>
                        <Box component="td" colSpan={columns[g]} sx={{ px: 1, color: 'text.secondary', fontStyle: 'italic', ...edge }}>
                          waits at the barrier
                        </Box>
                        <Box component="td" sx={{ ...totalCell, color: 'text.disabled' }}>
                          —
                        </Box>
                      </Fragment>
                    );
                  }
                  const total = ringGroupTotal(r, g);
                  const off = total !== groupTotals[g];
                  return (
                    <Fragment key={g}>
                      {Array.from({ length: columns[g]! }, (_, k) => {
                        const n = groupPhases[k];
                        return (
                          <Box component="td" key={k} sx={{ width: CELL_WIDTH, minWidth: CELL_WIDTH, maxWidth: CELL_WIDTH, px: 0.25, py: 0.5, verticalAlign: 'top', ...(k === 0 ? edge : {}) }}>
                            {n === undefined ? null : cell(n, phases.get(n)!)}
                          </Box>
                        );
                      })}
                      <Box component="td" sx={{ ...totalCell, color: off ? 'error.main' : 'text.primary', fontWeight: off ? 600 : 400 }}>
                        {s(total)}
                      </Box>
                    </Fragment>
                  );
                })}
                <Box component="td" sx={{ ...totalCell, ...barrierEdge }}>
                  <div>{s(ringTotal(r))}</div>
                  {ringWait(r) > 0 ? (
                    <Box sx={{ color: 'text.secondary', fontSize: 11 }}>incl. {s(ringWait(r))} s wait</Box>
                  ) : null}
                </Box>
              </Box>
            ))}
            <tr>
              <Box component="th" scope="row" sx={{ px: 1, textAlign: 'left', fontWeight: 400, color: 'text.secondary', whiteSpace: 'nowrap' }}>
                Group
              </Box>
              {columns.map((count, g) => (
                <Box component="td" key={g} colSpan={count + 1} sx={{ ...totalCell, py: 0.75, ...(g > 0 ? barrierEdge : {}) }}>
                  <Box component="span" sx={{ fontWeight: 600 }}>
                    {s(groupTotals[g]!)} s
                  </Box>
                  {groupSpread[g]! > 0 ? (
                    <Box component="span" sx={{ color: 'error.main', ml: 1 }}>
                      rings differ by {s(groupSpread[g]!)} s
                    </Box>
                  ) : null}
                </Box>
              ))}
              <Box component="td" sx={{ ...totalCell, ...barrierEdge, fontWeight: 600 }}>
                {s(splitsTotal)} s
              </Box>
            </tr>
          </tbody>
        </Box>
      </Box>

      <Box id={fieldId(splitsPath)} tabIndex={-1} sx={{ px: 1.5, py: 1, display: 'flex', flexDirection: 'column', gap: 0.5, outline: 'none' }}>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 3, fontSize: 13 }}>
          <span>
            Splits total <Box component="strong" sx={mono}>{s(splitsTotal)} s</Box>
          </span>
          <span>
            Cycle <Box component="strong" sx={mono}>{s(pattern.cycle)} s</Box>
          </span>
          {free ? null : (
            <Box component="span" role="status" sx={{ color: remainder === 0 && aligned ? 'success.main' : 'error.main', fontWeight: 600 }}>
              {remainder > 0 ? `${s(remainder)} s unallocated` : remainder < 0 ? `${s(-remainder)} s over the cycle` : aligned ? 'Splits fill the cycle' : 'Groups fill the cycle, but the rings are not aligned'}
            </Box>
          )}
        </Box>
        {free ? null : <IssueLines issues={groupIssues} />}
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          Split = green + yellow + red clear, in seconds. Minimums under each split: minimum green + clearances, and walk + pedestrian clearance + clearances.
        </Typography>
      </Box>
    </Section>
  );
}

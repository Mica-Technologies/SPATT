/**
 * Capacity analysis of one pattern against its count (v/c, HCM 2000 delay, level of service,
 * Webster's cycle), and "Suggest timing", which adds a new pattern timed from the count.
 */
import { useMemo, useState } from 'react';
import AutoFixHighRoundedIcon from '@mui/icons-material/AutoFixHighRounded';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { analyzePattern, suggestedPattern, suggestTiming, type SuggestedTiming } from '../../../engine';
import { formatSeconds, uniqueName, type Intersection, type Issue } from '../../../model';
import { SelectInput } from '../../fields/GridInputs';
import { issuesFor, type FieldPath } from '../../fields/paths';
import { useWorkspace } from '../../state/workspace';
import { fontFamilyMono } from '../../theme/themePrimitives';
import { nextPatternId } from '../patterns/patternEdits';
import { Section } from '../patterns/Section';
import { cellSx as baseCellSx, headSx as baseHeadSx, numberCellSx as baseNumberCellSx } from './tableStyles';

const cellSx = { ...baseCellSx, px: 0.75 } as const;
const headSx = { ...baseHeadSx, px: 0.75 } as const;
const numberCellSx = { ...baseNumberCellSx, px: 0.75 } as const;

const REASONS: Record<string, string> = {
  'no-volume-set': 'Link this pattern to a count to analyse it.',
  'no-lane-groups': 'Add lane groups and volumes to analyse this pattern.',
  'no-cycle': 'The analysis needs a cycle length: it works on coordinated patterns.',
  'not-coordinated': 'Suggest timing works from a coordinated pattern.',
  'no-volumes': 'The count has no volumes yet.',
};

const LIMITED: Record<NonNullable<Extract<SuggestedTiming, { ok: true }>['limitedBy']>, string> = {
  minimum: 'Webster’s cycle was shorter than the 40 s minimum, so the minimum is used.',
  maximum: 'Webster’s cycle was longer than the 180 s maximum, so the maximum is used.',
  'phase-minimums': 'Webster’s cycle could not fit every phase’s minimum split (pedestrian intervals included), so the cycle is the shortest that does.',
  oversaturated: 'Demand reaches or exceeds saturation (Y ≥ 1), so there is no Webster cycle; the 180 s maximum is used and delays will be high.',
};

const fixed = (value: number | null, digits: number) => (value === null || !Number.isFinite(value) ? '—' : value.toFixed(digits));

interface AnalysisSectionProps {
  intersection: Intersection;
  basePath: FieldPath;
  issues: readonly Issue[];
}

export default function AnalysisSection({ intersection, basePath, issues }: AnalysisSectionProps) {
  const editIntersection = useWorkspace((s) => s.editIntersection);
  const selectedPatternId = useWorkspace((s) => s.selectedPatternId);
  const selectPattern = useWorkspace((s) => s.selectPattern);
  const [created, setCreated] = useState<{ name: string; cycle: number; limitedBy: string | null; oversaturated: boolean } | null>(null);
  const patternIndex = Math.max(0, intersection.patterns.findIndex((p) => p.id === selectedPatternId));
  const pattern = intersection.patterns[patternIndex];
  const analysis = useMemo(() => (pattern ? analyzePattern(intersection, pattern.id) : null), [intersection, pattern]);

  if (!pattern || !analysis) {
    return (
      <Section title="Analysis">
        <Typography variant="body2" sx={{ color: 'text.secondary', p: 1.5 }}>
          Add a pattern to analyse it against a count.
        </Typography>
      </Section>
    );
  }
  const linkPath = [...basePath, 'patterns', patternIndex, 'volumeSetId'];

  const suggest = () => {
    const suggestion = suggestTiming(intersection, pattern.id);
    if (!suggestion.ok) return;
    const id = nextPatternId(intersection);
    const name = uniqueName(`${pattern.name || 'Pattern'} (suggested)`, intersection.patterns.map((p) => p.name));
    editIntersection(`Suggest timing from ${pattern.name || pattern.id}`, (i) => i.patterns.push(suggestedPattern(pattern, suggestion, id, name)));
    selectPattern(id);
    setCreated({ name, cycle: suggestion.cycle, limitedBy: suggestion.limitedBy ? LIMITED[suggestion.limitedBy] : null, oversaturated: suggestion.limitedBy === 'oversaturated' });
  };
  const canSuggest = suggestTiming(intersection, pattern.id);

  const stat = (label: string, value: string) => (
    <Box role="group" aria-label={label} sx={{ px: 1.25, py: 0.5, border: 1, borderColor: 'divider', borderRadius: 2, minWidth: 92 }}>
      <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>
        {label}
      </Typography>
      <Typography variant="subtitle1" component="p" sx={{ fontFamily: fontFamilyMono, m: 0 }}>
        {value}
      </Typography>
    </Box>
  );

  return (
    <Section
      title="Analysis"
      actions={
        <Button size="small" variant="contained" startIcon={<AutoFixHighRoundedIcon />} onClick={suggest} disabled={!canSuggest.ok}>
          Suggest timing
        </Button>
      }
    >
      <Box sx={{ p: 1.5, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
          <TextField select size="small" label="Pattern" value={pattern.id} onChange={(e) => selectPattern(e.target.value)} sx={{ minWidth: 200 }}>
            {intersection.patterns.map((p) => (
              <MenuItem key={p.id} value={p.id}>
                {p.name || p.id}
              </MenuItem>
            ))}
          </TextField>
          <Box component="label" sx={{ display: 'flex', alignItems: 'center', gap: 1, fontSize: 13, color: 'text.secondary' }}>
            Timed for count
            <SelectInput
              path={linkPath}
              label="Count this pattern is timed for"
              value={pattern.volumeSetId ?? ''}
              options={[{ value: '', label: 'None' }, ...intersection.volumeSets.map((s) => ({ value: s.id, label: s.name || s.id }))]}
              issues={issuesFor(issues, linkPath)}
              onCommit={(v) => editIntersection('Pattern count', (i) => (i.patterns.find((p) => p.id === pattern.id)!.volumeSetId = v === '' ? null : v))}
              style={{ width: 160 }}
            />
          </Box>
        </Box>

        {created ? (
          <Alert severity={created.oversaturated ? 'warning' : 'success'} onClose={() => setCreated(null)}>
            Added pattern “{created.name}” with a {formatSeconds(created.cycle)} s cycle. {created.limitedBy ?? 'The cycle is Webster’s optimum for this count.'} Review its splits in the Patterns tab.
          </Alert>
        ) : null}

        {!analysis.ok ? (
          <Alert severity="info" variant="outlined">
            {REASONS[analysis.reason]}
          </Alert>
        ) : (
          <>
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
              {stat('Intersection delay', analysis.delay === null ? '—' : `${analysis.delay.toFixed(1)} s · LOS ${analysis.los}`)}
              {stat('Critical v/c', fixed(analysis.criticalVolumeToCapacity, 2))}
              {stat('Flow ratio Y', analysis.critical.flowRatio.toFixed(3))}
              {stat('Lost time L', `${formatSeconds(analysis.critical.lostTime)} s`)}
              {stat('Cycle', `${analysis.cycle.toFixed(0)} s`)}
              {stat('Webster cycle', analysis.critical.webster === null ? 'none' : `${formatSeconds(analysis.critical.webster)} s`)}
            </Box>
            <Box sx={{ overflowX: 'auto', border: 1, borderColor: 'divider', borderRadius: 1 }}>
              <Box component="table" aria-label="Lane group analysis" sx={{ borderCollapse: 'separate', borderSpacing: 0, fontSize: 13, width: '100%', minWidth: 680 }}>
                <thead>
                  <tr>
                    {['Lane group', 'Phase', 'Volume', 'Flow v', 'Sat. flow s', 'v/s', 'Green g', 'Capacity', 'v/c', 'Delay', 'LOS'].map((h, k) => (
                      <Box component="th" scope="col" key={h} sx={{ ...headSx, textAlign: k >= 2 ? 'right' : 'left' }}>
                        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                          {h}
                        </Typography>
                      </Box>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {analysis.laneGroups.map((g) => {
                    const over = g.volumeToCapacity > 1;
                    return (
                      <tr key={g.laneGroupId}>
                        <Box component="td" sx={cellSx}>
                          {g.label || 'Lane group'}
                          {g.saturation.permittedLefts && !g.saturation.overridden ? (
                            <Tooltip title="Permitted left turns are not reduced for opposing traffic. Enter this lane group's saturation flow by hand for a closer figure.">
                              <Typography component="span" variant="caption" sx={{ color: 'warning.main', ml: 1 }}>
                                permitted lefts
                              </Typography>
                            </Tooltip>
                          ) : null}
                        </Box>
                        <Box component="td" sx={{ ...cellSx, fontFamily: fontFamilyMono }}>
                          {g.phase}
                        </Box>
                        {[String(g.volume), g.flow.toFixed(0), g.saturation.value.toFixed(0), g.flowRatio.toFixed(3), `${g.effectiveGreen.toFixed(1)} s`, g.capacity.toFixed(0)].map((v, k) => (
                          <Box component="td" key={k} sx={{ ...numberCellSx, fontFamily: fontFamilyMono }}>
                            {v}
                          </Box>
                        ))}
                        <Box component="td" sx={{ ...numberCellSx, fontFamily: fontFamilyMono, color: over ? 'error.main' : undefined, fontWeight: over ? 600 : undefined }}>
                          {fixed(g.volumeToCapacity, 2)}
                        </Box>
                        <Box component="td" sx={{ ...numberCellSx, fontFamily: fontFamilyMono }}>
                          {g.delay === null ? '—' : `${g.delay.toFixed(1)} s`}
                        </Box>
                        <Box component="td" sx={{ ...numberCellSx, fontWeight: 600 }}>
                          {g.los ?? '—'}
                        </Box>
                      </tr>
                    );
                  })}
                </tbody>
              </Box>
            </Box>
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              HCM 2000 method, simplified: effective green is the split less yellow and red clearance; delay is uniform plus incremental delay with random arrivals (no progression adjustment) over a 15-minute analysis period. Suggest timing adds a new pattern with Webster&apos;s cycle and splits in proportion to critical flow ratios, raised to each phase&apos;s minimum including its pedestrian interval.
            </Typography>
          </>
        )}
      </Box>
    </Section>
  );
}

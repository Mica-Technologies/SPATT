/**
 * The body of a plan comparison: pattern settings, phase timing and splits, phase order, the two
 * ring-barrier diagrams on one time scale, and the capacity analysis of each against its count.
 * Changed values are tinted with the warning colour and shown as "A → B".
 */
import { useMemo, type ReactNode } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import type { Theme } from '@mui/material/styles';
import { alpha } from '@mui/material/styles';
import useMediaQuery from '@mui/material/useMediaQuery';
import { comparePlans, type CapacityRow, type CapacityValues, type CompareSide, type FieldDiff, type FieldValue } from '../../engine';
import { formatSeconds } from '../../model';
import ScrollArea from '../components/ScrollArea';
import RingBarrierDiagram from '../diagram/RingBarrierDiagram';
import { projectForDiagram } from '../diagram/sketch';
import { fontFamilyMono } from '../theme/themePrimitives';

export interface NamedSide extends CompareSide {
  /** What the side is called in headings, e.g. "AM Peak" or "Corridor study · AM Peak". */
  title: string;
}

interface CompareReportProps {
  a: NamedSide;
  b: NamedSide;
  onlyDifferences: boolean;
  /** Static drawing for print (no tooltips). */
  print?: boolean;
}

/** A semantic palette colour at an opacity, through CSS variables when the theme uses them. */
function tint(theme: Theme, key: 'warning' | 'success' | 'error' | 'info', opacity: number): string {
  return theme.vars ? `rgba(${theme.vars.palette[key].mainChannel} / ${opacity})` : alpha(theme.palette[key].main, opacity);
}

const mono = { fontFamily: fontFamilyMono, fontVariantNumeric: 'tabular-nums' } as const;
const cell = { px: 1, py: 0.5, borderBottom: 1, borderColor: 'divider', whiteSpace: 'nowrap', fontSize: 13, verticalAlign: 'top' } as const;
const headCell = { ...cell, textAlign: 'left', fontWeight: 500, color: 'text.secondary', bgcolor: 'background.paper' } as const;
const stickyHead = { ...headCell, position: 'sticky', left: 0, zIndex: 2 } as const;
const changedSx = (theme: Theme) => ({ bgcolor: tint(theme, 'warning', 0.16) });
/** A sticky row header in a changed row: opaque, so scrolled cells do not show through, with the same tint. */
const changedStickySx = (theme: Theme) => {
  const t = tint(theme, 'warning', 0.16);
  return { backgroundImage: `linear-gradient(${t}, ${t})` };
};

function format(value: FieldValue, kind: FieldDiff['format']): string {
  if (value === null) return '—';
  if (kind === 'tenths' && typeof value === 'number') return formatSeconds(value);
  if (kind === 'boolean') return value ? 'Yes' : 'No';
  return String(value) || '—';
}

const signed = (tenths: number) => `${tenths > 0 ? '+' : tenths < 0 ? '−' : '±'}${formatSeconds(Math.abs(tenths))}`;

/** A value that may have changed: "a → b" with B in bold, or just the value. */
function Change({ diff }: { diff: FieldDiff }) {
  if (!diff.changed) return <>{format(diff.a, diff.format)}</>;
  return (
    <>
      <Box component="span" sx={{ color: 'text.secondary' }}>
        {format(diff.a, diff.format)}
      </Box>
      <Box component="span" aria-label="changed to" sx={{ mx: 0.5, color: 'text.secondary' }}>
        →
      </Box>
      <Box component="span" sx={{ fontWeight: 700 }}>
        {format(diff.b, diff.format)}
      </Box>
    </>
  );
}

function Heading({ children }: { children: ReactNode }) {
  return (
    <Typography variant="overline" component="h3" sx={{ display: 'block', color: 'text.secondary', lineHeight: 1.6, mb: 0.5, breakAfter: 'avoid-page' }}>
      {children}
    </Typography>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Box component="section" aria-label={title} sx={{ border: 1, borderColor: 'divider', borderRadius: 2, bgcolor: 'background.paper', p: { xs: 1.5, sm: 2 }, minWidth: 0, breakInside: 'avoid-page' }}>
      <Heading>{title}</Heading>
      {children}
    </Box>
  );
}

function PatternTable({ fields, a, b }: { fields: FieldDiff[]; a: string; b: string }) {
  return (
    <ScrollArea className="compare-scroll">
      <Box component="table" sx={{ borderCollapse: 'collapse', minWidth: '100%' }}>
        <thead>
          <tr>
            <Box component="th" scope="col" sx={stickyHead}>
              Setting
            </Box>
            <Box component="th" scope="col" sx={headCell}>
              A · {a}
            </Box>
            <Box component="th" scope="col" sx={headCell}>
              B · {b}
            </Box>
            <Box component="th" scope="col" sx={{ ...headCell, textAlign: 'right' }}>
              Change
            </Box>
          </tr>
        </thead>
        <tbody>
          {fields.map((f) => (
            <Box component="tr" key={f.key} data-changed={f.changed || undefined} sx={f.changed ? changedSx : undefined}>
              <Box component="th" scope="row" sx={[{ ...stickyHead, fontWeight: 400, color: 'text.primary' }, f.changed ? changedStickySx : {}]}>
                {f.label}
              </Box>
              <Box component="td" sx={{ ...cell, ...(f.format === 'tenths' ? mono : {}) }}>
                {format(f.a, f.format)}
              </Box>
              <Box component="td" sx={{ ...cell, ...(f.format === 'tenths' ? mono : {}), fontWeight: f.changed ? 700 : 400 }}>
                {format(f.b, f.format)}
              </Box>
              <Box component="td" sx={{ ...cell, ...mono, textAlign: 'right', color: 'text.secondary' }}>
                {f.delta !== null && f.delta !== 0 ? `${signed(f.delta)} s` : f.changed ? 'Changed' : ''}
              </Box>
            </Box>
          ))}
        </tbody>
      </Box>
    </ScrollArea>
  );
}

function PhaseTable({ comparison, onlyDifferences }: { comparison: ReturnType<typeof comparePlans>; onlyDifferences: boolean }) {
  const phases = comparison.phases;
  const keys = phases[0]?.fields.map((f) => ({ key: f.key, label: f.label })) ?? [];
  const rows = keys.filter(({ key }) => !onlyDifferences || phases.some((p) => p.fields.find((f) => f.key === key)!.changed));
  if (phases.length === 0) return <Typography variant="body2">No phases on either side.</Typography>;
  return (
    <ScrollArea className="compare-scroll">
      <Box component="table" sx={{ borderCollapse: 'collapse', minWidth: '100%' }}>
        <thead>
          <tr>
            <Box component="th" scope="col" sx={stickyHead}>
              Phase
            </Box>
            {phases.map((p) => (
              <Box component="th" scope="col" key={p.phase} sx={{ ...headCell, textAlign: 'right', ...(p.inA !== p.inB ? { color: 'warning.main' } : {}) }} title={p.label}>
                <Box component="span" sx={{ display: 'block', color: 'text.primary', fontWeight: 600 }}>
                  {p.phase}
                </Box>
                <Box component="span" sx={{ display: 'block', fontSize: 11, fontWeight: 400 }}>
                  {p.inA && !p.inB ? 'A only' : !p.inA && p.inB ? 'B only' : p.label}
                </Box>
              </Box>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <Box component="td" colSpan={phases.length + 1} sx={{ ...cell, color: 'text.secondary' }}>
                No phase timing differs.
              </Box>
            </tr>
          ) : (
            rows.map(({ key, label }) => (
              <tr key={key}>
                <Box component="th" scope="row" sx={{ ...stickyHead, fontWeight: 400, color: 'text.primary' }}>
                  {label}
                </Box>
                {phases.map((p) => {
                  const diff = p.fields.find((f) => f.key === key)!;
                  return (
                    <Box
                      component="td"
                      key={p.phase}
                      data-changed={diff.changed || undefined}
                      aria-label={diff.changed ? `${label}, phase ${p.phase}: ${format(diff.a, diff.format)} to ${format(diff.b, diff.format)}` : undefined}
                      sx={[{ ...cell, ...(diff.format === 'tenths' ? mono : {}), textAlign: 'right' }, diff.changed ? changedSx : {}]}
                    >
                      <Change diff={diff} />
                    </Box>
                  );
                })}
              </tr>
            ))
          )}
        </tbody>
      </Box>
    </ScrollArea>
  );
}

const LEFT = 30;
const RIGHT = 10;
const PRINT_WIDTH = 720;
/** Phones draw in fewer units, so the text stays readable when the drawing is scaled down. */
const PHONE_WIDTH = 380;

/** Both diagrams on one time scale: the shorter cycle draws proportionally narrower. */
function Diagrams({ a, b, print }: { a: NamedSide; b: NamedSide; print: boolean }) {
  const phone = useMediaQuery((theme: Theme) => theme.breakpoints.down('sm'), { noSsr: true });
  const BASE_WIDTH = phone && !print ? PHONE_WIDTH : PRINT_WIDTH;
  const drawn = useMemo(() => [a, b].map((side) => ({ side, drawn: projectForDiagram(side.intersection, side.patternId) })), [a, b]);
  const cycles = drawn.map(({ drawn: d }) => (d.result.ok ? Math.max(d.result.projection.cycle, d.enteredCycle ?? 0) : 0));
  const longest = Math.max(1, ...cycles);
  const plot = BASE_WIDTH - LEFT - RIGHT;
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {drawn.map(({ side, drawn: d }, k) => {
        const label = k === 0 ? 'A' : 'B';
        const width = Math.round(LEFT + RIGHT + plot * (cycles[k]! / longest));
        return (
          <Box key={label}>
            <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>
              {label} · {side.title}
            </Typography>
            {d.result.ok ? (
              <Box sx={{ width: `${(width / BASE_WIDTH) * 100}%`, minWidth: 0 }}>
                <RingBarrierDiagram projection={d.result.projection} intersection={side.intersection} width={width} interactive={!print} cycleMark={d.enteredCycle} />
              </Box>
            ) : (
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                {d.result.issues[0]?.code === 'projection.free-pattern' ? 'Runs free: no fixed cycle to draw.' : 'This pattern has problems that stop its diagram.'}
              </Typography>
            )}
          </Box>
        );
      })}
      <Typography variant="caption" sx={{ color: 'text.secondary' }}>
        Both diagrams use one time scale, so a longer cycle draws wider.
      </Typography>
    </Box>
  );
}

const vc = (v: CapacityValues | null) => (v?.volumeToCapacity == null ? '—' : v.volumeToCapacity.toFixed(2));
const delay = (v: CapacityValues | null) => (v?.delay == null ? '—' : v.delay.toFixed(1));

/** Delay and v/c deltas: higher is worse (error colour), lower is better (success colour). */
function Delta({ a, b, digits, unit = '' }: { a: number | null | undefined; b: number | null | undefined; digits: number; unit?: string }) {
  if (a == null || b == null) return <>—</>;
  const d = b - a;
  const shown = Math.abs(d) < 0.5 * 10 ** -digits ? 0 : d;
  return (
    <Box component="span" sx={{ color: shown > 0 ? 'error.main' : shown < 0 ? 'success.main' : 'text.secondary', fontWeight: shown === 0 ? 400 : 600 }}>
      {shown > 0 ? '+' : shown < 0 ? '−' : '±'}
      {Math.abs(shown).toFixed(digits)}
      {unit}
    </Box>
  );
}

function CapacityTable({ rows }: { rows: CapacityRow[] }) {
  const num = { ...cell, ...mono, textAlign: 'right' } as const;
  return (
    <ScrollArea className="compare-scroll">
      <Box component="table" sx={{ borderCollapse: 'collapse', minWidth: '100%' }}>
        <thead>
          <tr>
            <Box component="th" scope="col" sx={stickyHead}>
              Lane group
            </Box>
            {['v/c A', 'v/c B', 'Δ v/c', 'Delay A', 'Delay B', 'Δ delay', 'LOS'].map((h) => (
              <Box component="th" scope="col" key={h} sx={{ ...headCell, textAlign: 'right' }}>
                {h}
              </Box>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, k) => {
            const losChanged = row.a?.los !== row.b?.los;
            return (
              <Box component="tr" key={row.key} sx={k === 0 ? { '& > *': { fontWeight: 600 } } : undefined}>
                <Box component="th" scope="row" sx={{ ...stickyHead, fontWeight: k === 0 ? 600 : 400, color: 'text.primary' }}>
                  {row.label}
                </Box>
                <Box component="td" sx={num}>
                  {vc(row.a)}
                </Box>
                <Box component="td" sx={num}>
                  {vc(row.b)}
                </Box>
                <Box component="td" sx={num}>
                  <Delta a={row.a?.volumeToCapacity} b={row.b?.volumeToCapacity} digits={2} />
                </Box>
                <Box component="td" sx={num}>
                  {delay(row.a)}
                </Box>
                <Box component="td" sx={num}>
                  {delay(row.b)}
                </Box>
                <Box component="td" sx={num}>
                  <Delta a={row.a?.delay} b={row.b?.delay} digits={1} unit=" s" />
                </Box>
                <Box component="td" data-changed={losChanged || undefined} sx={[num, losChanged ? changedSx : {}]}>
                  {losChanged ? `${row.a?.los ?? '—'} → ${row.b?.los ?? '—'}` : (row.a?.los ?? '—')}
                </Box>
              </Box>
            );
          })}
        </tbody>
      </Box>
    </ScrollArea>
  );
}

export default function CompareReport({ a, b, onlyDifferences, print = false }: CompareReportProps) {
  const comparison = useMemo(() => comparePlans(a, b), [a, b]);
  const patternRows = onlyDifferences ? comparison.pattern.filter((f) => f.changed) : comparison.pattern;
  const ringRows = onlyDifferences ? comparison.rings.filter((r) => r.changed) : comparison.rings;
  const sameIntersection = a.intersection === b.intersection;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
      <Alert severity={comparison.changeCount === 0 ? 'success' : 'info'} variant="outlined" role="status">
        {comparison.changeCount === 0
          ? 'The two plans are the same.'
          : `${comparison.changeCount} value${comparison.changeCount === 1 ? ' differs' : 's differ'}. Changed values are highlighted and shown as A → B.`}
      </Alert>

      <Panel title="Pattern">
        {patternRows.length > 0 ? <PatternTable fields={patternRows} a={a.title} b={b.title} /> : <Typography variant="body2" sx={{ color: 'text.secondary' }}>No pattern setting differs.</Typography>}
        {ringRows.length > 0 ? (
          <Box sx={{ mt: 1.5 }}>
            <Heading>Phase order{sameIntersection ? '' : ' (barrier groups separated by |)'}</Heading>
            <ScrollArea className="compare-scroll">
              <Box component="table" sx={{ borderCollapse: 'collapse', minWidth: '100%' }}>
                <tbody>
                  {ringRows.map((r) => (
                    <Box component="tr" key={r.ring} data-changed={r.changed || undefined} sx={r.changed ? changedSx : undefined}>
                      <Box component="th" scope="row" sx={{ ...headCell, color: 'text.primary', fontWeight: 400, bgcolor: 'transparent' }}>
                        Ring {r.ring}
                      </Box>
                      <Box component="td" sx={{ ...cell, ...mono }}>
                        A {r.a ?? '—'}
                      </Box>
                      <Box component="td" sx={{ ...cell, ...mono, fontWeight: r.changed ? 700 : 400 }}>
                        B {r.b ?? '—'}
                      </Box>
                    </Box>
                  ))}
                </tbody>
              </Box>
            </ScrollArea>
          </Box>
        ) : null}
      </Panel>

      <Panel title="Phase timing and splits">
        <PhaseTable comparison={comparison} onlyDifferences={onlyDifferences} />
      </Panel>

      <Panel title="Ring-barrier diagrams">
        <Diagrams a={a} b={b} print={print} />
      </Panel>

      <Panel title="Capacity">
        {comparison.capacity ? (
          <>
            <Typography variant="body2" sx={{ color: 'text.secondary', mb: 1 }}>
              A against {comparison.capacity.countA}, B against {comparison.capacity.countB}. Intersection row: volume-weighted delay and critical v/c (Xc).
            </Typography>
            <CapacityTable rows={[comparison.capacity.overall, ...comparison.capacity.laneGroups]} />
          </>
        ) : (
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            Delay, v/c and level of service are compared when both patterns are linked to a count.{' '}
            {comparison.capacityReasons.a ? `A: ${comparison.capacityReasons.a} ` : ''}
            {comparison.capacityReasons.b ? `B: ${comparison.capacityReasons.b}` : ''}
          </Typography>
        )}
      </Panel>
    </Box>
  );
}

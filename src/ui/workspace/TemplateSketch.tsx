import Box from '@mui/material/Box';
import { useTheme } from '@mui/material/styles';
import { effectiveSequence } from '../../model';
import type { IntersectionTemplate } from './templates';

/**
 * A small ring-barrier sketch of a template: one row per ring, each phase a block as wide as its
 * split in the first pattern, barriers as lines.
 */
export default function TemplateSketch({ template, width = 96 }: { template: IntersectionTemplate; width?: number }) {
  const theme = useTheme();
  const palette = (theme.vars || theme).palette;
  const intersection = template.build('preview');
  const pattern = intersection.patterns[0];
  const rings = pattern ? effectiveSequence(pattern, intersection.rings) : intersection.rings;
  const split = (n: number) => pattern?.splits[String(n)] ?? 10;
  const groups = rings[0]?.groups.length ?? 0;
  const groupLength = Array.from({ length: groups }, (_, g) => Math.max(1, ...rings.map((r) => (r.groups[g] ?? []).reduce((sum, n) => sum + split(n), 0))));
  const cycle = groupLength.reduce((a, b) => a + b, 0);
  const scale = width / cycle;
  const row = 9;
  const height = rings.length * (row + 3) - 3;
  return (
    <Box component="svg" aria-hidden viewBox={`0 0 ${width} ${height}`} sx={{ width, height, display: 'block', flexShrink: 0 }}>
      {rings.map((ring, r) => {
        let start = 0;
        return ring.groups.map((group, g) => {
          const groupStart = start;
          start += groupLength[g]!;
          let x = groupStart;
          return group.map((n) => {
            const w = split(n);
            const rect = <rect key={`${r}-${n}`} x={x * scale + 0.5} y={r * (row + 3)} width={Math.max(1, w * scale - 1)} height={row} rx={1.5} fill={palette.success.main} fillOpacity={0.75} />;
            x += w;
            return rect;
          });
        });
      })}
      {groupLength.slice(0, -1).map((_, g) => {
        const at = groupLength.slice(0, g + 1).reduce((a, b) => a + b, 0) * scale;
        return <line key={g} x1={at} x2={at} y1={0} y2={height} stroke={palette.text.primary} strokeWidth={1.5} />;
      })}
    </Box>
  );
}

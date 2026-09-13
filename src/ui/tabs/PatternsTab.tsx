/**
 * Timing patterns: the list on the left, the selected pattern's settings, split grid and phase
 * sequence on the right.
 */
import { useMemo } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { projectCycle } from '../../engine';
import { useWorkspace } from '../state/workspace';
import PatternList from './patterns/PatternList';
import PatternSettings from './patterns/PatternSettings';
import SequenceEditor from './patterns/SequenceEditor';
import SplitGrid from './patterns/SplitGrid';
import type { TabProps } from './types';

export default function PatternsTab({ intersection, intersectionIndex, issues }: TabProps) {
  const selectedId = useWorkspace((s) => s.selectedPatternId);
  const patternIndex = Math.max(
    0,
    intersection.patterns.findIndex((p) => p.id === selectedId),
  );
  const pattern = intersection.patterns[patternIndex];
  const projection = useMemo(() => (pattern ? projectCycle(intersection, pattern.id) : null), [intersection, pattern]);
  const path = ['intersections', intersectionIndex, 'patterns', patternIndex];

  return (
    <Box sx={{ p: 2, display: 'flex', gap: 2, alignItems: 'flex-start', flexWrap: 'wrap' }}>
      <Box sx={{ flex: '0 0 220px', minWidth: 0 }}>
        <PatternList intersection={intersection} intersectionIndex={intersectionIndex} selectedId={pattern?.id ?? null} issues={issues} />
      </Box>
      <Box sx={{ flex: '1 1 540px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        {pattern && projection ? (
          <>
            <PatternSettings key={pattern.id} intersection={intersection} pattern={pattern} path={path} issues={issues} projection={projection} />
            <SplitGrid intersection={intersection} pattern={pattern} path={path} issues={issues} />
            <SequenceEditor intersection={intersection} pattern={pattern} path={path} issues={issues} />
          </>
        ) : (
          <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 2, bgcolor: 'background.paper', p: 3 }}>
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              Add a pattern to program a cycle, splits and offset. Without one, the intersection runs free.
            </Typography>
          </Box>
        )}
      </Box>
    </Box>
  );
}

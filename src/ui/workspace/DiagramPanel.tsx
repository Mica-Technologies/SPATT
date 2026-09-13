import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import type { Intersection } from '../../model';

/** The live ring-barrier diagram docked beside the editor. */
export default function DiagramPanel(_props: { intersection: Intersection; patternId: string | null }) {
  return (
    <Box component="aside" aria-label="Ring-barrier diagram" sx={{ borderLeft: 1, borderColor: 'divider', bgcolor: 'background.paper', p: 2, overflowY: 'auto' }}>
      <Typography variant="subtitle2">Ring-barrier diagram</Typography>
    </Box>
  );
}

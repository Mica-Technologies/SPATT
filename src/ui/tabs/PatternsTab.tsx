import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import type { TabProps } from './types';

export default function PatternsTab(_props: TabProps) {
  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="body2" sx={{ color: 'text.secondary' }}>
        Pattern editing is not built yet.
      </Typography>
    </Box>
  );
}

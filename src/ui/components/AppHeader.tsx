import type { ReactNode } from 'react';
import AppBar from '@mui/material/AppBar';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Toolbar from '@mui/material/Toolbar';
import Typography from '@mui/material/Typography';
import ColorModeIconDropdown from '../theme/ColorModeIconDropdown';
import SpattMark from './SpattMark';

interface AppHeaderProps {
  title: string;
  subtitle?: string;
  /** Before the mark, e.g. the button that opens the navigation drawer on narrow screens. */
  start?: ReactNode;
  actions?: ReactNode;
}

export default function AppHeader({ title, subtitle, start, actions }: AppHeaderProps) {
  return (
    <AppBar
      position="static"
      elevation={0}
      color="inherit"
      sx={{ borderBottom: 1, borderColor: 'divider', bgcolor: 'background.paper' }}
    >
      <Toolbar variant="dense" sx={{ gap: { xs: 1, sm: 1.5 }, minHeight: 52, px: { xs: 1.5, sm: 2 } }}>
        {start}
        <SpattMark size={26} />
        <Stack direction="row" spacing={1} sx={{ alignItems: 'baseline', flexGrow: 1, minWidth: 0 }}>
          <Typography variant="h6" component="h1" sx={{ fontWeight: 600, letterSpacing: 0.5, flexShrink: 0 }}>
            {title}
          </Typography>
          {subtitle ? (
            <Typography variant="body2" noWrap sx={{ color: 'text.secondary', minWidth: 0, display: { xs: 'none', sm: 'block' } }}>
              {subtitle}
            </Typography>
          ) : null}
        </Stack>
        <Box sx={{ display: 'flex', gap: { xs: 0.5, sm: 1 }, alignItems: 'center', flexShrink: 0 }}>
          {actions}
          <ColorModeIconDropdown />
        </Box>
      </Toolbar>
    </AppBar>
  );
}

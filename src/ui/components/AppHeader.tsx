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
  actions?: ReactNode;
}

export default function AppHeader({ title, subtitle, actions }: AppHeaderProps) {
  return (
    <AppBar
      position="static"
      elevation={0}
      color="inherit"
      sx={{ borderBottom: 1, borderColor: 'divider', bgcolor: 'background.paper' }}
    >
      <Toolbar variant="dense" sx={{ gap: 1.5, minHeight: 52 }}>
        <SpattMark size={26} />
        <Stack direction="row" spacing={1} sx={{ alignItems: 'baseline', flexGrow: 1, minWidth: 0 }}>
          <Typography variant="h6" component="h1" sx={{ fontWeight: 600, letterSpacing: 0.5 }}>
            {title}
          </Typography>
          {subtitle ? (
            <Typography variant="body2" noWrap sx={{ color: 'text.secondary' }}>
              {subtitle}
            </Typography>
          ) : null}
        </Stack>
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
          {actions}
          <ColorModeIconDropdown />
        </Box>
      </Toolbar>
    </AppBar>
  );
}

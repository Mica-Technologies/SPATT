import type { ReactNode } from 'react';
import CssBaseline from '@mui/material/CssBaseline';
import AppTheme from './theme/AppTheme';
import './fonts';

/** Theme, baseline and fonts shared by the SPATT and manager entry points. */
export default function AppRoot({ children }: { children: ReactNode }) {
  return (
    <AppTheme>
      <CssBaseline enableColorScheme />
      {children}
    </AppTheme>
  );
}

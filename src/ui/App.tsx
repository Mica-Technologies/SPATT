import { useEffect, useState } from 'react';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import FolderOpenRoundedIcon from '@mui/icons-material/FolderOpenRounded';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Container from '@mui/material/Container';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { detectHost, type Host } from '../io/host';
import AppHeader from './components/AppHeader';

const HOST_LABEL: Record<Host, string> = {
  tauri: 'Desktop',
  server: 'Network server',
  browser: 'Browser',
};

export default function App() {
  const [host, setHost] = useState<Host | null>(null);

  useEffect(() => {
    let cancelled = false;
    void detectHost().then((detected) => {
      if (!cancelled) {
        setHost(detected);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Box sx={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', bgcolor: 'background.default' }}>
      <AppHeader
        title="SPATT"
        subtitle="Signal Programming and Timing Tool"
        actions={host ? <Chip size="small" variant="outlined" label={HOST_LABEL[host]} /> : null}
      />
      <Container maxWidth="md" sx={{ flexGrow: 1, display: 'flex', alignItems: 'center', py: 6 }}>
        <Paper variant="outlined" sx={{ p: { xs: 3, sm: 5 }, width: '100%', borderRadius: 4 }}>
          <Stack spacing={3}>
            <Stack spacing={1}>
              <Typography variant="h4" component="h2">
                No project open
              </Typography>
              <Typography variant="body1" sx={{ color: 'text.secondary', maxWidth: 560 }}>
                A project holds intersections, their ring-barrier structure and timing patterns, and
                the corridors that coordinate them.
              </Typography>
            </Stack>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
              <Button variant="contained" startIcon={<AddRoundedIcon />} disabled>
                New project
              </Button>
              <Button variant="outlined" startIcon={<FolderOpenRoundedIcon />} disabled>
                Open project
              </Button>
            </Stack>
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              Project editing arrives with the timing model. This build verifies the app shell on
              every host.
            </Typography>
          </Stack>
        </Paper>
      </Container>
      <Box component="footer" sx={{ px: 3, py: 1.5, borderTop: 1, borderColor: 'divider' }}>
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          SPATT is not certified traffic engineering software. Timing plans it produces are for
          study, simulation and games, not for deployment on public roads.
        </Typography>
      </Box>
    </Box>
  );
}

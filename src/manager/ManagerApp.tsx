import { useEffect, useState } from 'react';
import LanRoundedIcon from '@mui/icons-material/LanRounded';
import LaunchRoundedIcon from '@mui/icons-material/LaunchRounded';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import FormControlLabel from '@mui/material/FormControlLabel';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import Typography from '@mui/material/Typography';
import AppHeader from '../ui/components/AppHeader';
import { fontFamilyMono } from '../ui/theme/themePrimitives';
import { getAppInfo, getServerStatus, openSpattWindow, type AppInfo, type ServerStatus } from './bridge';

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <Stack direction="row" sx={{ justifyContent: 'space-between', gap: 2 }}>
      <Typography variant="body2" sx={{ color: 'text.secondary' }}>
        {label}
      </Typography>
      <Typography variant="body2" sx={{ fontFamily: fontFamilyMono }}>
        {value}
      </Typography>
    </Stack>
  );
}

export default function ManagerApp() {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [server, setServer] = useState<ServerStatus | null>(null);

  useEffect(() => {
    void getAppInfo().then(setInfo);
    void getServerStatus().then(setServer);
  }, []);

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
      <AppHeader title="SPATT Manager" />
      <Stack spacing={2} sx={{ p: 2 }}>
        <Card variant="outlined">
          <CardContent>
            <Stack spacing={1.5}>
              <Typography variant="h6" component="h2">
                SPATT
              </Typography>
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                Open the timing tool in its own window.
              </Typography>
              <Box>
                <Button variant="contained" startIcon={<LaunchRoundedIcon />} onClick={() => void openSpattWindow()}>
                  Open SPATT
                </Button>
              </Box>
            </Stack>
          </CardContent>
        </Card>

        <Card variant="outlined">
          <CardContent>
            <Stack spacing={1.5}>
              <Stack direction="row" sx={{ alignItems: 'center', gap: 1 }}>
                <LanRoundedIcon fontSize="small" />
                <Typography variant="h6" component="h2" sx={{ flexGrow: 1 }}>
                  Network server
                </Typography>
                <Chip
                  size="small"
                  color={server?.running ? 'success' : 'default'}
                  label={server?.running ? 'Running' : 'Stopped'}
                />
              </Stack>
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                Serves SPATT to browsers on this computer or your local network. Server controls are
                not available in this build yet.
              </Typography>
              <FormControlLabel control={<Switch disabled />} label="Serve on the local network" />
              <FormControlLabel control={<Switch disabled />} label="Run in the background" />
            </Stack>
          </CardContent>
        </Card>

        <Card variant="outlined">
          <CardContent>
            <Stack spacing={1}>
              <Typography variant="subtitle2" component="h2">
                About
              </Typography>
              <Divider />
              <InfoRow label="Version" value={info?.version ?? '…'} />
              <InfoRow label="Platform" value={info ? `${info.os} ${info.arch}`.trim() : '…'} />
              <InfoRow label="Mode" value={info?.mode ?? '…'} />
            </Stack>
          </CardContent>
        </Card>
      </Stack>
    </Box>
  );
}

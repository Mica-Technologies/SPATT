import { useEffect, useState } from 'react';
import LaunchRoundedIcon from '@mui/icons-material/LaunchRounded';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Divider from '@mui/material/Divider';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import AppHeader from '../ui/components/AppHeader';
import { fontFamilyMono } from '../ui/theme/themePrimitives';
import { getAppInfo, openSpattWindow, type AppInfo } from './bridge';
import ServerCard from './ServerCard';

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

  useEffect(() => {
    void getAppInfo().then(setInfo);
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

        <ServerCard />

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

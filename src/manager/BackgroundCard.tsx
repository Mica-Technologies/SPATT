/**
 * Running SPATT in the background: off, start at login (this user's projects), or a system service
 * (the machine-wide projects, before anyone logs in). While the service runs, its address, network
 * sharing and port are managed here; changing them asks for administrator permission.
 */
import { useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Checkbox from '@mui/material/Checkbox';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Divider from '@mui/material/Divider';
import FormControlLabel from '@mui/material/FormControlLabel';
import LinearProgress from '@mui/material/LinearProgress';
import Radio from '@mui/material/Radio';
import RadioGroup from '@mui/material/RadioGroup';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { fontFamilyMono } from '../ui/theme/themePrimitives';
import { configureService, installBackground, uninstallBackground, type BackgroundInfo, type BackgroundMode, type ServicePatch } from './bridge';

type Choice = 'off' | BackgroundMode;

const serviceLabel = (info: BackgroundInfo) => {
  const state = info.installed.service;
  if (state === 'notInstalled') return null;
  if (state === 'running') return info.service ? 'Running' : 'Starting';
  if (state === 'stopped') return 'Stopped';
  return state.other;
};

export default function BackgroundCard({ info, onChange }: { info: BackgroundInfo; onChange: (next: BackgroundInfo) => void }) {
  const current: Choice = info.installed.service !== 'notInstalled' ? 'service' : info.installed.login ? 'login' : 'off';
  const [choice, setChoice] = useState<Choice>(current);
  const [copyLibrary, setCopyLibrary] = useState(true);
  const [deleteData, setDeleteData] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [port, setPort] = useState(String(info.service?.port ?? ''));
  const service = info.service;
  const admin = info.installed.elevated ? '' : ' Windows asks for administrator permission.';

  const act = (action: () => Promise<BackgroundInfo>) => {
    setBusy(true);
    setFailure(null);
    setConfirming(false);
    action()
      .then((next) => {
        onChange(next);
        setPort(String(next.service?.port ?? ''));
      })
      .catch((cause: unknown) => setFailure(String(cause)))
      .finally(() => setBusy(false));
  };

  const apply = () =>
    act(async () => {
      if (choice === 'off') {
        return uninstallBackground(current === 'off' ? 'login' : current, deleteData);
      }
      return installBackground(choice, copyLibrary);
    });

  const configure = (patch: ServicePatch) => act(() => configureService(patch));
  const portNumber = Number(port);
  const portValid = Number.isInteger(portNumber) && portNumber >= 1024 && portNumber <= 65535;

  return (
    <Card variant="outlined">
      <CardContent>
        <Stack spacing={1.5}>
          <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
            <Typography variant="h6" component="h2">
              Run in background
            </Typography>
            <Chip size="small" label={current === 'off' ? 'Off' : current === 'login' ? 'At login' : `Service: ${serviceLabel(info)}`} color={current === 'off' ? 'default' : 'success'} variant={current === 'off' ? 'outlined' : 'filled'} />
          </Stack>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            Keep SPATT serving projects without this window open.
          </Typography>

          <RadioGroup value={choice} onChange={(e) => setChoice(e.target.value as Choice)} aria-label="Background mode">
            <FormControlLabel value="off" control={<Radio size="small" />} label="Off: SPATT serves only while it is open" />
            <FormControlLabel
              value="login"
              control={<Radio size="small" />}
              label={
                <span>
                  Start at login
                  <Typography component="span" variant="caption" sx={{ display: 'block', color: 'text.secondary' }}>
                    Your projects, with a tray icon, when you log in. No administrator rights.
                  </Typography>
                </span>
              }
            />
            <FormControlLabel
              value="service"
              control={<Radio size="small" />}
              label={
                <span>
                  System service
                  <Typography component="span" variant="caption" sx={{ display: 'block', color: 'text.secondary' }}>
                    Runs before anyone logs in, from a shared library for this computer ({info.installed.serviceDataDir}). Needs administrator rights.
                  </Typography>
                </span>
              }
            />
          </RadioGroup>

          {choice === 'service' && current !== 'service' ? (
            <FormControlLabel control={<Checkbox size="small" checked={copyLibrary} onChange={(e) => setCopyLibrary(e.target.checked)} />} label="Copy my projects into the service's library (yours are kept)" />
          ) : null}
          {choice === 'off' && current === 'service' ? (
            <FormControlLabel control={<Checkbox size="small" checked={deleteData} onChange={(e) => setDeleteData(e.target.checked)} />} label="Also delete the service's projects and settings" />
          ) : null}

          <Box>
            <Button variant="contained" disabled={busy || choice === current} onClick={() => setConfirming(true)}>
              Apply
            </Button>
          </Box>
          {busy ? <LinearProgress aria-label="Changing background mode" /> : null}
          {failure ? <Alert severity="error">{failure}</Alert> : null}

          {service ? (
            <>
              <Divider />
              <Typography variant="subtitle2" component="h3">
                The service
              </Typography>
              <Stack direction="row" sx={{ alignItems: 'center', gap: 1 }}>
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                  This computer:
                </Typography>
                <Typography variant="body2" sx={{ fontFamily: fontFamilyMono }}>
                  {service.localUrl}
                </Typography>
              </Stack>
              {service.lanUrl ? (
                <Stack direction="row" sx={{ alignItems: 'center', gap: 1, minWidth: 0 }}>
                  <Typography variant="body2" sx={{ color: 'text.secondary', flexShrink: 0 }}>
                    Other devices:
                  </Typography>
                  <Typography variant="body2" sx={{ fontFamily: fontFamilyMono, overflowWrap: 'anywhere' }}>
                    {service.lanUrl}
                  </Typography>
                </Stack>
              ) : null}
              <FormControlLabel control={<Switch checked={service.lan} disabled={busy} onChange={(e) => configure({ lan: e.target.checked })} />} label="Share on the local network (with an access token; adds a firewall rule for private networks)" />
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                <TextField size="small" label="Port" value={port} onChange={(e) => setPort(e.target.value)} error={!portValid} sx={{ width: 120 }} />
                <Button disabled={busy || !portValid || portNumber === service.port} onClick={() => configure({ port: portNumber })}>
                  Apply port
                </Button>
                {service.lan ? (
                  <Button disabled={busy} onClick={() => configure({ regenerateToken: true })}>
                    New token
                  </Button>
                ) : null}
              </Stack>
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                Changes restart the service.{admin}
                {info.installed.firewallRule !== null && service.lan ? ` Firewall rule: ${info.installed.firewallRule ? 'present' : 'missing'}.` : ''}
              </Typography>
            </>
          ) : null}
        </Stack>
      </CardContent>

      <Dialog open={confirming} onClose={() => setConfirming(false)} aria-labelledby="background-confirm-title">
        <DialogTitle id="background-confirm-title">{choice === 'off' ? 'Stop running in the background?' : choice === 'login' ? 'Start SPATT at login?' : 'Install the SPATT service?'}</DialogTitle>
        <DialogContent>
          <Typography variant="body2">
            {choice === 'off'
              ? current === 'service'
                ? `The SPATT service stops and is removed, with its firewall rule.${deleteData ? ' Its projects and settings are deleted.' : ' Its projects stay in the shared library folder.'}${admin}`
                : 'SPATT no longer starts when you log in.'
              : choice === 'login'
                ? 'SPATT starts with a tray icon when you log in and serves your projects with the settings above.'
                : `SPATT installs a system service that serves the shared library for this computer, starting now and at every boot, and adds a tray icon at login.${copyLibrary ? ' Your projects are copied into it.' : ''} This window then works on the service's library.${admin}`}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirming(false)}>Cancel</Button>
          <Button variant="contained" onClick={apply}>
            {choice === 'off' ? 'Remove' : 'Install'}
          </Button>
        </DialogActions>
      </Dialog>
    </Card>
  );
}

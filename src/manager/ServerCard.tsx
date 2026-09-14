/**
 * The manager's network server controls: start and stop, port, sharing on the local network with
 * its access link, token and QR code, the project folder, closing to the tray, and recent
 * activity.
 */
import { useCallback, useEffect, useState } from 'react';
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded';
import FolderOpenRoundedIcon from '@mui/icons-material/FolderOpenRounded';
import LanRoundedIcon from '@mui/icons-material/LanRounded';
import OpenInBrowserRoundedIcon from '@mui/icons-material/OpenInBrowserRounded';
import PlayArrowRoundedIcon from '@mui/icons-material/PlayArrowRounded';
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded';
import StopRoundedIcon from '@mui/icons-material/StopRounded';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import FormControlLabel from '@mui/material/FormControlLabel';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import QRCode from 'qrcode';
import { fontFamilyMono } from '../ui/theme/themePrimitives';
import { getServerLogs, getServerStatus, onServerChanged, openInBrowser, openProjectsFolder, regenerateToken, startServer, stopServer, updateServer, type LogLine, type ServerSettingsPatch, type ServerStatus } from './bridge';

const LOG_POLL_MS = 2000;
const timeFormat = new Intl.DateTimeFormat(undefined, { timeStyle: 'medium' });

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Tooltip title={copied ? 'Copied' : label}>
      <IconButton
        size="small"
        aria-label={label}
        onClick={() =>
          void navigator.clipboard.writeText(text).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          })
        }
      >
        <ContentCopyRoundedIcon fontSize="small" />
      </IconButton>
    </Tooltip>
  );
}

function AccessQr({ url }: { url: string }) {
  const [svg, setSvg] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }).then((markup) => {
      if (!cancelled) setSvg(markup);
    });
    return () => {
      cancelled = true;
    };
  }, [url]);
  // A QR code needs dark modules on a light ground in either theme, so it sits on a white tile.
  return svg ? <Box role="img" aria-label="QR code of the access link" sx={{ width: 148, height: 148, p: 0.5, bgcolor: 'common.white', borderRadius: 1, flexShrink: 0, '& svg': { display: 'block', width: '100%', height: '100%' } }} dangerouslySetInnerHTML={{ __html: svg }} /> : null;
}

export default function ServerCard() {
  const [status, setStatus] = useState<ServerStatus | null>(null);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [port, setPort] = useState('');

  const refresh = useCallback(() => {
    void getServerStatus().then((next) => {
      setStatus(next);
      setPort(String(next.port));
    });
  }, []);

  useEffect(() => {
    refresh();
    const unlisten = onServerChanged(refresh);
    const timer = setInterval(() => void getServerLogs().then(setLogs), LOG_POLL_MS);
    void getServerLogs().then(setLogs);
    return () => {
      clearInterval(timer);
      void unlisten.then((stop) => stop());
    };
  }, [refresh]);

  const run = (action: () => Promise<ServerStatus>) => {
    setBusy(true);
    setFailure(null);
    action()
      .then((next) => {
        setStatus(next);
        setPort(String(next.port));
      })
      .catch((cause: unknown) => {
        setFailure(String(cause));
        refresh();
      })
      .finally(() => {
        setBusy(false);
        void getServerLogs().then(setLogs);
      });
  };
  const update = (patch: ServerSettingsPatch) => run(() => updateServer(patch));

  if (!status) {
    return null;
  }

  const portNumber = Number(port);
  const portValid = Number.isInteger(portNumber) && portNumber >= 1024 && portNumber <= 65535;

  return (
    <Card variant="outlined">
      <CardContent>
        <Stack spacing={1.5}>
          <Stack direction="row" sx={{ alignItems: 'center', gap: 1 }}>
            <LanRoundedIcon fontSize="small" />
            <Typography variant="h6" component="h2" sx={{ flexGrow: 1 }}>
              Network server
            </Typography>
            <Chip size="small" color={status.running ? 'success' : 'default'} label={status.running ? 'Running' : 'Stopped'} />
          </Stack>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            Serves SPATT to browsers on this computer or your local network. Everyone works on this app&apos;s own project library, and edits made at the same time are never silently overwritten.
          </Typography>

          {failure ?? status.error ? <Alert severity="error">{failure ?? status.error}</Alert> : null}

          <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
            {status.running ? (
              <Button variant="outlined" startIcon={<StopRoundedIcon />} disabled={busy} onClick={() => run(stopServer)}>
                Stop
              </Button>
            ) : (
              <Button variant="contained" startIcon={<PlayArrowRoundedIcon />} disabled={busy || !portValid} onClick={() =>
                  run(async () => {
                    if (portNumber !== status.port) await updateServer({ port: portNumber });
                    return startServer();
                  })
                }
              >
                Start
              </Button>
            )}
            <TextField
              size="small"
              label="Port"
              value={port}
              onChange={(e) => setPort(e.target.value.replace(/\D/g, ''))}
              error={!portValid}
              helperText={portValid ? undefined : '1024 to 65535'}
              // Applied by Start, or by Apply while running, never on blur: a blur-triggered save
              // would disable Start before the click that caused the blur lands.
              disabled={busy}
              sx={{ width: 110 }}
              slotProps={{ htmlInput: { inputMode: 'numeric' } }}
            />
            {status.running && portValid && portNumber !== status.port ? (
              <Tooltip title="Restart the server on this port">
                <span>
                  <Button disabled={busy} onClick={() => update({ port: portNumber })}>
                    Apply
                  </Button>
                </span>
              </Tooltip>
            ) : null}
            <Tooltip title="Open in this computer's browser">
              <span>
                <IconButton aria-label="Open in browser" disabled={!status.running} onClick={() => void openInBrowser()}>
                  <OpenInBrowserRoundedIcon />
                </IconButton>
              </span>
            </Tooltip>
          </Stack>

          <Box>
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              This computer
            </Typography>
            <Stack direction="row" sx={{ alignItems: 'center' }}>
              <Typography variant="body2" sx={{ fontFamily: fontFamilyMono, flexGrow: 1 }}>
                {status.localUrl}
              </Typography>
              <CopyButton text={status.localUrl} label="Copy this computer's address" />
            </Stack>
          </Box>

          <Divider />

          <FormControlLabel control={<Switch checked={status.lan} disabled={busy} onChange={(e) => update({ lan: e.target.checked })} />} label="Share on the local network" />
          {status.lan ? (
            <Stack spacing={1}>
              {status.lanUrl ? (
                <Stack direction="row" spacing={1.5} sx={{ alignItems: 'flex-start' }}>
                  <AccessQr url={status.lanUrl} />
                  <Box sx={{ minWidth: 0 }}>
                    <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                      Access link for other devices
                    </Typography>
                    <Typography variant="body2" sx={{ fontFamily: fontFamilyMono, wordBreak: 'break-all' }}>
                      {status.lanUrl}
                    </Typography>
                    <Stack direction="row" spacing={0.5} sx={{ mt: 0.5 }}>
                      <CopyButton text={status.lanUrl} label="Copy the access link" />
                    </Stack>
                    <Typography variant="caption" component="p" sx={{ color: 'text.secondary', mt: 0.5 }}>
                      Open the link or scan the code on a phone or another computer. It signs that browser in.
                    </Typography>
                  </Box>
                </Stack>
              ) : (
                <Alert severity="warning">This computer has no network address right now, so other devices cannot reach it.</Alert>
              )}
              <Stack direction="row" sx={{ alignItems: 'center' }}>
                <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                    Access token
                  </Typography>
                  <Typography variant="body2" sx={{ fontFamily: fontFamilyMono, wordBreak: 'break-all' }}>
                    {status.token}
                  </Typography>
                </Box>
                <CopyButton text={status.token} label="Copy the access token" />
                <Tooltip title="New token: every other device must use the new link">
                  <IconButton aria-label="Generate a new access token" disabled={busy} onClick={() => run(regenerateToken)}>
                    <RefreshRoundedIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </Stack>
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                Your system may ask whether to allow SPATT through the firewall the first time it serves the network.
              </Typography>
            </Stack>
          ) : null}

          <Divider />

          <Box>
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              Projects folder
            </Typography>
            <Stack direction="row" sx={{ alignItems: 'center' }}>
              <Typography variant="body2" sx={{ fontFamily: fontFamilyMono, flexGrow: 1, wordBreak: 'break-all' }}>
                {status.dataDir}
              </Typography>
              <Tooltip title="Show the folder">
                <IconButton size="small" aria-label="Show the projects folder" onClick={() => void openProjectsFolder()}>
                  <FolderOpenRoundedIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Stack>
          </Box>

          <FormControlLabel control={<Switch checked={status.keepServingOnClose} disabled={busy} onChange={(e) => update({ keepServingOnClose: e.target.checked })} />} label="Keep serving in the tray when this window is closed" />
          <FormControlLabel control={<Switch disabled />} label="Run in the background at login or as a service (coming soon)" />

          <Box>
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              Recent activity
            </Typography>
            <Box component="ol" aria-label="Recent server activity" sx={{ m: 0, p: 1, listStyle: 'none', maxHeight: 160, overflowY: 'auto', bgcolor: 'background.default', border: 1, borderColor: 'divider', borderRadius: 1, fontFamily: fontFamilyMono, fontSize: 12 }}>
              {logs.length === 0 ? (
                <Box component="li" sx={{ color: 'text.secondary' }}>
                  Nothing yet
                </Box>
              ) : (
                logs
                  .slice(-40)
                  .reverse()
                  .map((line, k) => (
                    <Box component="li" key={`${line.at}-${k}`}>
                      <Box component="span" sx={{ color: 'text.secondary', mr: 1 }}>
                        {timeFormat.format(new Date(line.at))}
                      </Box>
                      {line.text}
                    </Box>
                  ))
              )}
            </Box>
          </Box>
        </Stack>
      </CardContent>
    </Card>
  );
}

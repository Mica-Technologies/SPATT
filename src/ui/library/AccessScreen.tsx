/**
 * Shown by a SPATT server to a browser on another device that has no access yet: explains the
 * access link, and accepts a pasted token.
 */
import { useState } from 'react';
import KeyRoundedIcon from '@mui/icons-material/KeyRounded';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Container from '@mui/material/Container';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import AppHeader from '../components/AppHeader';

export default function AccessScreen({ onSignIn }: { onSignIn: (token: string) => Promise<boolean> }) {
  const [token, setToken] = useState('');
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    const ok = await onSignIn(token.trim()).catch(() => false);
    setBusy(false);
    setFailed(!ok);
  };

  return (
    <Box sx={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', bgcolor: 'background.default' }}>
      <AppHeader title="SPATT" subtitle="Signal Programming and Timing Tool" />
      <Container maxWidth="sm" sx={{ py: 6 }}>
        <Paper variant="outlined" sx={{ p: 3 }}>
          <Stack
            component="form"
            spacing={2}
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
              <KeyRoundedIcon color="primary" />
              <Typography variant="h5" component="h2">
                Access needed
              </Typography>
            </Stack>
            <Typography variant="body2">
              This SPATT server is shared on the network, so other devices need its access link. On the computer running SPATT, open the manager and use the link or scan its QR code with this device. The link signs this browser in and is remembered.
            </Typography>
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              Or paste the access token shown in the manager:
            </Typography>
            <TextField label="Access token" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" slotProps={{ htmlInput: { spellCheck: false } }} />
            {failed ? <Alert severity="error">That token is not right. Check it in the manager; it changes when someone generates a new one.</Alert> : null}
            <Box>
              <Button type="submit" variant="contained" disabled={busy || token.trim().length === 0}>
                Sign in
              </Button>
            </Box>
          </Stack>
        </Paper>
      </Container>
    </Box>
  );
}

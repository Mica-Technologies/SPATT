/** The keyboard shortcuts help, opened with ? or from the header. */
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Typography from '@mui/material/Typography';
import { fontFamilyMono } from '../theme/themePrimitives';

const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = mac ? '⌘' : 'Ctrl';
const ALT = mac ? '⌥' : 'Alt';

const GROUPS: { title: string; items: { keys: string[][]; action: string; range?: boolean }[] }[] = [
  {
    title: 'Editing',
    items: [
      { keys: [[MOD, 'Z']], action: 'Undo' },
      { keys: [[MOD, 'Y'], [MOD, 'Shift', 'Z']], action: 'Redo' },
    ],
  },
  {
    title: 'Navigation',
    items: [
      { keys: [[ALT, '1'], [ALT, '6']], action: 'Go to tab 1 to 6 (Phases … Simulate, or a corridor’s tabs)', range: true },
      { keys: [['Tab']], action: 'Move through fields; the first Tab offers “Skip to editor”' },
      { keys: [['?']], action: 'Show this list' },
    ],
  },
  {
    title: 'Simulate tab',
    items: [
      { keys: [[MOD, 'Enter']], action: 'Run the simulation' },
      { keys: [['Space']], action: 'Play or pause the playback' },
    ],
  },
];

function Key({ children }: { children: string }) {
  return (
    <Box component="kbd" sx={{ fontFamily: fontFamilyMono, fontSize: 12, px: 0.75, py: 0.125, border: 1, borderColor: 'divider', borderBottomWidth: 2, borderRadius: 1, bgcolor: 'background.default', whiteSpace: 'nowrap' }}>
      {children}
    </Box>
  );
}

export default function ShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm" aria-labelledby="shortcuts-title">
      <DialogTitle id="shortcuts-title">Keyboard shortcuts</DialogTitle>
      <DialogContent dividers>
        {GROUPS.map((group) => (
          <Box key={group.title} component="section" aria-label={group.title} sx={{ '& + &': { mt: 2 } }}>
            <Typography variant="overline" component="h3" sx={{ color: 'text.secondary' }}>
              {group.title}
            </Typography>
            <Box component="dl" sx={{ m: 0, display: 'grid', gridTemplateColumns: 'minmax(120px, max-content) 1fr', columnGap: 2, rowGap: 1, alignItems: 'baseline' }}>
              {group.items.map((item) => (
                <Box key={item.action} sx={{ display: 'contents' }}>
                  <Box component="dt" sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, alignItems: 'center', fontSize: 12, color: 'text.secondary' }}>
                    {item.keys.map((combo, k) => (
                      <Box key={k} component="span" sx={{ display: 'inline-flex', gap: 0.5, alignItems: 'center' }}>
                        {k > 0 ? (item.range ? 'to' : 'or') : null}
                        {combo.map((key) => (
                          <Key key={key}>{key}</Key>
                        ))}
                      </Box>
                    ))}
                  </Box>
                  <Box component="dd" sx={{ m: 0 }}>
                    <Typography variant="body2">{item.action}</Typography>
                  </Box>
                </Box>
              ))}
            </Box>
          </Box>
        ))}
        <Typography variant="caption" component="p" sx={{ color: 'text.secondary', mt: 2, mb: 0 }}>
          Shortcuts other than {MOD}+Enter do nothing while you are typing in a field, so the field&apos;s own keys keep working.
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}

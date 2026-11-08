/**
 * Import intersections from a Synchro UTDF combined CSV file: a summary of each signalized node
 * (what was imported, what was assumed, what was left out) before adding the chosen ones to the
 * project as one undoable step.
 */
import { useMemo, useState } from 'react';
import FileUploadRoundedIcon from '@mui/icons-material/FileUploadRounded';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import FormControlLabel from '@mui/material/FormControlLabel';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme } from '@mui/material/styles';
import { pickTextFile } from '../../io/files';
import { importUtdf, type UtdfNote } from '../../io/import/utdf';
import { formatSeconds, randomId, validateIntersection, type Intersection } from '../../model';
import { fontFamilyMono } from '../theme/themePrimitives';

interface UtdfImportDialogProps {
  open: boolean;
  onClose: () => void;
  /** Receives the chosen intersections, to add to the project in one step. */
  onImport: (intersections: Intersection[]) => void;
}

function Notes({ notes, kind }: { notes: UtdfNote[]; kind: UtdfNote['kind'] }) {
  const list = notes.filter((n) => n.kind === kind);
  if (list.length === 0) return null;
  return (
    <Box>
      <Typography variant="caption" component="h4" sx={{ fontWeight: 600, color: kind === 'dropped' ? 'warning.main' : 'text.secondary' }}>
        {kind === 'dropped' ? 'Left out' : 'Assumed'}
      </Typography>
      <Box component="ul" sx={{ m: 0, pl: 2.5, typography: 'body2', color: 'text.secondary' }}>
        {list.map((n) => (
          <li key={n.message}>{n.message}</li>
        ))}
      </Box>
    </Box>
  );
}

function summary(intersection: Intersection): string {
  const patterns = intersection.patterns.map((p) => (p.mode === 'free' ? `${p.name} (free)` : `${p.name} ${formatSeconds(p.cycle)} s`)).join(', ');
  const parts = [
    `${intersection.phases.length} phase${intersection.phases.length === 1 ? '' : 's'} in ${intersection.rings.length} ring${intersection.rings.length === 1 ? '' : 's'}`,
    intersection.patterns.length > 0 ? `${intersection.patterns.length === 1 ? 'pattern' : 'patterns'} ${patterns}` : 'no patterns',
    `${intersection.laneGroups.length} lane group${intersection.laneGroups.length === 1 ? '' : 's'}`,
    intersection.volumeSets.length > 0 ? 'a count' : 'no count',
  ];
  return parts.join(' · ');
}

export default function UtdfImportDialog({ open, onClose, onImport }: UtdfImportDialogProps) {
  const theme = useTheme();
  const phone = useMediaQuery(theme.breakpoints.down('sm'), { noSsr: true });
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const result = useMemo(() => (text.trim() ? importUtdf(text, randomId) : null), [text]);
  const chosen = result?.ok ? result.intersections.filter((i) => !excluded.has(i.nodeId)) : [];

  const close = () => {
    setText('');
    setFileName(null);
    setExcluded(new Set());
    onClose();
  };
  const load = (next: string, file: string | null) => {
    setText(next);
    setFileName(file);
    setExcluded(new Set());
  };

  return (
    <Dialog open={open} onClose={close} fullWidth maxWidth="md" fullScreen={phone} aria-labelledby="utdf-import-title">
      <DialogTitle id="utdf-import-title">Import from Synchro UTDF</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          <Typography variant="body2">
            Open a combined UTDF CSV file exported from Synchro. Each signalized node becomes an intersection with its phases, rings, one pattern per timing plan, lane groups and volumes. Check the result: the import was written from the published format and tested against hand-written samples.
          </Typography>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }} useFlexGap>
            <Button
              variant="outlined"
              startIcon={<FileUploadRoundedIcon />}
              onClick={() => {
                void pickTextFile('.csv,.txt,text/csv,text/plain').then((file) => file && load(file.text, file.name));
              }}
            >
              Open UTDF file…
            </Button>
            {fileName ? (
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                {fileName}
              </Typography>
            ) : null}
          </Stack>
          <TextField
            label="UTDF (CSV)"
            multiline
            rows={phone ? 4 : 5}
            value={text}
            onChange={(e) => load(e.target.value, null)}
            placeholder={'[Network]\nNetwork Settings\nRECORDNAME,DATA\n…'}
            sx={{ '& .MuiOutlinedInput-root': { height: 'auto', alignItems: 'flex-start', py: 1 } }}
            slotProps={{ htmlInput: { spellCheck: false, style: { fontFamily: fontFamilyMono, fontSize: 12, lineHeight: 1.5 } } }}
          />
          {result && !result.ok ? <Alert severity="error">{result.error}</Alert> : null}
          {result?.ok ? (
            <>
              <Alert severity="info" variant="outlined" role="status">
                Found {result.intersections.length} signalized intersection{result.intersections.length === 1 ? '' : 's'}. Untick any you do not want.
              </Alert>
              {result.intersections.map(({ nodeId, intersection, notes }) => {
                const errors = validateIntersection(intersection).filter((i) => i.severity === 'error').length;
                return (
                  <Box key={nodeId} component="section" aria-label={intersection.name} sx={{ border: 1, borderColor: 'divider', borderRadius: 2, p: 1.5, display: 'flex', flexDirection: 'column', gap: 1 }}>
                    <FormControlLabel
                      sx={{ m: 0, alignItems: 'flex-start' }}
                      control={
                        <Checkbox
                          size="small"
                          checked={!excluded.has(nodeId)}
                          onChange={(e) => {
                            const next = new Set(excluded);
                            if (e.target.checked) next.delete(nodeId);
                            else next.add(nodeId);
                            setExcluded(next);
                          }}
                          sx={{ mt: -0.5 }}
                        />
                      }
                      label={
                        <Box>
                          <Typography variant="subtitle2" component="span" sx={{ display: 'block' }}>
                            {intersection.name}{' '}
                            <Box component="span" sx={{ color: 'text.secondary', fontWeight: 400 }}>
                              (node {nodeId})
                            </Box>
                          </Typography>
                          <Typography variant="body2" component="span" sx={{ display: 'block', color: 'text.secondary' }}>
                            {summary(intersection)}
                          </Typography>
                        </Box>
                      }
                    />
                    {errors > 0 ? (
                      <Typography variant="body2" sx={{ color: 'error.main' }}>
                        {errors} problem{errors === 1 ? '' : 's'} to fix after the import; the Problems panel lists them.
                      </Typography>
                    ) : null}
                    <Notes notes={notes} kind="dropped" />
                    <Notes notes={notes} kind="assumed" />
                  </Box>
                );
              })}
              {result.notes.length > 0 ? (
                <Box component="section" aria-label="Whole file" sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  <Typography variant="subtitle2" component="h3">
                    Whole file
                  </Typography>
                  <Notes notes={result.notes} kind="dropped" />
                  <Notes notes={result.notes} kind="assumed" />
                </Box>
              ) : null}
            </>
          ) : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={close}>Cancel</Button>
        <Button
          variant="contained"
          disabled={chosen.length === 0}
          onClick={() => {
            onImport(chosen.map((c) => c.intersection));
            close();
          }}
        >
          {chosen.length > 1 ? `Add ${chosen.length} intersections` : 'Add intersection'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

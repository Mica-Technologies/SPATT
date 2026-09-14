/**
 * Import a CSM ASC-3 timing plan (pasted, or from a file) as a new intersection, showing what the
 * conversion changed before adding it.
 */
import { useMemo, useState } from 'react';
import FileUploadRoundedIcon from '@mui/icons-material/FileUploadRounded';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { pickProjectFile } from '../../io/files';
import type { Intersection, OffsetReference } from '../../model';
import { importCsm } from '../../profiles/csm';
import { REFERENCE_LABEL } from '../diagram/diagramText';
import { fontFamilyMono } from '../theme/themePrimitives';
import IssueList from './IssueList';

interface CsmImportDialogProps {
  open: boolean;
  onClose: () => void;
  /** Receives the converted intersection (with `id`), to add to the project. */
  onImport: (intersection: Intersection) => void;
  id: string;
}

export default function CsmImportDialog({ open, onClose, onImport, id }: CsmImportDialogProps) {
  const [text, setText] = useState('');
  const [reference, setReference] = useState<OffsetReference>('beginCoordGreen');
  const result = useMemo(() => (text.trim() ? importCsm(text, { id, offsetReference: reference }) : null), [text, id, reference]);

  const close = () => {
    setText('');
    onClose();
  };

  return (
    <Dialog open={open} onClose={close} fullWidth maxWidth="sm" aria-labelledby="csm-import-title">
      <DialogTitle id="csm-import-title">Import from CSM ASC-3</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          <Typography variant="body2">Paste a timing plan copied from the controller, or open a plan file. It becomes a new intersection.</Typography>
          <Stack direction="row" spacing={1}>
            <Button
              variant="outlined"
              startIcon={<FileUploadRoundedIcon />}
              onClick={() => {
                void pickProjectFile('.json,application/json').then((file) => file && setText(file.text));
              }}
            >
              Open file…
            </Button>
          </Stack>
          <TextField
            label="Plan"
            multiline
            rows={8}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder='{"format": "csm-asc3-plan", …}'
            // The theme gives outlined inputs a fixed single-line height; a fixed-row text area needs its own.
            sx={{ '& .MuiOutlinedInput-root': { height: 'auto', alignItems: 'flex-start', py: 1 } }}
            slotProps={{ htmlInput: { spellCheck: false, style: { fontFamily: fontFamilyMono, fontSize: 12, lineHeight: 1.5 } } }}
          />
          <TextField select size="small" label="Measure offsets to" value={reference} onChange={(e) => setReference(e.target.value as OffsetReference)}>
            {(Object.keys(REFERENCE_LABEL) as OffsetReference[]).map((key) => (
              <MenuItem key={key} value={key}>
                {REFERENCE_LABEL[key].replace(/^./, (c) => c.toUpperCase())}
              </MenuItem>
            ))}
          </TextField>
          {result && !result.ok ? <IssueList label="Import problems" issues={result.issues} /> : null}
          {result?.ok ? (
            <>
              <Alert severity={result.issues.length > 0 ? 'warning' : 'success'}>
                {result.intersection.name}: {result.intersection.phases.length} phases, {result.intersection.patterns.length} pattern{result.intersection.patterns.length === 1 ? '' : 's'}
                {result.issues.length > 0 ? '. Check these before you rely on it:' : '.'}
              </Alert>
              {result.issues.length > 0 ? <IssueList label="Import notes" issues={result.issues} /> : null}
            </>
          ) : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={close}>Cancel</Button>
        <Button
          variant="contained"
          disabled={!result?.ok}
          onClick={() => {
            if (result?.ok) {
              onImport(result.intersection);
              close();
            }
          }}
        >
          Add intersection
        </Button>
      </DialogActions>
    </Dialog>
  );
}

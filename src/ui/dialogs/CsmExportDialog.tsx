/**
 * Export an intersection as a CSM ASC-3 timing plan: what the controller cannot express (which
 * blocks export) or expresses differently, then download the plan or copy it for pasting into the
 * controller.
 */
import { useMemo, useState } from 'react';
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded';
import FileDownloadRoundedIcon from '@mui/icons-material/FileDownloadRounded';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { saveTextFile, safeFileName } from '../../io/files';
import type { Intersection } from '../../model';
import { exportCsm } from '../../profiles/csm';
import { navigateTo } from '../workspace/navigation';
import IssueList from './IssueList';

interface CsmExportDialogProps {
  open: boolean;
  onClose: () => void;
  intersection: Intersection | null;
  intersectionIndex: number;
}

export default function CsmExportDialog({ open, onClose, intersection, intersectionIndex }: CsmExportDialogProps) {
  const result = useMemo(() => (open && intersection ? exportCsm(intersection) : null), [open, intersection]);
  const [copied, setCopied] = useState(false);
  const canCopy = typeof navigator !== 'undefined' && navigator.clipboard !== undefined;
  const errors = result?.issues.filter((i) => i.severity === 'error').length ?? 0;

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm" aria-labelledby="csm-export-title">
      <DialogTitle id="csm-export-title">Export for CSM ASC-3</DialogTitle>
      <DialogContent dividers>
        {result && intersection ? (
          <Stack spacing={2}>
            <Typography variant="body2">
              A timing plan for the City Super Mod&apos;s Advanced signal controller, in game ticks. Import it on the controller in game. Signal circuits and other settings this plan does not include stay as they are on the controller.
            </Typography>
            {result.ok ? (
              <Alert severity={result.issues.length > 0 ? 'warning' : 'success'}>
                {result.issues.length > 0 ? 'Ready to export. Check how the controller will differ:' : 'Ready to export. The controller can run this plan as it is.'}
              </Alert>
            ) : (
              <Alert severity="error">
                {errors} problem{errors === 1 ? '' : 's'} must be fixed first.
              </Alert>
            )}
            {result.issues.length > 0 ? (
              <IssueList
                label="Export problems"
                issues={result.issues}
                onSelect={(issue) => {
                  onClose();
                  navigateTo(['intersections', intersectionIndex, ...issue.path]);
                }}
              />
            ) : null}
          </Stack>
        ) : null}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
        {canCopy ? (
          <Button
            startIcon={<ContentCopyRoundedIcon />}
            disabled={!result?.ok}
            onClick={() => {
              if (!result?.ok) return;
              void navigator.clipboard.writeText(JSON.stringify(result.plan)).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              });
            }}
          >
            {copied ? 'Copied' : 'Copy plan'}
          </Button>
        ) : null}
        <Button
          variant="contained"
          startIcon={<FileDownloadRoundedIcon />}
          disabled={!result?.ok}
          onClick={() => {
            if (result?.ok && intersection) void saveTextFile(`${safeFileName(intersection.name, 'intersection')}.csm.json`, result.text, 'CSM ASC-3 plan');
          }}
        >
          Download
        </Button>
      </DialogActions>
    </Dialog>
  );
}

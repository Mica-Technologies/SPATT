/** Project name, unit system and notes. */
import { useState } from 'react';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import { UNIT_SYSTEMS, type Project } from '../../model';
import { useWorkspace } from '../state/workspace';

export default function ProjectSettingsDialog({ open, onClose, project }: { open: boolean; onClose: () => void; project: Project }) {
  const edit = useWorkspace((s) => s.edit);
  const [name, setName] = useState(project.name);
  const [units, setUnits] = useState(0);
  const [notes, setNotes] = useState(project.notes);
  const [openedWith, setOpenedWith] = useState(false);
  if (open !== openedWith) {
    setOpenedWith(open);
    if (open) {
      setName(project.name);
      setUnits(Math.max(0, UNIT_SYSTEMS.findIndex((u) => u.length === project.units.length && u.speed === project.units.speed)));
      setNotes(project.notes);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm" aria-labelledby="project-settings-title">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const system = UNIT_SYSTEMS[units]!;
          edit('Change project settings', (p) => {
            p.name = name.trim() || p.name;
            p.units = { length: system.length, speed: system.speed };
            p.notes = notes;
          });
          onClose();
        }}
      >
        <DialogTitle id="project-settings-title">Project settings</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2}>
            <TextField label="Project name" value={name} onChange={(e) => setName(e.target.value)} slotProps={{ htmlInput: { maxLength: 120 } }} />
            <TextField select label="Units" value={units} onChange={(e) => setUnits(Number(e.target.value))} helperText="How distances and speeds are shown and entered. Stored values do not change.">
              {UNIT_SYSTEMS.map((system, k) => (
                <MenuItem key={system.label} value={k}>
                  {system.label}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              label="Notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              multiline
              rows={4}
              sx={{ '& .MuiOutlinedInput-root': { height: 'auto', alignItems: 'flex-start', py: 1 } }}
              slotProps={{ htmlInput: { maxLength: 10_000 } }}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="contained">
            Save
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}

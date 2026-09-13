import { useState } from 'react';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import MoreVertRoundedIcon from '@mui/icons-material/MoreVertRounded';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import IconButton from '@mui/material/IconButton';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemText from '@mui/material/ListItemText';
import ListSubheader from '@mui/material/ListSubheader';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import {
  csmDefault,
  leadLagEightPhase,
  randomId,
  splitPhaseSideStreet,
  standardEightPhase,
  twoPhase,
  uniqueName,
  type Intersection,
} from '../../model';
import { useIssues } from '../state/useIssues';
import { useWorkspace } from '../state/workspace';

const TEMPLATES: { label: string; build: (id: string) => Intersection }[] = [
  { label: 'Standard eight-phase', build: standardEightPhase },
  { label: 'Eight-phase, lead-lag', build: leadLagEightPhase },
  { label: 'Split-phase side street', build: splitPhaseSideStreet },
  { label: 'Two-phase', build: twoPhase },
  { label: 'CSM ASC-3 default', build: csmDefault },
];

export default function Sidebar() {
  const project = useWorkspace((s) => s.project)!;
  const selectedId = useWorkspace((s) => s.selectedIntersectionId);
  const { edit, selectIntersection } = useWorkspace.getState();
  const issues = useIssues();
  const [addAnchor, setAddAnchor] = useState<HTMLElement | null>(null);
  const [itemMenu, setItemMenu] = useState<{ anchor: HTMLElement; intersection: Intersection } | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState<Intersection | null>(null);

  const add = (build: (id: string) => Intersection) => {
    const id = randomId('i');
    const intersection = build(id);
    intersection.name = uniqueName(intersection.name, project.intersections.map((i) => i.name));
    edit(`Add ${intersection.name}`, (p) => p.intersections.push(intersection));
    selectIntersection(id);
    setAddAnchor(null);
  };

  const duplicate = (source: Intersection) => {
    const copy = structuredClone(source);
    copy.id = randomId('i');
    copy.name = uniqueName(source.name, project.intersections.map((i) => i.name));
    edit(`Duplicate ${source.name}`, (p) => {
      const index = p.intersections.findIndex((i) => i.id === source.id);
      p.intersections.splice(index + 1, 0, copy);
    });
    selectIntersection(copy.id);
  };

  const errorCount = (index: number) =>
    issues.filter((i) => i.severity === 'error' && i.path[0] === 'intersections' && i.path[1] === index).length;

  return (
    <Box component="nav" aria-label="Intersections" sx={{ borderRight: 1, borderColor: 'divider', bgcolor: 'background.paper', overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
      <List dense subheader={<ListSubheader sx={{ bgcolor: 'background.paper', lineHeight: '40px' }}>Intersections</ListSubheader>}>
        {project.intersections.map((intersection, index) => {
          const errors = errorCount(index);
          return (
            <ListItemButton
              key={intersection.id}
              selected={intersection.id === selectedId}
              onClick={() => selectIntersection(intersection.id)}
              sx={{ pr: 0.5, borderRadius: 1, mx: 0.5 }}
            >
              <ListItemText
                primary={intersection.name}
                secondary={errors > 0 ? `${errors} error${errors === 1 ? '' : 's'}` : `${intersection.phases.length} phases`}
                slotProps={{ primary: { noWrap: true }, secondary: { sx: { color: errors > 0 ? 'error.main' : undefined } } }}
              />
              <IconButton
                size="small"
                aria-label={`Actions for ${intersection.name}`}
                onClick={(event) => {
                  event.stopPropagation();
                  setItemMenu({ anchor: event.currentTarget, intersection });
                }}
              >
                <MoreVertRoundedIcon fontSize="small" />
              </IconButton>
            </ListItemButton>
          );
        })}
      </List>
      {project.intersections.length === 0 ? (
        <Typography variant="body2" sx={{ color: 'text.secondary', px: 2, pb: 1 }}>
          No intersections yet.
        </Typography>
      ) : null}
      <Box sx={{ px: 1.5, pb: 2 }}>
        <Button size="small" variant="outlined" fullWidth startIcon={<AddRoundedIcon />} onClick={(e) => setAddAnchor(e.currentTarget)}>
          Add intersection
        </Button>
      </Box>

      <Menu anchorEl={addAnchor} open={addAnchor !== null} onClose={() => setAddAnchor(null)}>
        <ListSubheader sx={{ lineHeight: '32px' }}>Start from</ListSubheader>
        {TEMPLATES.map((template) => (
          <MenuItem key={template.label} onClick={() => add(template.build)}>
            {template.label}
          </MenuItem>
        ))}
      </Menu>

      <Menu anchorEl={itemMenu?.anchor} open={itemMenu !== null} onClose={() => setItemMenu(null)}>
        <MenuItem
          onClick={() => {
            setRenaming({ id: itemMenu!.intersection.id, name: itemMenu!.intersection.name });
            setItemMenu(null);
          }}
        >
          Rename…
        </MenuItem>
        <MenuItem
          onClick={() => {
            duplicate(itemMenu!.intersection);
            setItemMenu(null);
          }}
        >
          Duplicate
        </MenuItem>
        <MenuItem
          sx={{ color: 'error.main' }}
          onClick={() => {
            setDeleting(itemMenu!.intersection);
            setItemMenu(null);
          }}
        >
          Delete…
        </MenuItem>
      </Menu>

      <Dialog open={renaming !== null} onClose={() => setRenaming(null)} fullWidth maxWidth="xs">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const target = renaming!;
            const name = target.name.trim();
            if (name) {
              edit('Rename intersection', (p) => {
                const found = p.intersections.find((i) => i.id === target.id);
                if (found) found.name = name;
              });
            }
            setRenaming(null);
          }}
        >
          <DialogTitle>Rename intersection</DialogTitle>
          <DialogContent>
            <TextField autoFocus fullWidth label="Name" value={renaming?.name ?? ''} onChange={(e) => setRenaming((r) => (r ? { ...r, name: e.target.value } : r))} sx={{ mt: 1 }} slotProps={{ htmlInput: { maxLength: 120 } }} />
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setRenaming(null)}>Cancel</Button>
            <Button type="submit" variant="contained">
              Rename
            </Button>
          </DialogActions>
        </form>
      </Dialog>

      <Dialog open={deleting !== null} onClose={() => setDeleting(null)}>
        <DialogTitle>Delete “{deleting?.name}”?</DialogTitle>
        <DialogContent>
          <Typography variant="body2">You can undo this.</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleting(null)}>Cancel</Button>
          <Button
            color="error"
            variant="outlined"
            onClick={() => {
              const target = deleting!;
              edit(`Delete ${target.name}`, (p) => {
                p.intersections = p.intersections.filter((i) => i.id !== target.id);
                p.corridors.forEach((c) => (c.intersectionIds = c.intersectionIds.filter((id) => id !== target.id)));
              });
              selectIntersection(selectedId === target.id ? null : selectedId);
              setDeleting(null);
            }}
          >
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

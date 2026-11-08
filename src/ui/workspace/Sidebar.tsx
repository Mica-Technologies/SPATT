import { useRef, useState } from 'react';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import MoreVertRoundedIcon from '@mui/icons-material/MoreVertRounded';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import Divider from '@mui/material/Divider';
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
import Snackbar from '@mui/material/Snackbar';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { randomId, removeIntersectionFromCorridors, uniqueName, type Intersection } from '../../model';
import AddCorridorDialog from '../corridor/AddCorridorDialog';
import CsmExportDialog from '../dialogs/CsmExportDialog';
import CountImportDialog from '../dialogs/CountImportDialog';
import CsmImportDialog from '../dialogs/CsmImportDialog';
import UtdfImportDialog from '../dialogs/UtdfImportDialog';
import { useIssues } from '../state/useIssues';
import { useWorkspace } from '../state/workspace';
import { addTemplateIntersection } from './addIntersection';
import TemplateSketch from './TemplateSketch';
import { TEMPLATES } from './templates';

type Kind = 'intersection' | 'corridor';
interface Target {
  kind: Kind;
  id: string;
  name: string;
}

export default function Sidebar() {
  const project = useWorkspace((s) => s.project)!;
  const selectedId = useWorkspace((s) => s.selectedIntersectionId);
  const selectedCorridorId = useWorkspace((s) => s.selectedCorridorId);
  const { edit, selectIntersection, selectCorridor, setView } = useWorkspace.getState();
  const issues = useIssues();
  const [addAnchor, setAddAnchor] = useState<HTMLElement | null>(null);
  const [itemMenu, setItemMenu] = useState<{ anchor: HTMLElement; target: Target } | null>(null);
  const [renaming, setRenaming] = useState<Target | null>(null);
  const [deleting, setDeleting] = useState<Target | null>(null);
  const [csmExport, setCsmExport] = useState<string | null>(null);
  const [csmImportId, setCsmImportId] = useState<string | null>(null);
  const [utdfImport, setUtdfImport] = useState(false);
  const [countImport, setCountImport] = useState<string | null>(null);
  const [addingCorridor, setAddingCorridor] = useState(false);
  // An added template whose name was taken: offered for renaming without interrupting the user.
  const [numbered, setNumbered] = useState<Target | null>(null);
  const renameInput = useRef<HTMLInputElement>(null);

  const add = (build: (id: string) => Intersection) => {
    setAddAnchor(null);
    const added = addTemplateIntersection(build);
    // Another intersection already has the template's name: offer a rename rather than leave a numbered copy unnoticed.
    setNumbered(added.renamed ? { kind: 'intersection', id: added.id, name: added.name } : null);
  };

  const insert = (intersection: Intersection) => {
    const id = intersection.id;
    intersection.name = uniqueName(intersection.name, project.intersections.map((i) => i.name));
    edit(`Add ${intersection.name}`, (p) => p.intersections.push(intersection));
    selectIntersection(id);
  };

  /** Several imported intersections, as one undo step. */
  const insertAll = (intersections: Intersection[]) => {
    const taken = project.intersections.map((i) => i.name);
    for (const intersection of intersections) {
      intersection.name = uniqueName(intersection.name, taken);
      taken.push(intersection.name);
    }
    edit(intersections.length === 1 ? `Add ${intersections[0]!.name}` : `Import ${intersections.length} intersections`, (p) => p.intersections.push(...intersections));
    if (intersections[0]) selectIntersection(intersections[0].id);
  };

  const duplicate = (id: string) => {
    const source = project.intersections.find((i) => i.id === id);
    if (!source) return;
    const copy = structuredClone(source);
    copy.id = randomId('i');
    copy.name = uniqueName(source.name, project.intersections.map((i) => i.name));
    edit(`Duplicate ${source.name}`, (p) => {
      const index = p.intersections.findIndex((i) => i.id === source.id);
      p.intersections.splice(index + 1, 0, copy);
    });
    selectIntersection(copy.id);
  };

  const errorCount = (root: 'intersections' | 'corridors', index: number) =>
    issues.filter((i) => i.severity === 'error' && i.path[0] === root && i.path[1] === index).length;

  const actions = (target: Target) => (
    <IconButton
      size="small"
      aria-label={`Actions for ${target.name}`}
      onClick={(event) => {
        event.stopPropagation();
        setItemMenu({ anchor: event.currentTarget, target });
      }}
    >
      <MoreVertRoundedIcon fontSize="small" />
    </IconButton>
  );
  const closeMenuAnd = (action: (target: Target) => void) => () => {
    action(itemMenu!.target);
    setItemMenu(null);
  };

  return (
    <Box component="nav" aria-label="Intersections" sx={{ borderRight: 1, borderColor: 'divider', bgcolor: 'background.paper', overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
      <List dense subheader={<ListSubheader sx={{ bgcolor: 'background.paper', lineHeight: '40px' }}>Intersections</ListSubheader>}>
        {project.intersections.map((intersection, index) => {
          const errors = errorCount('intersections', index);
          // Controller data from a CSM import (circuits, overlaps...) travels with the intersection.
          const fromCsm = intersection.extensions?.csm !== undefined || intersection.phases.some((p) => p.extensions?.csm !== undefined);
          const detail = errors > 0 ? `${errors} error${errors === 1 ? '' : 's'}` : `${intersection.phases.length} phases`;
          return (
            <ListItemButton
              key={intersection.id}
              selected={selectedCorridorId === null && intersection.id === selectedId}
              onClick={() => selectIntersection(intersection.id)}
              sx={{ pr: 0.5, borderRadius: 1, mx: 0.5 }}
            >
              <ListItemText
                primary={intersection.name}
                secondary={fromCsm ? `CSM · ${detail}` : detail}
                slotProps={{ primary: { noWrap: true }, secondary: { sx: { color: errors > 0 ? 'error.main' : undefined } } }}
              />
              {actions({ kind: 'intersection', id: intersection.id, name: intersection.name })}
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

      <List dense aria-label="Corridors" subheader={<ListSubheader sx={{ bgcolor: 'background.paper', lineHeight: '40px' }}>Corridors</ListSubheader>}>
        {project.corridors.map((corridor, index) => {
          const errors = errorCount('corridors', index);
          return (
            <ListItemButton key={corridor.id} selected={corridor.id === selectedCorridorId} onClick={() => selectCorridor(corridor.id)} sx={{ pr: 0.5, borderRadius: 1, mx: 0.5 }}>
              <ListItemText
                primary={corridor.name}
                secondary={errors > 0 ? `${errors} error${errors === 1 ? '' : 's'}` : `${corridor.stops.length} intersection${corridor.stops.length === 1 ? '' : 's'}`}
                slotProps={{ primary: { noWrap: true }, secondary: { sx: { color: errors > 0 ? 'error.main' : undefined } } }}
              />
              {actions({ kind: 'corridor', id: corridor.id, name: corridor.name })}
            </ListItemButton>
          );
        })}
      </List>
      <Box sx={{ px: 1.5, pb: 2 }}>
        <Button size="small" variant="outlined" fullWidth startIcon={<AddRoundedIcon />} onClick={() => setAddingCorridor(true)} disabled={project.intersections.length === 0} aria-describedby={project.intersections.length < 2 ? 'add-corridor-hint' : undefined}>
          Add corridor
        </Button>
        {project.intersections.length < 2 ? (
          <Typography id="add-corridor-hint" variant="caption" component="p" sx={{ color: 'text.secondary', mt: 0.75, px: 0.5 }}>
            {project.intersections.length === 0 ? 'A corridor links intersections: add one first.' : 'A corridor links two or more intersections in travel order.'}
          </Typography>
        ) : null}
      </Box>

      <Menu
        anchorEl={addAnchor}
        open={addAnchor !== null}
        onClose={() => setAddAnchor(null)}
      >
        <ListSubheader sx={{ lineHeight: '32px' }}>Start from</ListSubheader>
        {TEMPLATES.map((template, k) => (
          <MenuItem key={template.label} aria-label={template.label} aria-describedby={`template-description-${k}`} onClick={() => add(template.build)} sx={{ gap: 1.5, alignItems: 'center', maxWidth: 400 }}>
            <TemplateSketch template={template} width={56} />
            <ListItemText
              primary={template.label}
              secondary={template.description}
              slotProps={{ secondary: { id: `template-description-${k}`, sx: { whiteSpace: 'normal' } } }}
            />
          </MenuItem>
        ))}
        <Divider />
        <MenuItem
          onClick={() => {
            setCsmImportId(randomId('i'));
            setAddAnchor(null);
          }}
        >
          Import from CSM ASC-3…
        </MenuItem>
        <MenuItem
          onClick={() => {
            setUtdfImport(true);
            setAddAnchor(null);
          }}
        >
          Import from Synchro UTDF…
        </MenuItem>
      </Menu>

      <Menu anchorEl={itemMenu?.anchor} open={itemMenu !== null} onClose={() => setItemMenu(null)}>
        <MenuItem onClick={closeMenuAnd((target) => setRenaming(target))}>Rename…</MenuItem>
        {itemMenu?.target.kind === 'intersection' ? <MenuItem onClick={closeMenuAnd((target) => duplicate(target.id))}>Duplicate</MenuItem> : null}
        {itemMenu?.target.kind === 'intersection' ? (
          <MenuItem
            onClick={closeMenuAnd((target) => {
              selectIntersection(target.id);
              setView('compare');
            })}
          >
            Compare plans…
          </MenuItem>
        ) : null}
        {itemMenu?.target.kind === 'intersection' ? <MenuItem onClick={closeMenuAnd((target) => setCountImport(target.id))}>Import counts from CSV…</MenuItem> : null}
        {itemMenu?.target.kind === 'intersection' ? <MenuItem onClick={closeMenuAnd((target) => setCsmExport(target.id))}>Export for CSM ASC-3…</MenuItem> : null}
        <MenuItem sx={{ color: 'error.main' }} onClick={closeMenuAnd((target) => setDeleting(target))}>
          Delete…
        </MenuItem>
      </Menu>

      <Snackbar
        open={numbered !== null}
        autoHideDuration={8000}
        onClose={(_, reason) => reason !== 'clickaway' && setNumbered(null)}
        message={numbered ? `Added as “${numbered.name}”: that name was taken.` : ''}
        action={
          <Button
            color="inherit"
            size="small"
            onClick={() => {
              setRenaming(numbered);
              setNumbered(null);
            }}
          >
            Rename
          </Button>
        }
      />
      <CsmExportDialog
        open={csmExport !== null}
        onClose={() => setCsmExport(null)}
        intersection={project.intersections.find((i) => i.id === csmExport) ?? null}
        intersectionIndex={project.intersections.findIndex((i) => i.id === csmExport)}
      />
      <CsmImportDialog open={csmImportId !== null} id={csmImportId ?? ''} onClose={() => setCsmImportId(null)} onImport={insert} />
      <UtdfImportDialog open={utdfImport} onClose={() => setUtdfImport(false)} onImport={insertAll} />
      <CountImportDialog open={countImport !== null} onClose={() => setCountImport(null)} intersection={project.intersections.find((i) => i.id === countImport) ?? null} />
      <AddCorridorDialog
        open={addingCorridor}
        project={project}
        onClose={() => setAddingCorridor(false)}
        onCreate={(corridor) => {
          edit(`Add ${corridor.name}`, (p) => p.corridors.push(corridor));
          selectCorridor(corridor.id);
          setAddingCorridor(false);
        }}
      />

      <Dialog
        open={renaming !== null}
        onClose={() => setRenaming(null)}
        aria-labelledby="rename-dialog-title"
        fullWidth
        maxWidth="xs"
        // Focus once shown: a closing menu may hand focus back to its button after autoFocus ran.
        slotProps={{
          transition: {
            onEntered: () => {
              renameInput.current?.focus();
              renameInput.current?.select();
            },
          },
        }}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const target = renaming!;
            const name = target.name.trim();
            if (name) {
              edit(`Rename ${target.kind}`, (p) => {
                const found = target.kind === 'intersection' ? p.intersections.find((i) => i.id === target.id) : p.corridors.find((c) => c.id === target.id);
                if (found) found.name = name;
              });
            }
            setRenaming(null);
          }}
        >
          <DialogTitle id="rename-dialog-title">Rename {renaming?.kind}</DialogTitle>
          <DialogContent>
            <TextField autoFocus inputRef={renameInput} fullWidth label="Name" value={renaming?.name ?? ''} onFocus={(e) => e.target.select()} onChange={(e) => setRenaming((r) => (r ? { ...r, name: e.target.value } : r))} sx={{ mt: 1 }} slotProps={{ htmlInput: { maxLength: 120 } }} />
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
          <Typography variant="body2">
            {deleting?.kind === 'intersection' && project.corridors.some((c) => c.stops.some((s) => s.intersectionId === deleting.id)) ? 'It is also removed from the corridors that include it. ' : ''}
            You can undo this.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleting(null)}>Cancel</Button>
          <Button
            color="error"
            variant="outlined"
            onClick={() => {
              const target = deleting!;
              if (target.kind === 'intersection') {
                edit(`Delete ${target.name}`, (p) => {
                  p.intersections = p.intersections.filter((i) => i.id !== target.id);
                  removeIntersectionFromCorridors(p, target.id);
                });
                selectIntersection(selectedId === target.id ? null : selectedId);
              } else {
                edit(`Delete ${target.name}`, (p) => {
                  p.corridors = p.corridors.filter((c) => c.id !== target.id);
                });
                selectCorridor(null);
              }
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

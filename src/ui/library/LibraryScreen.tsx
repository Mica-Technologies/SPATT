import { useCallback, useEffect, useState } from 'react';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import FileUploadRoundedIcon from '@mui/icons-material/FileUploadRounded';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Container from '@mui/material/Container';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import IconButton from '@mui/material/IconButton';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemText from '@mui/material/ListItemText';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { pickProjectFile } from '../../io/files';
import { recoverJournal } from '../../io/journal';
import { newProjectId, openFromStore, saveToStore, type ProjectSummary } from '../../io/store';
import { emptyProject, loadProject, type Issue } from '../../model';
import AppHeader from '../components/AppHeader';
import { useProjectStore } from '../state/storeContextValue';
import { useWorkspace } from '../state/workspace';

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export default function LibraryScreen({ hostLabel }: { hostLabel: string }) {
  const store = useProjectStore();
  const open = useWorkspace((s) => s.open);
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [problem, setProblem] = useState<{ title: string; issues: Issue[] } | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [deleting, setDeleting] = useState<ProjectSummary | null>(null);

  const refresh = useCallback(() => {
    recoverJournal(store)
      .then(() => store.list())
      .then(setProjects, (cause: unknown) => setProblem({ title: `Could not read the project library: ${String(cause)}`, issues: [] }));
  }, [store]);

  useEffect(refresh, [refresh]);

  const openProject = async (id: string) => {
    const opened = await openFromStore(store, id);
    if (!opened) {
      refresh();
    } else if (opened.result.ok) {
      open(opened.result.project, opened.version);
    } else {
      setProblem({ title: 'This project could not be opened.', issues: opened.result.issues });
    }
  };

  const create = async () => {
    const project = emptyProject(name.trim() || 'Untitled project', newProjectId());
    const version = await saveToStore(store, project, null);
    setCreating(false);
    setName('');
    open(project, version);
  };

  const importFile = async () => {
    const file = await pickProjectFile();
    if (!file) {
      return;
    }
    const result = loadProject(file.text);
    if (!result.ok) {
      setProblem({ title: `${file.name} is not a SPATT project SPATT can open.`, issues: result.issues });
      return;
    }
    // An imported file gets a fresh id, so importing the same file twice never overwrites.
    const project = { ...result.project, id: newProjectId() };
    open(project, await saveToStore(store, project, null));
  };

  const remove = async () => {
    if (deleting) {
      await store.remove(deleting.id);
      setDeleting(null);
      refresh();
    }
  };

  return (
    <Box sx={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', bgcolor: 'background.default' }}>
      <AppHeader title="SPATT" subtitle="Signal Programming and Timing Tool" />
      <Container maxWidth="md" sx={{ py: 5, flexGrow: 1 }}>
        <Stack spacing={3}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ alignItems: { sm: 'flex-end' }, justifyContent: 'space-between' }}>
            <Box>
              <Typography variant="h4" component="h2">
                Projects
              </Typography>
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                Saved automatically {hostLabel}.
              </Typography>
            </Box>
            <Stack direction="row" spacing={1}>
              <Button variant="outlined" startIcon={<FileUploadRoundedIcon />} onClick={() => void importFile()}>
                Import
              </Button>
              <Button variant="contained" startIcon={<AddRoundedIcon />} onClick={() => setCreating(true)}>
                New project
              </Button>
            </Stack>
          </Stack>

          {problem ? (
            <Alert severity="error" onClose={() => setProblem(null)}>
              <Typography variant="body2" sx={{ fontWeight: 500 }}>
                {problem.title}
              </Typography>
              {problem.issues.slice(0, 5).map((issue, index) => (
                <Typography key={index} variant="caption" component="div">
                  {issue.path.length > 0 ? `${issue.path.join('.')}: ` : ''}
                  {issue.message}
                </Typography>
              ))}
            </Alert>
          ) : null}

          <Paper variant="outlined">
            {projects === null ? null : projects.length === 0 ? (
              <Box sx={{ p: 4, textAlign: 'center' }}>
                <Typography variant="body1">No projects yet</Typography>
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                  Create a project, or import a .spatt.json file.
                </Typography>
              </Box>
            ) : (
              <List disablePadding>
                {projects.map((summary) => (
                  <ListItemButton key={summary.id} divider onClick={() => void openProject(summary.id)} sx={{ py: 1.5 }}>
                    <ListItemText
                      primary={summary.name}
                      secondary={`${summary.intersectionCount} intersection${summary.intersectionCount === 1 ? '' : 's'} · edited ${dateFormat.format(new Date(summary.updatedAt))}`}
                    />
                    <Tooltip title="Delete project">
                      <IconButton
                        edge="end"
                        aria-label={`Delete ${summary.name}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          setDeleting(summary);
                        }}
                      >
                        <DeleteOutlineRoundedIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </ListItemButton>
                ))}
              </List>
            )}
          </Paper>
        </Stack>
      </Container>

      <Dialog open={creating} onClose={() => setCreating(false)} fullWidth maxWidth="xs">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void create();
          }}
        >
          <DialogTitle>New project</DialogTitle>
          <DialogContent>
            <TextField autoFocus fullWidth label="Project name" value={name} onChange={(e) => setName(e.target.value)} sx={{ mt: 1 }} />
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setCreating(false)}>Cancel</Button>
            <Button type="submit" variant="contained">
              Create
            </Button>
          </DialogActions>
        </form>
      </Dialog>

      <Dialog open={deleting !== null} onClose={() => setDeleting(null)}>
        <DialogTitle>Delete “{deleting?.name}”?</DialogTitle>
        <DialogContent>
          <Typography variant="body2">The project is removed from the library. Export it first if you want to keep a copy.</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleting(null)}>Cancel</Button>
          <Button color="error" variant="outlined" onClick={() => void remove()}>
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

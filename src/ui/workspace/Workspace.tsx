import { useEffect, useState } from 'react';
import CloudDoneRoundedIcon from '@mui/icons-material/CloudDoneRounded';
import ErrorOutlineRoundedIcon from '@mui/icons-material/ErrorOutlineRounded';
import FileDownloadRoundedIcon from '@mui/icons-material/FileDownloadRounded';
import FolderOpenRoundedIcon from '@mui/icons-material/FolderOpenRounded';
import RedoRoundedIcon from '@mui/icons-material/RedoRounded';
import SyncRoundedIcon from '@mui/icons-material/SyncRounded';
import UndoRoundedIcon from '@mui/icons-material/UndoRounded';
import ViewSidebarRoundedIcon from '@mui/icons-material/ViewSidebarRounded';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import { downloadProject } from '../../io/files';
import AppHeader from '../components/AppHeader';
import { findFieldElement } from '../fields/paths';
import { useAutosave, type SaveStatus } from '../state/useAutosave';
import { useIntersectionIssues } from '../state/useIssues';
import { redoLabel, selectIntersection, undoLabel, useWorkspace, type WorkspaceTab } from '../state/workspace';
import PatternsTab from '../tabs/PatternsTab';
import PhasesTab from '../tabs/PhasesTab';
import RingsTab from '../tabs/RingsTab';
import ScheduleTab from '../tabs/ScheduleTab';
import DiagramPanel from './DiagramPanel';
import ProblemsPanel from './ProblemsPanel';
import Sidebar from './Sidebar';

const TABS: { value: WorkspaceTab; label: string }[] = [
  { value: 'phases', label: 'Phases' },
  { value: 'rings', label: 'Rings & Barriers' },
  { value: 'patterns', label: 'Patterns' },
  { value: 'schedule', label: 'Schedule' },
];

const SAVE_LABEL: Record<SaveStatus, string> = {
  saved: 'Saved',
  pending: 'Unsaved changes',
  saving: 'Saving…',
  error: 'Save failed',
};

function isEditable(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
}

export default function Workspace() {
  const project = useWorkspace((s) => s.project)!;
  const intersection = useWorkspace(selectIntersection);
  const tab = useWorkspace((s) => s.tab);
  const patternId = useWorkspace((s) => s.selectedPatternId);
  const focusRequest = useWorkspace((s) => s.focusRequest);
  const undoText = useWorkspace(undoLabel);
  const redoText = useWorkspace(redoLabel);
  const { undo, redo, setTab, close } = useWorkspace.getState();
  const { status, error } = useAutosave();
  const wide = useMediaQuery('(min-width: 1280px)');
  const [diagramOpen, setDiagramOpen] = useState(true);
  const intersectionIndex = project.intersections.findIndex((i) => i.id === intersection?.id);
  const issues = useIntersectionIssues(intersectionIndex);

  // Ctrl/Cmd+Z and Ctrl+Y / Ctrl+Shift+Z, except while typing in a field (its own undo applies).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || isEditable(event.target)) return;
      const key = event.key.toLowerCase();
      if (key === 'z' && !event.shiftKey) {
        event.preventDefault();
        undo();
      } else if (key === 'y' || (key === 'z' && event.shiftKey)) {
        event.preventDefault();
        redo();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [undo, redo]);

  // Focus the field a problem points at, once its tab has rendered.
  useEffect(() => {
    if (!focusRequest) return;
    const frame = requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const element = findFieldElement(focusRequest.path);
        element?.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
        element?.focus({ preventScroll: true });
      }),
    );
    return () => cancelAnimationFrame(frame);
  }, [focusRequest]);

  const saveIcon = status === 'error' ? <ErrorOutlineRoundedIcon fontSize="small" color="error" /> : status === 'saved' ? <CloudDoneRoundedIcon fontSize="small" /> : <SyncRoundedIcon fontSize="small" />;
  const showDiagram = wide && diagramOpen && intersection !== null;

  return (
    <Box sx={{ height: '100vh', display: 'flex', flexDirection: 'column', bgcolor: 'background.default' }}>
      <AppHeader
        title="SPATT"
        subtitle={project.name}
        actions={
          <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
            <Tooltip title={error ?? SAVE_LABEL[status]}>
              <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', color: status === 'error' ? 'error.main' : 'text.secondary', mr: 1 }} aria-live="polite">
                {saveIcon}
                <Typography variant="caption" sx={{ display: { xs: 'none', md: 'block' } }}>
                  {SAVE_LABEL[status]}
                </Typography>
              </Stack>
            </Tooltip>
            <Tooltip title={undoText ? `Undo ${undoText}` : 'Nothing to undo'}>
              <span>
                <IconButton size="small" aria-label="Undo" disabled={!undoText} onClick={undo}>
                  <UndoRoundedIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title={redoText ? `Redo ${redoText}` : 'Nothing to redo'}>
              <span>
                <IconButton size="small" aria-label="Redo" disabled={!redoText} onClick={redo}>
                  <RedoRoundedIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title="Export .spatt.json">
              <IconButton size="small" aria-label="Export project" onClick={() => downloadProject(project)}>
                <FileDownloadRoundedIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            {wide ? (
              <Tooltip title={diagramOpen ? 'Hide diagram' : 'Show diagram'}>
                <IconButton size="small" aria-label="Toggle diagram" aria-pressed={diagramOpen} onClick={() => setDiagramOpen(!diagramOpen)}>
                  <ViewSidebarRoundedIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            ) : null}
            <Tooltip title="All projects">
              <IconButton size="small" aria-label="All projects" onClick={close}>
                <FolderOpenRoundedIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Stack>
        }
      />
      <Box sx={{ flexGrow: 1, minHeight: 0, display: 'grid', gridTemplateColumns: showDiagram ? '240px minmax(0, 1fr) 380px' : '240px minmax(0, 1fr)' }}>
        <Sidebar />
        <Box component="main" sx={{ display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 }}>
          {intersection ? (
            <>
              <Box sx={{ px: 2, pt: 1.5, borderBottom: 1, borderColor: 'divider', bgcolor: 'background.paper' }}>
                <Typography variant="h6" component="h2" noWrap>
                  {intersection.name}
                </Typography>
                <Tabs value={tab} onChange={(_, value: WorkspaceTab) => setTab(value)} sx={{ minHeight: 40 }}>
                  {TABS.map((t) => (
                    <Tab key={t.value} value={t.value} label={t.label} sx={{ minHeight: 40 }} />
                  ))}
                </Tabs>
              </Box>
              <Box sx={{ flexGrow: 1, overflow: 'auto', minHeight: 0 }}>
                {tab === 'phases' ? <PhasesTab intersection={intersection} intersectionIndex={intersectionIndex} issues={issues} /> : null}
                {tab === 'rings' ? <RingsTab intersection={intersection} intersectionIndex={intersectionIndex} issues={issues} /> : null}
                {tab === 'patterns' ? <PatternsTab intersection={intersection} intersectionIndex={intersectionIndex} issues={issues} /> : null}
                {tab === 'schedule' ? <ScheduleTab intersection={intersection} intersectionIndex={intersectionIndex} issues={issues} /> : null}
              </Box>
            </>
          ) : (
            <Box sx={{ flexGrow: 1, display: 'grid', placeItems: 'center', p: 4 }}>
              <Typography variant="body1" sx={{ color: 'text.secondary' }}>
                Add an intersection to start timing.
              </Typography>
            </Box>
          )}
          <ProblemsPanel />
        </Box>
        {showDiagram ? <DiagramPanel intersection={intersection} patternId={patternId} /> : null}
      </Box>
    </Box>
  );
}

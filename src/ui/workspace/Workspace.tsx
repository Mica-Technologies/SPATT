import { useEffect, useMemo, useState, type MouseEvent } from 'react';
import CloudDoneRoundedIcon from '@mui/icons-material/CloudDoneRounded';
import ErrorOutlineRoundedIcon from '@mui/icons-material/ErrorOutlineRounded';
import FileDownloadRoundedIcon from '@mui/icons-material/FileDownloadRounded';
import GridViewRoundedIcon from '@mui/icons-material/GridViewRounded';
import KeyboardRoundedIcon from '@mui/icons-material/KeyboardRounded';
import MenuRoundedIcon from '@mui/icons-material/MenuRounded';
import PrintRoundedIcon from '@mui/icons-material/PrintRounded';
import SyncRoundedIcon from '@mui/icons-material/SyncRounded';
import TuneRoundedIcon from '@mui/icons-material/TuneRounded';
import ViewSidebarRoundedIcon from '@mui/icons-material/ViewSidebarRounded';
import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import Badge from '@mui/material/Badge';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Drawer from '@mui/material/Drawer';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { useTheme } from '@mui/material/styles';
import useMediaQuery from '@mui/material/useMediaQuery';
import { downloadProject } from '../../io/files';
import AppHeader from '../components/AppHeader';
import CorridorEditor from '../corridor/CorridorEditor';
import ClearanceDialog from '../dialogs/ClearanceDialog';
import ProjectSettingsDialog from '../dialogs/ProjectSettingsDialog';
import SheetScreen from '../sheet/SheetScreen';
import { findFieldElement } from '../fields/paths';
import { isEditable } from '../fields/keys';
import { useAutosave, type ConflictChoice, type SaveStatus } from '../state/useAutosave';
import { useIntersectionIssues } from '../state/useIssues';
import { redoLabel, selectCorridor, selectIntersection, undoLabel, useWorkspace, type CorridorTab, type WorkspaceTab } from '../state/workspace';
import PatternsTab from '../tabs/PatternsTab';
import PhasesTab from '../tabs/PhasesTab';
import RingsTab from '../tabs/RingsTab';
import ScheduleTab from '../tabs/ScheduleTab';
import SimulateTab from '../tabs/SimulateTab';
import VolumesTab from '../tabs/VolumesTab';
import DiagramPanel from './DiagramPanel';
import EmptyProject from './EmptyProject';
import { TAB_FOR_SECTION } from './navigation';
import ProblemsPanel from './ProblemsPanel';
import ShortcutsDialog from './ShortcutsDialog';
import Sidebar from './Sidebar';
import WorkspaceActions, { type HeaderCommand, type HeaderDensity } from './WorkspaceActions';

const TABS: { value: WorkspaceTab; label: string }[] = [
  { value: 'phases', label: 'Phases' },
  { value: 'rings', label: 'Rings & Barriers' },
  { value: 'patterns', label: 'Patterns' },
  { value: 'schedule', label: 'Schedule' },
  { value: 'volumes', label: 'Volumes' },
  { value: 'simulate', label: 'Simulate' },
];

const CORRIDOR_TABS: CorridorTab[] = ['layout', 'plans', 'progression'];

const SAVE_LABEL: Record<SaveStatus, string> = {
  saved: 'Saved',
  pending: 'Unsaved changes',
  saving: 'Saving…',
  error: 'Save failed',
  conflict: 'Changed elsewhere',
};

const SIDEBAR_WIDTH = 240;
const MAIN_ID = 'workspace-main';

export default function Workspace() {
  const project = useWorkspace((s) => s.project)!;
  const intersection = useWorkspace(selectIntersection);
  const corridor = useWorkspace(selectCorridor);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const tab = useWorkspace((s) => s.tab);
  const patternId = useWorkspace((s) => s.selectedPatternId);
  const focusRequest = useWorkspace((s) => s.focusRequest);
  const view = useWorkspace((s) => s.view);
  const selectedPlanId = useWorkspace((s) => s.selectedPlanId);
  const undoText = useWorkspace(undoLabel);
  const redoText = useWorkspace(redoLabel);
  const { undo, redo, setTab, setView, close } = useWorkspace.getState();
  const { status, error, conflict, resolveConflict } = useAutosave();
  const [resolving, setResolving] = useState(false);
  const settle = (choice: ConflictChoice) => {
    setResolving(true);
    void resolveConflict(choice).finally(() => setResolving(false));
  };
  const theme = useTheme();
  const wide = useMediaQuery('(min-width: 1280px)', { noSsr: true });
  const desktop = useMediaQuery(theme.breakpoints.up('md'), { noSsr: true });
  const phone = !useMediaQuery(theme.breakpoints.up('sm'), { noSsr: true });
  const density: HeaderDensity = wide ? 'labels' : phone ? 'menu' : 'icons';
  const [diagramOpen, setDiagramOpen] = useState(true);
  const [navOpen, setNavOpen] = useState(false);
  const intersectionIndex = project.intersections.findIndex((i) => i.id === intersection?.id);
  const issues = useIntersectionIssues(intersectionIndex);
  const [clearancePhase, setClearancePhase] = useState<number | null>(null);

  // On narrow screens the navigation is a drawer: close it once something is chosen.
  const selectedKey = `${intersection?.id}/${corridor?.id}`;
  const [lastSelected, setLastSelected] = useState(selectedKey);
  if (selectedKey !== lastSelected) {
    setLastSelected(selectedKey);
    setNavOpen(false);
  }

  // Keyboard shortcuts (see ShortcutsDialog). None of them fire while typing in a field, whose own keys apply.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const state = useWorkspace.getState();
      if (state.view !== 'editor' || isEditable(event.target) || event.defaultPrevented) return;
      const key = event.key.toLowerCase();
      if (event.ctrlKey || event.metaKey) {
        if (event.altKey) return;
        if (key === 'z' && !event.shiftKey) {
          event.preventDefault();
          undo();
        } else if (key === 'y' || (key === 'z' && event.shiftKey)) {
          event.preventDefault();
          redo();
        }
        return;
      }
      if (event.altKey && /^Digit[1-9]$/.test(event.code)) {
        const k = Number(event.code.slice(5)) - 1;
        if (state.selectedCorridorId !== null) {
          const target = CORRIDOR_TABS[k];
          if (target) {
            event.preventDefault();
            state.setCorridorTab(target);
          }
        } else if (state.selectedIntersectionId !== null && TABS[k]) {
          event.preventDefault();
          state.setTab(TABS[k].value);
        }
        return;
      }
      // A dialog or menu has focus: leave its keys alone.
      if (event.target instanceof Element && event.target.closest('[role="dialog"], [role="menu"]')) return;
      if (event.key === '?') {
        event.preventDefault();
        setShortcutsOpen(true);
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

  // Errors and warnings per tab, for the counts on the tab labels.
  const tabCounts = useMemo(() => {
    const counts = new Map<WorkspaceTab, { errors: number; warnings: number }>();
    for (const issue of issues) {
      const target = TAB_FOR_SECTION[String(issue.path[2])];
      if (!target) continue;
      const count = counts.get(target) ?? { errors: 0, warnings: 0 };
      if (issue.severity === 'error') count.errors++;
      else count.warnings++;
      counts.set(target, count);
    }
    return counts;
  }, [issues]);

  const saveIcon = status === 'error' || status === 'conflict' ? <ErrorOutlineRoundedIcon fontSize="small" color="error" /> : status === 'saved' ? <CloudDoneRoundedIcon fontSize="small" /> : <SyncRoundedIcon fontSize="small" />;
  const diagramAvailable = wide && intersection !== null && corridor === null;
  const showDiagram = diagramAvailable && diagramOpen;

  if (view === 'sheet') {
    return <SheetScreen project={project} selectedIntersectionId={intersection?.id ?? null} corridor={corridor} selectedPlanId={selectedPlanId} onBack={() => setView('editor')} />;
  }

  const sheetName = corridor ? 'Time-space sheet' : 'Timing sheet';
  const commands: HeaderCommand[] = [
    { name: sheetName, label: corridor ? 'Sheet' : 'Timing sheet', icon: <PrintRoundedIcon fontSize="small" />, disabled: corridor ? corridor.plans.length === 0 : project.intersections.length === 0, onClick: () => setView('sheet'), group: true },
    { name: 'Export project', label: 'Export', icon: <FileDownloadRoundedIcon fontSize="small" />, onClick: () => downloadProject(project) },
    ...(diagramAvailable ? [{ name: 'Diagram', icon: <ViewSidebarRoundedIcon fontSize="small" />, pressed: diagramOpen, onClick: () => setDiagramOpen(!diagramOpen) }] : []),
    { name: 'Project settings', label: 'Settings', icon: <TuneRoundedIcon fontSize="small" />, onClick: () => setSettingsOpen(true), group: true },
    ...(density === 'menu' ? [{ name: 'Keyboard shortcuts', icon: <KeyboardRoundedIcon fontSize="small" />, onClick: () => setShortcutsOpen(true) }] : []),
    { name: 'All projects', icon: <GridViewRoundedIcon fontSize="small" />, onClick: close },
  ];

  const sidebar = <Sidebar />;
  const columns = [desktop ? `${SIDEBAR_WIDTH}px` : null, 'minmax(0, 1fr)', showDiagram ? '380px' : null].filter(Boolean).join(' ');

  return (
    <Box sx={{ height: '100dvh', display: 'flex', flexDirection: 'column', bgcolor: 'background.default' }}>
      <Box
        component="a"
        href={`#${MAIN_ID}`}
        onClick={(event: MouseEvent) => {
          event.preventDefault();
          document.getElementById(MAIN_ID)?.focus();
        }}
        sx={{
          position: 'absolute',
          left: 8,
          top: 8,
          zIndex: (t) => t.zIndex.tooltip + 1,
          px: 2,
          py: 1,
          borderRadius: 1,
          bgcolor: 'background.paper',
          color: 'primary.main',
          border: 2,
          borderColor: 'primary.main',
          fontWeight: 600,
          transform: 'translateY(-200%)',
          '&:focus': { transform: 'none' },
        }}
      >
        Skip to editor
      </Box>
      <AppHeader
        title="SPATT"
        subtitle={project.name}
        start={
          desktop ? null : (
            <Tooltip title="Intersections and corridors">
              <IconButton size="small" aria-label="Intersections and corridors" aria-expanded={navOpen} aria-controls="workspace-navigation" onClick={() => setNavOpen(true)}>
                <MenuRoundedIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )
        }
        actions={
          <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
            <Tooltip title={error ?? SAVE_LABEL[status]}>
              <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', color: status === 'error' || status === 'conflict' ? 'error.main' : 'text.secondary', mr: { xs: 0.5, sm: 1 } }} aria-live="polite">
                {saveIcon}
                <Typography variant="caption" sx={{ display: { xs: 'none', md: 'block' }, whiteSpace: 'nowrap' }}>
                  {SAVE_LABEL[status]}
                </Typography>
              </Stack>
            </Tooltip>
            <WorkspaceActions density={density} undoText={undoText} redoText={redoText} onUndo={undo} onRedo={redo} commands={commands} />
            {density === 'menu' ? null : (
              <Tooltip title="Keyboard shortcuts (?)">
                <IconButton size="small" aria-label="Keyboard shortcuts" onClick={() => setShortcutsOpen(true)}>
                  <KeyboardRoundedIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            )}
          </Stack>
        }
      />
      {conflict ? (
        <Alert
          severity="warning"
          square
          sx={{ borderBottom: 1, borderColor: 'divider', alignItems: 'center', flexWrap: 'wrap' }}
          action={
            <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
              <Button size="small" color="inherit" disabled={conflict.current === null || resolving} onClick={() => settle('theirs')}>
                Load their version
              </Button>
              <Button size="small" color="inherit" disabled={resolving} onClick={() => settle('mine')}>
                Keep mine
              </Button>
              <Button size="small" color="inherit" disabled={resolving} onClick={() => settle('copy')}>
                Save mine as a copy
              </Button>
            </Stack>
          }
        >
          <AlertTitle sx={{ mb: 0 }}>{conflict.current === null ? 'This project was deleted elsewhere' : 'This project was changed elsewhere'}</AlertTitle>
          Saving is paused. Loading their version discards your unsaved edits; keeping yours replaces theirs.
        </Alert>
      ) : null}
      <Box sx={{ flexGrow: 1, minHeight: 0, display: 'grid', gridTemplateColumns: columns }}>
        {desktop ? (
          sidebar
        ) : (
          <Drawer
            open={navOpen}
            onClose={() => setNavOpen(false)}
            ModalProps={{ keepMounted: true }}
            slotProps={{ paper: { id: 'workspace-navigation', sx: { width: SIDEBAR_WIDTH + 40, maxWidth: '85vw', '& > nav': { flexGrow: 1, borderRight: 0 } } } }}
          >
            {sidebar}
          </Drawer>
        )}
        <Box component="main" id={MAIN_ID} tabIndex={-1} sx={{ display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0, outline: 'none' }}>
          {corridor ? (
            <CorridorEditor project={project} corridor={corridor} />
          ) : intersection ? (
            <>
              <Box sx={{ px: { xs: 1, sm: 2 }, pt: 1.5, borderBottom: 1, borderColor: 'divider', bgcolor: 'background.paper' }}>
                <Typography variant="h6" component="h2" noWrap sx={{ px: { xs: 1, sm: 0 } }}>
                  {intersection.name}
                </Typography>
                <Tabs value={tab} onChange={(_, value: WorkspaceTab) => setTab(value)} variant="scrollable" scrollButtons="auto" allowScrollButtonsMobile sx={{ minHeight: 40 }}>
                  {TABS.map((t) => {
                    const count = tabCounts.get(t.value);
                    const problems = count ? count.errors + count.warnings : 0;
                    return (
                      <Tab
                        key={t.value}
                        value={t.value}
                        sx={{ minHeight: 40 }}
                        aria-label={problems > 0 ? `${t.label}, ${count!.errors > 0 ? `${count!.errors} error${count!.errors === 1 ? '' : 's'}` : `${count!.warnings} warning${count!.warnings === 1 ? '' : 's'}`}` : undefined}
                        label={
                          problems > 0 ? (
                            <Badge
                              badgeContent={count!.errors > 0 ? count!.errors : count!.warnings}
                              color={count!.errors > 0 ? 'error' : 'warning'}
                              sx={{ '& .MuiBadge-badge': { position: 'static', transform: 'none', ml: 0.75, height: 18, minWidth: 18, fontSize: 11 } }}
                            >
                              {t.label}
                            </Badge>
                          ) : (
                            t.label
                          )
                        }
                      />
                    );
                  })}
                </Tabs>
              </Box>
              <Box sx={{ flexGrow: 1, overflowY: 'auto', overflowX: 'hidden', minHeight: 0, position: 'relative' }}>
                {tab === 'phases' ? (
                  <PhasesTab
                    intersection={intersection}
                    intersectionIndex={intersectionIndex}
                    issues={issues}
                    phaseActions={[{ label: 'Calculate clearances…', onSelect: (phase) => setClearancePhase(phase.number) }]}
                  />
                ) : null}
                {tab === 'rings' ? <RingsTab intersection={intersection} intersectionIndex={intersectionIndex} issues={issues} /> : null}
                {tab === 'patterns' ? <PatternsTab intersection={intersection} intersectionIndex={intersectionIndex} issues={issues} /> : null}
                {tab === 'schedule' ? <ScheduleTab intersection={intersection} intersectionIndex={intersectionIndex} issues={issues} /> : null}
                {tab === 'volumes' ? <VolumesTab intersection={intersection} intersectionIndex={intersectionIndex} issues={issues} /> : null}
                {tab === 'simulate' ? <SimulateTab key={intersection.id} intersection={intersection} intersectionIndex={intersectionIndex} issues={issues} /> : null}
              </Box>
            </>
          ) : (
            <EmptyProject />
          )}
          <ProblemsPanel />
        </Box>
        {showDiagram ? <DiagramPanel intersection={intersection} patternId={patternId} /> : null}
      </Box>
      <ProjectSettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} project={project} />
      <ShortcutsDialog open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
      <ClearanceDialog
        open={clearancePhase !== null}
        onClose={() => setClearancePhase(null)}
        intersectionIndex={intersectionIndex}
        phase={intersection?.phases.find((p) => p.number === clearancePhase) ?? null}
        units={project.units}
      />
    </Box>
  );
}

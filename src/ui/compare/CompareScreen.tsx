/**
 * Plan compare: side A is a pattern of an intersection in the open project; side B is another
 * pattern of this project, or an intersection's pattern in another project from the library
 * (read through the ProjectStore, never written). Printable like the timing sheet.
 */
import { useEffect, useMemo, useState } from 'react';
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded';
import PrintRoundedIcon from '@mui/icons-material/PrintRounded';
import SwapVertRoundedIcon from '@mui/icons-material/SwapVertRounded';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import FormControlLabel from '@mui/material/FormControlLabel';
import GlobalStyles from '@mui/material/GlobalStyles';
import IconButton from '@mui/material/IconButton';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { matchIntersectionByName } from '../../engine';
import { openFromStore, type ProjectSummary } from '../../io/store';
import type { Intersection, Project } from '../../model';
import AppHeader from '../components/AppHeader';
import { useProjectStore } from '../state/storeContextValue';
import CompareReport, { type NamedSide } from './CompareReport';

interface CompareScreenProps {
  project: Project;
  intersectionId: string | null;
  patternId: string | null;
  onBack: () => void;
}

type Source = 'project' | 'library';

interface Choice {
  intersectionId: string;
  patternId: string;
}

/** A pattern other than `avoid` when there is one. */
function otherPattern(intersection: Intersection | undefined, avoid: string | null): string {
  return intersection?.patterns.find((p) => p.id !== avoid)?.id ?? intersection?.patterns[0]?.id ?? '';
}

const select = { minWidth: 0, flex: '1 1 150px' } as const;

function PatternSelect({ label, intersection, value, onChange }: { label: string; intersection: Intersection | undefined; value: string; onChange: (id: string) => void }) {
  return (
    <TextField select size="small" label={label} value={intersection?.patterns.some((p) => p.id === value) ? value : ''} onChange={(e) => onChange(e.target.value)} disabled={!intersection || intersection.patterns.length === 0} sx={select}>
      {(intersection?.patterns ?? []).map((p) => (
        <MenuItem key={p.id} value={p.id}>
          {p.name || 'Untitled pattern'}
          {p.mode === 'free' ? ' (free)' : ''}
        </MenuItem>
      ))}
    </TextField>
  );
}

function IntersectionSelect({ label, intersections, value, onChange }: { label: string; intersections: readonly Intersection[]; value: string; onChange: (id: string) => void }) {
  return (
    <TextField select size="small" label={label} value={intersections.some((i) => i.id === value) ? value : ''} onChange={(e) => onChange(e.target.value)} sx={select}>
      {intersections.map((i) => (
        <MenuItem key={i.id} value={i.id}>
          {i.name}
        </MenuItem>
      ))}
    </TextField>
  );
}

export default function CompareScreen({ project, intersectionId, patternId, onBack }: CompareScreenProps) {
  const store = useProjectStore();
  const firstWithPatterns = project.intersections.find((i) => i.id === intersectionId && i.patterns.length > 0) ?? project.intersections.find((i) => i.patterns.length > 0) ?? project.intersections[0];
  const [a, setA] = useState<Choice>(() => ({
    intersectionId: firstWithPatterns?.id ?? '',
    patternId: firstWithPatterns?.patterns.some((p) => p.id === patternId) ? patternId! : (firstWithPatterns?.patterns[0]?.id ?? ''),
  }));
  const intersectionA = project.intersections.find((i) => i.id === a.intersectionId);
  const [source, setSource] = useState<Source>(() => ((firstWithPatterns?.patterns.length ?? 0) > 1 ? 'project' : 'library'));
  const [b, setB] = useState<Choice>(() => ({ intersectionId: a.intersectionId, patternId: otherPattern(intersectionA, a.patternId) }));

  // Other projects in the library, and the one picked for side B.
  const [library, setLibrary] = useState<ProjectSummary[] | null>(null);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [otherId, setOtherId] = useState('');
  const [other, setOther] = useState<{ id: string; project: Project | null; error: string | null } | null>(null);
  const [onlyDifferences, setOnlyDifferences] = useState(false);
  const [printing, setPrinting] = useState(false);

  useEffect(() => {
    if (source !== 'library' || library !== null) return;
    let live = true;
    store
      .list()
      .then((list) => live && setLibrary(list.filter((p) => p.id !== project.id)))
      .catch((error: unknown) => live && setLibraryError(error instanceof Error ? error.message : String(error)));
    return () => {
      live = false;
    };
  }, [source, library, store, project.id]);

  const pickOther = (id: string) => {
    setOtherId(id);
    setOther(null);
    void openFromStore(store, id)
      .then((opened) => {
        if (!opened) return setOther({ id, project: null, error: 'That project no longer exists.' });
        if (!opened.result.ok) return setOther({ id, project: null, error: 'That project could not be read.' });
        const loaded = opened.result.project;
        setOther({ id, project: loaded, error: null });
        // The same-named intersection, or the first one with patterns.
        const match = matchIntersectionByName(intersectionA?.name ?? '', loaded.intersections) ?? loaded.intersections.find((i) => i.patterns.length > 0) ?? loaded.intersections[0];
        const samePattern = match?.patterns.find((p) => p.name.trim().toLowerCase() === intersectionA?.patterns.find((q) => q.id === a.patternId)?.name.trim().toLowerCase());
        setB({ intersectionId: match?.id ?? '', patternId: samePattern?.id ?? match?.patterns[0]?.id ?? '' });
      })
      .catch((error: unknown) => setOther({ id, project: null, error: error instanceof Error ? error.message : String(error) }));
  };

  const projectB = source === 'project' ? project : other?.id === otherId ? other.project : null;
  const intersectionB = projectB?.intersections.find((i) => i.id === b.intersectionId);
  const nameMatched = source === 'library' && intersectionB && intersectionA ? matchIntersectionByName(intersectionA.name, [intersectionB]) !== null : true;

  const sideA: NamedSide | null = useMemo(() => {
    if (!intersectionA || !intersectionA.patterns.some((p) => p.id === a.patternId)) return null;
    return { intersection: intersectionA, patternId: a.patternId, title: intersectionA.patterns.find((p) => p.id === a.patternId)!.name || 'Untitled pattern' };
  }, [intersectionA, a.patternId]);
  const sideB: NamedSide | null = useMemo(() => {
    if (!intersectionB || !intersectionB.patterns.some((p) => p.id === b.patternId) || !projectB) return null;
    const name = intersectionB.patterns.find((p) => p.id === b.patternId)!.name || 'Untitled pattern';
    const where = projectB !== project ? `${projectB.name} · ` : intersectionB !== intersectionA ? `${intersectionB.name} · ` : '';
    return { intersection: intersectionB, patternId: b.patternId, title: `${where}${name}` };
  }, [intersectionB, b.patternId, projectB, project, intersectionA]);

  // Print in light colours with static diagrams, as the timing sheet does.
  useEffect(() => {
    const before = () => setPrinting(true);
    const after = () => setPrinting(false);
    window.addEventListener('beforeprint', before);
    window.addEventListener('afterprint', after);
    return () => {
      window.removeEventListener('beforeprint', before);
      window.removeEventListener('afterprint', after);
    };
  }, []);

  const swap = () => {
    if (source !== 'project') return;
    setA(b);
    setB(a);
  };

  const subtitle = `${project.name} · Compare plans`;
  return (
    // On phones the whole screen scrolls, so the choices do not take half of it for good.
    <Box className="compare-screen" sx={{ height: '100dvh', display: 'flex', flexDirection: 'column', bgcolor: 'background.default', overflowY: { xs: 'auto', md: 'hidden' } }}>
      <GlobalStyles
        styles={{
          '@media print': {
            html: { colorScheme: 'light !important' },
            'html, body': { background: '#fff !important' },
            '.compare-toolbar': { display: 'none !important' },
            '.compare-screen': { height: 'auto !important', display: 'block !important', overflow: 'visible !important' },
            '.compare-body': { overflow: 'visible !important', padding: '0 !important' },
            '.compare-scroll, .compare-scroll > div': { overflow: 'visible !important' },
            // Keep the change highlights, which browsers otherwise drop as backgrounds.
            '.compare-body *': { printColorAdjust: 'exact', WebkitPrintColorAdjust: 'exact' },
          },
        }}
      />
      <Box className="compare-toolbar">
        <AppHeader
          title="SPATT"
          subtitle={subtitle}
          actions={
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              <Button size="small" startIcon={<ArrowBackRoundedIcon />} onClick={onBack} aria-label="Back to editor">
                <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>
                  Back to editor
                </Box>
                <Box component="span" sx={{ display: { xs: 'inline', sm: 'none' } }}>
                  Back
                </Box>
              </Button>
              <Button size="small" variant="contained" startIcon={<PrintRoundedIcon />} disabled={!sideA || !sideB} onClick={() => window.print()}>
                Print
              </Button>
            </Stack>
          }
        />
        <Box component="form" aria-label="Plans to compare" onSubmit={(e) => e.preventDefault()} sx={{ px: { xs: 1.5, sm: 2 }, py: 1.5, borderBottom: 1, borderColor: 'divider', bgcolor: 'background.paper', display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} useFlexGap sx={{ alignItems: { md: 'center' } }}>
            <Typography variant="subtitle2" component="h2" sx={{ flex: '0 0 auto', width: { md: 24 } }}>
              A
            </Typography>
            <Stack direction="row" spacing={1.5} useFlexGap sx={{ flexWrap: 'wrap', flexGrow: 1 }}>
              <IntersectionSelect
                label="Intersection A"
                intersections={project.intersections}
                value={a.intersectionId}
                onChange={(id) => {
                  const next = project.intersections.find((i) => i.id === id);
                  setA({ intersectionId: id, patternId: next?.patterns[0]?.id ?? '' });
                  if (source === 'project') setB({ intersectionId: id, patternId: otherPattern(next, next?.patterns[0]?.id ?? null) });
                }}
              />
              <PatternSelect label="Pattern A" intersection={intersectionA} value={a.patternId} onChange={(id) => setA({ ...a, patternId: id })} />
            </Stack>
            <Tooltip title="Swap A and B">
              <span>
                <IconButton size="small" aria-label="Swap A and B" onClick={swap} disabled={source !== 'project'}>
                  <SwapVertRoundedIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
          </Stack>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} useFlexGap sx={{ alignItems: { md: 'center' } }}>
            <Typography variant="subtitle2" component="h2" sx={{ flex: '0 0 auto', width: { md: 24 } }}>
              B
            </Typography>
            <Stack direction="row" spacing={1.5} useFlexGap sx={{ flexWrap: 'wrap', flexGrow: 1, alignItems: 'center' }}>
              <ToggleButtonGroup
                size="small"
                exclusive
                value={source}
                onChange={(_, next: Source | null) => {
                  if (!next) return;
                  setSource(next);
                  if (next === 'project') setB({ intersectionId: a.intersectionId, patternId: otherPattern(intersectionA, a.patternId) });
                  else if (other?.project) pickOther(other.id);
                }}
                aria-label="Compare with"
              >
                <ToggleButton value="project">This project</ToggleButton>
                <ToggleButton value="library">Another project</ToggleButton>
              </ToggleButtonGroup>
              {source === 'library' ? (
                <TextField select size="small" label="Project B" value={otherId} onChange={(e) => pickOther(e.target.value)} disabled={!library || library.length === 0} sx={select}>
                  {(library ?? []).map((p) => (
                    <MenuItem key={p.id} value={p.id}>
                      {p.name}
                    </MenuItem>
                  ))}
                </TextField>
              ) : null}
              {projectB ? (
                <>
                  <IntersectionSelect
                    label="Intersection B"
                    intersections={projectB.intersections}
                    value={b.intersectionId}
                    onChange={(id) => {
                      const next = projectB.intersections.find((i) => i.id === id);
                      setB({ intersectionId: id, patternId: next?.patterns[0]?.id ?? '' });
                    }}
                  />
                  <PatternSelect label="Pattern B" intersection={intersectionB} value={b.patternId} onChange={(id) => setB({ ...b, patternId: id })} />
                </>
              ) : null}
            </Stack>
            <Box sx={{ width: 34, display: { xs: 'none', md: 'block' } }} />
          </Stack>
          <FormControlLabel control={<Switch size="small" checked={onlyDifferences} onChange={(e) => setOnlyDifferences(e.target.checked)} />} label="Only differences" sx={{ alignSelf: 'flex-start', ml: 0 }} />
        </Box>
      </Box>

      <Box className="compare-body" sx={{ flexGrow: 1, minHeight: { md: 0 }, overflowY: { md: 'auto' }, p: { xs: 1.5, sm: 2 } }}>
        <Box data-mui-color-scheme={printing ? 'light' : undefined} sx={{ maxWidth: 1100, mx: 'auto', display: 'flex', flexDirection: 'column', gap: 2, color: 'text.primary' }}>
          <Box sx={{ display: 'none', '@media print': { display: 'block' } }}>
            <Typography variant="overline" sx={{ display: 'block', color: 'text.secondary' }}>
              Plan comparison · {project.name}
            </Typography>
            <Typography variant="h5" component="h2" sx={{ fontWeight: 600 }}>
              {intersectionA?.name ?? ''}
            </Typography>
            <Typography variant="body2">
              A: {sideA?.title ?? '—'} · B: {sideB?.title ?? '—'}
            </Typography>
          </Box>
          {source === 'library' && libraryError ? <Alert severity="error">The project library could not be read: {libraryError}</Alert> : null}
          {source === 'library' && library !== null && library.length === 0 ? <Alert severity="info">There are no other projects in the library to compare with.</Alert> : null}
          {source === 'library' && other?.error ? <Alert severity="error">{other.error}</Alert> : null}
          {source === 'library' && projectB && !nameMatched ? (
            <Alert severity="warning" variant="outlined">
              {projectB.name} has no intersection named “{intersectionA?.name}”. Comparing with {intersectionB?.name}; phases are matched by number.
            </Alert>
          ) : null}
          {!sideA ? (
            <Typography variant="body1" sx={{ color: 'text.secondary', mt: 4, textAlign: 'center' }}>
              Add a pattern to an intersection to compare plans.
            </Typography>
          ) : !sideB ? (
            <Typography variant="body1" sx={{ color: 'text.secondary', mt: 4, textAlign: 'center' }}>
              {source === 'library' ? 'Choose a project and a pattern for B.' : 'Choose a pattern for B.'}
            </Typography>
          ) : (
            <CompareReport a={sideA} b={sideB} onlyDifferences={onlyDifferences} print={printing} />
          )}
        </Box>
      </Box>
    </Box>
  );
}

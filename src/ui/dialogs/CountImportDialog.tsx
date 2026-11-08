/**
 * Import a turning-movement count from CSV: read the intervals, find the peak hour and its PHF,
 * and map each counted movement to a lane group (an existing one, or a new one for a phase)
 * before adding the count to the intersection as one undoable step.
 */
import { useMemo, useState } from 'react';
import FileUploadRoundedIcon from '@mui/icons-material/FileUploadRounded';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme } from '@mui/material/styles';
import { pickTextFile } from '../../io/files';
import { applyCount, findPeakHour, formatMinute, movementLabel, parseTurningMovementCsv, suggestTargets, type CountTarget, type MovementKey } from '../../io/import/tmc';
import { DEFAULT_PEAK_HOUR_FACTOR, randomId, uniqueName, type Intersection } from '../../model';
import ScrollArea from '../components/ScrollArea';
import { useWorkspace } from '../state/workspace';
import { cellSx, headSx, numberCellSx } from '../tabs/volumes/tableStyles';
import { fontFamilyMono } from '../theme/themePrimitives';

interface CountImportDialogProps {
  open: boolean;
  onClose: () => void;
  intersection: Intersection | null;
}

type Period = 'all' | 'am' | 'pm';
const PERIODS: Record<Period, { label: string; from: number; to: number }> = {
  all: { label: 'Busiest hour of the count', from: 0, to: 1440 },
  am: { label: 'Morning (starting before noon)', from: 0, to: 720 },
  pm: { label: 'Afternoon and evening (from noon)', from: 720, to: 1440 },
};
const LAYOUT_LABEL = { wide: 'one column per movement', 'two-row': 'approaches over movements', long: 'one row per movement' } as const;

const targetValue = (t: CountTarget) => (t.kind === 'group' ? `group:${t.laneGroupId}` : t.kind === 'phase' ? `phase:${t.phase}` : 'skip');
function targetFrom(value: string): CountTarget {
  const [kind, id] = value.split(/:(.*)/s);
  if (kind === 'group') return { kind: 'group', laneGroupId: id! };
  if (kind === 'phase') return { kind: 'phase', phase: Number(id) };
  return { kind: 'skip' };
}

const MAX_COUNTS = 32;

export default function CountImportDialog({ open, onClose, intersection }: CountImportDialogProps) {
  const theme = useTheme();
  const phone = useMediaQuery(theme.breakpoints.down('sm'), { noSsr: true });
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [period, setPeriod] = useState<Period>('all');
  const [name, setName] = useState<string | null>(null);
  const [phfText, setPhfText] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<Partial<Record<MovementKey, CountTarget>>>({});

  const parsed = useMemo(() => (text.trim() ? parseTurningMovementCsv(text) : null), [text]);
  const counts = parsed?.ok ? parsed : null;
  const peak = useMemo(() => (counts ? findPeakHour(counts, PERIODS[period].from, PERIODS[period].to) : null), [counts, period]);
  const suggested = useMemo(() => (counts && intersection ? suggestTargets(intersection, counts.movements) : null), [counts, intersection]);
  const targets = suggested ? ({ ...suggested, ...overrides } as Record<MovementKey, CountTarget>) : null;

  const defaultName = peak ? `${peak.start < 720 ? 'AM' : 'PM'} peak ${formatMinute(peak.start)}` : 'Count';
  const shownName = name ?? defaultName;
  const computedPhf = peak?.phf ?? DEFAULT_PEAK_HOUR_FACTOR;
  const shownPhf = phfText ?? computedPhf.toFixed(2);
  const phf = Number(shownPhf);
  const phfValid = Number.isFinite(phf) && phf >= 0.5 && phf <= 1;
  const full = (intersection?.volumeSets.length ?? 0) >= MAX_COUNTS;
  const mapped = targets ? Object.values(targets).filter((t) => t.kind !== 'skip').length : 0;

  const reset = () => {
    setText('');
    setFileName(null);
    setPeriod('all');
    setName(null);
    setPhfText(null);
    setOverrides({});
  };
  const close = () => {
    reset();
    onClose();
  };

  const load = (next: string, file: string | null) => {
    setText(next);
    setFileName(file);
    setName(null);
    setPhfText(null);
    setOverrides({});
  };

  const apply = () => {
    if (!intersection || !peak || !targets) return;
    const label = uniqueName(shownName.trim() || defaultName, intersection.volumeSets.map((s) => s.name));
    useWorkspace.getState().edit(`Import count ${label}`, (project) => {
      const target = project.intersections.find((i) => i.id === intersection.id);
      if (target) applyCount(target, { name: label, peakHourFactor: phf, volumes: peak.volumes, targets }, randomId);
    });
    useWorkspace.getState().selectIntersection(intersection.id);
    useWorkspace.getState().setTab('volumes');
    close();
  };

  const covered = new Set(intersection?.laneGroups.map((g) => g.phase) ?? []);
  const newGroupPhases = intersection?.phases.filter((p) => p.enabled && p.movement.kind !== 'pedestrian' && !covered.has(p.number)) ?? [];

  return (
    <Dialog open={open} onClose={close} fullWidth maxWidth="md" fullScreen={phone} aria-labelledby="count-import-title">
      <DialogTitle id="count-import-title">Import turning-movement counts</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          <Typography variant="body2">
            A CSV of 15-minute (or 5-minute) counts by approach and movement, such as <Box component="code" sx={{ fontFamily: fontFamilyMono }}>Time, NBL, NBT, NBR, SBL, …</Box>. SPATT finds the peak hour, works out its peak hour factor and adds it to {intersection?.name ?? 'the intersection'} as a count.
          </Typography>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }} useFlexGap>
            <Button
              variant="outlined"
              startIcon={<FileUploadRoundedIcon />}
              onClick={() => {
                void pickTextFile('.csv,.txt,text/csv,text/plain').then((file) => file && load(file.text, file.name));
              }}
            >
              Open CSV file…
            </Button>
            {fileName ? (
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                {fileName}
              </Typography>
            ) : null}
          </Stack>
          <TextField
            label="Counts (CSV)"
            multiline
            rows={phone ? 4 : 5}
            value={text}
            onChange={(e) => load(e.target.value, null)}
            placeholder={'Time,NBL,NBT,NBR,SBL,SBT,SBR,EBL,EBT,EBR,WBL,WBT,WBR\n07:00,12,85,20,…'}
            sx={{ '& .MuiOutlinedInput-root': { height: 'auto', alignItems: 'flex-start', py: 1 } }}
            slotProps={{ htmlInput: { spellCheck: false, style: { fontFamily: fontFamilyMono, fontSize: 12, lineHeight: 1.5 } } }}
          />
          {parsed && !parsed.ok ? <Alert severity="error">{parsed.error}</Alert> : null}
          {counts ? (
            <>
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                Read {counts.bins.length} {counts.interval === 60 ? 'hourly' : '15-minute'} interval{counts.bins.length === 1 ? '' : 's'} ({LAYOUT_LABEL[counts.layout]}), {formatMinute(counts.bins[0]!.start)} to {formatMinute(counts.bins.at(-1)!.start + counts.interval)}, {counts.movements.length} movements.
              </Typography>
              {counts.notes.length > 0 ? (
                <Box component="ul" sx={{ m: 0, pl: 2.5, color: 'text.secondary', typography: 'body2' }}>
                  {counts.notes.map((note) => (
                    <li key={note}>{note}</li>
                  ))}
                </Box>
              ) : null}
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} useFlexGap>
                <TextField select size="small" label="Peak hour" value={period} onChange={(e) => setPeriod(e.target.value as Period)} sx={{ flex: '1 1 220px' }}>
                  {(Object.keys(PERIODS) as Period[]).map((w) => (
                    <MenuItem key={w} value={w}>
                      {PERIODS[w].label}
                    </MenuItem>
                  ))}
                </TextField>
                <TextField size="small" label="Count name" value={shownName} onChange={(e) => setName(e.target.value)} sx={{ flex: '1 1 180px' }} slotProps={{ htmlInput: { maxLength: 80 } }} />
                <TextField
                  size="small"
                  label="Peak hour factor"
                  value={shownPhf}
                  onChange={(e) => setPhfText(e.target.value)}
                  error={!phfValid}
                  helperText={phfValid ? undefined : 'Between 0.50 and 1.00'}
                  sx={{ flex: '0 1 140px' }}
                  slotProps={{ htmlInput: { inputMode: 'decimal' } }}
                />
              </Stack>
              {peak ? (
                <Alert severity="info" variant="outlined" role="status">
                  Peak hour {formatMinute(peak.start)}–{formatMinute(peak.end)}: {peak.total.toLocaleString()} vehicles
                  {peak.phf !== null ? `, PHF ${peak.phf.toFixed(2)} (busiest 15 minutes: ${peak.peak15!.toLocaleString()})` : '. Hourly data has no PHF: enter one.'}
                </Alert>
              ) : (
                <Alert severity="warning">No complete hour of counts starts in that period.</Alert>
              )}
              {peak && targets ? (
                <Box>
                  <Typography variant="subtitle2" component="h3" sx={{ mb: 0.5 }}>
                    Lane groups
                  </Typography>
                  <Typography variant="body2" sx={{ color: 'text.secondary', mb: 1 }}>
                    Each movement goes into the lane group shown. A new lane group is made for a phase that has none; a lane group that does not carry a movement it is given will carry it from now on.
                  </Typography>
                  <ScrollArea sx={{ border: 1, borderColor: 'divider', borderRadius: 1 }}>
                    <Box component="table" sx={{ borderCollapse: 'collapse', width: '100%', fontSize: 13 }}>
                      <thead>
                        <tr>
                          <Box component="th" scope="col" sx={headSx}>
                            Movement
                          </Box>
                          <Box component="th" scope="col" sx={{ ...headSx, textAlign: 'right' }}>
                            Peak hour
                          </Box>
                          <Box component="th" scope="col" sx={headSx}>
                            Goes into
                          </Box>
                        </tr>
                      </thead>
                      <tbody>
                        {counts.movements.map((key) => (
                          <tr key={key}>
                            <Box component="th" scope="row" sx={{ ...cellSx, textAlign: 'left', fontWeight: 400 }}>
                              {movementLabel(key)}
                            </Box>
                            <Box component="td" sx={{ ...numberCellSx, fontFamily: fontFamilyMono }}>
                              {(peak.volumes[key] ?? 0).toLocaleString()}
                            </Box>
                            <Box component="td" sx={{ ...cellSx, py: 0.5, minWidth: 200 }}>
                              <TextField
                                select
                                size="small"
                                fullWidth
                                value={targetValue(targets[key])}
                                onChange={(e) => setOverrides({ ...overrides, [key]: targetFrom(e.target.value) })}
                                slotProps={{ htmlInput: { 'aria-label': `Lane group for ${movementLabel(key)}` } }}
                              >
                                {intersection?.laneGroups.map((g) => (
                                  <MenuItem key={g.id} value={`group:${g.id}`}>
                                    {g.label || 'Lane group'} (phase {g.phase})
                                  </MenuItem>
                                ))}
                                {newGroupPhases.map((p) => (
                                  <MenuItem key={p.number} value={`phase:${p.number}`}>
                                    New lane group, phase {p.number}
                                    {p.label ? ` ${p.label}` : ''}
                                  </MenuItem>
                                ))}
                                <MenuItem value="skip">Not imported</MenuItem>
                              </TextField>
                            </Box>
                          </tr>
                        ))}
                      </tbody>
                    </Box>
                  </ScrollArea>
                </Box>
              ) : null}
              {full ? <Alert severity="error">The intersection already has {MAX_COUNTS} counts, the most it can hold.</Alert> : null}
            </>
          ) : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={close}>Cancel</Button>
        <Button variant="contained" disabled={!peak || !targets || mapped === 0 || !phfValid || full || !intersection} onClick={apply}>
          Add count
        </Button>
      </DialogActions>
    </Dialog>
  );
}

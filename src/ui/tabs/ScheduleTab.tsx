/**
 * The intersection's daily schedule: a 24-hour timeline of which pattern runs when, and the
 * entries behind it. Entries are kept sorted by start time after every edit.
 */
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { alpha, type Theme } from '@mui/material/styles';
import {
  formatClock,
  formatDuration,
  MINUTES_PER_DAY,
  nextScheduleStart,
  scheduleSegments,
  scheduleSpans,
  sortSchedule,
  type Intersection,
  type ScheduleEntry,
} from '../../model';
import { SelectInput } from '../fields/GridInputs';
import { issuesFor } from '../fields/paths';
import { TimeOfDayInput } from '../fields/TimeOfDayInput';
import { useWorkspace } from '../state/workspace';
import { fontFamilyMono } from '../theme/themePrimitives';
import type { TabProps } from './types';

type PaletteKey = 'primary' | 'success' | 'warning' | 'secondary' | 'info';

/**
 * Pattern colours, in the order of the intersection's patterns; repeats after five. Red is left
 * out: everywhere else in SPATT it means an error.
 */
const PATTERN_PALETTE: readonly PaletteKey[] = ['primary', 'success', 'warning', 'secondary', 'info'];

/** A translucent tint of a palette colour that follows the active colour scheme. */
function tint(theme: Theme, key: PaletteKey, opacity: number): string {
  return theme.vars ? `rgba(${theme.vars.palette[key].mainChannel} / ${opacity})` : alpha(theme.palette[key].main, opacity);
}

/** The select value standing for "run free". */
const FREE = '';

interface PatternStyle {
  name: string;
  key: PaletteKey | null;
}

function patternStyles(intersection: Intersection): Map<string | null, PatternStyle> {
  const styles = new Map<string | null, PatternStyle>([[null, { name: 'Free', key: null }]]);
  intersection.patterns.forEach((pattern, i) => {
    styles.set(pattern.id, { name: pattern.name || pattern.id, key: PATTERN_PALETTE[i % PATTERN_PALETTE.length]! });
  });
  return styles;
}

const styleFor = (styles: Map<string | null, PatternStyle>, patternId: string | null): PatternStyle =>
  styles.get(patternId) ?? { name: `Missing pattern “${patternId}”`, key: null };

const segmentSx = (key: PaletteKey | null) => (theme: Theme) =>
  key === null
    ? {
        // Free: neutral and hatched, so it never reads as a pattern colour.
        backgroundColor: (theme.vars || theme).palette.action.selected,
        backgroundImage: `repeating-linear-gradient(135deg, transparent 0 6px, ${(theme.vars || theme).palette.divider} 6px 8px)`,
        borderColor: (theme.vars || theme).palette.divider,
      }
    : {
        backgroundColor: tint(theme, key, 0.28),
        borderColor: tint(theme, key, 0.9),
      };

const visuallyHidden = {
  position: 'absolute',
  width: '1px',
  height: '1px',
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
} as const;

function Timeline({ intersection }: { intersection: Intersection }) {
  const styles = patternStyles(intersection);
  const segments = scheduleSegments(intersection.schedule);
  const pct = (minute: number) => `${(minute / MINUTES_PER_DAY) * 100}%`;

  return (
    <Box>
      <Box role="img" aria-label="24-hour schedule timeline" sx={{ position: 'relative', height: 40, borderRadius: 1, overflow: 'hidden', border: 1, borderColor: 'divider', bgcolor: 'background.default' }}>
        {segments.map((segment) => {
          const style = styleFor(styles, segment.patternId);
          return (
            <Tooltip
              key={segment.startMinute}
              title={`${style.name} · ${formatClock(segment.startMinute)}–${formatClock(segment.endMinute)} (${formatDuration(segment.endMinute - segment.startMinute)})`}
              followCursor
            >
              <Box
                sx={[
                  {
                    position: 'absolute',
                    top: 0,
                    bottom: 0,
                    left: pct(segment.startMinute),
                    width: pct(segment.endMinute - segment.startMinute),
                    borderLeft: segment.startMinute === 0 ? 0 : 2,
                    borderLeftStyle: 'solid',
                    display: 'flex',
                    alignItems: 'center',
                    px: 0.75,
                    overflow: 'hidden',
                    cursor: 'default',
                  },
                  segmentSx(style.key),
                ]}
              >
                <Typography variant="caption" noWrap sx={{ color: 'text.primary', fontWeight: 500 }}>
                  {style.name}
                </Typography>
              </Box>
            </Tooltip>
          );
        })}
      </Box>
      <Box aria-hidden sx={{ position: 'relative', height: 22 }}>
        {Array.from({ length: 25 }, (_, h) => {
          const major = h % 3 === 0;
          const edge = h === 0 ? 'start' : h === 24 ? 'end' : 'middle';
          return (
            <Box
              key={h}
              sx={{
                position: 'absolute',
                left: pct(h * 60),
                top: 0,
                transform: edge === 'start' ? 'none' : edge === 'end' ? 'translateX(-100%)' : 'translateX(-50%)',
                display: 'flex',
                flexDirection: 'column',
                alignItems: edge === 'start' ? 'flex-start' : edge === 'end' ? 'flex-end' : 'center',
              }}
            >
              <Box sx={{ width: '1px', height: major ? 6 : 3, bgcolor: 'text.secondary', opacity: major ? 0.8 : 0.5 }} />
              {major && (
                <Typography variant="caption" sx={{ color: 'text.secondary', fontFamily: fontFamilyMono, fontSize: 11, lineHeight: 1.3 }}>
                  {String(h).padStart(2, '0')}
                </Typography>
              )}
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}

const cellSx = { px: 1, py: 0.25, borderBottom: 1, borderColor: 'divider', whiteSpace: 'nowrap' } as const;
const headSx = { ...cellSx, textAlign: 'left', fontWeight: 400, py: 0.75 } as const;

export default function ScheduleTab({ intersection, intersectionIndex, issues }: TabProps) {
  const editIntersection = useWorkspace((s) => s.editIntersection);
  const styles = patternStyles(intersection);
  const spans = scheduleSpans(intersection.schedule);
  const basePath = ['intersections', intersectionIndex, 'schedule'];

  const editSchedule = (label: string, recipe: (schedule: ScheduleEntry[]) => void) =>
    editIntersection(label, (i) => {
      recipe(i.schedule);
      i.schedule = sortSchedule(i.schedule);
    });

  const patternOptions = (current: string | null) => [
    { value: FREE, label: 'Free' },
    ...intersection.patterns.map((p) => ({ value: p.id, label: p.name || p.id })),
    ...(current !== null && !intersection.patterns.some((p) => p.id === current) ? [{ value: current, label: `Missing: ${current}` }] : []),
  ];

  const addEntry = () => {
    const start = nextScheduleStart(intersection.schedule);
    editSchedule(`Add schedule entry at ${formatClock(start)}`, (s) => s.push({ startMinute: start, patternId: intersection.patterns[0]?.id ?? null }));
  };

  return (
    <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 2, maxWidth: 960 }}>
      {intersection.patterns.length === 0 && (
        <Alert severity="info" variant="outlined">
          This intersection has no timing patterns yet, so entries can only run free. Patterns are created in the Patterns tab.
        </Alert>
      )}

      <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 2, bgcolor: 'background.paper', px: 1.5, pt: 1, pb: 0.5 }}>
        <Typography variant="overline" component="h2" sx={{ color: 'text.secondary', lineHeight: 1.5, display: 'block', mb: 0.75 }}>
          Daily timeline
        </Typography>
        <Timeline intersection={intersection} />
      </Box>

      <Box sx={{ overflowX: 'auto', border: 1, borderColor: 'divider', borderRadius: 2, bgcolor: 'background.paper' }}>
        <Box component="table" sx={{ borderCollapse: 'separate', borderSpacing: 0, fontSize: 13, width: '100%', minWidth: 560 }}>
          <thead>
            <tr>
              {['Start', 'Pattern', 'Ends', 'Duration'].map((label) => (
                <Box component="th" scope="col" key={label} sx={headSx}>
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                    {label}
                  </Typography>
                </Box>
              ))}
              <Box component="th" scope="col" sx={{ ...headSx, width: 40 }}>
                <Box component="span" sx={visuallyHidden}>
                  Actions
                </Box>
              </Box>
            </tr>
          </thead>
          <tbody>
            {spans.length === 0 && (
              <tr>
                <Box component="td" colSpan={5} sx={{ ...cellSx, py: 2, color: 'text.secondary' }}>
                  No schedule entries: the controller runs free all day.
                </Box>
              </tr>
            )}
            {spans.map((span) => {
              const { entry, index } = span;
              const path = [...basePath, index];
              const style = styleFor(styles, entry.patternId);
              const clock = formatClock(entry.startMinute);
              const nextDay = span.endMinute > MINUTES_PER_DAY;
              return (
                <Box component="tr" key={`${index}-${entry.startMinute}`} sx={{ '&:hover td': { bgcolor: 'action.hover' } }}>
                  <Box component="td" sx={{ ...cellSx, width: 96 }}>
                    <TimeOfDayInput
                      path={[...path, 'startMinute']}
                      label={`Start time, entry at ${clock}`}
                      value={entry.startMinute}
                      issues={issuesFor(issues, [...path, 'startMinute'])}
                      onCommit={(minute) => editSchedule(`Move schedule entry to ${formatClock(minute)}`, (s) => (s[index]!.startMinute = minute))}
                    />
                  </Box>
                  <Box component="td" sx={{ ...cellSx, width: '40%' }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Box aria-hidden sx={[{ width: 12, height: 12, flex: 'none', borderRadius: 0.5, border: 1 }, segmentSx(style.key)]} />
                      <SelectInput
                        path={[...path, 'patternId']}
                        label={`Pattern, entry at ${clock}`}
                        value={entry.patternId ?? FREE}
                        options={patternOptions(entry.patternId)}
                        issues={issuesFor(issues, [...path, 'patternId'])}
                        onCommit={(value) => editSchedule(`Schedule ${clock} pattern`, (s) => (s[index]!.patternId = value === FREE ? null : value))}
                      />
                    </Box>
                  </Box>
                  <Box component="td" sx={{ ...cellSx, fontFamily: fontFamilyMono }}>
                    {formatClock(nextDay ? span.endMinute - MINUTES_PER_DAY : span.endMinute)}
                    {nextDay && (
                      <Typography component="span" variant="caption" sx={{ color: 'text.secondary', ml: 1 }}>
                        next day
                      </Typography>
                    )}
                  </Box>
                  <Box component="td" sx={cellSx}>
                    {formatDuration(span.durationMinutes)}
                  </Box>
                  <Box component="td" sx={{ ...cellSx, textAlign: 'center' }}>
                    <Tooltip title="Delete entry">
                      <IconButton
                        size="small"
                        aria-label={`Delete schedule entry at ${clock}`}
                        onClick={() => editSchedule(`Delete schedule entry at ${clock}`, (s) => s.splice(index, 1))}
                        sx={{ width: 26, height: 26, border: 'none' }}
                      >
                        <DeleteOutlineRoundedIcon sx={{ fontSize: 18 }} />
                      </IconButton>
                    </Tooltip>
                  </Box>
                </Box>
              );
            })}
          </tbody>
        </Box>
      </Box>

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
        <Button size="small" variant="outlined" startIcon={<AddRoundedIcon />} onClick={addEntry}>
          Add entry
        </Button>
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          24-hour times. Each entry runs until the next one starts; the last runs past midnight until the first.
        </Typography>
      </Box>
    </Box>
  );
}

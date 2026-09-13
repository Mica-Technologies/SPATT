/**
 * The ring and barrier structure editor: rings down the side, barrier groups across, each cell
 * holding that ring's phases in timing order. Phases move by drag and drop or, for keyboard and
 * screen-reader users, through each chip's action menu.
 */
import { Fragment, useState, type DragEvent } from 'react';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import DragIndicatorRoundedIcon from '@mui/icons-material/DragIndicatorRounded';
import ErrorOutlineRoundedIcon from '@mui/icons-material/ErrorOutlineRounded';
import MoreVertRoundedIcon from '@mui/icons-material/MoreVertRounded';
import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import ListSubheader from '@mui/material/ListSubheader';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Snackbar from '@mui/material/Snackbar';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { alpha } from '@mui/material/styles';
import {
  addBarrierGroup,
  addRing,
  barrierGroupCount,
  indexAfterRemoval,
  MAX_RINGS,
  movePhase,
  removeBarrierGroup,
  removeRing,
  unassignedPhases,
  unassignPhase,
  type Intersection,
  type Issue,
  type Phase,
} from '../../model';
import { fieldId, issuesFor, worstSeverity, type FieldPath } from '../fields/paths';
import { useWorkspace } from '../state/workspace';
import { fontFamilyMono } from '../theme/themePrimitives';
import type { TabProps } from './types';

const PHASE_MIME = 'application/x-spatt-phase';

/** A ring cell, or the unassigned tray when `ring` and `group` are null. */
interface Slot {
  ring: number | null;
  group: number | null;
  /** For a chip, its position; for a drop target, insert before this position as shown. */
  index: number;
}

const draggedPhase = (event: DragEvent): number | null => {
  const value = Number(event.dataTransfer.getData(PHASE_MIME));
  return Number.isInteger(value) && value > 0 ? value : null;
};

const carriesPhase = (event: DragEvent): boolean => Array.from(event.dataTransfer.types).includes(PHASE_MIME);

/** Insertion position from the pointer: before or after the chip under it, else the end. */
function dropIndex(event: DragEvent<HTMLElement>, length: number): number {
  const chip = (event.target as HTMLElement).closest<HTMLElement>('[data-chip-index]');
  if (!chip || !event.currentTarget.contains(chip)) {
    return length;
  }
  const index = Number(chip.dataset.chipIndex);
  const rect = chip.getBoundingClientRect();
  return event.clientX > rect.left + rect.width / 2 ? index + 1 : index;
}

interface PhaseChipProps {
  number: number;
  phase: Phase | undefined;
  slot: Slot;
  issues: readonly Issue[];
  /** Mark as an error without an issue path (an enabled phase in the unassigned tray). */
  flagged: boolean;
  path: FieldPath | null;
  onMenu: (anchor: HTMLElement, number: number, slot: Slot) => void;
  onDragChange: (phase: number | null) => void;
}

function PhaseChip({ number, phase, slot, issues, flagged, path, onMenu, onDragChange }: PhaseChipProps) {
  const severity = worstSeverity(issues) ?? (flagged ? 'error' : null);
  const disabled = phase !== undefined && !phase.enabled;
  const label = phase ? phase.label || `Phase ${number}` : 'Not defined';
  const tooltip = issues.length > 0 ? issues.map((i) => i.message).join('\n') : flagged ? `Phase ${number} is enabled but not placed in any ring` : disabled ? 'Disabled' : '';

  const chip = (
    <Box
      draggable
      tabIndex={-1}
      data-chip-index={slot.index}
      id={path ? fieldId(path) : undefined}
      aria-label={`Phase ${number}, ${label}${disabled ? ', disabled' : ''}`}
      onDragStart={(event) => {
        event.dataTransfer.setData(PHASE_MIME, String(number));
        event.dataTransfer.setData('text/plain', `Phase ${number}`);
        event.dataTransfer.effectAllowed = 'move';
        onDragChange(number);
      }}
      onDragEnd={() => onDragChange(null)}
      sx={(theme) => ({
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0.25,
        height: 28,
        maxWidth: '100%',
        pl: 0.25,
        border: 1,
        borderRadius: 1,
        borderColor: severity === 'error' ? 'error.main' : severity === 'warning' ? 'warning.main' : 'divider',
        bgcolor: severity ? alpha(theme.palette[severity].main, 0.08) : 'background.default',
        opacity: disabled ? 0.55 : 1,
        cursor: 'grab',
        userSelect: 'none',
        outline: 'none',
        '&:active': { cursor: 'grabbing' },
        '&:focus': { boxShadow: `0 0 0 2px ${alpha(theme.palette.primary.main, 0.4)}` },
      })}
    >
      <DragIndicatorRoundedIcon aria-hidden sx={{ fontSize: 14, color: 'text.disabled' }} />
      <Typography component="span" variant="subtitle2" sx={{ fontFamily: fontFamilyMono, minWidth: 16, textAlign: 'right' }}>
        {number}
      </Typography>
      <Typography component="span" variant="caption" noWrap sx={{ color: 'text.secondary', maxWidth: 120, ml: 0.5 }}>
        {label}
      </Typography>
      <IconButton size="small" aria-label={`Phase ${number} actions`} aria-haspopup="menu" onClick={(e) => onMenu(e.currentTarget, number, slot)} sx={{ width: 22, height: 22, border: 'none' }}>
        <MoreVertRoundedIcon sx={{ fontSize: 16 }} />
      </IconButton>
    </Box>
  );

  return tooltip ? (
    <Tooltip title={tooltip} placement="top" describeChild slotProps={{ tooltip: { sx: { whiteSpace: 'pre-line' } } }}>
      {chip}
    </Tooltip>
  ) : (
    chip
  );
}

const InsertionMark = () => <Box aria-hidden sx={{ alignSelf: 'stretch', width: 2, minHeight: 28, borderRadius: 1, bgcolor: 'primary.main' }} />;

const smallIconSx = { width: 22, height: 22, border: 'none' } as const;

export default function RingsTab({ intersection, intersectionIndex, issues }: TabProps) {
  const editIntersection = useWorkspace((s) => s.editIntersection);
  const [menu, setMenu] = useState<{ anchor: HTMLElement; phase: number; slot: Slot } | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  const [target, setTarget] = useState<Slot | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const rings = intersection.rings;
  const groupCount = Math.max(1, barrierGroupCount(rings));
  const phaseByNumber = new Map(intersection.phases.map((p) => [p.number, p]));
  const unassigned = unassignedPhases(intersection);
  const ringsPath: FieldPath = ['intersections', intersectionIndex, 'rings'];
  const summary = issues.filter((i) => i.path[0] === 'intersections' && i.path[1] === intersectionIndex && (i.code.startsWith('ring.') || i.code.startsWith('barrier.')));

  /** Applies a structural edit as one undo step and says which lead/lag orders it reset. */
  const apply = (label: string, recipe: (i: Intersection) => string[]) => {
    let reset: string[] = [];
    editIntersection(label, (i) => {
      reset = recipe(i);
    });
    if (reset.length > 0) {
      const names = reset.map((id) => `"${intersection.patterns.find((p) => p.id === id)?.name ?? id}"`).join(', ');
      setNotice(`Lead/lag order reset to the base rings in ${reset.length === 1 ? 'pattern' : 'patterns'} ${names}`);
    }
  };

  /** `beforeIndex` counts positions in the target cell as shown, the moving phase included. */
  const place = (phase: number, ring: number, group: number, beforeIndex: number) =>
    apply(`Move phase ${phase}`, (i) => movePhase(i, phase, ring, group, indexAfterRemoval(i.rings, phase, ring, group, beforeIndex)));

  const unassign = (phase: number) => apply(`Remove phase ${phase} from rings`, (i) => unassignPhase(i, phase));

  const onDragChange = (phase: number | null) => {
    setDragging(phase);
    if (phase === null) setTarget(null);
  };

  const dropHandlers = (ring: number | null, group: number | null, length: number) => ({
    onDragOver: (event: DragEvent<HTMLElement>) => {
      if (!carriesPhase(event)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      const index = ring === null ? length : dropIndex(event, length);
      if (!target || target.ring !== ring || target.group !== group || target.index !== index) {
        setTarget({ ring, group, index });
      }
    },
    onDragLeave: (event: DragEvent<HTMLElement>) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
        setTarget(null);
      }
    },
    onDrop: (event: DragEvent<HTMLElement>) => {
      event.preventDefault();
      const phase = draggedPhase(event);
      const index = dropIndex(event, length);
      onDragChange(null);
      if (phase === null) return;
      if (ring === null || group === null) {
        if (rings.some((r) => r.groups.some((g) => g.includes(phase)))) unassign(phase);
      } else if (phaseByNumber.has(phase)) {
        place(phase, ring, group, index);
      }
    },
  });

  const dropZoneSx = (active: boolean, idle = 'transparent') => ({
    outline: active ? '2px dashed' : 'none',
    outlineColor: 'primary.main',
    outlineOffset: -3,
    bgcolor: active ? 'action.hover' : idle,
  });

  const menuSlot = menu?.slot ?? null;
  const menuGroup = menuSlot && menuSlot.ring !== null && menuSlot.group !== null ? (rings[menuSlot.ring]?.groups[menuSlot.group] ?? null) : null;
  const menuDefined = menu !== null && phaseByNumber.has(menu.phase);
  const closeMenuAfter = (action: () => void) => () => {
    action();
    setMenu(null);
  };

  // Columns: ring label, then the barrier groups with a narrow barrier column between neighbours.
  const columns = ['minmax(96px, auto)', ...Array.from({ length: groupCount }, (_, g) => (g === 0 ? 'minmax(180px, 1fr)' : '12px minmax(180px, 1fr)'))].join(' ');
  const groupColumn = (g: number) => 2 + g * 2;
  const rowRule = (r: number) => (r < rings.length - 1 ? 1 : 0);

  return (
    <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1 }}>
        <Typography variant="body2" sx={{ color: 'text.secondary', flex: '1 1 420px', maxWidth: 820 }}>
          A ring times one phase at a time, left to right. A barrier separates movements that must never run together, such as the main
          street and the side street, so all rings cross a barrier at the same moment: ring 1 cannot start the next group while ring 2
          is still timing in this one.
        </Typography>
        <Box sx={{ display: 'flex', gap: 1, ml: 'auto' }}>
          <Button size="small" variant="outlined" startIcon={<AddRoundedIcon />} disabled={rings.length >= MAX_RINGS} onClick={() => apply(`Add ring ${rings.length + 1}`, addRing)}>
            {rings.length >= MAX_RINGS ? `${MAX_RINGS} rings maximum` : 'Add ring'}
          </Button>
          <Button size="small" variant="outlined" startIcon={<AddRoundedIcon />} onClick={() => apply('Add barrier group', addBarrierGroup)}>
            Add barrier group
          </Button>
        </Box>
      </Box>

      {summary.length > 0 ? (
        <Box component="ul" aria-label="Ring structure problems" sx={{ m: 0, py: 0.75, px: 1.25, listStyle: 'none', border: 1, borderColor: 'divider', borderRadius: 2, bgcolor: 'background.paper', display: 'flex', flexDirection: 'column', gap: 0.5 }}>
          {summary.map((issue, n) => (
            <Box component="li" key={`${issue.code}-${n}`} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              {issue.severity === 'error' ? <ErrorOutlineRoundedIcon sx={{ fontSize: 18, color: 'error.main' }} /> : <WarningAmberRoundedIcon sx={{ fontSize: 18, color: 'warning.main' }} />}
              <Typography variant="body2">{issue.message}</Typography>
            </Box>
          ))}
        </Box>
      ) : null}

      <Box sx={{ overflowX: 'auto', border: 1, borderColor: 'divider', borderRadius: 2, bgcolor: 'background.paper' }}>
        <Box
          id={fieldId(ringsPath)}
          tabIndex={-1}
          role="table"
          aria-label="Rings and barrier groups"
          sx={{
            display: 'grid',
            gridTemplateColumns: columns,
            minWidth: 96 + groupCount * 192,
            outline: 'none',
            '&:focus': { boxShadow: (theme) => `inset 0 0 0 2px ${theme.palette.primary.main}` },
          }}
        >
          <Box role="row" sx={{ display: 'contents' }}>
            <Box role="columnheader" aria-label="Ring" sx={{ gridColumn: 1, gridRow: 1, borderBottom: 1, borderColor: 'divider' }} />
            {Array.from({ length: groupCount }, (_, g) => (
              <Box role="columnheader" key={g} sx={{ gridColumn: groupColumn(g), gridRow: 1, display: 'flex', alignItems: 'center', gap: 0.5, pl: 1, pr: 0.5, py: 0.25, borderBottom: 1, borderColor: 'divider' }}>
                <Typography variant="overline" sx={{ color: 'text.secondary', lineHeight: 1.5, flexGrow: 1 }}>
                  Barrier group {g + 1}
                </Typography>
                <Tooltip title={groupCount <= 1 ? 'At least one barrier group is needed' : `Remove barrier group ${g + 1}; its phases become unassigned`}>
                  <span>
                    <IconButton size="small" aria-label={`Remove barrier group ${g + 1}`} disabled={groupCount <= 1} onClick={() => apply(`Remove barrier group ${g + 1}`, (i) => removeBarrierGroup(i, g))} sx={smallIconSx}>
                      <CloseRoundedIcon sx={{ fontSize: 16 }} />
                    </IconButton>
                  </span>
                </Tooltip>
              </Box>
            ))}
          </Box>

          {Array.from({ length: groupCount - 1 }, (_, b) => (
            <Box key={`barrier-${b}`} aria-hidden title="Barrier" sx={{ gridColumn: groupColumn(b) + 1, gridRow: `1 / ${rings.length + 2}`, display: 'flex', justifyContent: 'center', py: 0.5 }}>
              <Box sx={{ width: 5, borderLeft: 2, borderRight: 2, borderColor: 'text.secondary' }} />
            </Box>
          ))}

          {rings.map((ring, r) => (
            <Box role="row" key={r} sx={{ display: 'contents' }}>
              <Box role="rowheader" sx={{ gridColumn: 1, gridRow: r + 2, display: 'flex', alignItems: 'center', gap: 0.5, pl: 1.5, pr: 0.5, borderBottom: rowRule(r), borderColor: 'divider' }}>
                <Typography variant="subtitle2" sx={{ flexGrow: 1, whiteSpace: 'nowrap' }}>
                  Ring {r + 1}
                </Typography>
                <Tooltip title={rings.length <= 1 ? 'At least one ring is needed' : `Remove ring ${r + 1}; its phases become unassigned`}>
                  <span>
                    <IconButton size="small" aria-label={`Remove ring ${r + 1}`} disabled={rings.length <= 1} onClick={() => apply(`Remove ring ${r + 1}`, (i) => removeRing(i, r))} sx={smallIconSx}>
                      <CloseRoundedIcon sx={{ fontSize: 16 }} />
                    </IconButton>
                  </span>
                </Tooltip>
              </Box>
              {Array.from({ length: groupCount }, (_, g) => {
                const phases = ring.groups[g];
                const cellPath: FieldPath = [...ringsPath, r, 'groups', g];
                const list = phases ?? [];
                const active = dragging !== null && target !== null && target.ring === r && target.group === g;
                const markAt = active ? Math.min(target.index, list.length) : -1;
                return (
                  <Box
                    role="cell"
                    key={g}
                    aria-label={`Ring ${r + 1}, barrier group ${g + 1}`}
                    {...(phases ? dropHandlers(r, g, list.length) : {})}
                    sx={{ gridColumn: groupColumn(g), gridRow: r + 2, display: 'flex', flexWrap: 'wrap', alignItems: 'center', alignContent: 'center', gap: 0.5, minHeight: 48, p: 1, borderBottom: rowRule(r), borderColor: 'divider', ...dropZoneSx(active) }}
                  >
                    {list.map((n, i) => (
                      <Fragment key={`${n}-${i}`}>
                        {markAt === i ? <InsertionMark /> : null}
                        <PhaseChip
                          number={n}
                          phase={phaseByNumber.get(n)}
                          slot={{ ring: r, group: g, index: i }}
                          issues={issuesFor(issues, [...cellPath, i])}
                          flagged={false}
                          path={[...cellPath, i]}
                          onMenu={(anchor, phase, slot) => setMenu({ anchor, phase, slot })}
                          onDragChange={onDragChange}
                        />
                      </Fragment>
                    ))}
                    {list.length > 0 && markAt === list.length ? <InsertionMark /> : null}
                    {list.length === 0 ? (
                      <Typography variant="caption" sx={{ color: 'text.disabled', fontStyle: 'italic' }}>
                        {phases ? 'Empty' : 'Missing group'}
                      </Typography>
                    ) : null}
                  </Box>
                );
              })}
            </Box>
          ))}
        </Box>
      </Box>

      <Box
        role="group"
        aria-label="Unassigned phases"
        {...dropHandlers(null, null, unassigned.length)}
        sx={{ border: 1, borderColor: 'divider', borderRadius: 2, py: 1, px: 1.5, ...dropZoneSx(dragging !== null && target !== null && target.ring === null, 'background.paper') }}
      >
        <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', columnGap: 1, mb: 0.5 }}>
          <Typography variant="overline" sx={{ color: 'text.secondary', lineHeight: 1.5 }}>
            Unassigned phases
          </Typography>
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            Defined but in no ring; an enabled phase here never runs. Drop a phase here to take it out of the rings.
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 0.5, minHeight: 30 }}>
          {unassigned.length === 0 ? (
            <Typography variant="caption" sx={{ color: 'text.disabled', fontStyle: 'italic' }}>
              Every defined phase is placed.
            </Typography>
          ) : (
            unassigned.map((n, i) => {
              const phase = phaseByNumber.get(n);
              return (
                <PhaseChip
                  key={n}
                  number={n}
                  phase={phase}
                  slot={{ ring: null, group: null, index: i }}
                  issues={[]}
                  flagged={phase?.enabled === true}
                  path={null}
                  onMenu={(anchor, p, slot) => setMenu({ anchor, phase: p, slot })}
                  onDragChange={onDragChange}
                />
              );
            })
          )}
        </Box>
      </Box>

      <Typography variant="caption" sx={{ color: 'text.secondary' }}>
        Reordering phases within a barrier group keeps each pattern&apos;s lead/lag order. Moving a phase to another ring or group, or adding or
        removing a ring or group, resets any pattern whose order no longer fits.
      </Typography>

      <Menu anchorEl={menu?.anchor} open={menu !== null} onClose={() => setMenu(null)} slotProps={{ list: { dense: true } }}>
        {menu && menuSlot && menuGroup
          ? [
              <MenuItem key="earlier" disabled={!menuDefined || menuSlot.index === 0} onClick={closeMenuAfter(() => place(menu.phase, menuSlot.ring!, menuSlot.group!, menuSlot.index - 1))}>
                Move earlier
              </MenuItem>,
              <MenuItem key="later" disabled={!menuDefined || menuSlot.index >= menuGroup.length - 1} onClick={closeMenuAfter(() => place(menu.phase, menuSlot.ring!, menuSlot.group!, menuSlot.index + 2))}>
                Move later
              </MenuItem>,
            ]
          : null}
        {menuDefined ? <ListSubheader sx={{ lineHeight: '32px' }}>{menuGroup ? 'Move to' : 'Place in'}</ListSubheader> : null}
        {menu && menuDefined
          ? rings.flatMap((ring, r) =>
              ring.groups.map((cell, g) =>
                menuSlot?.ring === r && menuSlot.group === g ? null : (
                  <MenuItem key={`to-${r}-${g}`} onClick={closeMenuAfter(() => place(menu.phase, r, g, cell.length))}>
                    Ring {r + 1}, barrier group {g + 1}
                  </MenuItem>
                ),
              ),
            )
          : null}
        {menu && menuGroup ? <Divider /> : null}
        {menu && menuGroup ? (
          <MenuItem sx={{ color: 'error.main' }} onClick={closeMenuAfter(() => unassign(menu.phase))}>
            Remove from rings
          </MenuItem>
        ) : null}
      </Menu>

      <Snackbar open={notice !== null} autoHideDuration={6000} onClose={() => setNotice(null)} message={notice} />
    </Box>
  );
}

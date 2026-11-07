/**
 * The workspace header's commands. Undo and redo are always buttons; the rest are labelled
 * buttons on wide screens, icon buttons in between, and an overflow menu on phones.
 */
import { useState, type ReactElement } from 'react';
import MoreVertRoundedIcon from '@mui/icons-material/MoreVertRounded';
import RedoRoundedIcon from '@mui/icons-material/RedoRounded';
import UndoRoundedIcon from '@mui/icons-material/UndoRounded';
import Button from '@mui/material/Button';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';

export interface HeaderCommand {
  /** Accessible name (and tooltip). */
  name: string;
  /** Visible label on wide screens; defaults to the name. */
  label?: string;
  icon: ReactElement;
  onClick: () => void;
  disabled?: boolean;
  /** For toggles. */
  pressed?: boolean;
  /** Starts a new group (a divider before it). */
  group?: boolean;
}

export type HeaderDensity = 'labels' | 'icons' | 'menu';

interface WorkspaceActionsProps {
  density: HeaderDensity;
  undoText: string | null;
  redoText: string | null;
  onUndo: () => void;
  onRedo: () => void;
  commands: HeaderCommand[];
}

const separator = <Divider orientation="vertical" flexItem sx={{ mx: 0.5, my: 1 }} />;

export default function WorkspaceActions({ density, undoText, redoText, onUndo, onRedo, commands }: WorkspaceActionsProps) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);

  const history = (
    <>
      <Tooltip title={undoText ? `Undo ${undoText} (Ctrl+Z)` : 'Nothing to undo'}>
        <span>
          <IconButton size="small" aria-label="Undo" disabled={!undoText} onClick={onUndo}>
            <UndoRoundedIcon fontSize="small" />
          </IconButton>
        </span>
      </Tooltip>
      <Tooltip title={redoText ? `Redo ${redoText} (Ctrl+Y)` : 'Nothing to redo'}>
        <span>
          <IconButton size="small" aria-label="Redo" disabled={!redoText} onClick={onRedo}>
            <RedoRoundedIcon fontSize="small" />
          </IconButton>
        </span>
      </Tooltip>
    </>
  );

  if (density === 'menu') {
    return (
      <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
        {history}
        <Tooltip title="More actions">
          <IconButton size="small" aria-label="More actions" aria-haspopup="menu" aria-expanded={anchor !== null} onClick={(e) => setAnchor(e.currentTarget)}>
            <MoreVertRoundedIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Menu anchorEl={anchor} open={anchor !== null} onClose={() => setAnchor(null)}>
          {commands.flatMap((command, k) => [
            command.group && k > 0 ? <Divider key={`d${k}`} /> : null,
            <MenuItem
              key={command.name}
              disabled={command.disabled}
              selected={command.pressed}
              onClick={() => {
                setAnchor(null);
                command.onClick();
              }}
            >
              <ListItemIcon>{command.icon}</ListItemIcon>
              <ListItemText>{command.name}</ListItemText>
            </MenuItem>,
          ])}
        </Menu>
      </Stack>
    );
  }

  return (
    <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
      {history}
      {commands.map((command) => {
        const button =
          density === 'labels' ? (
            <Button
              size="small"
              variant="outlined"
              color={command.pressed ? 'secondary' : 'primary'}
              startIcon={command.icon}
              aria-label={command.label && command.label !== command.name ? command.name : undefined}
              aria-pressed={command.pressed}
              disabled={command.disabled}
              onClick={command.onClick}
              sx={{ whiteSpace: 'nowrap' }}
            >
              {command.label ?? command.name}
            </Button>
          ) : (
            <Tooltip title={command.name}>
              <span>
                <IconButton size="small" aria-label={command.name} aria-pressed={command.pressed} disabled={command.disabled} onClick={command.onClick} sx={command.pressed ? { color: 'primary.main' } : undefined}>
                  {command.icon}
                </IconButton>
              </span>
            </Tooltip>
          );
        return (
          <Stack key={command.name} direction="row" sx={{ alignItems: 'center' }}>
            {command.group ? separator : null}
            {button}
          </Stack>
        );
      })}
    </Stack>
  );
}

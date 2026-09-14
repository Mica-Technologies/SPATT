/** The intersection's patterns: select, add, duplicate, rename and delete. */
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
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { formatSeconds, removePatternFromCorridors, type Intersection, type Issue, type Pattern } from '../../../model';
import { useWorkspace } from '../../state/workspace';
import { createPattern, deletePattern, duplicatePattern, scheduleUses } from './patternEdits';
import { Section } from './Section';

interface PatternListProps {
  intersection: Intersection;
  intersectionIndex: number;
  selectedId: string | null;
  issues: readonly Issue[];
}

export default function PatternList({ intersection, intersectionIndex, selectedId, issues }: PatternListProps) {
  const editIntersection = useWorkspace((s) => s.editIntersection);
  const { selectPattern, requestFocus } = useWorkspace.getState();
  const [menu, setMenu] = useState<{ anchor: HTMLElement; pattern: Pattern } | null>(null);
  const [deleting, setDeleting] = useState<Pattern | null>(null);

  const add = () => {
    const pattern = createPattern(intersection);
    editIntersection(`Add ${pattern.name}`, (i) => i.patterns.push(structuredClone(pattern)));
    selectPattern(pattern.id);
  };

  const errorCount = (index: number) => issues.filter((i) => i.severity === 'error' && i.path[2] === 'patterns' && i.path[3] === index).length;

  const summary = (pattern: Pattern, index: number) => {
    const errors = errorCount(index);
    if (errors > 0) {
      return `${errors} error${errors === 1 ? '' : 's'}`;
    }
    const mode = pattern.mode === 'free' ? 'Free' : `${formatSeconds(pattern.cycle)} s cycle`;
    return pattern.sequence ? `${mode} · own sequence` : mode;
  };

  return (
    <Section
      title="Patterns"
      actions={
        <Tooltip title="Add pattern">
          <IconButton size="small" aria-label="Add pattern" onClick={add} sx={{ width: 28, height: 28 }}>
            <AddRoundedIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      }
    >
      <List dense sx={{ py: 0.5 }}>
        {intersection.patterns.map((pattern, index) => {
          const errors = errorCount(index);
          return (
            <ListItemButton key={pattern.id} selected={pattern.id === selectedId} onClick={() => selectPattern(pattern.id)} sx={{ pr: 0.5, borderRadius: 1, mx: 0.5 }}>
              <ListItemText
                primary={pattern.name || 'Untitled pattern'}
                secondary={summary(pattern, index)}
                slotProps={{ primary: { noWrap: true }, secondary: { noWrap: true, sx: { color: errors > 0 ? 'error.main' : undefined } } }}
              />
              <IconButton
                size="small"
                aria-label={`Actions for ${pattern.name}`}
                onClick={(event) => {
                  event.stopPropagation();
                  setMenu({ anchor: event.currentTarget, pattern });
                }}
              >
                <MoreVertRoundedIcon fontSize="small" />
              </IconButton>
            </ListItemButton>
          );
        })}
      </List>
      {intersection.patterns.length === 0 ? (
        <Box sx={{ px: 1.5, pb: 1.5 }}>
          <Typography variant="body2" sx={{ color: 'text.secondary', mb: 1 }}>
            No patterns. The intersection runs free.
          </Typography>
          <Button size="small" variant="outlined" startIcon={<AddRoundedIcon />} onClick={add}>
            Add pattern
          </Button>
        </Box>
      ) : null}

      <Menu anchorEl={menu?.anchor} open={menu !== null} onClose={() => setMenu(null)}>
        <MenuItem
          onClick={() => {
            const target = menu!.pattern;
            const index = intersection.patterns.findIndex((p) => p.id === target.id);
            selectPattern(target.id);
            requestFocus(['intersections', intersectionIndex, 'patterns', index, 'name']);
            setMenu(null);
          }}
        >
          Rename
        </MenuItem>
        <MenuItem
          onClick={() => {
            const target = menu!.pattern;
            let copyId: string | null = null;
            editIntersection(`Duplicate ${target.name}`, (i) => (copyId = duplicatePattern(i, target.id)));
            if (copyId) selectPattern(copyId);
            setMenu(null);
          }}
        >
          Duplicate
        </MenuItem>
        <MenuItem
          sx={{ color: 'error.main' }}
          onClick={() => {
            setDeleting(menu!.pattern);
            setMenu(null);
          }}
        >
          Delete…
        </MenuItem>
      </Menu>

      <Dialog open={deleting !== null} onClose={() => setDeleting(null)}>
        <DialogTitle>Delete “{deleting?.name}”?</DialogTitle>
        <DialogContent>
          <Typography variant="body2">
            {deleting && scheduleUses(intersection, deleting.id) > 0
              ? `${scheduleUses(intersection, deleting.id)} schedule ${scheduleUses(intersection, deleting.id) === 1 ? 'entry uses' : 'entries use'} it and will run Free instead. `
              : ''}
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
              let next: string | null = selectedId;
              editIntersection(`Delete ${target.name}`, (i, project) => {
                removePatternFromCorridors(project, i.id, target.id);
                const replacement = deletePattern(i, target.id);
                if (selectedId === target.id) next = replacement;
              });
              selectPattern(next);
              setDeleting(null);
            }}
          >
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </Section>
  );
}

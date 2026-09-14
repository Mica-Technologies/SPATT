/** Creates a corridor: a name, the outbound direction, and the intersections in travel order. */
import { useState } from 'react';
import ArrowDownwardRoundedIcon from '@mui/icons-material/ArrowDownwardRounded';
import ArrowUpwardRoundedIcon from '@mui/icons-material/ArrowUpwardRounded';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import IconButton from '@mui/material/IconButton';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemText from '@mui/material/ListItemText';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { newCorridorPlan, newCorridorStop, randomId, uniqueName, type Approach, type Corridor, type Project } from '../../model';
import { APPROACHES } from '../fields/phaseOptions';

const DIRECTIONS = APPROACHES.filter((a) => a.value !== '') as { value: Approach; label: string }[];

interface AddCorridorDialogProps {
  open: boolean;
  project: Project;
  onClose: () => void;
  onCreate: (corridor: Corridor) => void;
}

export default function AddCorridorDialog({ open, project, onClose, onCreate }: AddCorridorDialogProps) {
  const [name, setName] = useState('');
  const [outbound, setOutbound] = useState<Approach>('E');
  const [order, setOrder] = useState<string[]>([]);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [openedWith, setOpenedWith] = useState<boolean>(false);

  // Reset whenever the dialog opens, listing the project's intersections in their order.
  if (open !== openedWith) {
    setOpenedWith(open);
    if (open) {
      setName(uniqueName('Corridor', project.corridors.map((c) => c.name)));
      setOutbound('E');
      setOrder(project.intersections.map((i) => i.id));
      setChosen(new Set(project.intersections.map((i) => i.id)));
    }
  }

  const byId = new Map(project.intersections.map((i) => [i.id, i]));
  const swap = (k: number, j: number) =>
    setOrder((o) => {
      const next = [...o];
      [next[k], next[j]] = [next[j]!, next[k]!];
      return next;
    });
  const selected = order.filter((id) => chosen.has(id)).flatMap((id) => (byId.get(id) ? [byId.get(id)!] : []));

  const create = () => {
    const corridor: Corridor = {
      id: randomId('c'),
      name: name.trim() || 'Corridor',
      outbound,
      stops: selected.map((intersection, k) => newCorridorStop(intersection, outbound, k === 0)),
      plans: [newCorridorPlan(randomId('plan'), 'Plan 1', selected)],
    };
    onCreate(corridor);
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs" aria-labelledby="add-corridor-title">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          create();
        }}
      >
        <DialogTitle id="add-corridor-title">Add corridor</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2}>
            <TextField autoFocus label="Corridor name" value={name} onChange={(e) => setName(e.target.value)} slotProps={{ htmlInput: { maxLength: 120 } }} />
            <TextField select label="Outbound direction" value={outbound} onChange={(e) => setOutbound(e.target.value as Approach)} helperText="Direction of travel from the first intersection to the last">
              {DIRECTIONS.map((d) => (
                <MenuItem key={d.value} value={d.value}>
                  {d.label}
                </MenuItem>
              ))}
            </TextField>
            <Box>
              <Typography variant="body2" sx={{ mb: 0.5 }}>
                Intersections, in travel order
              </Typography>
              {order.length === 0 ? (
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                  Add intersections to the project first.
                </Typography>
              ) : (
                <List dense disablePadding sx={{ border: 1, borderColor: 'divider', borderRadius: 1 }}>
                  {order.map((id, k) => (
                    <ListItem
                      key={id}
                      sx={{ pr: 11 }}
                      divider={k < order.length - 1}
                      secondaryAction={
                        <Stack direction="row">
                          <IconButton size="small" aria-label={`Move ${byId.get(id)?.name} earlier`} disabled={k === 0} onClick={() => swap(k, k - 1)}>
                            <ArrowUpwardRoundedIcon fontSize="small" />
                          </IconButton>
                          <IconButton size="small" aria-label={`Move ${byId.get(id)?.name} later`} disabled={k === order.length - 1} onClick={() => swap(k, k + 1)}>
                            <ArrowDownwardRoundedIcon fontSize="small" />
                          </IconButton>
                        </Stack>
                      }
                    >
                      <Checkbox
                        edge="start"
                        size="small"
                        checked={chosen.has(id)}
                        slotProps={{ input: { 'aria-label': `Include ${byId.get(id)?.name}` } }}
                        onChange={(e) =>
                          setChosen((c) => {
                            const next = new Set(c);
                            if (e.target.checked) next.add(id);
                            else next.delete(id);
                            return next;
                          })
                        }
                      />
                      <ListItemText primary={byId.get(id)?.name} />
                    </ListItem>
                  ))}
                </List>
              )}
            </Box>
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              Links start at 300 m and 48 km/h, through phases are chosen from each phase&apos;s direction of travel, and a first timing plan uses each intersection&apos;s first coordinated pattern. Adjust them in the corridor.
            </Typography>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="contained">
            Add corridor
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}

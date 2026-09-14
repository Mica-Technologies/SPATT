/** Volume counts: hourly volumes per lane group and movement, with a peak hour factor. */
import { useState } from 'react';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { MOVEMENT_LABEL, MOVEMENTS, newVolumeSet, randomId, removeVolumeSet, uniqueName, zeroVolumes, type Intersection, type Issue, type VolumeSet } from '../../../model';
import { NumberInput, TextInput } from '../../fields/GridInputs';
import { issuesFor, type FieldPath } from '../../fields/paths';
import { useWorkspace } from '../../state/workspace';
import { fontFamilyMono } from '../../theme/themePrimitives';
import { Section } from '../patterns/Section';
import { cellSx, headSx, numberCellSx } from './tableStyles';

interface CountsSectionProps {
  intersection: Intersection;
  basePath: FieldPath;
  issues: readonly Issue[];
}

export default function CountsSection({ intersection, basePath, issues }: CountsSectionProps) {
  const editIntersection = useWorkspace((s) => s.editIntersection);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const index = Math.max(0, intersection.volumeSets.findIndex((s) => s.id === selectedId));
  const set = intersection.volumeSets[index];
  const path = [...basePath, 'volumeSets', index];
  const linked = set ? intersection.patterns.filter((p) => p.volumeSetId === set.id) : [];

  const update = (label: string, recipe: (s: VolumeSet) => void) =>
    editIntersection(label, (i) => {
      const found = i.volumeSets.find((s) => s.id === set?.id);
      if (found) recipe(found);
    });

  const add = () => {
    const id = randomId('count');
    const name = uniqueName(intersection.volumeSets.length === 0 ? 'AM peak' : 'Count', intersection.volumeSets.map((s) => s.name));
    editIntersection(`Add count ${name}`, (i) => {
      i.volumeSets.push(newVolumeSet(id, name, i.laneGroups));
      // The first count is what the patterns are timed for until told otherwise.
      if (i.volumeSets.length === 1) for (const p of i.patterns) p.volumeSetId ??= id;
    });
    setSelectedId(id);
  };

  return (
    <Section
      title="Counts"
      actions={
        <Button size="small" variant="outlined" startIcon={<AddRoundedIcon />} onClick={add}>
          Add count
        </Button>
      }
    >
      {!set ? (
        <Typography variant="body2" sx={{ color: 'text.secondary', p: 1.5 }}>
          No counts yet. A count holds one period&apos;s hourly volumes (an AM peak hour, say); patterns link to the count they are timed for.
        </Typography>
      ) : (
        <Box sx={{ p: 1.5, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
            <TextField select size="small" label="Count" value={set.id} onChange={(e) => setSelectedId(e.target.value)} sx={{ minWidth: 180 }}>
              {intersection.volumeSets.map((s) => (
                <MenuItem key={s.id} value={s.id}>
                  {s.name || 'Untitled count'}
                </MenuItem>
              ))}
            </TextField>
            <Box component="label" sx={{ display: 'flex', alignItems: 'center', gap: 1, fontSize: 13, color: 'text.secondary' }}>
              Name
              <Box sx={{ width: 160 }}>
                <TextInput path={[...path, 'name']} label="Count name" value={set.name} onCommit={(v) => update('Rename count', (s) => (s.name = v))} />
              </Box>
            </Box>
            <Box component="label" sx={{ display: 'flex', alignItems: 'center', gap: 1, fontSize: 13, color: 'text.secondary' }}>
              Peak hour factor
              <Box sx={{ width: 64 }}>
                <NumberInput path={[...path, 'peakHourFactor']} label="Peak hour factor" value={set.peakHourFactor} min={0.5} max={1} onCommit={(v) => update('Peak hour factor', (s) => (s.peakHourFactor = v!))} />
              </Box>
            </Box>
            <Box sx={{ flexGrow: 1 }} />
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              {linked.length === 0 ? 'No pattern is timed for this count' : `Timed for it: ${linked.map((p) => p.name || p.id).join(', ')}`}
            </Typography>
            <Tooltip title="Delete count">
              <IconButton size="small" aria-label={`Delete count ${set.name}`} onClick={() => editIntersection(`Delete count ${set.name}`, (i) => removeVolumeSet(i, set.id))}>
                <DeleteOutlineRoundedIcon sx={{ fontSize: 18 }} />
              </IconButton>
            </Tooltip>
          </Box>

          {intersection.laneGroups.length === 0 ? (
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              Add lane groups to enter volumes.
            </Typography>
          ) : (
            <Box sx={{ overflowX: 'auto', border: 1, borderColor: 'divider', borderRadius: 1 }}>
              <Box component="table" aria-label={`Volumes in ${set.name || 'count'}`} sx={{ borderCollapse: 'separate', borderSpacing: 0, fontSize: 13, width: '100%', minWidth: 520 }}>
                <thead>
                  <tr>
                    {['Lane group', 'Phase', ...MOVEMENTS.map((m) => `${MOVEMENT_LABEL[m]} (veh/h)`), 'Total'].map((h, k) => (
                      <Box component="th" scope="col" key={h} sx={{ ...headSx, textAlign: k >= 2 ? 'right' : 'left' }}>
                        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                          {h}
                        </Typography>
                      </Box>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {intersection.laneGroups.map((group) => {
                    const volumes = set.volumes[group.id] ?? zeroVolumes();
                    const name = group.label || 'lane group';
                    return (
                      <tr key={group.id}>
                        <Box component="td" sx={cellSx}>
                          {name}
                        </Box>
                        <Box component="td" sx={{ ...cellSx, fontFamily: fontFamilyMono }}>
                          {group.phase}
                        </Box>
                        {MOVEMENTS.map((m) => {
                          const fieldPath = [...path, 'volumes', group.id, m];
                          return (
                            <Box component="td" key={m} sx={{ ...numberCellSx, width: 110 }}>
                              <NumberInput
                                path={fieldPath}
                                label={`${MOVEMENT_LABEL[m]} volume, ${name}`}
                                value={volumes[m]}
                                min={0}
                                max={10000}
                                integer
                                disabled={!group.movements[m] && volumes[m] === 0}
                                issues={issuesFor(issues, fieldPath)}
                                onCommit={(v) =>
                                  update(`${name} ${MOVEMENT_LABEL[m].toLowerCase()} volume`, (s) => {
                                    const entry = (s.volumes[group.id] ??= zeroVolumes());
                                    entry[m] = v!;
                                  })
                                }
                              />
                            </Box>
                          );
                        })}
                        <Box component="td" sx={{ ...numberCellSx, fontFamily: fontFamilyMono }}>
                          {volumes.left + volumes.through + volumes.right}
                        </Box>
                      </tr>
                    );
                  })}
                </tbody>
              </Box>
            </Box>
          )}
        </Box>
      )}
    </Section>
  );
}

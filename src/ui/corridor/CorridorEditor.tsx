/** The main area for a selected corridor: its layout, its timing plans and their time-space diagram. */
import { useMemo } from 'react';
import Box from '@mui/material/Box';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import Typography from '@mui/material/Typography';
import type { Corridor, Project } from '../../model';
import { useIssues } from '../state/useIssues';
import { useWorkspace, type CorridorTab } from '../state/workspace';
import CorridorLayout from './CorridorLayout';
import CorridorPlans from './CorridorPlans';
import CorridorProgression from './CorridorProgression';

export default function CorridorEditor({ project, corridor }: { project: Project; corridor: Corridor }) {
  const tab = useWorkspace((s) => s.corridorTab);
  const setTab = useWorkspace((s) => s.setCorridorTab);
  const corridorIndex = project.corridors.findIndex((c) => c.id === corridor.id);
  const all = useIssues();
  const issues = useMemo(() => all.filter((i) => i.path[0] === 'corridors' && i.path[1] === corridorIndex), [all, corridorIndex]);

  return (
    <>
      <Box sx={{ px: 2, pt: 1.5, borderBottom: 1, borderColor: 'divider', bgcolor: 'background.paper' }}>
        <Typography variant="overline" sx={{ display: 'block', lineHeight: 1.4, color: 'text.secondary' }}>
          Corridor
        </Typography>
        <Typography variant="h6" component="h2" noWrap>
          {corridor.name}
        </Typography>
        <Tabs value={tab} onChange={(_, value: CorridorTab) => setTab(value)} sx={{ minHeight: 40 }}>
          <Tab value="layout" label="Layout" sx={{ minHeight: 40 }} />
          <Tab value="plans" label="Timing plans" sx={{ minHeight: 40 }} />
          <Tab value="progression" label="Time-space diagram" sx={{ minHeight: 40 }} />
        </Tabs>
      </Box>
      <Box sx={{ flexGrow: 1, overflow: 'auto', minHeight: 0 }}>
        {tab === 'layout' ? <CorridorLayout project={project} corridor={corridor} corridorIndex={corridorIndex} issues={issues} /> : null}
        {tab === 'plans' ? <CorridorPlans project={project} corridor={corridor} corridorIndex={corridorIndex} issues={issues} /> : null}
        {tab === 'progression' ? <CorridorProgression project={project} corridor={corridor} /> : null}
      </Box>
    </>
  );
}

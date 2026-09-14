import { useState } from 'react';
import CheckCircleOutlineRoundedIcon from '@mui/icons-material/CheckCircleOutlineRounded';
import ErrorOutlineRoundedIcon from '@mui/icons-material/ErrorOutlineRounded';
import ExpandLessRoundedIcon from '@mui/icons-material/ExpandLessRounded';
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded';
import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import type { Issue } from '../../model';
import { useIssues } from '../state/useIssues';
import { useWorkspace } from '../state/workspace';
import { navigateTo } from './navigation';

const SECTION_LABEL: Record<string, string> = {
  phases: 'Phases',
  overlaps: 'Overlaps',
  preempts: 'Preempts',
  rings: 'Rings & Barriers',
  patterns: 'Patterns',
  schedule: 'Schedule',
  capacity: 'Volumes',
  laneGroups: 'Volumes · Lane groups',
  volumeSets: 'Volumes · Counts',
};

export default function ProblemsPanel() {
  const issues = useIssues();
  const project = useWorkspace((s) => s.project);
  const [open, setOpen] = useState(true);
  const errors = issues.filter((i) => i.severity === 'error').length;
  const warnings = issues.length - errors;

  const location = (issue: Issue): string => {
    if (issue.path[0] === 'corridors' && typeof issue.path[1] === 'number') {
      const corridor = project?.corridors[issue.path[1]];
      return [corridor?.name, issue.path[2] === 'plans' ? 'Timing plans' : 'Corridor layout'].filter(Boolean).join(' · ');
    }
    const intersection = typeof issue.path[1] === 'number' ? project?.intersections[issue.path[1]] : undefined;
    const section = SECTION_LABEL[String(issue.path[2])] ?? '';
    return [intersection?.name, section].filter(Boolean).join(' · ');
  };

  return (
    <Box component="section" aria-label="Problems" sx={{ borderTop: 1, borderColor: 'divider', bgcolor: 'background.paper', display: 'flex', flexDirection: 'column', maxHeight: open ? 220 : 36, flexShrink: 0 }}>
      <ButtonBase onClick={() => setOpen(!open)} aria-expanded={open} sx={{ justifyContent: 'flex-start', gap: 1.5, px: 2, height: 36, flexShrink: 0 }}>
        <Typography variant="subtitle2">Problems</Typography>
        {issues.length === 0 ? (
          <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', color: 'success.main' }}>
            <CheckCircleOutlineRoundedIcon sx={{ fontSize: 16 }} />
            <Typography variant="caption">None</Typography>
          </Stack>
        ) : (
          <>
            <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', color: errors ? 'error.main' : 'text.secondary' }}>
              <ErrorOutlineRoundedIcon sx={{ fontSize: 16 }} />
              <Typography variant="caption">{errors}</Typography>
            </Stack>
            <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', color: warnings ? 'warning.main' : 'text.secondary' }}>
              <WarningAmberRoundedIcon sx={{ fontSize: 16 }} />
              <Typography variant="caption">{warnings}</Typography>
            </Stack>
          </>
        )}
        <Box sx={{ flexGrow: 1 }} />
        {open ? <ExpandMoreRoundedIcon fontSize="small" /> : <ExpandLessRoundedIcon fontSize="small" />}
      </ButtonBase>
      {open && issues.length > 0 ? (
        <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0, overflowY: 'auto' }}>
          {issues.map((issue, index) => (
            <li key={`${issue.code}-${issue.path.join('.')}-${index}`}>
              <ButtonBase
                onClick={() => navigateTo(issue.path)}
                sx={{ width: '100%', justifyContent: 'flex-start', textAlign: 'left', gap: 1.5, px: 2, py: 0.75, '&:hover': { bgcolor: 'action.hover' } }}
              >
                {issue.severity === 'error' ? (
                  <ErrorOutlineRoundedIcon sx={{ fontSize: 16, color: 'error.main', flexShrink: 0 }} />
                ) : (
                  <WarningAmberRoundedIcon sx={{ fontSize: 16, color: 'warning.main', flexShrink: 0 }} />
                )}
                <Typography variant="body2" sx={{ flexGrow: 1 }}>
                  {issue.message}
                </Typography>
                <Typography variant="caption" sx={{ color: 'text.secondary', whiteSpace: 'nowrap' }}>
                  {location(issue)}
                </Typography>
              </ButtonBase>
            </li>
          ))}
        </Box>
      ) : null}
    </Box>
  );
}

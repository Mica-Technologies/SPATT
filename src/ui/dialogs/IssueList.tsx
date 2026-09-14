/** A compact list of issues, each optionally clickable (to jump to its field). */
import ErrorOutlineRoundedIcon from '@mui/icons-material/ErrorOutlineRounded';
import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Typography from '@mui/material/Typography';
import type { Issue } from '../../model';

export default function IssueList({ issues, onSelect, label }: { issues: readonly Issue[]; onSelect?: (issue: Issue) => void; label: string }) {
  return (
    <Box component="ul" aria-label={label} sx={{ listStyle: 'none', m: 0, p: 0, border: 1, borderColor: 'divider', borderRadius: 1, maxHeight: 240, overflowY: 'auto' }}>
      {issues.map((issue, index) => {
        const content = (
          <>
            {issue.severity === 'error' ? <ErrorOutlineRoundedIcon sx={{ fontSize: 16, color: 'error.main', flexShrink: 0, mt: 0.25 }} /> : <WarningAmberRoundedIcon sx={{ fontSize: 16, color: 'warning.main', flexShrink: 0, mt: 0.25 }} />}
            <Typography variant="body2">{issue.message}</Typography>
          </>
        );
        const sx = { display: 'flex', gap: 1, alignItems: 'flex-start', width: '100%', textAlign: 'left', px: 1.5, py: 0.75 } as const;
        return (
          <Box component="li" key={`${issue.code}-${index}`} sx={{ '& + &': { borderTop: 1, borderColor: 'divider' } }}>
            {onSelect && issue.path.length > 0 ? (
              <ButtonBase onClick={() => onSelect(issue)} sx={{ ...sx, justifyContent: 'flex-start', '&:hover': { bgcolor: 'action.hover' } }}>
                {content}
              </ButtonBase>
            ) : (
              <Box sx={sx}>{content}</Box>
            )}
          </Box>
        );
      })}
    </Box>
  );
}

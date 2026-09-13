import type { ReactNode } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import type { Issue } from '../../../model';

interface SectionProps {
  title: string;
  /** DOM id, so the problems panel can scroll to the section. */
  id?: string;
  actions?: ReactNode;
  children: ReactNode;
}

/** A bordered editor panel with an overline title and actions on the right. */
export function Section({ title, id, actions, children }: SectionProps) {
  return (
    <Box component="section" id={id} tabIndex={id ? -1 : undefined} aria-label={title} sx={{ border: 1, borderColor: 'divider', borderRadius: 2, bgcolor: 'background.paper', minWidth: 0, outline: 'none' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', px: 1.5, minHeight: 40, borderBottom: 1, borderColor: 'divider' }}>
        <Typography variant="overline" component="h3" sx={{ color: 'text.secondary', lineHeight: 1.5, flexGrow: 1 }}>
          {title}
        </Typography>
        {actions}
      </Box>
      {children}
    </Box>
  );
}

/** Issue messages as a compact list, coloured by severity. */
export function IssueLines({ issues }: { issues: readonly Issue[] }) {
  if (issues.length === 0) {
    return null;
  }
  return (
    <Box component="ul" sx={{ m: 0, p: 0, listStyle: 'none' }}>
      {issues.map((issue, index) => (
        <Typography component="li" key={`${issue.code}-${index}`} variant="caption" sx={{ display: 'block', color: issue.severity === 'error' ? 'error.main' : 'warning.main' }}>
          {issue.message}
        </Typography>
      ))}
    </Box>
  );
}

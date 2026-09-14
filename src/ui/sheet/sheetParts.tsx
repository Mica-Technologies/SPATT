/** Building blocks shared by the printed sheets: titled sections and compact bordered tables. */
import type { ReactNode } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { fontFamilyMono } from '../theme/themePrimitives';

const cellSx = { border: 1, borderColor: 'divider', px: 0.75, py: 0.25, textAlign: 'right', whiteSpace: 'nowrap', fontFamily: fontFamilyMono, fontVariantNumeric: 'tabular-nums' } as const;
const headSx = { ...cellSx, textAlign: 'left', fontFamily: 'inherit', fontWeight: 500, bgcolor: 'action.hover' } as const;
const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/** A titled block. Short sections keep together; long ones may break, but never right after the title. */
export function Section({ title, children, keepTogether = true }: { title: string; children: ReactNode; keepTogether?: boolean }) {
  return (
    <Box component="section" sx={{ mt: 2.5, breakInside: keepTogether ? 'avoid-page' : 'auto' }}>
      <Typography variant="overline" component="h3" sx={{ display: 'block', breakAfter: 'avoid-page', lineHeight: 1.6, color: 'text.secondary', borderBottom: 1, borderColor: 'divider', mb: 0.75 }}>
        {title}
      </Typography>
      {children}
    </Box>
  );
}

export function Table({ head, rows, firstColumnLabel }: { head: ReactNode[]; rows: { label: string; cells: ReactNode[] }[]; firstColumnLabel: string }) {
  return (
    <Box component="table" sx={{ borderCollapse: 'collapse', fontSize: 10.5, width: '100%' }}>
      <thead>
        <tr>
          <Box component="th" scope="col" sx={headSx}>
            {firstColumnLabel}
          </Box>
          {head.map((cell, k) => (
            <Box component="th" scope="col" key={k} sx={{ ...headSx, textAlign: 'right' }}>
              {cell}
            </Box>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, k) => (
          <tr key={`${row.label}-${k}`}>
            <Box component="th" scope="row" sx={headSx}>
              {row.label}
            </Box>
            {row.cells.map((cell, c) => (
              <Box component="td" key={c} sx={cellSx}>
                {cell}
              </Box>
            ))}
          </tr>
        ))}
      </tbody>
    </Box>
  );
}

/** The sheet's title block: what it is, the project, and when it was printed and edited. */
export function SheetHeader({ kind, title, subtitle, printedAt, editedAt }: { kind: string; title: string; subtitle?: string; printedAt: Date; editedAt: string }) {
  return (
    <Box component="header" sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 2, borderBottom: 2, borderColor: 'text.primary', pb: 0.75 }}>
      <Box>
        <Typography variant="overline" sx={{ display: 'block', lineHeight: 1.4, color: 'text.secondary' }}>
          {kind}
        </Typography>
        <Typography variant="h5" component="h2" sx={{ fontWeight: 600 }}>
          {title}
        </Typography>
        {subtitle ? (
          <Typography variant="subtitle1" component="p" sx={{ color: 'text.secondary', m: 0 }}>
            {subtitle}
          </Typography>
        ) : null}
      </Box>
      <Typography variant="caption" sx={{ color: 'text.secondary', textAlign: 'right' }}>
        Printed {dateFormat.format(printedAt)}
        <br />
        Edited {dateFormat.format(new Date(editedAt))}
      </Typography>
    </Box>
  );
}

export function SheetFooter() {
  return (
    <Typography component="footer" variant="caption" sx={{ display: 'block', mt: 3, pt: 0.75, borderTop: 1, borderColor: 'divider', color: 'text.secondary' }}>
      Produced with SPATT. Not certified engineering software: check every value against local practice and the governing standards before use.
    </Typography>
  );
}

/** Label and value pairs in a wrapping line. */
export function Facts({ facts }: { facts: [string, ReactNode][] }) {
  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', columnGap: 2.5, rowGap: 0.25, fontSize: 10.5, mb: 0.75 }}>
      {facts.map(([label, value]) => (
        <span key={label}>
          <Box component="span" sx={{ color: 'text.secondary' }}>
            {label}
          </Box>{' '}
          <Box component="span" sx={{ fontFamily: fontFamilyMono }}>
            {value}
          </Box>
        </span>
      ))}
    </Box>
  );
}

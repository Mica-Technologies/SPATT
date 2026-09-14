/**
 * Print preview for timing sheets: the selected intersection or every intersection, on Letter or
 * A4, each intersection starting a new page. Printing uses the browser's (or webview's) print
 * dialog; the toolbar and screen framing are hidden from the printout.
 */
import { useState } from 'react';
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded';
import PrintRoundedIcon from '@mui/icons-material/PrintRounded';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import GlobalStyles from '@mui/material/GlobalStyles';
import Stack from '@mui/material/Stack';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Typography from '@mui/material/Typography';
import type { Project } from '../../model';
import AppHeader from '../components/AppHeader';
import TimingSheet from './TimingSheet';

export type Paper = 'letter' | 'a4';

const PAPER: Record<Paper, { size: string; width: string; minHeight: string; margin: string }> = {
  letter: { size: 'letter', width: '8.5in', minHeight: '11in', margin: '0.5in' },
  a4: { size: 'A4', width: '210mm', minHeight: '297mm', margin: '12mm' },
};

/** Letter where the locale is likely to use it (US, Canada, Mexico, Philippines and a few others), A4 elsewhere. */
function defaultPaper(): Paper {
  const region = new Intl.Locale(navigator.language).maximize().region ?? '';
  return ['US', 'CA', 'MX', 'PH', 'CL', 'CO', 'VE', 'GT', 'PR'].includes(region) ? 'letter' : 'a4';
}

interface SheetScreenProps {
  project: Project;
  selectedIntersectionId: string | null;
  onBack: () => void;
}

export default function SheetScreen({ project, selectedIntersectionId, onBack }: SheetScreenProps) {
  const [paper, setPaper] = useState<Paper>(defaultPaper);
  const [scope, setScope] = useState<'selected' | 'all'>('selected');
  const [printedAt] = useState(() => new Date());
  const selected = project.intersections.find((i) => i.id === selectedIntersectionId) ?? project.intersections[0];
  const intersections = scope === 'all' ? project.intersections : selected ? [selected] : [];
  const format = PAPER[paper];

  return (
    <Box className="sheet-screen" sx={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', bgcolor: 'background.default' }}>
      <GlobalStyles
        styles={{
          '@page': { size: format.size, margin: format.margin },
          '@media print': {
            // The canvas follows color-scheme, so a dark app theme would paint the page margins dark.
            html: { colorScheme: 'light !important' },
            'html, body': { background: '#fff !important' },
            '.sheet-toolbar': { display: 'none !important' },
            '.sheet-screen': { minHeight: '0 !important', background: 'none !important' },
            '.sheet-stack': { padding: '0 !important', gap: '0 !important' },
            '.sheet-page': { width: 'auto !important', minHeight: '0 !important', padding: '0 !important', boxShadow: 'none !important', border: 'none !important' },
            '.sheet-stack > * + * > .sheet-page': { breakBefore: 'page' },
          },
        }}
      />
      <Box className="sheet-toolbar">
        <AppHeader
          title="SPATT"
          subtitle={`${project.name} · Timing sheet`}
          actions={
            <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
              <Button size="small" startIcon={<ArrowBackRoundedIcon />} onClick={onBack}>
                Back to editor
              </Button>
              <ToggleButtonGroup size="small" exclusive value={scope} onChange={(_, value: 'selected' | 'all' | null) => value && setScope(value)} aria-label="Intersections to print">
                <ToggleButton value="selected">This intersection</ToggleButton>
                <ToggleButton value="all">All ({project.intersections.length})</ToggleButton>
              </ToggleButtonGroup>
              <ToggleButtonGroup size="small" exclusive value={paper} onChange={(_, value: Paper | null) => value && setPaper(value)} aria-label="Paper size">
                <ToggleButton value="letter">Letter</ToggleButton>
                <ToggleButton value="a4">A4</ToggleButton>
              </ToggleButtonGroup>
              <Button size="small" variant="contained" startIcon={<PrintRoundedIcon />} disabled={intersections.length === 0} onClick={() => window.print()}>
                Print
              </Button>
            </Stack>
          }
        />
      </Box>

      <Box className="sheet-stack" sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, p: 3, overflowX: 'auto' }}>
        {intersections.length === 0 ? (
          <Typography variant="body1" sx={{ color: 'text.secondary', mt: 6 }}>
            Add an intersection to print its timing sheet.
          </Typography>
        ) : (
          intersections.map((intersection) => (
            <Box
              key={intersection.id}
              data-mui-color-scheme="light"
              sx={{
                display: 'contents',
                '& > .sheet-page': {
                  boxSizing: 'border-box',
                  width: format.width,
                  minHeight: format.minHeight,
                  padding: format.margin,
                  bgcolor: 'common.white',
                  color: 'text.primary',
                  boxShadow: 3,
                  flexShrink: 0,
                },
              }}
            >
              <TimingSheet project={project} intersection={intersection} printedAt={printedAt} />
            </Box>
          ))
        )}
      </Box>
    </Box>
  );
}

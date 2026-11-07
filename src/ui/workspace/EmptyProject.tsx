/** The main area of a project with no intersections yet: start from a template right here. */
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Typography from '@mui/material/Typography';
import { addTemplateIntersection } from './addIntersection';
import TemplateSketch from './TemplateSketch';
import { TEMPLATES } from './templates';

export default function EmptyProject() {
  return (
    <Box sx={{ flexGrow: 1, overflowY: 'auto', p: { xs: 2, sm: 4 } }}>
      <Box sx={{ maxWidth: 760, mx: 'auto' }}>
        <Typography variant="h6" component="h2">
          Start timing an intersection
        </Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
          Pick a starting point. Every value can be changed afterwards, and more intersections can be added from the list of intersections.
        </Typography>
        <Box component="ul" aria-label="Intersection templates" sx={{ listStyle: 'none', m: 0, p: 0, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 1.5 }}>
          {TEMPLATES.map((template) => (
            <li key={template.label}>
              <ButtonBase
                onClick={() => addTemplateIntersection(template.build)}
                aria-label={`Start from ${template.label}`}
                sx={{
                  width: '100%',
                  height: '100%',
                  p: 1.5,
                  gap: 1,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'flex-start',
                  textAlign: 'left',
                  border: 1,
                  borderColor: 'divider',
                  borderRadius: 2,
                  bgcolor: 'background.paper',
                  '&:hover': { borderColor: 'primary.main' },
                  '&.Mui-focusVisible': { outline: 2, outlineColor: 'primary.main', outlineOffset: 2 },
                }}
              >
                <TemplateSketch template={template} width={120} />
                <Typography variant="subtitle2" component="span">
                  {template.label}
                </Typography>
                <Typography variant="caption" component="span" sx={{ color: 'text.secondary' }}>
                  {template.description}
                </Typography>
              </ButtonBase>
            </li>
          ))}
        </Box>
      </Box>
    </Box>
  );
}

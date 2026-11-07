/** Colours for the intersection drawing: fixed lamp colours, and theme-aware CSS for everything else. */
import type { Theme } from '@mui/material/styles';
import { fontFamilySans } from '../theme/themePrimitives';

/**
 * Lamp colours. Lamps sit on a near-black housing in both colour schemes, so these fixed signal
 * colours read the same in light and dark mode.
 */
export const LAMP = {
  red: 'hsl(4, 86%, 58%)',
  yellow: 'hsl(42, 100%, 55%)',
  green: 'hsl(145, 70%, 46%)',
  walk: 'hsl(210, 20%, 96%)',
  hand: 'hsl(24, 100%, 56%)',
  off: 'hsl(220, 14%, 24%)',
} as const;

export type Lamp = keyof typeof LAMP;

export const lampOf = (signal: string): Lamp => {
  switch (signal) {
    case 'green':
      return 'green';
    case 'yellow':
      return 'yellow';
    case 'red':
    case 'redClearance':
      return 'red';
    case 'walk':
      return 'walk';
    case 'pedestrianClearance':
    case 'dontWalk':
      return 'hand';
    default:
      return 'off';
  }
};

export function drawingSx(theme: Theme) {
  const palette = (theme.vars || theme).palette;
  return {
    width: '100%',
    height: 'auto',
    display: 'block',
    fontFamily: fontFamilySans,
    '& .ground': { fill: palette.grey[100] },
    // The stroke hides hairline seams where the road's pieces meet.
    '& .road': { fill: palette.grey[400], stroke: palette.grey[400], strokeWidth: 0.1, strokeLinejoin: 'round' },
    '& .paint-fill': { fill: palette.common.white },
    '& .paint-line': { stroke: palette.common.white, fill: 'none' },
    '& .road-side': { fill: palette.grey[500] },
    '& .centre': { stroke: LAMP.yellow, fill: 'none' },
    '& .median': { fill: LAMP.yellow, fillOpacity: 0.16 },
    '& .label': { fill: palette.text.secondary },
    '& .label-on-road': { fill: palette.common.white },
    '& .pole': { fill: palette.grey[500], stroke: palette.grey[500] },
    '& .pole-shade': { fill: palette.grey[600] },
    '& .housing-top': { fill: palette.grey[600] },
    '& .housing-east': { fill: palette.grey[800] },
    '& .housing-south': { fill: palette.grey[700] },
    '& .housing': { fill: palette.grey[800], stroke: palette.grey[600] },
    '& .compass': {
      fill: palette.text.secondary,
      stroke: palette.text.secondary,
    },
    ...theme.applyStyles('dark', {
      '& .ground': { fill: palette.grey[800] },
      '& .road': { fill: palette.grey[700], stroke: palette.grey[700] },
      '& .paint-fill': { fill: palette.grey[300] },
      '& .paint-line': { stroke: palette.grey[300] },
      '& .road-side': { fill: palette.grey[900] },
      '& .label-on-road': { fill: palette.grey[200] },
      '& .pole': { fill: palette.grey[400], stroke: palette.grey[400] },
      '& .pole-shade': { fill: palette.grey[500] },
      '& .housing-top': { fill: palette.grey[500] },
      '& .housing-east': { fill: palette.grey[900] },
      '& .housing-south': { fill: palette.grey[800] },
      '& .housing': { fill: palette.grey[900], stroke: palette.grey[500] },
    }),
  };
}

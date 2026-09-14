export const cellSx = { px: 1, py: 0.25, borderBottom: 1, borderColor: 'divider', whiteSpace: 'nowrap' } as const;
export const headSx = { ...cellSx, textAlign: 'left', fontWeight: 400, py: 0.75 } as const;
export const numberCellSx = { ...cellSx, textAlign: 'right' } as const;

export const visuallyHidden = {
  position: 'absolute',
  width: '1px',
  height: '1px',
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
} as const;

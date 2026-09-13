import { alpha, type Theme } from '@mui/material/styles';

/** Shared look of every dense grid cell input: borderless until hovered, focused or flagged. */
export const cellInputStyles = ({ theme }: { theme: Theme }) => ({
  width: '100%',
  minWidth: 0,
  height: 28,
  padding: '0 6px',
  font: 'inherit',
  fontSize: 13,
  color: (theme.vars || theme).palette.text.primary,
  background: 'transparent',
  border: '1px solid transparent',
  borderRadius: 4,
  outline: 'none',
  '&:hover:not(:disabled)': {
    borderColor: (theme.vars || theme).palette.divider,
  },
  '&:focus': {
    borderColor: (theme.vars || theme).palette.primary.main,
    background: (theme.vars || theme).palette.background.default,
    boxShadow: `0 0 0 2px ${alpha(theme.palette.primary.main, 0.25)}`,
  },
  '&:disabled': {
    color: (theme.vars || theme).palette.text.disabled,
  },
  '&[data-severity="error"]': {
    borderColor: (theme.vars || theme).palette.error.main,
    background: alpha(theme.palette.error.main, 0.08),
  },
  '&[data-severity="warning"]': {
    borderColor: (theme.vars || theme).palette.warning.main,
    background: alpha(theme.palette.warning.main, 0.08),
  },
  '&[data-invalid="true"]': {
    borderColor: (theme.vars || theme).palette.error.main,
  },
});

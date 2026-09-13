/**
 * A 24-hour time-of-day cell (`HH:MM`) for dense grids. Like the inputs in GridInputs it commits
 * on blur or Enter (Escape reverts), carries a `fieldId` and shows the worst issue affecting it.
 */
import { useState, type CSSProperties } from 'react';
import Tooltip from '@mui/material/Tooltip';
import { alpha, styled } from '@mui/material/styles';
import { formatClock, parseClock, type Issue } from '../../model';
import { fontFamilyMono } from '../theme/themePrimitives';
import { fieldId, worstSeverity, type FieldPath } from './paths';

const Input = styled('input')(({ theme }) => ({
  width: '100%',
  minWidth: 0,
  height: 28,
  padding: '0 6px',
  font: 'inherit',
  fontSize: 13,
  fontFamily: fontFamilyMono,
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
  '&[data-severity="error"], &[data-invalid="true"]': {
    borderColor: (theme.vars || theme).palette.error.main,
  },
  '&[data-severity="error"]': {
    background: alpha(theme.palette.error.main, 0.08),
  },
  '&[data-severity="warning"]': {
    borderColor: (theme.vars || theme).palette.warning.main,
    background: alpha(theme.palette.warning.main, 0.08),
  },
}));

interface TimeOfDayInputProps {
  path: FieldPath;
  label: string;
  /** Minutes after midnight, 0..1439. */
  value: number;
  onCommit: (value: number) => void;
  issues?: readonly Issue[];
  disabled?: boolean;
  style?: CSSProperties;
}

export function TimeOfDayInput({ path, label, value, onCommit, issues = [], disabled, style }: TimeOfDayInputProps) {
  const display = formatClock(value);
  const [draft, setDraft] = useState(display);
  const [invalid, setInvalid] = useState(false);
  // Reset the draft when the committed value changes, during render (see SecondsInput).
  const [shown, setShown] = useState(display);
  if (shown !== display) {
    setShown(display);
    setDraft(display);
    setInvalid(false);
  }

  const revert = () => {
    setDraft(display);
    setInvalid(false);
  };

  const commit = () => {
    const parsed = parseClock(draft);
    if (parsed === null || parsed === value) {
      revert();
      return;
    }
    onCommit(parsed);
  };

  const input = (
    <Input
      id={fieldId(path)}
      aria-label={label}
      inputMode="numeric"
      placeholder="HH:MM"
      value={draft}
      disabled={disabled}
      data-severity={worstSeverity(issues) ?? undefined}
      data-invalid={invalid || undefined}
      style={style}
      onChange={(event) => {
        setDraft(event.target.value);
        setInvalid(parseClock(event.target.value) === null);
      }}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.currentTarget.blur();
        } else if (event.key === 'Escape') {
          revert();
          event.currentTarget.blur();
        }
      }}
    />
  );

  // Always wrapped (an empty title shows nothing), so the input is not remounted, and does not
  // lose focus, when a typed value turns invalid.
  const messages = [...(invalid ? ['Enter a 24-hour time, e.g. 06:30'] : []), ...issues.map((i) => i.message)];
  return (
    <Tooltip title={messages.join('\n')} placement="top" slotProps={{ tooltip: { sx: { whiteSpace: 'pre-line' } } }}>
      {input}
    </Tooltip>
  );
}

/**
 * A 24-hour time-of-day cell (`HH:MM`) for dense grids. Like the inputs in GridInputs it commits
 * on blur or Enter (Escape reverts), carries a `fieldId` and shows the worst issue affecting it.
 */
import { useState, type CSSProperties } from 'react';
import Tooltip from '@mui/material/Tooltip';
import { styled } from '@mui/material/styles';
import { formatClock, parseClock, type Issue } from '../../model';
import { fontFamilyMono } from '../theme/themePrimitives';
import { cellInputStyles } from './cellInputStyles';
import { fieldId, worstSeverity, type FieldPath } from './paths';

const Input = styled('input')((args) => ({ ...cellInputStyles(args), fontFamily: fontFamilyMono }));

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

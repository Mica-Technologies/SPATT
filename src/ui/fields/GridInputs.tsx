/**
 * Compact inputs for dense editing grids. Each commits a value (not every keystroke), carries a
 * `fieldId` so the problems panel can focus it, and shows the worst issue affecting it.
 */
import { useState, type CSSProperties, type KeyboardEvent, type ReactElement } from 'react';
import Tooltip from '@mui/material/Tooltip';
import { styled } from '@mui/material/styles';
import { formatSeconds, type Issue, type Tenths } from '../../model';
import { fontFamilyMono } from '../theme/themePrimitives';
import { cellInputStyles } from './cellInputStyles';
import { parseSeconds } from './parseSeconds';
import { fieldId, worstSeverity, type FieldPath } from './paths';

const Input = styled('input')(cellInputStyles);
const Select = styled('select')(cellInputStyles);

function withIssues(issues: readonly Issue[], element: ReactElement) {
  if (issues.length === 0) {
    return element;
  }
  return (
    <Tooltip title={issues.map((i) => i.message).join('\n')} placement="top" slotProps={{ tooltip: { sx: { whiteSpace: 'pre-line' } } }}>
      {element}
    </Tooltip>
  );
}

interface BaseProps {
  path: FieldPath;
  label: string;
  issues?: readonly Issue[];
  disabled?: boolean;
  style?: CSSProperties;
}

interface SecondsInputProps extends BaseProps {
  value: Tenths;
  onCommit: (value: Tenths) => void;
  /** Show 0 as an empty field (for "not programmed" values such as Max 2). */
  zeroAsBlank?: boolean;
}

export function SecondsInput({ path, label, value, onCommit, issues = [], disabled, zeroAsBlank, style }: SecondsInputProps) {
  const display = zeroAsBlank && value === 0 ? '' : formatSeconds(value);
  const [draft, setDraft] = useState(display);
  const [invalid, setInvalid] = useState(false);
  // Reset the draft when the committed value changes (an edit, undo or redo), during render
  // rather than in an effect, so the stale draft is never painted.
  const [shown, setShown] = useState(display);
  if (shown !== display) {
    setShown(display);
    setDraft(display);
    setInvalid(false);
  }

  const commit = () => {
    const parsed = parseSeconds(draft, zeroAsBlank ? 0 : null);
    if (parsed === null) {
      setDraft(display);
      setInvalid(false);
      return;
    }
    if (parsed !== value) {
      onCommit(parsed);
    } else {
      setDraft(display);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.currentTarget.blur();
    } else if (event.key === 'Escape') {
      setDraft(display);
      setInvalid(false);
      event.currentTarget.blur();
    }
  };

  return withIssues(
    issues,
    <Input
      id={fieldId(path)}
      aria-label={label}
      inputMode="decimal"
      value={draft}
      placeholder={zeroAsBlank ? '—' : undefined}
      disabled={disabled}
      data-severity={worstSeverity(issues) ?? undefined}
      data-invalid={invalid || undefined}
      style={{ textAlign: 'right', fontFamily: fontFamilyMono, ...style }}
      onChange={(event) => {
        setDraft(event.target.value);
        setInvalid(parseSeconds(event.target.value, zeroAsBlank ? 0 : null) === null);
      }}
      onBlur={commit}
      onKeyDown={onKeyDown}
    />,
  );
}

interface TextInputProps extends BaseProps {
  value: string;
  onCommit: (value: string) => void;
  maxLength?: number;
}

export function TextInput({ path, label, value, onCommit, issues = [], disabled, maxLength = 80, style }: TextInputProps) {
  const [draft, setDraft] = useState(value);
  const [shown, setShown] = useState(value);
  if (shown !== value) {
    setShown(value);
    setDraft(value);
  }
  return withIssues(
    issues,
    <Input
      id={fieldId(path)}
      aria-label={label}
      value={draft}
      maxLength={maxLength}
      disabled={disabled}
      data-severity={worstSeverity(issues) ?? undefined}
      style={style}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => draft !== value && onCommit(draft)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur();
        if (event.key === 'Escape') {
          setDraft(value);
          event.currentTarget.blur();
        }
      }}
    />,
  );
}

interface SelectInputProps<T extends string> extends BaseProps {
  value: T;
  options: readonly { value: T; label: string }[];
  onCommit: (value: T) => void;
}

export function SelectInput<T extends string>({ path, label, value, options, onCommit, issues = [], disabled, style }: SelectInputProps<T>) {
  return withIssues(
    issues,
    <Select
      id={fieldId(path)}
      aria-label={label}
      value={value}
      disabled={disabled}
      data-severity={worstSeverity(issues) ?? undefined}
      style={style}
      onChange={(event) => onCommit(event.target.value as T)}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </Select>,
  );
}

interface CheckboxInputProps extends BaseProps {
  value: boolean;
  onCommit: (value: boolean) => void;
}

const Checkbox = styled('input')(({ theme }) => ({
  width: 16,
  height: 16,
  margin: 0,
  accentColor: theme.palette.primary.main,
  cursor: 'pointer',
  '&:disabled': { cursor: 'default' },
}));

export function CheckboxInput({ path, label, value, onCommit, issues = [], disabled }: CheckboxInputProps) {
  return withIssues(
    issues,
    <Checkbox
      id={fieldId(path)}
      type="checkbox"
      aria-label={label}
      checked={value}
      disabled={disabled}
      onChange={(event) => onCommit(event.target.checked)}
    />,
  );
}

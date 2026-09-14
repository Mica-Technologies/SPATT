// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { emptyProject, splitPhaseSideStreet, standardEightPhase } from '../../model';
import { useIntersectionIssues } from '../state/useIssues';
import { selectIntersection, useWorkspace } from '../state/workspace';
import PatternsTab from './PatternsTab';

function Harness() {
  const intersection = useWorkspace(selectIntersection);
  const issues = useIntersectionIssues(0);
  return intersection ? <PatternsTab intersection={intersection} intersectionIndex={0} issues={issues} /> : null;
}

const state = () => useWorkspace.getState();
const pattern = (index = 0) => selectIntersection(state())!.patterns[index]!;

beforeEach(() => {
  const project = emptyProject('Sample', 'p-sample', new Date('2026-09-01T00:00:00.000Z'));
  project.intersections.push(standardEightPhase('main'));
  state().open(project);
});

afterEach(() => {
  cleanup();
  state().close();
});

describe('PatternsTab', () => {
  it('shows the splits, their minimums and that they fill the cycle', () => {
    render(<Harness />);
    expect((screen.getByLabelText('Split, phase 2') as HTMLInputElement).value).toBe('35.0');
    expect(screen.getAllByText('min 16.0')).toHaveLength(4); // phases 2, 4, 6, 8
    expect(screen.getAllByText('ped 31.0')).toHaveLength(2); // phases 2, 6
    expect(screen.getByRole('status').textContent).toBe('Splits fill the cycle');
  });

  it('adds a pattern and selects it', () => {
    render(<Harness />);
    fireEvent.click(screen.getAllByRole('button', { name: 'Add pattern' })[0]!);
    expect(selectIntersection(state())!.patterns.map((p) => p.id)).toEqual(['am-peak', 'pattern-1']);
    expect(state().selectedPatternId).toBe('pattern-1');
    expect((screen.getByLabelText('Cycle length') as HTMLInputElement).value).toBe('80.0');
  });

  it('balances in one undo step', () => {
    state().editIntersection('Short ring', (i) => (i.patterns[0]!.splits['6'] = 300));
    render(<Harness />);
    expect(screen.getByRole('status').textContent).toBe('Groups fill the cycle, but the rings are not aligned');
    expect(screen.getByText('rings differ by 5.0 s')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Balance' }));
    expect(pattern().splits['6']).toBe(350);
    state().undo();
    expect(pattern().splits['6']).toBe(300);
  });

  it('raises a split below its minimum when balancing', () => {
    state().editIntersection('Zero split', (i) => (i.patterns[0]!.splits['1'] = 0));
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Balance' }));
    expect(pattern().splits).toMatchObject({ 1: 100, 2: 400 });
  });

  it('counts the barrier wait in a split-phased ring total', () => {
    const project = emptyProject('Split', 'p-split', new Date('2026-09-01T00:00:00.000Z'));
    project.intersections.push(splitPhaseSideStreet('split'));
    state().open(project);
    render(<Harness />);
    // Cycle 120: ring 2 serves nothing in groups 2 and 3 (30 + 30 s) and waits there.
    expect(screen.getAllByText('120.0')).toHaveLength(2);
    expect(screen.getByText('incl. 60.0 s wait')).toBeTruthy();
  });

  it('converts the offset when the reference changes', () => {
    state().editIntersection('Offset', (i) => (i.patterns[0]!.offset = 300));
    render(<Harness />);
    fireEvent.change(screen.getByLabelText('Offset reference'), { target: { value: 'beginCoordYellow' } });
    expect(pattern()).toMatchObject({ offsetReference: 'beginCoordYellow', offset: 590 });
  });

  it('keeps the offset number when conversion is turned off', () => {
    state().editIntersection('Offset', (i) => (i.patterns[0]!.offset = 300));
    render(<Harness />);
    fireEvent.click(screen.getByLabelText('Convert the offset when the reference changes'));
    fireEvent.change(screen.getByLabelText('Offset reference'), { target: { value: 'firstPhaseStart' } });
    expect(pattern()).toMatchObject({ offsetReference: 'firstPhaseStart', offset: 300 });
  });

  it('swaps a lead-lag order for this pattern only', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Swap phases 1 and 2' }));
    expect(pattern().sequence?.[0]?.groups[0]).toEqual([2, 1]);
    expect(selectIntersection(state())!.rings[0]!.groups[0]).toEqual([1, 2]);
    const section = screen.getByRole('region', { name: 'Phase sequence' });
    expect(within(section).getByText('Own sequence for this pattern')).toBeTruthy();
    fireEvent.click(within(section).getByRole('button', { name: 'Use base sequence' }));
    expect(pattern().sequence).toBeNull();
  });

  it('disables the split grid in free mode', () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText('Mode'), { target: { value: 'free' } });
    expect(screen.getByText('This pattern runs free, so its cycle, offset and splits are not used.')).toBeTruthy();
    expect((screen.getByLabelText('Split, phase 2') as HTMLInputElement).disabled).toBe(true);
  });

  it('deletes a pattern and sends its schedule entries to Free', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Actions for AM Peak' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete…' }));
    expect(screen.getByText(/1 schedule entry uses it/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(selectIntersection(state())!.patterns).toEqual([]);
    expect(selectIntersection(state())!.schedule.map((e) => e.patternId)).toEqual([null, null]);
    expect(state().selectedPatternId).toBeNull();
  });
});

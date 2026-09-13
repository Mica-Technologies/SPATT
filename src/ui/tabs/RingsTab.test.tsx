// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addPhase, emptyProject, leadLagEightPhase, validateIntersection, type Intersection } from '../../model';
import { selectIntersection, useWorkspace } from '../state/workspace';
import RingsTab from './RingsTab';

const state = () => useWorkspace.getState();
const current = () => selectIntersection(state())!;

function renderTab(setup?: (i: Intersection) => void) {
  const project = emptyProject('Sample', 'p-sample', new Date('2026-09-01T00:00:00.000Z'));
  const intersection = leadLagEightPhase('main');
  setup?.(intersection);
  project.intersections.push(intersection);
  state().open(project);
  const view = () => {
    const i = current();
    const issues = validateIntersection(i).map((issue) => ({ ...issue, path: ['intersections', 0, ...issue.path] }));
    return <RingsTab intersection={i} intersectionIndex={0} issues={issues} />;
  };
  const result = render(view());
  return { rerender: () => result.rerender(view()) };
}

/** A DataTransfer stand-in: jsdom has none. */
function dataTransfer() {
  const data = new Map<string, string>();
  return {
    get types() {
      return [...data.keys()];
    },
    setData: (type: string, value: string) => data.set(type, value),
    getData: (type: string) => data.get(type) ?? '',
    effectAllowed: 'all',
    dropEffect: 'none',
  };
}

describe('RingsTab', () => {
  beforeEach(() => state().close());
  afterEach(cleanup);

  it('shows each ring cell in timing order and an empty unassigned tray', () => {
    renderTab();
    const cell = screen.getByRole('cell', { name: 'Ring 1, barrier group 1' });
    const chips = within(cell)
      .getAllByLabelText(/^Phase \d+,/)
      .map((el) => el.getAttribute('aria-label'));
    expect(chips).toEqual(['Phase 1, WB Left', 'Phase 2, EB Thru']);
    expect(screen.getByText('Every defined phase is placed.')).toBeTruthy();
    expect(document.getElementById('field:intersections.0.rings')).toBeTruthy();
  });

  it('moves a phase through the chip menu as one undo step', () => {
    const { rerender } = renderTab();
    fireEvent.click(screen.getByRole('button', { name: 'Phase 1 actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Ring 2, barrier group 2' }));
    expect(current().rings.map((r) => r.groups)).toEqual([
      [[2], [3, 4]],
      [[5, 6], [7, 8, 1]],
    ]);
    expect(current().patterns[0]!.sequence).toBeNull();
    expect(state().past).toHaveLength(1);
    rerender();
    expect(screen.getByText(/Lead\/lag order reset/)).toBeTruthy();
  });

  it('reorders within a group without resetting the pattern order', () => {
    renderTab();
    fireEvent.click(screen.getByRole('button', { name: 'Phase 1 actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Move later' }));
    expect(current().rings[0]!.groups[0]).toEqual([2, 1]);
    expect(current().patterns[0]!.sequence).not.toBeNull();
  });

  it('removes a phase from the rings and lists it as unassigned', () => {
    const { rerender } = renderTab();
    fireEvent.click(screen.getByRole('button', { name: 'Phase 4 actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Remove from rings' }));
    rerender();
    const tray = screen.getByRole('group', { name: 'Unassigned phases' });
    expect(within(tray).getByLabelText('Phase 4, SB Thru')).toBeTruthy();
    expect(screen.getByText('Phase 4 is enabled but not placed in any ring')).toBeTruthy();
  });

  it('drops an unassigned phase into a cell', () => {
    const { rerender } = renderTab((i) => addPhase(i, 9));
    const chip = within(screen.getByRole('group', { name: 'Unassigned phases' })).getByLabelText(/^Phase 9,/);
    const transfer = dataTransfer();
    fireEvent.dragStart(chip, { dataTransfer: transfer });
    const cell = screen.getByRole('cell', { name: 'Ring 1, barrier group 2' });
    fireEvent.dragOver(cell, { dataTransfer: transfer });
    fireEvent.drop(cell, { dataTransfer: transfer });
    expect(current().rings[0]!.groups[1]).toEqual([3, 4, 9]);
    rerender();
    expect(screen.getByText('Every defined phase is placed.')).toBeTruthy();
  });

  it('adds and removes rings and barrier groups', () => {
    const { rerender } = renderTab();
    fireEvent.click(screen.getByRole('button', { name: 'Add ring' }));
    rerender();
    fireEvent.click(screen.getByRole('button', { name: 'Add barrier group' }));
    expect(current().rings.map((r) => r.groups.length)).toEqual([3, 3, 3]);
    rerender();
    fireEvent.click(screen.getByRole('button', { name: 'Remove ring 1' }));
    rerender();
    fireEvent.click(screen.getByRole('button', { name: 'Remove barrier group 1' }));
    expect(current().rings.map((r) => r.groups)).toEqual([
      [[7, 8], []],
      [[], []],
    ]);
    expect(state().past).toHaveLength(4);
  });
});

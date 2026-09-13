import { beforeEach, describe, expect, it } from 'vitest';
import { emptyProject, standardEightPhase, twoPhase } from '../../model';
import { HISTORY_LIMIT, redoLabel, selectIntersection, undoLabel, useWorkspace } from './workspace';

function openSample() {
  const project = emptyProject('Sample', 'p-sample', new Date('2026-09-01T00:00:00.000Z'));
  project.intersections.push(standardEightPhase('main'), twoPhase('elm'));
  useWorkspace.getState().open(project);
  return project;
}

const state = () => useWorkspace.getState();

describe('workspace', () => {
  beforeEach(() => state().close());

  it('opens a project on its first intersection and pattern', () => {
    openSample();
    expect(state().selectedIntersectionId).toBe('main');
    expect(state().selectedPatternId).toBe('am-peak');
  });

  it('edits immutably and stamps updatedAt', () => {
    const original = openSample();
    state().editIntersection('Change yellow', (i) => (i.phases[0]!.yellow = 40));
    expect(selectIntersection(state())!.phases[0]!.yellow).toBe(40);
    expect(original.intersections[0]!.phases[0]!.yellow).toBe(35);
    expect(state().project!.updatedAt).not.toBe(original.updatedAt);
  });

  it('undoes and redoes with labels', () => {
    openSample();
    state().editIntersection('Change yellow', (i) => (i.phases[0]!.yellow = 40));
    state().editIntersection('Rename', (i) => (i.name = 'Renamed'));
    expect(undoLabel(state())).toBe('Rename');

    state().undo();
    expect(selectIntersection(state())!.name).toBe('Main St & Side St');
    expect(redoLabel(state())).toBe('Rename');

    state().undo();
    expect(selectIntersection(state())!.phases[0]!.yellow).toBe(35);
    expect(undoLabel(state())).toBeNull();

    state().redo();
    state().redo();
    expect(selectIntersection(state())!.name).toBe('Renamed');
    expect(redoLabel(state())).toBeNull();
  });

  it('drops the redo stack on a new edit', () => {
    openSample();
    state().editIntersection('A', (i) => (i.notes = 'a'));
    state().undo();
    state().editIntersection('B', (i) => (i.notes = 'b'));
    expect(redoLabel(state())).toBeNull();
  });

  it('caps history', () => {
    openSample();
    for (let n = 0; n < HISTORY_LIMIT + 10; n++) {
      state().editIntersection(`Edit ${n}`, (i) => (i.notes = String(n)));
    }
    expect(state().past).toHaveLength(HISTORY_LIMIT);
  });

  it('keeps a valid selection when undo removes the selected intersection', () => {
    openSample();
    state().edit('Add', (p) => p.intersections.push({ ...twoPhase('new'), name: 'New' }));
    state().selectIntersection('new');
    state().undo();
    expect(state().selectedIntersectionId).toBe('main');
  });

  it('bumps the revision on every change', () => {
    openSample();
    const before = state().revision;
    state().editIntersection('A', (i) => (i.notes = 'a'));
    state().undo();
    expect(state().revision).toBe(before + 2);
  });
});

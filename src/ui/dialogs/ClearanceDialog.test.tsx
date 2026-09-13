// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyProject, makePhase, standardEightPhase, type Phase, type Project } from '../../model';
import { selectIntersection, useWorkspace } from '../state/workspace';
import ClearanceDialog from './ClearanceDialog';

const US: Project['units'] = { length: 'ft', speed: 'mph' };

const vehiclePhase = (basis?: Phase['clearanceBasis']): Phase => ({
  ...makePhase(2, { label: 'EB Thru', approach: 'E', kind: 'through', minGreen: 100, maxGreen1: 400, yellow: 40, redClear: 20, ped: { walk: 70, clearance: 180 } }),
  clearanceBasis: basis,
});

const input = (key: string) => document.querySelector<HTMLInputElement>(`input[data-field="${key}"]`)!;
const type = (key: string, value: string) => fireEvent.change(input(key), { target: { value } });
const computed = (key: string) => screen.getByTestId(`computed-${key}`).textContent;

function renderDialog(phase: Phase, units = US, onClose = () => {}) {
  return render(<ClearanceDialog open onClose={onClose} intersectionIndex={0} phase={phase} units={units} />);
}

describe('ClearanceDialog', () => {
  beforeEach(() => useWorkspace.getState().close());
  afterEach(cleanup);

  it('computes a 3.6 s yellow for 35 mph on the level from the stored basis', () => {
    renderDialog(vehiclePhase({ approachSpeed: 35, gradePercent: 0 }));
    expect(input('approachSpeed').value).toBe('35');
    expect(computed('yellow')).toBe('3.6 s');
  });

  it('recomputes live as inputs change, with defaults for vehicle length and walking speed', () => {
    renderDialog(vehiclePhase());
    expect(input('vehicleLength').value).toBe('20');
    expect(input('walkingSpeed').value).toBe('3.5');
    expect(computed('yellow')).toMatch(/Enter approach speed/);

    type('approachSpeed', '35');
    expect(computed('yellow')).toBe('3.6 s');
    type('gradePercent', '-5');
    expect(computed('yellow')).toBe('4.1 s');
    type('intersectionWidth', '60');
    expect(computed('redClear')).toBe('1.6 s');
    type('crossingDistance', '48');
    expect(computed('pedClearance')).toBe('13.8 s');
  });

  it('uses metric defaults and converts a mismatched speed unit', () => {
    renderDialog(vehiclePhase(), { length: 'm', speed: 'mph' });
    expect(input('vehicleLength').value).toBe('6');
    expect(input('walkingSpeed').value).toBe('1.07');
    type('approachSpeed', '35');
    expect(computed('yellow')).toBe('3.6 s');
  });

  it('shows engine range errors instead of throwing and disables applying them', () => {
    renderDialog(vehiclePhase());
    type('approachSpeed', '0');
    type('intersectionWidth', '60');
    expect(computed('yellow')).toMatch(/positive speed/);
    expect(computed('redClear')).toMatch(/positive speed/);
    expect(screen.getByLabelText<HTMLInputElement>('Apply yellow change').disabled).toBe(true);
    type('walkingSpeed', '0');
    type('crossingDistance', '48');
    expect(computed('pedClearance')).toMatch(/Walking speed must be positive/);
  });

  it('flags a grade outside the file format range', () => {
    renderDialog(vehiclePhase({ approachSpeed: 35 }));
    type('gradePercent', '20');
    expect(screen.getByText(/Between −15 and 15/)).toBeTruthy();
    expect(computed('yellow')).toMatch(/Check grade/);
  });

  it('runs the pushbutton check against the current walk', () => {
    renderDialog(vehiclePhase());
    type('crossingDistance', '48');
    // Walk 7.0 + 13.8 = 20.8 s against (48 + 6) / 3.0 = 18.0 s.
    expect(screen.getByTestId('pushbutton-check').textContent).toMatch(/20\.8 s meets the 18\.0 s minimum/);
    type('crossingDistance', '80');
    type('walkingSpeed', '4');
    // 80 / 4 = 20.0; 7.0 + 20.0 = 27.0 < 28.7.
    expect(screen.getByTestId('pushbutton-check').textContent).toMatch(/27\.0 s is below the 28\.7 s minimum \(walk needs at least 8\.7 s\)/);
  });

  it('cannot apply pedestrian clearance to a phase without pedestrian service', () => {
    const phase = makePhase(1, { label: 'WB Left', approach: 'W', kind: 'left', minGreen: 50, maxGreen1: 200, yellow: 35, redClear: 15 });
    renderDialog(phase);
    type('crossingDistance', '48');
    expect(screen.getByLabelText<HTMLInputElement>('Apply pedestrian clearance').disabled).toBe(true);
    expect(screen.getByTestId('pushbutton-check').textContent).toMatch(/no pedestrian service/);
  });

  it('applies the chosen values and their basis as one undoable edit', () => {
    const project = emptyProject('Sample', 'p', new Date('2026-09-01T00:00:00.000Z'));
    project.intersections.push(standardEightPhase('main'));
    useWorkspace.getState().open(project);
    const phase = project.intersections[0]!.phases[1]!;
    const onClose = vi.fn();
    renderDialog(phase, US, onClose);

    type('approachSpeed', '35');
    type('intersectionWidth', '60');
    type('crossingDistance', '48');
    fireEvent.click(screen.getByLabelText('Apply red clearance'));
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    const updated = selectIntersection(useWorkspace.getState())!.phases[1]!;
    expect(updated.yellow).toBe(36);
    expect(updated.redClear).toBe(20);
    expect(updated.pedestrian.clearance).toBe(138);
    expect(updated.clearanceBasis).toEqual({ approachSpeed: 35, gradePercent: 0, crossingDistance: 48, walkingSpeed: 3.5 });
    expect(useWorkspace.getState().past).toHaveLength(1);
    expect(onClose).toHaveBeenCalled();

    useWorkspace.getState().undo();
    expect(selectIntersection(useWorkspace.getState())!.phases[1]!.yellow).toBe(40);
  });
});

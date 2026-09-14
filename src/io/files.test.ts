import { beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyProject, saveProject } from '../model';
import { downloadProject, projectFileName } from './files';

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
vi.mock('./host', () => ({ isTauri: () => true }));

const project = emptyProject('Main St / 1st Ave', 'p-main', new Date('2026-09-13T00:00:00.000Z'));

describe('downloadProject on desktop', () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  it('exports through the native Save dialog command', async () => {
    invoke.mockResolvedValueOnce('C:/exports/Main St 1st Ave.spatt.json');
    expect(await downloadProject(project)).toBe('C:/exports/Main St 1st Ave.spatt.json');
    expect(invoke).toHaveBeenCalledWith('project_export', {
      suggestedName: projectFileName(project),
      text: saveProject(project),
      fileType: 'SPATT project',
    });
  });

  it('resolves with null when cancelled', async () => {
    invoke.mockResolvedValueOnce(null);
    expect(await downloadProject(project)).toBeNull();
  });

  it('never rejects, so the UI can fire and forget', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    invoke.mockRejectedValueOnce('access denied');
    expect(await downloadProject(project)).toBeNull();
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });
});

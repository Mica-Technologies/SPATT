import { beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyProject } from '../model';
import { openFromStore, saveToStore } from './store';
import { TauriStore } from './tauri-store';

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke }));

describe('TauriStore', () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  it('lists through projects_list', async () => {
    const summaries = [{ id: 'p-a', name: 'A', updatedAt: '2026-09-12T00:00:00.000Z', intersectionCount: 2 }];
    invoke.mockResolvedValueOnce(summaries);
    const store = new TauriStore();
    expect(store.kind).toBe('tauri');
    expect(await store.list()).toEqual(summaries);
    expect(invoke).toHaveBeenCalledWith('projects_list');
  });

  it('reads through projects_read, passing null through for a missing project', async () => {
    const store = new TauriStore();
    invoke.mockResolvedValueOnce('{"name":"A"}');
    expect(await store.read('p-a')).toBe('{"name":"A"}');
    expect(invoke).toHaveBeenLastCalledWith('projects_read', { id: 'p-a' });

    invoke.mockResolvedValueOnce(null);
    expect(await store.read('p-missing')).toBeNull();
  });

  it('writes and removes through their commands', async () => {
    const store = new TauriStore();
    invoke.mockResolvedValue(null);
    await store.write('p-a', 'text');
    expect(invoke).toHaveBeenLastCalledWith('projects_write', { id: 'p-a', text: 'text' });
    await store.remove('p-a');
    expect(invoke).toHaveBeenLastCalledWith('projects_remove', { id: 'p-a' });
  });

  it('round-trips a project through the shared store helpers', async () => {
    const files = new Map<string, string>();
    invoke.mockImplementation((command: string, args?: { id: string; text?: string }) => {
      if (command === 'projects_write' && args?.text !== undefined) {
        files.set(args.id, args.text);
        return Promise.resolve(null);
      }
      if (command === 'projects_read' && args) {
        return Promise.resolve(files.get(args.id) ?? null);
      }
      return Promise.reject(new Error(`unexpected ${command}`));
    });
    const store = new TauriStore();
    await saveToStore(store, emptyProject('Corridor', 'p-corridor', new Date('2026-09-13T00:00:00.000Z')));
    const loaded = await openFromStore(store, 'p-corridor');
    expect(loaded?.ok && loaded.project.name).toBe('Corridor');
  });

  it('rejects with the command error', async () => {
    invoke.mockRejectedValueOnce('project id "../x" cannot be stored');
    await expect(new TauriStore().read('../x')).rejects.toBe('project id "../x" cannot be stored');
  });
});

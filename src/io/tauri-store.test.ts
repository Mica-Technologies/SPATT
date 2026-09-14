import { beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyProject } from '../model';
import { ConflictError, openFromStore, saveToStore, versionOf } from './store';
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
    invoke.mockResolvedValueOnce({ text: '{"name":"A"}', version: 'v1' });
    expect(await store.read('p-a')).toEqual({ text: '{"name":"A"}', version: 'v1' });
    expect(invoke).toHaveBeenLastCalledWith('projects_read', { id: 'p-a' });

    invoke.mockResolvedValueOnce(null);
    expect(await store.read('p-missing')).toBeNull();
  });

  it('writes with the expected version and removes through their commands', async () => {
    const store = new TauriStore();
    invoke.mockResolvedValue('v2');
    expect(await store.write('p-a', 'text')).toBe('v2');
    expect(invoke).toHaveBeenLastCalledWith('projects_write', { id: 'p-a', text: 'text', expected: { kind: 'any' } });
    await store.write('p-a', 'text', null);
    expect(invoke).toHaveBeenLastCalledWith('projects_write', { id: 'p-a', text: 'text', expected: { kind: 'absent' } });
    await store.write('p-a', 'text', 'v1');
    expect(invoke).toHaveBeenLastCalledWith('projects_write', { id: 'p-a', text: 'text', expected: { kind: 'version', version: 'v1' } });
    invoke.mockResolvedValue(null);
    await store.remove('p-a');
    expect(invoke).toHaveBeenLastCalledWith('projects_remove', { id: 'p-a' });
  });

  it('turns a conflict command error into ConflictError', async () => {
    invoke.mockRejectedValueOnce({ kind: 'conflict', current: 'v9', message: 'the project was changed elsewhere' });
    const error = await new TauriStore().write('p-a', 'x', 'v1').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConflictError);
    expect((error as ConflictError).current).toBe('v9');
  });

  it('round-trips a project through the shared store helpers', async () => {
    const files = new Map<string, string>();
    invoke.mockImplementation((command: string, args?: { id: string; text?: string }) => {
      if (command === 'projects_write' && args?.text !== undefined) {
        files.set(args.id, args.text);
        return Promise.resolve(versionOf(args.text));
      }
      if (command === 'projects_read' && args) {
        const text = files.get(args.id);
        return Promise.resolve(text === undefined ? null : { text, version: versionOf(text) });
      }
      return Promise.reject(new Error(`unexpected ${command}`));
    });
    const store = new TauriStore();
    const version = await saveToStore(store, emptyProject('Corridor', 'p-corridor', new Date('2026-09-13T00:00:00.000Z')), null);
    const loaded = await openFromStore(store, 'p-corridor');
    expect(loaded?.result.ok && loaded.result.project.name).toBe('Corridor');
    expect(loaded?.version).toBe(version);
  });

  it('rejects with the command error message', async () => {
    invoke.mockRejectedValueOnce({ kind: 'failed', message: 'project id "../x" cannot be stored' });
    await expect(new TauriStore().read('../x')).rejects.toThrow('project id "../x" cannot be stored');
  });
});

import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { emptyProject, standardEightPhase } from '../model';
import { BrowserStore } from './browser-store';
import { newProjectId, openFromStore, PROJECT_ID_PATTERN, saveToStore } from './store';

const project = (id: string, name: string, updatedAt: string) => {
  const p = emptyProject(name, id, new Date(updatedAt));
  p.intersections.push(standardEightPhase());
  return p;
};

describe('BrowserStore', () => {
  it('saves, lists newest first, loads and removes projects', async () => {
    const store = new BrowserStore(new IDBFactory());
    await saveToStore(store, project('p-older', 'Older', '2026-09-01T00:00:00.000Z'));
    await saveToStore(store, project('p-newer', 'Newer', '2026-09-12T00:00:00.000Z'));

    expect(await store.list()).toEqual([
      { id: 'p-newer', name: 'Newer', updatedAt: '2026-09-12T00:00:00.000Z', intersectionCount: 1 },
      { id: 'p-older', name: 'Older', updatedAt: '2026-09-01T00:00:00.000Z', intersectionCount: 1 },
    ]);

    const loaded = await openFromStore(store, 'p-newer');
    expect(loaded?.ok && loaded.project.name).toBe('Newer');

    await store.remove('p-newer');
    expect((await store.list()).map((s) => s.id)).toEqual(['p-older']);
    expect(await openFromStore(store, 'p-newer')).toBeNull();
  });

  it('overwrites a project saved twice', async () => {
    const store = new BrowserStore(new IDBFactory());
    const p = project('p-one', 'First name', '2026-09-01T00:00:00.000Z');
    await saveToStore(store, p);
    p.name = 'Renamed';
    await saveToStore(store, p);
    expect((await store.list()).map((s) => s.name)).toEqual(['Renamed']);
  });

  it('still lists a project whose text no longer parses', async () => {
    const store = new BrowserStore(new IDBFactory());
    await store.write('p-broken', '{ not json');
    expect(await store.list()).toEqual([{ id: 'p-broken', name: 'p-broken', updatedAt: '1970-01-01T00:00:00.000Z', intersectionCount: 0 }]);
    const loaded = await openFromStore(store, 'p-broken');
    expect(loaded?.ok).toBe(false);
  });
});

describe('project ids', () => {
  it('generates ids that are safe file names', () => {
    expect(newProjectId()).toMatch(PROJECT_ID_PATTERN);
  });

  it('refuses to store a project with an unsafe id', async () => {
    const store = new BrowserStore(new IDBFactory());
    await expect(saveToStore(store, project('../escape', 'Bad', '2026-09-01T00:00:00.000Z'))).rejects.toThrow();
  });
});

import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { emptyProject, saveProject, standardEightPhase } from '../model';
import { BrowserStore } from './browser-store';
import { ConflictError, newProjectId, openFromStore, PROJECT_ID_PATTERN, saveToStore, versionOf } from './store';

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
    expect(loaded?.result.ok && loaded.result.project.name).toBe('Newer');

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
    expect(loaded?.result.ok).toBe(false);
  });

  it('versions projects by their text and refuses a stale write', async () => {
    const store = new BrowserStore(new IDBFactory());
    const p = project('p-one', 'One', '2026-09-01T00:00:00.000Z');
    const v1 = await saveToStore(store, p, null);
    expect(v1).toBe(versionOf(saveProject(p)));
    expect((await store.read('p-one'))?.version).toBe(v1);
    await expect(saveToStore(store, p, null)).resolves.toBe(v1); // the same text again is not a conflict

    // Two tabs opened v1; the first saves, the second is refused and told the new version.
    p.name = 'Tab one';
    const v2 = await saveToStore(store, p, v1);
    p.name = 'Tab two';
    const refused = await saveToStore(store, p, v1).catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(ConflictError);
    expect((refused as ConflictError).current).toBe(v2);
    expect((await store.list())[0]!.name).toBe('Tab one');

    await store.remove('p-one');
    await expect(saveToStore(store, p, v2)).rejects.toMatchObject({ current: null });
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

describe('versionOf', () => {
  it('is FNV-1a 64 over UTF-8, matching the Rust store', () => {
    expect(versionOf('')).toBe('cbf29ce484222325');
    expect(versionOf('a')).toBe('af63dc4c8601ec8c');
    expect(versionOf('é')).not.toBe(versionOf('e'));
  });
});

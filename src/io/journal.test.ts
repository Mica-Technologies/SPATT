import { describe, expect, it } from 'vitest';
import { emptyProject, saveProject } from '../model';
import { journalProject, recoverJournal } from './journal';
import type { ProjectStore } from './store';

class MemoryStorage implements Storage {
  private readonly items = new Map<string, string>();
  get length() {
    return this.items.size;
  }
  clear() {
    this.items.clear();
  }
  getItem(key: string) {
    return this.items.get(key) ?? null;
  }
  key(index: number) {
    return [...this.items.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.items.delete(key);
  }
  setItem(key: string, value: string) {
    this.items.set(key, value);
  }
}

function memoryStore(files: Record<string, string> = {}): ProjectStore & { files: Record<string, string> } {
  return {
    kind: 'browser',
    files,
    list: () => Promise.resolve([]),
    read: (id) => Promise.resolve(files[id] ?? null),
    write: (id, text) => Promise.resolve(void (files[id] = text)),
    remove: (id) => Promise.resolve(void delete files[id]),
  };
}

const at = (id: string, iso: string) => emptyProject(`Project ${iso}`, id, new Date(iso));

describe('journal', () => {
  it('writes a newer copy to the store and clears it', async () => {
    const storage = new MemoryStorage();
    const store = memoryStore({ 'p-a': saveProject(at('p-a', '2026-09-01T00:00:00.000Z')) });
    const newer = at('p-a', '2026-09-02T00:00:00.000Z');
    journalProject(newer, storage);
    storage.setItem('unrelated', 'kept');

    expect(await recoverJournal(store, storage)).toEqual(['p-a']);
    expect(store.files['p-a']).toBe(saveProject(newer));
    expect(storage.length).toBe(1);
  });

  it('drops a copy that is not newer than the store', async () => {
    const storage = new MemoryStorage();
    const stored = saveProject(at('p-a', '2026-09-02T00:00:00.000Z'));
    const store = memoryStore({ 'p-a': stored });
    journalProject(at('p-a', '2026-09-01T00:00:00.000Z'), storage);

    expect(await recoverJournal(store, storage)).toEqual([]);
    expect(store.files['p-a']).toBe(stored);
    expect(storage.length).toBe(0);
  });

  it('restores a project the store does not have', async () => {
    const storage = new MemoryStorage();
    const store = memoryStore();
    journalProject(at('p-b', '2026-09-01T00:00:00.000Z'), storage);
    expect(await recoverJournal(store, storage)).toEqual(['p-b']);
  });

  it('keeps a copy the store refuses', async () => {
    const storage = new MemoryStorage();
    const store = { ...memoryStore(), write: () => Promise.reject(new Error('disk full')) };
    journalProject(at('p-c', '2026-09-01T00:00:00.000Z'), storage);
    const quiet = console.error;
    console.error = () => {};
    try {
      expect(await recoverJournal(store, storage)).toEqual([]);
    } finally {
      console.error = quiet;
    }
    expect(storage.length).toBe(1);
  });

  it('does nothing without storage', async () => {
    expect(await recoverJournal(memoryStore(), null)).toEqual([]);
    expect(() => journalProject(at('p-d', '2026-09-01T00:00:00.000Z'), null)).not.toThrow();
  });
});

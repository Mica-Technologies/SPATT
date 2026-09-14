/**
 * Project library in the browser's IndexedDB. Used when SPATT runs in a plain browser.
 * Data stays in this browser profile on this device; export a project to move it elsewhere.
 */
import type { ProjectStore, ProjectSummary } from './store';

const DB_NAME = 'spatt';
const DB_VERSION = 1;
const PROJECTS = 'projects';

interface StoredProject {
  id: string;
  text: string;
  summary: ProjectSummary;
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });
}

function openDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  const req = factory.open(DB_NAME, DB_VERSION);
  req.onupgradeneeded = () => {
    if (!req.result.objectStoreNames.contains(PROJECTS)) {
      req.result.createObjectStore(PROJECTS, { keyPath: 'id' });
    }
  };
  return request(req);
}

/** Summary fields read straight from the file text, tolerating a file that no longer validates. */
function summaryOf(id: string, text: string): ProjectSummary {
  try {
    const raw = JSON.parse(text) as { name?: unknown; updatedAt?: unknown; intersections?: unknown };
    return {
      id,
      name: typeof raw.name === 'string' ? raw.name : id,
      updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : new Date(0).toISOString(),
      intersectionCount: Array.isArray(raw.intersections) ? raw.intersections.length : 0,
    };
  } catch {
    return { id, name: id, updatedAt: new Date(0).toISOString(), intersectionCount: 0 };
  }
}

export class BrowserStore implements ProjectStore {
  readonly kind = 'browser' as const;
  private db: Promise<IDBDatabase> | null = null;
  private readonly factory: IDBFactory;

  constructor(factory: IDBFactory = indexedDB) {
    this.factory = factory;
  }

  private async objects(mode: IDBTransactionMode): Promise<IDBObjectStore> {
    this.db ??= openDatabase(this.factory);
    return (await this.db).transaction(PROJECTS, mode).objectStore(PROJECTS);
  }

  async list(): Promise<ProjectSummary[]> {
    const all = (await request((await this.objects('readonly')).getAll())) as StoredProject[];
    return all.map((p) => p.summary).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async read(id: string): Promise<string | null> {
    const found = (await request((await this.objects('readonly')).get(id))) as StoredProject | undefined;
    return found?.text ?? null;
  }

  async write(id: string, text: string): Promise<void> {
    const record: StoredProject = { id, text, summary: summaryOf(id, text) };
    const objects = await this.objects('readwrite');
    const done = request(objects.put(record));
    // Commit now rather than when the transaction goes idle: a write made while the page is
    // being unloaded (autosave's pagehide flush) is otherwise aborted with the page.
    objects.transaction.commit?.();
    await done;
  }

  async remove(id: string): Promise<void> {
    await request((await this.objects('readwrite')).delete(id));
  }
}

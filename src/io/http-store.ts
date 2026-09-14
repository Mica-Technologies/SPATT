/**
 * Project library on a SPATT server (`crates/spatt-server/src/api.rs`), shared by every device
 * that opens the server. Requests go to `./api/...` relative to the page, so the UI works
 * wherever the server is mounted. Access is by cookie (set by an access link or `signIn`).
 */
import { ConflictError, type ExpectedVersion, type ProjectStore, type ProjectSummary, type StoredProject } from './store';

/** The server wants the access token (another device without the cookie). */
export class AccessRequiredError extends Error {
  constructor() {
    super('This SPATT server needs an access link or token');
    this.name = 'AccessRequiredError';
  }
}

const unquote = (etag: string | null): string | null => (etag === null ? null : etag.replace(/^W\//, '').replace(/^"|"$/g, ''));

async function failure(response: Response, what: string): Promise<never> {
  if (response.status === 401) {
    throw new AccessRequiredError();
  }
  let detail = '';
  try {
    const body = (await response.json()) as { error?: string; message?: string };
    detail = body.message ?? body.error ?? '';
  } catch {
    // not JSON
  }
  throw new Error(`${what}: HTTP ${response.status}${detail ? ` (${detail})` : ''}`);
}

export class HttpStore implements ProjectStore {
  readonly kind = 'server' as const;
  private readonly base: string;
  private readonly fetch: typeof fetch;

  constructor(base = './api', fetchImpl: typeof fetch = (...args) => fetch(...args)) {
    this.base = base;
    this.fetch = fetchImpl;
  }

  private url(id?: string): string {
    return id === undefined ? `${this.base}/projects` : `${this.base}/projects/${encodeURIComponent(id)}`;
  }

  async list(): Promise<ProjectSummary[]> {
    const response = await this.fetch(this.url(), { headers: { accept: 'application/json' }, cache: 'no-store' });
    if (!response.ok) await failure(response, 'Listing projects');
    return (await response.json()) as ProjectSummary[];
  }

  async read(id: string): Promise<StoredProject | null> {
    const response = await this.fetch(this.url(id), { cache: 'no-store' });
    if (response.status === 404) return null;
    if (!response.ok) await failure(response, `Reading project ${id}`);
    const version = unquote(response.headers.get('etag'));
    if (version === null) throw new Error(`Reading project ${id}: the server sent no version`);
    return { text: await response.text(), version };
  }

  async write(id: string, text: string, expected?: ExpectedVersion): Promise<string> {
    const condition: Record<string, string> = expected === undefined ? { 'if-match': '*' } : expected === null ? { 'if-none-match': '*' } : { 'if-match': `"${expected}"` };
    const response = await this.fetch(this.url(id), { method: 'PUT', headers: { 'content-type': 'application/json', ...condition }, body: text });
    if (response.status === 412) {
      throw new ConflictError(unquote(response.headers.get('etag')));
    }
    if (!response.ok) await failure(response, `Saving project ${id}`);
    const version = unquote(response.headers.get('etag'));
    if (version === null) throw new Error(`Saving project ${id}: the server sent no version`);
    return version;
  }

  async remove(id: string): Promise<void> {
    const response = await this.fetch(this.url(id), { method: 'DELETE' });
    if (!response.ok && response.status !== 404) await failure(response, `Deleting project ${id}`);
  }

  /** Whether this browser may use the API (`/api/session`). */
  async hasAccess(): Promise<boolean> {
    const response = await this.fetch(`${this.base}/session`, { cache: 'no-store' });
    return response.ok;
  }

  /** Trades a pasted token for the access cookie. Resolves `false` for a wrong token. */
  async signIn(token: string): Promise<boolean> {
    const response = await this.fetch(`${this.base}/session`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token }) });
    return response.ok;
  }
}

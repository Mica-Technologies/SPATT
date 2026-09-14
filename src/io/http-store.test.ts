import { describe, expect, it } from 'vitest';
import { AccessRequiredError, HttpStore } from './http-store';
import { ConflictError, versionOf } from './store';

/** A fake spatt-server following `crates/spatt-server/src/api.rs`. */
function fakeServer({ token }: { token?: string } = {}) {
  const files = new Map<string, string>();
  const calls: { method: string; url: string; headers: Record<string, string> }[] = [];
  let signedIn = token === undefined;
  const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

  const fetchImpl = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    const method = init.method ?? 'GET';
    const headers = Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]));
    calls.push({ method, url, headers });
    if (url === './api/session') {
      if (method === 'POST') {
        const ok = (JSON.parse(String(init.body)) as { token: string }).token === token;
        signedIn ||= ok;
        return new Response(null, { status: ok ? 204 : 401 });
      }
      return new Response(null, { status: signedIn ? 204 : 401 });
    }
    if (!signedIn) return json(401, { error: 'access-token-required' });
    if (url === './api/projects') {
      return json(200, [...files.keys()].map((id) => ({ id, name: id, updatedAt: '', intersectionCount: 0 })));
    }
    const id = decodeURIComponent(url.replace('./api/projects/', ''));
    const current = files.has(id) ? versionOf(files.get(id)!) : null;
    const etag = (v: string | null): Record<string, string> => (v === null ? {} : { etag: `"${v}"` });
    if (method === 'GET') {
      return current === null ? json(404, { error: 'not-found' }) : new Response(files.get(id), { status: 200, headers: etag(current) });
    }
    if (method === 'DELETE') {
      files.delete(id);
      return new Response(null, { status: 204 });
    }
    const text = String(init.body);
    const ifMatch = headers['if-match'];
    const ok = ifMatch === '*' || (ifMatch !== undefined && ifMatch === `"${current}"`) || (headers['if-none-match'] === '*' && current === null) || current === versionOf(text);
    if (!ok) return json(412, { error: 'conflict' }, etag(current));
    files.set(id, text);
    return json(200, { version: versionOf(text) }, etag(versionOf(text)));
  }) as typeof fetch;

  return { store: new HttpStore('./api', fetchImpl), files, calls };
}

describe('HttpStore', () => {
  it('creates, reads with its version, updates from that version and lists', async () => {
    const { store, calls } = fakeServer();
    expect(store.kind).toBe('server');
    const v1 = await store.write('p-one', '{"a":1}', null);
    expect(calls.at(-1)).toMatchObject({ method: 'PUT', url: './api/projects/p-one', headers: { 'if-none-match': '*' } });
    expect(await store.read('p-one')).toEqual({ text: '{"a":1}', version: v1 });

    const v2 = await store.write('p-one', '{"a":2}', v1);
    expect(calls.at(-1)!.headers['if-match']).toBe(`"${v1}"`);
    expect(v2).toBe(versionOf('{"a":2}'));
    expect((await store.list()).map((s) => s.id)).toEqual(['p-one']);

    await store.write('p-one', '{"a":3}');
    expect(calls.at(-1)!.headers['if-match']).toBe('*');
  });

  it('reports a stale write as ConflictError with the current version', async () => {
    const { store, files } = fakeServer();
    const v1 = await store.write('p-one', 'mine', null);
    files.set('p-one', 'theirs');
    const error = await store.write('p-one', 'mine again', v1).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConflictError);
    expect((error as ConflictError).current).toBe(versionOf('theirs'));

    files.delete('p-one');
    await expect(store.write('p-one', 'mine again', v1)).rejects.toMatchObject({ current: null });
    expect(await store.read('p-one')).toBeNull();
  });

  it('asks for access until signed in', async () => {
    const { store } = fakeServer({ token: 'abcdefghijklmnop' });
    expect(await store.hasAccess()).toBe(false);
    await expect(store.list()).rejects.toBeInstanceOf(AccessRequiredError);
    expect(await store.signIn('wrong')).toBe(false);
    expect(await store.signIn('abcdefghijklmnop')).toBe(true);
    expect(await store.hasAccess()).toBe(true);
    expect(await store.list()).toEqual([]);
  });
});

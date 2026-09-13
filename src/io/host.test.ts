import { describe, expect, it } from 'vitest';
import { detectHost } from './host';

const respond = (status: number, body: unknown): typeof fetch =>
  (async () => new Response(JSON.stringify(body), { status })) as typeof fetch;

describe('detectHost', () => {
  it('recognises spatt-server by its health payload', async () => {
    expect(await detectHost(respond(200, { app: 'spatt', version: '2026.9.1300' }))).toBe('server');
  });

  it('treats any other 200 as a plain host', async () => {
    expect(await detectHost(respond(200, { status: 'ok' }))).toBe('browser');
  });

  it('falls back to browser when the request fails', async () => {
    const failing = (async () => {
      throw new TypeError('network');
    }) as typeof fetch;
    expect(await detectHost(failing)).toBe('browser');
  });
});

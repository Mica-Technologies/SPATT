#!/usr/bin/env node
/**
 * Starts a built spatt-server binary and checks it serves the API and the embedded web UI.
 * A server whose UI failed to embed still answers /api/health, so both are checked, and a project
 * is written and read back through the API in a temporary data folder.
 *
 * Usage: node scripts/smoke-server.mjs <path to spatt-server binary> [port]
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [binary, portArg] = process.argv.slice(2);
if (!binary) {
  console.error('Usage: node scripts/smoke-server.mjs <spatt-server binary> [port]');
  process.exit(2);
}
const port = Number(portArg ?? 18787);
const base = `http://127.0.0.1:${port}`;

const data = mkdtempSync(join(tmpdir(), 'spatt-smoke-'));
const server = spawn(binary, ['--bind', '127.0.0.1', '--port', String(port), '--data', data], { stdio: 'inherit' });
let exited = false;
server.on('exit', () => {
  exited = true;
});

async function waitForHealth() {
  for (let attempt = 0; attempt < 50; attempt++) {
    if (exited) {
      throw new Error('spatt-server exited before it answered');
    }
    try {
      const response = await fetch(`${base}/api/health`);
      if (response.ok) {
        return response.json();
      }
    } catch {
      // not listening yet
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('spatt-server did not answer /api/health within 10 s');
}

async function expectPage(path, needle) {
  const response = await fetch(`${base}${path}`);
  const text = await response.text();
  if (!response.ok || !text.includes(needle)) {
    throw new Error(`${path}: HTTP ${response.status}, expected a page containing ${JSON.stringify(needle)}`);
  }
  console.log(`${path}: OK`);
}

async function expectProjectRoundTrip() {
  const text = JSON.stringify({ name: 'Smoke', updatedAt: '2026-01-01T00:00:00.000Z', intersections: [] });
  const put = await fetch(`${base}/api/projects/p-smoke`, { method: 'PUT', headers: { 'if-none-match': '*' }, body: text });
  const etag = put.headers.get('etag');
  const read = await fetch(`${base}/api/projects/p-smoke`);
  const list = await (await fetch(`${base}/api/projects`)).json();
  if (!put.ok || !etag || (await read.text()) !== text || read.headers.get('etag') !== etag || list[0]?.name !== 'Smoke') {
    throw new Error(`project API: PUT ${put.status}, ETag ${etag}, list ${JSON.stringify(list)}`);
  }
  console.log('/api/projects: OK');
}

try {
  const health = await waitForHealth();
  if (health.app !== 'spatt') {
    throw new Error(`/api/health returned ${JSON.stringify(health)}`);
  }
  console.log(`/api/health: OK (${health.version})`);
  await expectPage('/', '<div id="root">');
  await expectPage('/manager.html', 'SPATT Manager');
  await expectPage('/some/client/route', '<div id="root">');
  await expectProjectRoundTrip();
  console.log('spatt-server smoke test passed');
} catch (error) {
  console.error(`spatt-server smoke test FAILED: ${error.message}`);
  process.exitCode = 1;
} finally {
  server.kill();
  server.on('exit', () => rmSync(data, { recursive: true, force: true }));
}

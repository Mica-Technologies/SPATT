#!/usr/bin/env node
/**
 * Builds the Linux installers and headless server in Docker, from any host OS.
 * Output lands in release-assets/. Needs Docker running.
 *
 * Caches (cargo registry, target dir, npm) live in named volumes so repeat builds are fast.
 */
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const image = 'spatt-linux-build:22.04';

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit', cwd: root });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

run('docker', ['build', '-t', image, join(root, 'docker', 'linux-build')]);
run('docker', [
  'run', '--rm',
  '-v', `${root}:/src`,
  '-v', 'spatt-linux-cargo-registry:/opt/cargo/registry',
  '-v', 'spatt-linux-target:/work/spatt/target',
  '-v', 'spatt-linux-npm:/root/.npm',
  '-e', `SPATT_BUNDLES=${process.env.SPATT_BUNDLES ?? 'deb,rpm,appimage'}`,
  image,
]);

#!/usr/bin/env node
/**
 * Copies one platform's build outputs into release-assets/ under stable, descriptive names:
 *   SPATT-<version>-<os>-<arch>-setup.exe / .msi / .dmg / .deb / .rpm / .AppImage
 *   spatt-server-<version>-<os>-<arch>[.exe]
 *
 * Usage: node scripts/collect-release-assets.mjs --target <rust triple> --version <semver>
 *
 * Fails when an expected artifact is missing, so a bundler that silently skipped a format
 * breaks the release instead of shipping without it.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Per target: OS and arch labels, and the bundle directories expected to hold one file each. */
export const TARGETS = {
  'x86_64-pc-windows-msvc': {
    os: 'windows',
    arch: 'x64',
    bundles: [
      { dir: 'nsis', ext: '.exe', suffix: '-setup.exe' },
      { dir: 'msi', ext: '.msi', suffix: '.msi' },
    ],
    exe: '.exe',
  },
  'x86_64-unknown-linux-gnu': {
    os: 'linux',
    arch: 'x86_64',
    bundles: [
      { dir: 'deb', ext: '.deb', suffix: '.deb' },
      { dir: 'rpm', ext: '.rpm', suffix: '.rpm' },
      { dir: 'appimage', ext: '.AppImage', suffix: '.AppImage' },
    ],
    exe: '',
  },
  'aarch64-apple-darwin': {
    os: 'macos',
    arch: 'arm64',
    bundles: [{ dir: 'dmg', ext: '.dmg', suffix: '.dmg' }],
    exe: '',
  },
  'x86_64-apple-darwin': {
    os: 'macos',
    arch: 'x64',
    bundles: [{ dir: 'dmg', ext: '.dmg', suffix: '.dmg' }],
    exe: '',
  },
};

export function assetNames(target, version) {
  const spec = TARGETS[target];
  if (!spec) {
    throw new Error(`Unknown target ${target}`);
  }
  const stem = `${version}-${spec.os}-${spec.arch}`;
  return {
    bundles: spec.bundles.map((b) => ({ ...b, name: `SPATT-${stem}${b.suffix}` })),
    server: `spatt-server-${stem}${spec.exe}`,
  };
}

function argValue(argv, name) {
  const index = argv.indexOf(name);
  if (index < 0 || !argv[index + 1]) {
    throw new Error(`Missing ${name}`);
  }
  return argv[index + 1];
}

function main(argv) {
  const target = argValue(argv, '--target');
  const version = argValue(argv, '--version');
  const { bundles, server } = assetNames(target, version);
  const release = join(root, 'target', target, 'release');
  const out = join(root, 'release-assets');
  mkdirSync(out, { recursive: true });

  for (const bundle of bundles) {
    const dir = join(release, 'bundle', bundle.dir);
    const found = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(bundle.ext)) : [];
    if (found.length !== 1) {
      throw new Error(`Expected one ${bundle.ext} in ${dir}, found ${found.length}: ${found.join(', ')}`);
    }
    copyFileSync(join(dir, found[0]), join(out, bundle.name));
    console.log(`${found[0]} -> ${bundle.name}`);
  }

  const serverBinary = join(release, `spatt-server${TARGETS[target].exe}`);
  if (!existsSync(serverBinary)) {
    throw new Error(`Missing ${serverBinary}`);
  }
  copyFileSync(serverBinary, join(out, server));
  console.log(`spatt-server -> ${server}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2));
}

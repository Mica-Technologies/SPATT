#!/usr/bin/env node
/**
 * Release versioning for SPATT, shared by the release workflow and local builds.
 *
 * Tags follow the same scheme as Mica's other projects:
 *   release      YYYY.MM.DD          (a second release that UTC day: YYYY.MM.DD+1, +2, ...)
 *   pre-release  YYYY.MM.DD-pre.HHMM+<short sha>
 *
 * Installers need versions their formats accept, which a date tag is not:
 *   semver (Cargo, package.json, Tauri, deb, dmg, NSIS)
 *                YYYY.M.P  where P = day * 100 + N (N = the day's release number, 0 first)
 *                pre-releases append -pre.<HHMM as a number>, so they sort before the release
 *                they lead up to
 *   MSI          (YYYY - 2000).M.P.B  — MSI caps major/minor at 255 and patch/build at 65535;
 *                B is HHMM for a pre-release and 9999 for a release
 *
 * Usage:
 *   node scripts/version.mjs [--release] [--sha <sha>] [--versions <json>] [--apply] [--github-output]
 *     --release        compute a full release (default: pre-release)
 *     --sha            commit to name in a pre-release tag (default: git rev-parse --short HEAD)
 *     --versions       use these already-computed versions (the `json` output) instead
 *     --apply          write the version into package.json, Cargo.toml and tauri.conf.json
 *     --github-output  append key=value lines to $GITHUB_OUTPUT
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const pad2 = (n) => String(n).padStart(2, '0');

/**
 * @param {{ now: Date, shortSha: string, existingTags: string[], release: boolean }} input
 */
export function computeVersions({ now, shortSha, existingTags, release }) {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;
  const day = now.getUTCDate();
  const hhmm = now.getUTCHours() * 100 + now.getUTCMinutes();
  const base = `${year}.${pad2(month)}.${pad2(day)}`;

  // The release number this day's next full release gets: 0 if none yet, else one past the
  // highest +N suffix (the bare base tag counts as 0).
  let highest = -1;
  const tags = new Set(existingTags);
  if (tags.has(base)) {
    highest = 0;
  }
  for (const tag of tags) {
    const match = tag.startsWith(`${base}+`) ? /^\d+$/.exec(tag.slice(base.length + 1)) : null;
    if (match) {
      highest = Math.max(highest, Number(match[0]));
    }
  }
  const releaseNumber = highest + 1;
  if (releaseNumber > 99) {
    throw new Error(`More than 99 releases on ${base}; the patch encoding would overflow`);
  }
  const patch = day * 100 + releaseNumber;

  if (year < 2000 || year > 2255) {
    throw new Error(`Year ${year} does not fit the MSI major version`);
  }
  const msiMajor = year - 2000;

  if (release) {
    return {
      prerelease: false,
      tag: releaseNumber === 0 ? base : `${base}+${releaseNumber}`,
      display: releaseNumber === 0 ? base : `${base}+${releaseNumber}`,
      semver: `${year}.${month}.${patch}`,
      msi: `${msiMajor}.${month}.${patch}.9999`,
    };
  }
  if (!/^[0-9a-f]{4,40}$/.test(shortSha)) {
    throw new Error(`Not a commit sha: ${shortSha}`);
  }
  const tag = `${base}-pre.${pad2(Math.floor(hhmm / 100))}${pad2(hhmm % 100)}+${shortSha}`;
  return {
    prerelease: true,
    tag,
    display: tag,
    semver: `${year}.${month}.${patch}-pre.${hhmm}`,
    msi: `${msiMajor}.${month}.${patch}.${hhmm}`,
  };
}

/** Writes the computed versions into the files the builds read them from. */
export function applyVersions(root, versions) {
  const packagePath = join(root, 'package.json');
  const pkg = JSON.parse(readFileSync(packagePath, 'utf8'));
  pkg.version = versions.semver;
  writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);

  const cargoPath = join(root, 'Cargo.toml');
  const cargo = readFileSync(cargoPath, 'utf8');
  const section = /(\[workspace\.package\][^[]*?^version\s*=\s*)"[^"]*"/m;
  if (!section.test(cargo)) {
    throw new Error('Cargo.toml has no [workspace.package] version to set');
  }
  writeFileSync(cargoPath, cargo.replace(section, `$1"${versions.semver}"`));

  const tauriPath = join(root, 'src-tauri', 'tauri.conf.json');
  const tauri = JSON.parse(readFileSync(tauriPath, 'utf8'));
  tauri.bundle.windows ??= {};
  tauri.bundle.windows.wix = { ...tauri.bundle.windows.wix, version: versions.msi };
  writeFileSync(tauriPath, `${JSON.stringify(tauri, null, 2)}\n`);
}

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

function argValue(argv, name) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

function main(argv) {
  // --versions '<json>' reuses versions computed earlier, so every build job in a release run
  // stamps the same numbers (computing again would read a different clock).
  const given = argValue(argv, '--versions');
  let versions;
  if (given) {
    versions = JSON.parse(given);
  } else {
    const release = argv.includes('--release');
    const shortSha = (argValue(argv, '--sha') ?? git(['rev-parse', '--short', 'HEAD'])).slice(0, 9);
    const existingTags = git(['tag', '-l']).split(/\r?\n/).filter(Boolean);
    versions = computeVersions({ now: new Date(), shortSha, existingTags, release });
  }

  if (argv.includes('--apply')) {
    applyVersions(join(dirname(fileURLToPath(import.meta.url)), '..'), versions);
  }
  if (argv.includes('--github-output')) {
    const outputPath = process.env.GITHUB_OUTPUT;
    if (!outputPath) {
      throw new Error('--github-output needs $GITHUB_OUTPUT');
    }
    const lines = Object.entries(versions).map(([k, v]) => `${k}=${v}\n`);
    lines.push(`json=${JSON.stringify(versions)}\n`);
    appendFileSync(outputPath, lines.join(''));
  }
  process.stdout.write(`${JSON.stringify(versions, null, 2)}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2));
}

#!/usr/bin/env node
/**
 * Tests SPATT's Linux background modes in a systemd container: install the service, reach it,
 * see it from an ordinary user, change its port, reboot the container, remove it; install start at
 * login for a user and run its autostart entry under a virtual display.
 *
 * Needs Docker and a Linux .deb in release-assets/ (`SPATT_BUNDLES=deb npm run build:linux`).
 * Usage: node scripts/test-linux-background.mjs
 */
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const image = 'spatt-systemd-test:22.04';
const name = 'spatt-systemd-test';
const deb = readdirSync(join(root, 'release-assets')).find((f) => f.endsWith('.deb'));
if (!deb) {
  console.error('No .deb in release-assets/: run `SPATT_BUNDLES=deb npm run build:linux` first.');
  process.exit(1);
}

let failures = 0;
function docker(args, { allowFail = false, quiet = false } = {}) {
  const result = spawnSync('docker', args, { cwd: root, encoding: 'utf8' });
  const out = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
  if (!quiet && out) console.log(out);
  if (result.status !== 0 && !allowFail) throw new Error(`docker ${args.join(' ')} failed (${result.status})`);
  return { code: result.status, out };
}
const sh = (script, user = 'root', opts = {}) => docker(['exec', '-u', user, name, 'bash', '-lc', script], opts);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function check(label, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

async function waitFor(label, script, want, tries = 40) {
  for (let i = 0; i < tries; i++) {
    const { out } = sh(script, 'root', { allowFail: true, quiet: true });
    if (out.includes(want)) return check(label, true);
    await sleep(500);
  }
  const { out } = sh(script, 'root', { allowFail: true, quiet: true });
  check(label, false, out.slice(0, 300));
}

const health = (port) => `curl -s http://127.0.0.1:${port}/api/health`;

console.log('== Image and container');
docker(['build', '-t', image, join(root, 'docker', 'systemd-test')]);
docker(['rm', '-f', name], { allowFail: true, quiet: true });
docker(['run', '-d', '--name', name, '--privileged', '--cgroupns=host', '-v', '/sys/fs/cgroup:/sys/fs/cgroup:rw', '--tmpfs', '/run', '--tmpfs', '/run/lock', '-v', `${join(root, 'release-assets')}:/assets:ro`, image]);
try {
  await waitFor('systemd is running', 'systemctl is-system-running 2>&1 || true', 'running');
  sh(`apt-get install -y /assets/${deb} >/tmp/apt.log 2>&1 || (apt-get update >/dev/null && apt-get install -y /assets/${deb} >/tmp/apt.log 2>&1); tail -1 /tmp/apt.log`);
  const exe = sh('command -v spatt || ls /usr/bin | grep -i spatt', 'root', { quiet: true }).out.split('\n')[0];
  check('SPATT is installed', exe.length > 0, exe);

  console.log('== System service');
  const install = sh('spatt --install-headless --mode service', 'root', { allowFail: true });
  check('install the service as root', install.code === 0, install.out);
  await waitFor('the service is active', 'systemctl is-active spatt.service', 'active');
  await waitFor('the service serves on 8787', health(8787), '"app":"spatt"');
  const unit = sh('cat /etc/systemd/system/spatt.service', 'root', { quiet: true }).out;
  check('the unit runs spatt --service as the spatt user', unit.includes('--service') && unit.includes('User=spatt'));
  const owner = sh('stat -c %U /var/lib/spatt', 'root', { quiet: true }).out;
  check('the spatt user owns /var/lib/spatt', owner === 'spatt', owner);
  const userStatus = sh('spatt --status', 'tester', { allowFail: true, quiet: true }).out;
  check('an ordinary user sees the service serving', userStatus.includes('Service serving at http://127.0.0.1:8787/'), userStatus);
  const clash = sh('install -m 755 /assets/spatt-server-*-linux-x86_64 /usr/local/bin/spatt-server && timeout 10 spatt-server --data /var/lib/spatt --port 8799 2>&1; true', 'root', { allowFail: true, quiet: true }).out;
  check('spatt-server refuses the service library', clash.includes('in use by'), clash.split('\n').slice(-2).join(' '));

  const configure = sh('spatt --configure-service --port 8790', 'root', { allowFail: true });
  check('change the service port', configure.code === 0, configure.out);
  await waitFor('the service serves on 8790 after its restart', health(8790), '"app":"spatt"');

  console.log('== Reboot');
  docker(['restart', name], { quiet: true });
  await waitFor('systemd is running again', 'systemctl is-system-running 2>&1 || true', 'running');
  await waitFor('the service started at boot', 'systemctl is-active spatt.service', 'active');
  await waitFor('and serves on 8790', health(8790), '"app":"spatt"');

  console.log('== A user with the service installed');
  const blocked = sh('spatt --install-headless --mode login', 'tester', { allowFail: true, quiet: true });
  check('a user cannot replace the service without administrator rights', blocked.code !== 0 && blocked.out.includes('sudo'), blocked.out);

  console.log('== Remove the service');
  const remove = sh('spatt --uninstall-headless --mode service --delete-data', 'root', { allowFail: true });
  check('remove the service with its data', remove.code === 0, remove.out);
  const left = sh('test -e /etc/systemd/system/spatt.service && echo unit; test -e /var/lib/spatt && echo data; systemctl is-active spatt.service; true', 'root', { allowFail: true, quiet: true }).out;
  check('no unit or data left, service inactive', !left.includes('unit') && !left.includes('data') && !/^active$/m.test(left), left.replace(/\n/g, ' '));
  const afterStatus = sh('spatt --status', 'root', { allowFail: true, quiet: true }).out;
  check('status reports no service', afterStatus.includes('System service: not installed'));

  console.log('== Start at login (user tester, no service)');
  const login = sh('spatt --install-headless --mode login', 'tester', { allowFail: true });

  check('install start at login', login.code === 0, login.out);
  const entry = sh('cat ~/.config/autostart/spatt-headless.desktop', 'tester', { allowFail: true, quiet: true }).out;
  check('the autostart entry runs spatt --headless', /Exec=.*spatt.* --headless/.test(entry), entry.split('\n').find((l) => l.startsWith('Exec=')));
  // A login session: run the autostart command the way a desktop would, on a virtual display.
  const exec = entry.split('\n').find((l) => l.startsWith('Exec='))?.slice(5).replace(/%%/g, '%') ?? '';
  sh(`nohup dbus-run-session -- xvfb-run -a ${exec} >/tmp/headless.log 2>&1 &`, 'tester', { allowFail: true, quiet: true });
  await waitFor('the login session serves the user library on 8787', health(8787), '"app":"spatt"', 80);
  const held = sh('spatt --status', 'tester', { allowFail: true, quiet: true }).out;
  check('status shows the user library open in the headless app', held.includes('open in the SPATT app (headless)'), held.split('\n').slice(-1)[0]);
  // Log off (the session's processes end) and log in again: the library lock is released and the
  // next session serves again.
  sh('pkill -f "spatt --headless" || true', 'root', { allowFail: true, quiet: true });
  await waitFor('logging off stops the server', `${health(8787)} || echo stopped`, 'stopped');
  sh(`nohup dbus-run-session -- xvfb-run -a ${exec} >/tmp/headless2.log 2>&1 &`, 'tester', { allowFail: true, quiet: true });
  await waitFor('logging in again serves on 8787', health(8787), '"app":"spatt"', 80);
  sh('pkill -f "spatt --headless" || true', 'root', { allowFail: true, quiet: true });
  const loginOff = sh('spatt --uninstall-headless --mode login && test ! -e ~/.config/autostart/spatt-headless.desktop && spatt --status | grep -q "Start at login: not installed" && echo gone', 'tester', { allowFail: true });
  check('remove start at login', loginOff.out.includes('gone'));

} finally {
  if (failures > 0) {
    console.log('\n-- service journal');
    sh('journalctl -u spatt.service --no-pager -n 30; cat /tmp/headless.log 2>/dev/null | tail -20', 'root', { allowFail: true });
  }
  docker(['rm', '-f', name], { allowFail: true, quiet: true });
}
console.log(failures === 0 ? '\nAll Linux background-mode checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);

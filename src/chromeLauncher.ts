/**
 * Launches the user's own Chrome for a web preview panel.
 *
 * One browser per terminal session, each on its own profile, so two agents
 * working in two worktrees never share a window or a debugging port. The
 * profile dir is also the handle for everything else: Chrome writes the
 * debugging port it settled on into `DevToolsActivePort` under it, and a second
 * launch pointed at the same dir is handed to the running instance as a new tab
 * instead of starting a browser.
 *
 * Main process only — the renderer reaches this through the `chrome:*` channels.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { getUserDataPath } from './paths';
import { getLogger } from './logger';
import type { ChromeInstanceInfo, ChromeLaunchResult, PtyId } from './types';

const chromeLog = getLogger().scope('chrome');

const PORT_FILE = 'DevToolsActivePort';
const PORT_FILE_TIMEOUT_MS = 15_000;
const PORT_FILE_POLL_MS = 100;

interface ChromeInstance extends ChromeInstanceInfo {
  profileDir: string;
  child: ChildProcess;
}

const instances = new Map<PtyId, ChromeInstance>();

let resolveBinary: () => string | null = findChromeBinary;

let onChange: ((ptyId: PtyId, instance: ChromeInstanceInfo | null) => void) | null = null;

/** Announce launches and exits so the panel's button can follow a browser the user quit. */
export function setChromeChangeListener(
  fn: ((ptyId: PtyId, instance: ChromeInstanceInfo | null) => void) | null,
): void {
  onChange = fn;
}

/** Swap the binary lookup. Tests hand in a stand-in that honours the port file. */
export function setChromeBinaryResolver(fn: () => string | null): void {
  resolveBinary = fn;
}

// ── Finding Chrome ───────────────────────────────────────────────────

const MACOS_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
];

const LINUX_CANDIDATES = [
  '/opt/google/chrome/chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/snap/bin/chromium',
];

function windowsCandidates(): string[] {
  const roots = [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA];
  return roots
    .filter((root): root is string => !!root)
    .map((root) => path.join(root, 'Google', 'Chrome', 'Application', 'chrome.exe'));
}

let cachedBinary: string | null | undefined;

function findChromeBinary(): string | null {
  if (cachedBinary !== undefined) return cachedBinary;

  const candidates =
    process.platform === 'darwin'
      ? MACOS_CANDIDATES
      : process.platform === 'win32'
        ? windowsCandidates()
        : LINUX_CANDIDATES;

  cachedBinary = null;
  for (const candidate of candidates) {
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      cachedBinary = candidate;
      break;
    } catch {
      // keep looking
    }
  }

  // A GUI Electron app doesn't inherit the login shell's PATH, so this only
  // finds Chrome installed somewhere the app's own PATH already reaches.
  if (!cachedBinary && process.platform !== 'win32') {
    for (const name of ['google-chrome', 'google-chrome-stable', 'chromium']) {
      try {
        const found = execFileSync('which', [name], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
        if (found) {
          cachedBinary = found;
          break;
        }
      } catch {
        // keep looking
      }
    }
  }

  return cachedBinary;
}

// ── Profiles ─────────────────────────────────────────────────────────

function profilesRoot(): string {
  return path.join(getUserDataPath(), 'chrome');
}

function profileDirFor(ptyId: PtyId): string {
  return path.join(profilesRoot(), ptyId);
}

/**
 * Drop profiles left behind by a crash or a kill. Called at startup, when no
 * instance can be running yet, so every directory under the root is stale.
 */
export function pruneChromeProfiles(): void {
  let entries: string[];
  try {
    entries = fs.readdirSync(profilesRoot());
  } catch {
    return; // never launched
  }
  for (const entry of entries) {
    try {
      fs.rmSync(path.join(profilesRoot(), entry), { recursive: true, force: true });
    } catch (err) {
      chromeLog.warn('could not remove stale profile', { entry, error: String(err) });
    }
  }
}

// ── Launching ────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Chrome writes the port it bound to as the first line of `DevToolsActivePort`,
 * and only once the endpoint is listening. Asking for port 0 and reading the
 * answer back is race-free in a way that picking a free port ourselves is not.
 */
async function readDebuggingPort(profileDir: string, child: ChildProcess): Promise<number> {
  const deadline = Date.now() + PORT_FILE_TIMEOUT_MS;
  const portFile = path.join(profileDir, PORT_FILE);
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`Chrome exited before the debugging port was ready (code ${child.exitCode})`);
    }
    try {
      const port = parseInt(fs.readFileSync(portFile, 'utf8').split('\n')[0], 10);
      if (port > 0) return port;
    } catch {
      // not written yet
    }
    await sleep(PORT_FILE_POLL_MS);
  }
  throw new Error('Timed out waiting for Chrome to report its debugging port');
}

/**
 * Open `url` in the session's Chrome, starting one if it isn't running.
 *
 * Handing the URL to a live instance is a second spawn against the same
 * profile: Chrome forwards it to the running browser as a tab and exits at
 * once, which is cheaper than speaking CDP to open a tab.
 */
export async function launchChrome(ptyId: PtyId, url: string): Promise<ChromeLaunchResult> {
  const binary = resolveBinary();
  if (!binary) {
    return { ok: false, error: 'Chrome is not installed, or is somewhere Ouijit cannot see' };
  }

  const profileDir = profileDirFor(ptyId);
  const existing = instances.get(ptyId);
  if (existing) {
    spawn(binary, [`--user-data-dir=${profileDir}`, url], { detached: true, stdio: 'ignore' }).unref();
    return { ok: true, instance: { pid: existing.pid, cdpUrl: existing.cdpUrl } };
  }

  try {
    fs.mkdirSync(profileDir, { recursive: true });
  } catch (err) {
    return { ok: false, error: `Could not create the Chrome profile: ${String(err)}` };
  }

  const child = spawn(
    binary,
    [
      `--user-data-dir=${profileDir}`,
      '--remote-debugging-port=0',
      '--no-first-run',
      '--no-default-browser-check',
      '--auto-open-devtools-for-tabs',
      url,
    ],
    { detached: false, stdio: 'ignore' },
  );

  if (!child.pid) {
    return { ok: false, error: 'Chrome failed to start' };
  }

  try {
    const port = await readDebuggingPort(profileDir, child);
    const instance: ChromeInstance = { pid: child.pid, cdpUrl: `http://127.0.0.1:${port}`, profileDir, child };
    instances.set(ptyId, instance);
    child.on('exit', () => {
      if (instances.get(ptyId) === instance) instances.delete(ptyId);
      onChange?.(ptyId, null);
    });
    chromeLog.info('launched', { ptyId, pid: child.pid, cdpUrl: instance.cdpUrl });
    onChange?.(ptyId, { pid: instance.pid, cdpUrl: instance.cdpUrl });
    return { ok: true, instance: { pid: instance.pid, cdpUrl: instance.cdpUrl } };
  } catch (err) {
    child.kill();
    const error = err instanceof Error ? err.message : String(err);
    chromeLog.warn('launch failed', { ptyId, error });
    return { ok: false, error };
  }
}

export function getChromeForPty(ptyId: PtyId): ChromeInstanceInfo | null {
  const instance = instances.get(ptyId);
  return instance ? { pid: instance.pid, cdpUrl: instance.cdpUrl } : null;
}

export function closeChromeForPty(ptyId: PtyId): void {
  const instance = instances.get(ptyId);
  if (!instance) return;
  instances.delete(ptyId);
  instance.child.kill();
  try {
    fs.rmSync(instance.profileDir, { recursive: true, force: true });
  } catch {
    // Chrome may still be writing it down; the startup prune gets it next time.
  }
  onChange?.(ptyId, null);
}

export function closeAllChrome(): void {
  for (const ptyId of [...instances.keys()]) closeChromeForPty(ptyId);
}

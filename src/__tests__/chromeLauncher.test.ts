import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { setUserDataPath } from '../paths';
import {
  launchChrome,
  closeChromeForPty,
  closeAllChrome,
  getChromeForPty,
  pruneChromeProfiles,
  setChromeBinaryResolver,
} from '../chromeLauncher';

/**
 * A stand-in for Chrome that keeps the one promise the launcher depends on:
 * given `--user-data-dir`, it writes the port it listens on as the first line
 * of `DevToolsActivePort` under that directory, then stays up. A
 * `mockResolvedValue` in its place would let the launcher stop reading the port
 * file at all and still pass.
 */
const FAKE_CHROME = `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const dir = process.argv.find((a) => a.startsWith('--user-data-dir=')).slice('--user-data-dir='.length);
// A second invocation against a live profile hands its URL to the running
// browser and exits, which is how a tab gets opened in one.
if (fs.existsSync(path.join(dir, 'DevToolsActivePort'))) process.exit(0);
fs.writeFileSync(path.join(dir, 'DevToolsActivePort'), '45123\\n/devtools/browser/abc\\n');
setInterval(() => {}, 1000);
`;

let userData: string;

beforeEach(() => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'ouijit-chrome-'));
  setUserDataPath(userData);
  const fakeChrome = path.join(userData, 'fake-chrome');
  fs.writeFileSync(fakeChrome, FAKE_CHROME, { mode: 0o755 });
  setChromeBinaryResolver(() => fakeChrome);
});

afterEach(() => {
  closeAllChrome();
  fs.rmSync(userData, { recursive: true, force: true });
});

describe('the Chrome a preview panel launches for its session', () => {
  test('starts once per session, reports its debugging port, and dies with the session', async () => {
    const first = await launchChrome('pty_a', 'http://localhost:3000');
    expect(first.ok).toBe(true);
    expect(first.instance?.cdpUrl).toBe('http://127.0.0.1:45123');
    expect(getChromeForPty('pty_a')).toEqual(first.instance);
    expect(fs.existsSync(path.join(userData, 'chrome', 'pty_a'))).toBe(true);

    // A second URL on the same session is the same browser, not a second one.
    const second = await launchChrome('pty_a', 'http://localhost:4000');
    expect(second.instance).toEqual(first.instance);

    // A different session gets its own profile, and does not see the first's.
    const other = await launchChrome('pty_b', 'http://localhost:3000');
    expect(other.ok).toBe(true);
    expect(fs.existsSync(path.join(userData, 'chrome', 'pty_b'))).toBe(true);

    closeChromeForPty('pty_a');
    expect(getChromeForPty('pty_a')).toBeNull();
    expect(fs.existsSync(path.join(userData, 'chrome', 'pty_a'))).toBe(false);
    expect(getChromeForPty('pty_b')).not.toBeNull();
  });

  test('reports the reason rather than throwing when Chrome is not installed', async () => {
    setChromeBinaryResolver(() => null);
    const result = await launchChrome('pty_c', 'http://localhost:3000');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not installed/);
  });

  test('clears profiles left behind by a crash, since nothing can be running at startup', () => {
    const stale = path.join(userData, 'chrome', 'pty_gone');
    fs.mkdirSync(stale, { recursive: true });
    fs.writeFileSync(path.join(stale, 'DevToolsActivePort'), '1234\n');

    pruneChromeProfiles();

    expect(fs.existsSync(stale)).toBe(false);
  });
});

import { test, expect, enterProject } from './fixtures';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';

const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';

/**
 * A page for the preview panel to show. The inspector attaches to the webview's
 * contents rather than to the page, but a document that actually loads is what
 * makes the assertion about DevTools mean anything.
 */
async function servePage(): Promise<{ url: string; close: () => Promise<void> }> {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<!doctype html><title>Preview</title><h1 id="marker">preview</h1>');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/**
 * Electron draws DevTools into a WebContents of ours only in a real window —
 * `setDevToolsWebContents` is not something jsdom or a unit test can exercise,
 * and its failure mode is a blank pane rather than an error.
 */
test('preview panel: the inspector renders Chrome DevTools inside the pane', async ({ appPage, testRepo }) => {
  test.setTimeout(40_000);

  const page = await servePage();
  try {
    await enterProject(appPage, testRepo.repoPath);
    await appPage.keyboard.press(`${modifier}+t`);
    await expect(appPage.locator('.kanban-board')).toHaveCount(0, { timeout: 5_000 });

    await appPage.keyboard.press(`${modifier}+i`);
    await expect(appPage.locator('.project-card--active')).toHaveCount(1, { timeout: 10_000 });

    await appPage.getByRole('button', { name: 'Add panel' }).first().click();
    await appPage.getByRole('button', { name: 'Web Preview' }).click();

    // The panel opens straight into its URL editor when it has no URL yet.
    const urlInput = appPage.getByPlaceholder('http://localhost:3000');
    await expect(urlInput).toBeVisible({ timeout: 5_000 });
    await urlInput.fill(page.url);
    await urlInput.press('Enter');
    await expect(appPage.locator('webview').first()).toBeAttached({ timeout: 10_000 });

    await appPage.getByRole('button', { name: 'Inspect' }).click();

    const host = appPage.locator('webview[partition="ouijit-devtools"]');
    await expect(host).toBeAttached({ timeout: 10_000 });

    await expect
      .poll(
        () =>
          appPage.evaluate(() => {
            const el = document.querySelector('webview[partition="ouijit-devtools"]');
            return (el as unknown as { getURL(): string } | null)?.getURL() ?? '';
          }),
        { timeout: 20_000 },
      )
      .toContain('devtools://');

    await appPage.getByRole('button', { name: 'Hide inspector' }).click();
    await expect(host).toHaveCount(0);
  } finally {
    await page.close();
  }
});

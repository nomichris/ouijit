import { test, expect, enterProject } from './fixtures';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';

const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';

/** A page with a distinctive element, so the DOM the inspector shows is checkable. */
async function servePage(): Promise<{ url: string; close: () => Promise<void> }> {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<!doctype html><title>Preview</title><div class="marker-card">preview</div>');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/**
 * The inspector only exists in a real window, and its failure mode is a
 * DevTools that renders its own toolbar over an empty panel — which is what
 * `setDevToolsWebContents` produced, and what a test asserting only the
 * frontend's URL happily passes. So this asserts the frontend rendered the
 * inspected page's DOM.
 */
test('preview panel: right-click inspects the previewed page', async ({ appPage, electronApp, testRepo }) => {
  test.setTimeout(60_000);

  const page = await servePage();
  try {
    await enterProject(appPage, testRepo.repoPath);
    await appPage.keyboard.press(`${modifier}+t`);
    await expect(appPage.locator('.kanban-board')).toHaveCount(0, { timeout: 5_000 });

    await appPage.keyboard.press(`${modifier}+i`);
    await expect(appPage.locator('.project-card--active')).toHaveCount(1, { timeout: 10_000 });

    await appPage.getByRole('button', { name: 'Add panel' }).first().click();
    await appPage.getByRole('button', { name: 'Web Preview' }).click();

    const urlInput = appPage.getByPlaceholder('http://localhost:3000');
    await expect(urlInput).toBeVisible({ timeout: 5_000 });
    await urlInput.fill(page.url);
    await urlInput.press('Enter');
    await expect(appPage.locator('webview').first()).toBeAttached({ timeout: 10_000 });

    // Playwright cannot click a native menu, so this drives what the menu's
    // Inspect Element item calls. The menu's own item set is covered in
    // src/__tests__/previewContextMenu.test.ts.
    const devToolsText = await electronApp.evaluate(async ({ webContents }) => {
      const guest = webContents.getAllWebContents().find((w) => w.getType() === 'webview');
      if (!guest) return 'NO_GUEST';
      guest.inspectElement(300, 300);
      const deadline = Date.now() + 30_000;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 500));
        const frontend = webContents.getAllWebContents().find((w) => w.getURL().startsWith('devtools://'));
        if (!frontend) continue;
        // DevTools builds its panels inside shadow roots, which textContent
        // does not cross — a plain innerText read comes back empty even when
        // the inspector is fully populated.
        const text: string = await frontend.executeJavaScript(`(() => {
          const deep = (root) => {
            let out = root.textContent || '';
            for (const el of root.querySelectorAll('*')) if (el.shadowRoot) out += deep(el.shadowRoot);
            return out;
          };
          return deep(document);
        })()`);
        const at = text.indexOf('marker-card');
        if (at !== -1) return text.slice(Math.max(0, at - 60), at + 60);
      }
      return 'TIMEOUT';
    });

    // The inspected page's DOM, rendered by the DevTools frontend.
    expect(devToolsText).toContain('marker-card');
  } finally {
    await page.close();
  }
});

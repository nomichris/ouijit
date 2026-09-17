/**
 * Right-click menu for the web preview panel's page.
 *
 * `inspectElement` is the whole point: it opens the DevTools Electron manages
 * itself, bound to the element under the cursor. Drawing the DevTools frontend
 * into a WebContents of ours instead (`setDevToolsWebContents`) renders the
 * frontend's chrome but never binds it to the target, so every panel comes up
 * empty — this is the path that works, at the cost of a separate window.
 *
 * Main process. The guest arrives through the embedder's `did-attach-webview`.
 */

import { Menu, clipboard, type MenuItemConstructorOptions, type WebContents, type ContextMenuParams } from 'electron';

/**
 * Separated from the popup so the item set can be asserted without a live
 * guest: what is on the menu depends entirely on what was clicked.
 */
export function buildPreviewMenu(contents: WebContents, params: ContextMenuParams): MenuItemConstructorOptions[] {
  const { navigationHistory } = contents;

  return [
    { label: 'Back', enabled: navigationHistory.canGoBack(), click: () => navigationHistory.goBack() },
    { label: 'Forward', enabled: navigationHistory.canGoForward(), click: () => navigationHistory.goForward() },
    { label: 'Reload', click: () => contents.reload() },
    { type: 'separator' },
    { label: 'Copy', visible: params.selectionText.trim().length > 0, role: 'copy' },
    {
      label: 'Copy Link Address',
      visible: !!params.linkURL,
      click: () => clipboard.writeText(params.linkURL),
    },
    { type: 'separator' },
    { label: 'Inspect Element', click: () => contents.inspectElement(params.x, params.y) },
  ];
}

export function attachPreviewContextMenu(guest: WebContents): void {
  guest.on('context-menu', (_event, params) => {
    Menu.buildFromTemplate(buildPreviewMenu(guest, params)).popup();
  });
}

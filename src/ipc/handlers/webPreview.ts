import { webContents, type BrowserWindow } from 'electron';
import { typedHandle, typedPush } from '../helpers';
import { launchChrome, closeChromeForPty, getChromeForPty, setChromeChangeListener } from '../../chromeLauncher';
import { getLogger } from '../../logger';

const webPreviewLog = getLogger().scope('webPreview');

/**
 * Resolve a webview's contents, refusing anything the main window doesn't host.
 * Without the check, a channel that opens DevTools on an id becomes a channel
 * that opens DevTools on any contents in the app.
 */
function hostedWebview(mainWindow: BrowserWindow, id: number) {
  const contents = webContents.fromId(id);
  if (!contents || contents.isDestroyed()) return null;
  if (contents.hostWebContents !== mainWindow.webContents) return null;
  return contents;
}

export function registerWebPreviewHandlers(mainWindow: BrowserWindow): void {
  // Electron manages DevTools in a native view of its own unless handed a
  // WebContents to draw into. Handing it the panel's second <webview> is what
  // puts the inspector in the pane instead of a detached window.
  typedHandle('webview:attach-devtools', (targetId, hostId) => {
    const target = hostedWebview(mainWindow, targetId);
    const host = hostedWebview(mainWindow, hostId);
    if (!target || !host) return false;
    try {
      target.setDevToolsWebContents(host);
      target.openDevTools();
      return true;
    } catch (err) {
      webPreviewLog.warn('could not draw DevTools into the panel', { error: String(err) });
      return false;
    }
  });

  typedHandle('webview:detach-devtools', (targetId) => {
    hostedWebview(mainWindow, targetId)?.closeDevTools();
  });

  typedHandle('chrome:open', (ptyId, url) => launchChrome(ptyId, url));
  typedHandle('chrome:close', (ptyId) => closeChromeForPty(ptyId));
  typedHandle('chrome:status', (ptyId) => getChromeForPty(ptyId));

  setChromeChangeListener((ptyId, instance) => typedPush(mainWindow, 'chrome:changed', ptyId, instance));
}

import type { BrowserWindow } from 'electron';
import { typedHandle, typedPush } from '../helpers';
import { launchChrome, closeChromeForPty, getChromeForPty, setChromeChangeListener } from '../../chromeLauncher';

export function registerWebPreviewHandlers(mainWindow: BrowserWindow): void {
  typedHandle('chrome:open', (ptyId, url) => launchChrome(ptyId, url));
  typedHandle('chrome:close', (ptyId) => closeChromeForPty(ptyId));
  typedHandle('chrome:status', (ptyId) => getChromeForPty(ptyId));

  setChromeChangeListener((ptyId, instance) => typedPush(mainWindow, 'chrome:changed', ptyId, instance));
}

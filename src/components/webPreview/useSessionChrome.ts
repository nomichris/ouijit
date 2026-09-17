import { useCallback, useEffect, useState } from 'react';
import type { ChromeInstanceInfo } from '../../types';

/**
 * The real Chrome a terminal session has open, if any.
 *
 * One browser per session rather than per panel, so every preview panel on a
 * session reports and closes the same one, and a browser the user quits himself
 * clears the button through the `chrome:changed` push.
 */
export function useSessionChrome(ptyId: string) {
  const [instance, setInstance] = useState<ChromeInstanceInfo | null>(null);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void window.api.webPreview.chromeStatus(ptyId).then((found) => {
      if (live) setInstance(found);
    });
    const off = window.api.webPreview.onChromeChanged((changedPtyId, changed) => {
      if (changedPtyId === ptyId) setInstance(changed);
    });
    return () => {
      live = false;
      off();
    };
  }, [ptyId]);

  const open = useCallback(
    async (url: string) => {
      setOpening(true);
      setError(null);
      const result = await window.api.webPreview.openChrome(ptyId, url);
      setOpening(false);
      if (result.instance) setInstance(result.instance);
      else setError(result.error ?? 'Chrome could not be started');
    },
    [ptyId],
  );

  const close = useCallback(async () => {
    await window.api.webPreview.closeChrome(ptyId);
    setInstance(null);
  }, [ptyId]);

  return { instance, opening, error, open, close, dismissError: () => setError(null) };
}

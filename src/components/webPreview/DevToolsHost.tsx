import { useCallback, useLayoutEffect, useRef } from 'react';
import { DEVTOOLS_PARTITION } from '../../constants/webPreview';

/**
 * The preview panel's inspector: a second <webview> that Electron draws the
 * DevTools frontend into, so the inspector lands in the pane instead of a
 * window of its own.
 *
 * The frontend can only be pointed at a WebContents that has never navigated,
 * so this mounts and unmounts with the toggle rather than hiding — a host that
 * has hosted DevTools once cannot host them again.
 */
export function DevToolsHost({ targetId, onUnavailable }: { targetId: number; onUnavailable: () => void }) {
  const attachedRef = useRef(false);

  const setNode = useCallback(
    (node: HTMLElement | null) => {
      if (!node) return;
      const onReady = async () => {
        if (attachedRef.current) return;
        attachedRef.current = true;
        const hostId = (node as HTMLElement & { getWebContentsId(): number }).getWebContentsId();
        if (!(await window.api.webPreview.attachDevTools(targetId, hostId))) onUnavailable();
      };
      node.addEventListener('dom-ready', onReady, { once: true });
    },
    [targetId, onUnavailable],
  );

  useLayoutEffect(() => () => void window.api.webPreview.detachDevTools(targetId), [targetId]);

  return (
    <webview
      ref={setNode as unknown as React.Ref<HTMLWebViewElement>}
      partition={DEVTOOLS_PARTITION}
      src="about:blank"
      style={{ width: '100%', height: '100%', border: 'none' }}
    />
  );
}

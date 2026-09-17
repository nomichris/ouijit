import { useEffect, useState, useCallback, useRef } from 'react';
import { Icon } from '../terminal/Icon';
import { TooltipButton } from '../ui/TooltipButton';
import { Tooltip } from '../ui/Tooltip';
import { FullWidthToggle, MinimizeButton, PanelCloseButton } from '../terminal/FullWidthToggle';
import { ResizeHandle } from '../common/ResizeHandle';
import { normalizeUrl } from './urlHelpers';
import { DevToolsHost } from './DevToolsHost';
import { useSessionChrome } from './useSessionChrome';

interface WebPreviewPanelProps {
  ptyId: string;
  panelId: string;
  url: string;
  onChangeUrl: (newUrl: string) => void;
  fullWidth: boolean;
  onToggleFullWidth: () => void;
  onMinimize: () => void;
  onClose: () => void;
}

// Electron <webview> is a custom element. Declare the minimal API surface we use.
interface ElectronWebviewElement extends HTMLElement {
  src: string;
  loadURL(url: string): Promise<void>;
  reload(): void;
  stop(): void;
  goBack(): void;
  goForward(): void;
  canGoBack(): boolean;
  canGoForward(): boolean;
  getURL(): string;
  getWebContentsId(): number;
  openDevTools(): void;
}

const HEADER_BUTTON =
  'w-7 h-7 flex items-center justify-center p-0 bg-transparent border-none rounded-md text-ink/60 shrink-0 transition-all duration-150 ease-out hover:bg-ink/10 hover:text-ink/90 disabled:text-ink/20 disabled:hover:bg-transparent [&>svg]:w-3.5 [&>svg]:h-3.5';

const INSPECTOR_MIN_WIDTH = 240;
const INSPECTOR_DEFAULT_WIDTH = 420;
const PAGE_MIN_WIDTH = 200;

export function WebPreviewPanel({
  ptyId,
  url,
  onChangeUrl,
  fullWidth,
  onToggleFullWidth,
  onMinimize,
  onClose,
}: WebPreviewPanelProps) {
  const [loading, setLoading] = useState(false);
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  const [currentUrl, setCurrentUrl] = useState(url);
  // When opened without a URL, drop straight into the editor so users can type
  // one instead of seeing a dead-end "No URL set" panel.
  const [editingUrl, setEditingUrl] = useState(!url);
  const [urlDraft, setUrlDraft] = useState(url);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [inspectorTargetId, setInspectorTargetId] = useState<number | null>(null);
  const [inspectorWidth, setInspectorWidth] = useState(INSPECTOR_DEFAULT_WIDTH);
  const [contentWidth, setContentWidth] = useState(0);
  const chrome = useSessionChrome(ptyId);

  const webviewRef = useRef<ElectronWebviewElement | null>(null);
  const urlInputRef = useRef<HTMLInputElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  // Attach webview event listeners via a callback ref so they rewire if the
  // <webview> remounts (e.g. url cleared and set again).
  const setWebviewNode = useCallback((node: ElectronWebviewElement | null) => {
    // Tear down listeners on the previous node.
    const prev = webviewRef.current;
    if (prev && prev !== node) {
      const cleanup = (prev as HTMLElement & { __ouijitCleanup?: () => void }).__ouijitCleanup;
      cleanup?.();
    }

    webviewRef.current = node;
    if (!node) return;

    // allowpopups is a boolean attribute Electron reads before attach; setting
    // it via React props fights the type defs, so set it imperatively.
    node.setAttribute('allowpopups', '');

    const handleStart = () => {
      setLoading(true);
      setLoadError(null);
    };
    const handleStop = () => {
      setLoading(false);
      try {
        setCanGoBack(node.canGoBack());
        setCanGoForward(node.canGoForward());
      } catch {
        // not yet attached
      }
    };
    const handleNavigate = (e: Event) => {
      const navEvent = e as Event & { url?: string };
      if (navEvent.url) setCurrentUrl(navEvent.url);
      try {
        setCanGoBack(node.canGoBack());
        setCanGoForward(node.canGoForward());
      } catch {
        // ignore
      }
    };
    const handleFailLoad = (e: Event) => {
      const failEvent = e as Event & { errorCode?: number; errorDescription?: string; validatedURL?: string };
      // -3 is ERR_ABORTED (usually user navigation away); ignore it.
      if (failEvent.errorCode === -3) return;
      setLoading(false);
      setLoadError(failEvent.errorDescription || 'Failed to load page');
    };

    node.addEventListener('did-start-loading', handleStart);
    node.addEventListener('did-stop-loading', handleStop);
    node.addEventListener('did-navigate', handleNavigate);
    node.addEventListener('did-navigate-in-page', handleNavigate);
    node.addEventListener('did-fail-load', handleFailLoad);

    (node as HTMLElement & { __ouijitCleanup?: () => void }).__ouijitCleanup = () => {
      node.removeEventListener('did-start-loading', handleStart);
      node.removeEventListener('did-stop-loading', handleStop);
      node.removeEventListener('did-navigate', handleNavigate);
      node.removeEventListener('did-navigate-in-page', handleNavigate);
      node.removeEventListener('did-fail-load', handleFailLoad);
    };
  }, []);

  // Sync external url prop changes into the webview. Skip the initial render
  // because `src={url}` already loads it — otherwise we'd double-load.
  const lastLoadedUrlRef = useRef<string>(url);
  useEffect(() => {
    const webview = webviewRef.current;
    if (!webview) {
      lastLoadedUrlRef.current = url;
      return;
    }
    if (!url) return;
    if (lastLoadedUrlRef.current === url) return;
    lastLoadedUrlRef.current = url;
    try {
      webview.loadURL(url).catch(() => {
        // Errors surface through did-fail-load
      });
    } catch {
      // Not yet attached — initial src attribute handles it
    }
    setCurrentUrl(url);
    setUrlDraft(url);
  }, [url]);

  const handleReload = useCallback(() => {
    webviewRef.current?.reload();
  }, []);

  const toggleInspector = useCallback(() => {
    if (inspectorTargetId !== null) {
      setInspectorTargetId(null);
      return;
    }
    const webview = webviewRef.current;
    if (webview) setInspectorTargetId(webview.getWebContentsId());
  }, [inspectorTargetId]);

  // Electron may refuse to draw the frontend into a webview of ours.
  const fallBackToDetachedDevTools = useCallback(() => {
    setInspectorTargetId(null);
    webviewRef.current?.openDevTools();
  }, []);

  const toggleChrome = useCallback(() => {
    if (chrome.instance) void chrome.close();
    else if (currentUrl || url) void chrome.open(currentUrl || url);
  }, [chrome, currentUrl, url]);

  // ResizeHandle reports the width of the pane before it, which here is the
  // page — and the page is the pane that flexes.
  useEffect(() => {
    const node = contentRef.current;
    if (!node) return;
    setContentWidth(node.clientWidth);
    const observer = new ResizeObserver(() => setContentWidth(node.clientWidth));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // The page webview unmounts when the URL is cleared, taking the contents the
  // inspector was attached to with it.
  useEffect(() => {
    if (!url) setInspectorTargetId(null);
  }, [url]);

  const handleBack = useCallback(() => {
    const w = webviewRef.current;
    if (w?.canGoBack()) w.goBack();
  }, []);

  const handleForward = useCallback(() => {
    const w = webviewRef.current;
    if (w?.canGoForward()) w.goForward();
  }, []);

  const commitUrl = useCallback(() => {
    const normalized = normalizeUrl(urlDraft);
    setEditingUrl(false);
    if (normalized && normalized !== url) {
      onChangeUrl(normalized);
    } else {
      setUrlDraft(url);
    }
  }, [urlDraft, url, onChangeUrl]);

  const startEditingUrl = useCallback(() => {
    setUrlDraft(currentUrl || url);
    setEditingUrl(true);
    requestAnimationFrame(() => {
      urlInputRef.current?.focus();
      urlInputRef.current?.select();
    });
  }, [currentUrl, url]);

  // Focus the input when it auto-opens (panel opened without a URL).
  useEffect(() => {
    if (editingUrl) urlInputRef.current?.focus();
  }, [editingUrl]);

  const inspectorLabel = inspectorTargetId !== null ? 'Hide inspector' : 'Inspect';
  const chromeLabel = chrome.instance ? 'Close Chrome' : 'Open in Chrome';

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-1 px-2 py-1.5 shrink-0">
        <TooltipButton
          text="Back"
          placement="bottom"
          className={HEADER_BUTTON}
          onClick={handleBack}
          disabled={!canGoBack}
        >
          <Icon name="arrow-left" />
        </TooltipButton>
        <TooltipButton
          text="Forward"
          placement="bottom"
          className={HEADER_BUTTON}
          onClick={handleForward}
          disabled={!canGoForward}
        >
          <Icon name="arrow-right" />
        </TooltipButton>
        <TooltipButton
          text={loading ? 'Stop' : 'Reload'}
          placement="bottom"
          className={HEADER_BUTTON}
          onClick={loading ? () => webviewRef.current?.stop() : handleReload}
        >
          <Icon name={loading ? 'x' : 'arrows-clockwise'} />
        </TooltipButton>
        {editingUrl ? (
          <input
            ref={urlInputRef}
            value={urlDraft}
            onChange={(e) => setUrlDraft(e.target.value)}
            onBlur={commitUrl}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitUrl();
              if (e.key === 'Escape') {
                setUrlDraft(url);
                setEditingUrl(false);
              }
            }}
            placeholder="http://localhost:3000"
            className="text-[13px] text-ink/80 flex-1 min-w-0 font-mono bg-ink/5 border border-ink/10 rounded px-2 py-0.5 outline-none focus:border-accent [-webkit-app-region:no-drag]"
          />
        ) : (
          <button
            className="text-[13px] text-ink/60 truncate flex-1 min-w-0 font-mono bg-transparent border-none py-0.5 px-2 text-left transition-colors duration-150 hover:text-ink/90 rounded"
            title={currentUrl}
            onClick={startEditingUrl}
          >
            {currentUrl || 'Enter URL…'}
          </button>
        )}
        <Tooltip text={inspectorLabel}>
          <button className={HEADER_BUTTON} onClick={toggleInspector} disabled={!url} aria-label={inspectorLabel}>
            <Icon name="bug" />
          </button>
        </Tooltip>
        <Tooltip text={chromeLabel}>
          <button
            className={HEADER_BUTTON}
            onClick={toggleChrome}
            disabled={!url || chrome.opening}
            aria-label={chromeLabel}
          >
            <Icon name="arrow-square-out" />
          </button>
        </Tooltip>
        <FullWidthToggle fullWidth={fullWidth} onToggle={onToggleFullWidth} />
        <MinimizeButton onMinimize={onMinimize} />
        <PanelCloseButton onClose={onClose} />
      </div>

      {/* Content */}
      <div ref={contentRef} className="flex-1 relative bg-white flex">
        {url ? (
          <>
            <webview
              ref={setWebviewNode as unknown as React.Ref<HTMLWebViewElement>}
              src={url}
              style={{ flex: 1, minWidth: 0, height: '100%', border: 'none' }}
            />
            {inspectorTargetId !== null && (
              <>
                {contentWidth > 0 && (
                  <ResizeHandle
                    width={contentWidth - inspectorWidth}
                    onWidth={(pageWidth) => setInspectorWidth(contentWidth - pageWidth)}
                    min={PAGE_MIN_WIDTH}
                    max={Math.max(PAGE_MIN_WIDTH, contentWidth - INSPECTOR_MIN_WIDTH)}
                    defaultWidth={contentWidth - INSPECTOR_DEFAULT_WIDTH}
                    label="Resize the inspector"
                  />
                )}
                <div className="shrink-0 h-full" style={{ width: inspectorWidth }}>
                  <DevToolsHost targetId={inspectorTargetId} onUnavailable={fallBackToDetachedDevTools} />
                </div>
              </>
            )}
          </>
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-ink/40 bg-terminal-bg">
            Enter a URL above to preview it
          </div>
        )}
        {chrome.error && (
          <div className="absolute inset-x-0 top-0 flex items-center gap-2 px-3 py-1.5 text-xs text-ink/80 bg-terminal-bg border-b border-ink/10">
            <Icon name="warning" className="w-3.5 h-3.5 text-ink/50" />
            <span className="flex-1 min-w-0 truncate">{chrome.error}</span>
            <button
              className="px-2 py-0.5 rounded bg-ink/10 hover:bg-ink/15 text-ink/70 border-none transition-colors"
              onClick={chrome.dismissError}
            >
              Dismiss
            </button>
          </div>
        )}
        {loadError && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm text-ink/70 bg-terminal-bg p-6 text-center">
            <Icon name="globe-simple" className="w-8 h-8 text-ink/30" />
            <div className="font-mono text-ink/80">{loadError}</div>
            <div className="font-mono text-[11px] text-ink/40 break-all">{currentUrl}</div>
            <button
              className="mt-2 px-3 py-1 rounded-md bg-ink/10 hover:bg-ink/15 text-ink/80 text-xs border-none transition-colors"
              onClick={handleReload}
            >
              Retry
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

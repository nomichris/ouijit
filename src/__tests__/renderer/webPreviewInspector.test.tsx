import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { WebPreviewPanel } from '../../components/webPreview/WebPreviewPanel';
import { DEVTOOLS_PARTITION } from '../../constants/webPreview';

const PAGE_CONTENTS_ID = 7;
const HOST_CONTENTS_ID = 8;

function renderPanel(url = 'http://localhost:3000') {
  return render(
    <WebPreviewPanel
      ptyId="pty_1"
      panelId="panel_1"
      url={url}
      onChangeUrl={vi.fn()}
      fullWidth={false}
      onToggleFullWidth={vi.fn()}
      onMinimize={vi.fn()}
      onClose={vi.fn()}
    />,
  );
}

/**
 * jsdom renders <webview> as an unknown element, so the Electron methods the
 * panel calls have to be put on it by hand. Ids distinguish the page from the
 * DevTools host, which is the pairing the attach call has to get right.
 */
function stubWebviews(container: HTMLElement): { openDevTools: ReturnType<typeof vi.fn> } {
  const openDevTools = vi.fn();
  for (const node of container.querySelectorAll('webview')) {
    const isHost = node.getAttribute('partition') === DEVTOOLS_PARTITION;
    Object.assign(node, {
      getWebContentsId: () => (isHost ? HOST_CONTENTS_ID : PAGE_CONTENTS_ID),
      openDevTools,
      canGoBack: () => false,
      canGoForward: () => false,
      loadURL: () => Promise.resolve(),
      reload: () => {},
      stop: () => {},
    });
  }
  return { openDevTools };
}

function devToolsHost(container: HTMLElement): Element | null {
  return container.querySelector(`webview[partition="${DEVTOOLS_PARTITION}"]`);
}

beforeEach(() => {
  vi.mocked(window.api.webPreview.attachDevTools).mockResolvedValue(true);
  vi.mocked(window.api.webPreview.chromeStatus).mockResolvedValue(null);
  vi.mocked(window.api.webPreview.openChrome).mockResolvedValue({
    ok: true,
    instance: { pid: 42, cdpUrl: 'http://127.0.0.1:45123' },
  });
});

describe('the preview panel inspector', () => {
  test('draws DevTools into a host webview while open, and takes them down on close', async () => {
    const { container } = renderPanel();
    stubWebviews(container);
    expect(devToolsHost(container)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Inspect' }));

    const host = devToolsHost(container);
    expect(host).not.toBeNull();
    stubWebviews(container);
    fireEvent(host!, new Event('dom-ready'));

    await waitFor(() =>
      expect(window.api.webPreview.attachDevTools).toHaveBeenCalledWith(PAGE_CONTENTS_ID, HOST_CONTENTS_ID),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Hide inspector' }));

    expect(devToolsHost(container)).toBeNull();
    expect(window.api.webPreview.detachDevTools).toHaveBeenCalledWith(PAGE_CONTENTS_ID);
  });

  test('falls back to a detached window when Electron will not draw into the host', async () => {
    vi.mocked(window.api.webPreview.attachDevTools).mockResolvedValue(false);
    const { container } = renderPanel();
    stubWebviews(container);

    fireEvent.click(screen.getByRole('button', { name: 'Inspect' }));
    const host = devToolsHost(container)!;
    const { openDevTools } = stubWebviews(container);
    fireEvent(host, new Event('dom-ready'));

    await waitFor(() => expect(openDevTools).toHaveBeenCalled());
    expect(devToolsHost(container)).toBeNull();
  });
});

describe('the preview panel Chrome button', () => {
  test('launches the session browser for the shown URL and offers to close it', async () => {
    const { container } = renderPanel();
    stubWebviews(container);

    fireEvent.click(screen.getByRole('button', { name: 'Open in Chrome' }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'Close Chrome' })).toBeTruthy());
    expect(window.api.webPreview.openChrome).toHaveBeenCalledWith('pty_1', 'http://localhost:3000');

    fireEvent.click(screen.getByRole('button', { name: 'Close Chrome' }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'Open in Chrome' })).toBeTruthy());
    expect(window.api.webPreview.closeChrome).toHaveBeenCalledWith('pty_1');
  });

  test('surfaces the reason when Chrome cannot be started', async () => {
    vi.mocked(window.api.webPreview.openChrome).mockResolvedValue({ ok: false, error: 'Chrome is not installed' });
    const { container } = renderPanel();
    stubWebviews(container);

    fireEvent.click(screen.getByRole('button', { name: 'Open in Chrome' }));

    await waitFor(() => expect(screen.getByText('Chrome is not installed')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText('Chrome is not installed')).toBeNull();
  });
});

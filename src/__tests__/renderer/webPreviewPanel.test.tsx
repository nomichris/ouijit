import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { WebPreviewPanel } from '../../components/webPreview/WebPreviewPanel';

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

beforeEach(() => {
  vi.mocked(window.api.webPreview.chromeStatus).mockResolvedValue(null);
  vi.mocked(window.api.webPreview.openChrome).mockResolvedValue({
    ok: true,
    instance: { pid: 42, cdpUrl: 'http://127.0.0.1:45123' },
  });
});

describe('the preview panel Chrome button', () => {
  test('launches the session browser for the shown URL and offers to close it', async () => {
    renderPanel();

    fireEvent.click(screen.getByRole('button', { name: 'Open in Chrome' }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'Close Chrome' })).toBeTruthy());
    expect(window.api.webPreview.openChrome).toHaveBeenCalledWith('pty_1', 'http://localhost:3000');

    fireEvent.click(screen.getByRole('button', { name: 'Close Chrome' }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'Open in Chrome' })).toBeTruthy());
    expect(window.api.webPreview.closeChrome).toHaveBeenCalledWith('pty_1');
  });

  test('surfaces the reason when Chrome cannot be started', async () => {
    vi.mocked(window.api.webPreview.openChrome).mockResolvedValue({ ok: false, error: 'Chrome is not installed' });
    renderPanel();

    fireEvent.click(screen.getByRole('button', { name: 'Open in Chrome' }));

    await waitFor(() => expect(screen.getByText('Chrome is not installed')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText('Chrome is not installed')).toBeNull();
  });
});

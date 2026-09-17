import { describe, test, expect, vi } from 'vitest';
import type { ContextMenuParams, WebContents } from 'electron';
import { buildPreviewMenu } from '../previewContextMenu';

function contents(history: { back?: boolean; forward?: boolean } = {}) {
  return {
    navigationHistory: {
      canGoBack: () => history.back ?? false,
      canGoForward: () => history.forward ?? false,
      goBack: vi.fn(),
      goForward: vi.fn(),
    },
    reload: vi.fn(),
    inspectElement: vi.fn(),
  } as unknown as WebContents;
}

function params(over: Partial<ContextMenuParams> = {}) {
  return { x: 10, y: 20, linkURL: '', selectionText: '', ...over } as ContextMenuParams;
}

/** What the user can actually pick: separators and hidden entries are not it. */
function offered(items: ReturnType<typeof buildPreviewMenu>) {
  return items.filter((i) => i.type !== 'separator' && i.visible !== false).map((i) => i.label);
}

describe('the preview page right-click menu', () => {
  test('offers navigation and Inspect Element, and hides what the click did not hit', () => {
    const menu = buildPreviewMenu(contents(), params());

    expect(offered(menu)).toEqual(['Back', 'Forward', 'Reload', 'Inspect Element']);
    expect(menu.find((i) => i.label === 'Back')?.enabled).toBe(false);
    expect(menu.find((i) => i.label === 'Forward')?.enabled).toBe(false);
  });

  test('enables history entries the page can actually use', () => {
    const menu = buildPreviewMenu(contents({ back: true }), params());

    expect(menu.find((i) => i.label === 'Back')?.enabled).toBe(true);
    expect(menu.find((i) => i.label === 'Forward')?.enabled).toBe(false);
  });

  test('shows Copy for a selection and Copy Link Address for a link', () => {
    expect(offered(buildPreviewMenu(contents(), params({ selectionText: '  hello ' })))).toContain('Copy');
    // Whitespace is not a selection.
    expect(offered(buildPreviewMenu(contents(), params({ selectionText: '   ' })))).not.toContain('Copy');
    expect(offered(buildPreviewMenu(contents(), params({ linkURL: 'https://x.test/a' })))).toContain(
      'Copy Link Address',
    );
  });

  test('inspects the point that was clicked, not the page in general', () => {
    const page = contents();
    const menu = buildPreviewMenu(page, params({ x: 314, y: 159 }));

    menu
      .find((i) => i.label === 'Inspect Element')
      ?.click?.(undefined as never, undefined as never, undefined as never);

    expect(page.inspectElement).toHaveBeenCalledWith(314, 159);
  });
});

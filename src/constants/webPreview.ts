/**
 * Session partition of the preview panel's DevTools host <webview>.
 *
 * The renderer sets it as an attribute; main reads it off the attach params to
 * tell that webview apart from the one showing the page, which is the only
 * signal `will-attach-webview` gets about which is which.
 */
export const DEVTOOLS_PARTITION = 'ouijit-devtools';

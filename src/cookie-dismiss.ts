/**
 * Cookie/consent-overlay dismisser for screenshot extraction.
 *
 * Registers a page-init hook that runs before every page script on every
 * navigation and injects a static <style> tag hiding a curated list of
 * known cookie-consent-management-platform (CMP) banners via
 * `display: none !important`. This is a pure CSS hide — no clicks, no
 * network calls, no page-data reads. It must be called AFTER
 * `context.newPage()` and BEFORE `page.goto()` so the hook is registered
 * before the page (and its CMP script) loads.
 *
 * `page` is typed loosely (no hard playwright dependency) to match the
 * optional-peer convention used by playwright-loader.ts and every
 * extractor in this codebase.
 */
export async function dismissCookieOverlays(page: any): Promise<void> {
  await page.addInitScript(() => {
    const css = [
      '#onetrust-banner-sdk,',
      '.onetrust-pc-dark-filter,',
      '#CybotCookiebotDialog,',
      '.osano-cm-window,',
      '#truste-consent-track,',
      '[id*="cookie"],',
      '[class*="consent"],',
      '[id*="gdpr"],',
      '[aria-label*="cookie"]',
      '{ display: none !important; }',
    ].join('\n');

    const style = document.createElement('style');
    style.textContent = css;

    const target = document.head || document.documentElement;
    target.appendChild(style);
  });
}

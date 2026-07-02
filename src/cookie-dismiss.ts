/**
 * Cookie/consent-overlay dismisser for screenshot extraction.
 *
 * Registers a page-init hook that runs before every page script on every
 * navigation. Rather than injecting a CSS hide (which can lose the cascade
 * to an equal-specificity `!important` rule the CMP inserts later in the
 * DOM), it pulls the known cookie-consent-management-platform (CMP) banner
 * nodes out of the document entirely. A persistent `MutationObserver`
 * re-runs the sweep whenever the CMP re-injects its markup, so the banner
 * stays gone for the page lifetime. This is pure DOM pruning — no clicks,
 * no accept/dismiss button presses, no network calls, no page-data reads.
 * It must be called AFTER `context.newPage()` and BEFORE `page.goto()` so
 * the hook is registered before the page (and its CMP script) loads.
 *
 * `page` is typed loosely (no hard playwright dependency) to match the
 * optional-peer convention used by playwright-loader.ts and every
 * extractor in this codebase.
 */
export async function dismissCookieOverlays(page: any): Promise<void> {
  await page.addInitScript(() => {
    const selectors = [
      '#onetrust-banner-sdk',
      '.onetrust-pc-dark-filter',
      '#CybotCookiebotDialog',
      '#CybotCookiebotDialogBodyUnderlay',
      '.osano-cm-window',
      '#truste-consent-track',
      '[id*="cookie"]',
      '[class*="consent"]',
      '[id*="gdpr"]',
      '[aria-label*="cookie"]',
    ];

    const sweep = () => {
      try {
        for (const selector of selectors) {
          try {
            const nodes = document.querySelectorAll(selector);
            for (const node of Array.from(nodes)) {
              node.remove();
            }
          } catch (e) {
            // A single malformed/unsupported selector must not abort the
            // rest of the sweep or break extraction.
          }
        }
      } catch (e) {
        // Defensive: a throw here must never break page extraction.
      }
    };

    // Immediate pass for banners already present, plus one on DOM ready.
    sweep();
    document.addEventListener('DOMContentLoaded', sweep);

    // Persistent observer: re-prune whenever the CMP re-injects its nodes.
    // Never disconnected — it must keep sweeping for the page lifetime.
    try {
      const observer = new MutationObserver(() => sweep());
      observer.observe(document.documentElement, {
        subtree: true,
        childList: true,
      });
    } catch (e) {
      // Some contexts may lack MutationObserver; the immediate/ready-time
      // sweeps still apply.
    }
  });
}

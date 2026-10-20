/**
 * Shared browser plumbing for URL and Ultra extractors.
 *
 * Without an interactive session, an extractor launches its own headless
 * Chromium and navigates to the URL, as it always has. With a session, it
 * reuses the prepared context and tab instead, so cookies, navigation and DOM
 * state from the manual preparation are kept.
 */

export const BROWSER_CONTEXT_OPTIONS = {
  viewport: { width: 1440, height: 900 },
  userAgent:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
};

/** A visible browser the user prepared by hand (see interactive-session.ts). */
export interface InteractiveSession {
  browser: any;
  context: any;
  /** The tab chosen for extraction. */
  page: any;
  /** Scroll offset when the user confirmed, restored before each extractor runs. */
  scrollY: number;
  /** True once the browser has disconnected, e.g. the user closed the window. */
  wasClosed(): boolean;
  close(): Promise<void>;
}

/** The page one extractor works on. `dispose` closes only what that extractor launched. */
export interface PageTarget {
  context: any;
  page: any;
  dispose(): Promise<void>;
}

export interface PageTargetOptions {
  session?: InteractiveSession;
  /** Wait after load so late scripts can settle. */
  settleMs: number;
  /** Runs before the first navigation. Only called for pages this module opens. */
  beforeNavigate?: (page: any) => Promise<void>;
}

/** Returns the session's context, or launches a headless browser and context. */
export async function openContext(
  playwright: any,
  session?: InteractiveSession
): Promise<{ context: any; dispose(): Promise<void> }> {
  if (session) return { context: session.context, dispose: async () => {} };

  const browser = await playwright.chromium.launch({ headless: true });
  try {
    const context = await browser.newContext(BROWSER_CONTEXT_OPTIONS);
    return { context, dispose: () => browser.close().catch(() => {}) };
  } catch (err) {
    await browser.close().catch(() => {});
    throw err;
  }
}

/**
 * Opens `url` in a fresh page. With a session, returns the prepared tab
 * without navigating it, so the user's page state is kept.
 */
export async function openPage(playwright: any, url: string, opts: PageTargetOptions): Promise<PageTarget> {
  const { context, dispose } = await openContext(playwright, opts.session);
  try {
    if (opts.session) {
      await restoreScroll(opts.session);
      await opts.session.page.waitForTimeout(opts.settleMs);
      return { context, page: opts.session.page, dispose };
    }

    const page = await context.newPage();
    await opts.beforeNavigate?.(page);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(opts.settleMs);
    return { context, page, dispose };
  } catch (err) {
    await dispose();
    throw err;
  }
}

/**
 * Puts the prepared tab back where the user left it. Extractors scroll the
 * page while they work, and the next extractor should start from the same view.
 */
export async function restoreScroll(session: InteractiveSession): Promise<void> {
  await session.page.evaluate((y: number) => window.scrollTo(0, y), session.scrollY);
}

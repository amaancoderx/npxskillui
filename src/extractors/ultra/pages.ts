import * as fs from 'fs';
import * as path from 'path';
import { StorageState } from '../../types';
import { PageScreenshot, SectionScreenshot } from '../../types-ultra';
import { loadPlaywright } from '../../playwright-loader';

/**
 * Ultra mode — Page & Section Screenshots
 *
 * 1. Crawl internal links from the origin URL (both <a href> and SPA navigation)
 * 2. Take a full-page screenshot for each (screens/pages/[slug].png)
 * 3. Detect major sections and clip one screenshot per section
 *
 * SPA support:
 * - Clicks navigable non-link elements (cards, tabs, sidebar items) to discover routes
 * - Opens navigation drawers/sidebars to find hidden links
 * - Supports hash-based routing (#/path)
 *
 * Requires Playwright (optional peer dependency).
 */
export async function capturePageScreenshots(
  originUrl: string,
  skillDir: string,
  maxPages: number,
  storageState?: StorageState | null,
  onProgress?: (step: string) => void
): Promise<{ pages: PageScreenshot[]; sections: SectionScreenshot[] }> {
  const log = onProgress || (() => {});
  const playwright = loadPlaywright();
  if (!playwright) return { pages: [], sections: [] };

  const pagesDir = path.join(skillDir, 'screens', 'pages');
  const sectionsDir = path.join(skillDir, 'screens', 'sections');
  fs.mkdirSync(pagesDir, { recursive: true });
  fs.mkdirSync(sectionsDir, { recursive: true });

  const pages: PageScreenshot[] = [];
  const sections: SectionScreenshot[] = [];

  const browser = await playwright.chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    ...(storageState ? { storageState } : {}),
  });

  try {
    const origin = new URL(originUrl).origin;
    const visited = new Set<string>();
    const queue: string[] = [originUrl];
    let spaDiscoveryDone = false;

    while (queue.length > 0 && visited.size < maxPages) {
      const url = queue.shift()!;
      const normalized = normalizeUrl(url);
      if (visited.has(normalized)) continue;
      visited.add(normalized);

      const slug = urlToSlug(url, origin);
      const pageFile = path.join(pagesDir, `${slug}.png`);

      let page: any;
      try {
        log(`Page ${visited.size}/${maxPages} — ${slug}`);
        page = await context.newPage();
        await page.goto(url, { waitUntil: 'networkidle', timeout: 25000 });
        await page.waitForTimeout(1500);

        // Full-page screenshot
        await page.screenshot({ path: pageFile, fullPage: true });
        const title = await page.title().catch(() => slug);

        pages.push({
          url,
          slug,
          filePath: `screens/pages/${slug}.png`,
          title: title || slug,
        });

        // Section screenshots
        const sectionData = await page.evaluate(() => {
          const SECTION_SELECTORS = [
            'section',
            'article',
            'header',
            'footer',
            'nav',
            'main > div',
            'main > section',
            '[class*="section"]',
            '[class*="hero"]',
            '[class*="features"]',
            '[class*="pricing"]',
            '[class*="testimonial"]',
            '[class*="faq"]',
            '[class*="cta"]',
          ];

          const candidates: Array<{
            selector: string;
            rect: { x: number; y: number; width: number; height: number };
          }> = [];

          for (const sel of SECTION_SELECTORS) {
            const els = document.querySelectorAll(sel);
            els.forEach((el) => {
              const rect = el.getBoundingClientRect();
              const scrollTop = window.scrollY || document.documentElement.scrollTop;
              // Must be wide (>= 60% viewport) and tall (>= 200px)
              if (rect.width >= window.innerWidth * 0.6 && rect.height >= 200) {
                candidates.push({
                  selector: sel,
                  rect: {
                    x: Math.max(0, rect.left),
                    y: Math.max(0, rect.top + scrollTop),
                    width: Math.min(rect.width, 1440),
                    height: Math.min(rect.height, 1200),
                  },
                });
              }
            });
          }

          // Deduplicate: remove sections whose top is within 50px of another
          const deduped: typeof candidates = [];
          for (const c of candidates) {
            const overlap = deduped.some(
              (d) => Math.abs(d.rect.y - c.rect.y) < 50
            );
            if (!overlap) deduped.push(c);
          }

          return deduped.slice(0, 10);
        });

        for (let i = 0; i < sectionData.length; i++) {
          const sec = sectionData[i];
          const secFile = `${slug}-section-${i + 1}.png`;
          const secPath = path.join(sectionsDir, secFile);

          try {
            await page.screenshot({
              path: secPath,
              clip: {
                x: sec.rect.x,
                y: sec.rect.y,
                width: sec.rect.width,
                height: sec.rect.height,
              },
            });
            sections.push({
              page: slug,
              index: i + 1,
              filePath: `screens/sections/${secFile}`,
              selector: sec.selector,
              height: Math.round(sec.rect.height),
              width: Math.round(sec.rect.width),
            });
          } catch {
            // Section clip failed — skip
          }
        }

        // ── Discover internal links (with hash route support) ──────────
        if (visited.size < maxPages) {
          const currentPathname = new URL(url).pathname;
          const links = await page.evaluate(({ origin, currentPathname }: { origin: string; currentPathname: string }) => {
            return Array.from(document.querySelectorAll('a[href]'))
              .map((a) => (a as HTMLAnchorElement).href)
              .filter((href) => {
                try {
                  const u = new URL(href);
                  if (u.origin !== origin) return false;
                  if (u.pathname.match(/\.(pdf|zip|png|jpg|svg|ico|css|js|xml|json|txt)$/i)) return false;
                  // Allow hash routes (#/path) but skip same-page anchors (#section)
                  if (u.hash) {
                    if (u.hash.startsWith('#/')) return true;
                    if (u.pathname === currentPathname) return false;
                  }
                  return true;
                } catch {
                  return false;
                }
              })
              .slice(0, 20);
          }, { origin, currentPathname });

          for (const link of links) {
            const norm = normalizeUrl(link);
            if (!visited.has(norm) && !queue.some(q => normalizeUrl(q) === norm)) {
              queue.push(link);
            }
          }
        }

        // ── SPA: click-based route discovery (once per crawl) ──────────
        if (!spaDiscoveryDone && visited.size < maxPages) {
          spaDiscoveryDone = true;
          log('SPA route discovery — clicking navigable elements...');
          const spaRoutes = await discoverSPARoutes(context, url, origin, visited, queue, maxPages, log);
          for (const route of spaRoutes) {
            const norm = normalizeUrl(route);
            if (!visited.has(norm) && !queue.some(q => normalizeUrl(q) === norm)) {
              queue.push(route);
            }
          }
        }

        await page.close();
      } catch (err) {
        // Page failed — continue with next
        await page?.close().catch(() => {});
      }
    }
  } finally {
    await browser.close().catch(() => {});
  }

  return { pages, sections };
}

// ── SPA Route Discovery ────────────────────────────────────────────────

/** Combined selector for non-link clickable elements that might navigate */
const SPA_NAV_SELECTOR = [
  // Vuetify
  '.v-card--link',
  '.v-list-item--link',
  '.v-tab',
  '.v-list-item[tabindex]',
  // Material / Angular
  'mat-list-item[routerlink]',
  'mat-tab',
  // Ant Design
  '.ant-menu-item',
  '.ant-card[tabindex]',
  // Generic patterns
  '[role="link"]:not(a)',
  '[role="menuitem"]:not(a)',
  '[role="tab"]:not(a)',
  '[tabindex="0"]:not(a):not(button):not(input):not(textarea):not(select)',
].join(', ');

/** Selectors for drawer/sidebar toggle buttons */
const DRAWER_TRIGGERS = [
  '.v-app-bar__nav-icon',
  'button[aria-label*="menu" i]',
  'button[aria-label*="Menu"]',
  'button[aria-label*="navigation" i]',
  '.mdi-menu',
  'button.hamburger',
  '[class*="hamburger"]',
  '[class*="menu-toggle"]',
  '[class*="nav-toggle"]',
  '[class*="sidebar-toggle"]',
];

/**
 * Click navigable non-link elements to discover SPA routes.
 * Reuses the same page, navigating back to origin between attempts.
 */
async function discoverSPARoutes(
  context: any,
  pageUrl: string,
  origin: string,
  visited: Set<string>,
  existingQueue: string[],
  maxPages: number,
  log: (step: string) => void = () => {}
): Promise<string[]> {
  const discovered: string[] = [];
  const page = await context.newPage();

  try {
    await page.goto(pageUrl, { waitUntil: 'networkidle', timeout: 25000 });
    await page.waitForTimeout(1500);

    // Step 1: Open any closed navigation drawers to reveal hidden links
    log('SPA — checking drawer/sidebar for links...');
    const drawerLinks = await discoverDrawerLinks(page, origin);
    for (const link of drawerLinks) {
      const norm = normalizeUrl(link);
      if (!visited.has(norm) && !existingQueue.some((q: string) => normalizeUrl(q) === norm)) {
        discovered.push(link);
      }
    }
    if (drawerLinks.length > 0) {
      log(`SPA — drawer: ${drawerLinks.length} links found`);
    }

    // Step 2: Find clickable non-link navigation elements on the main page
    await page.goto(pageUrl, { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(1000);

    const elementCount = await page.locator(SPA_NAV_SELECTOR).count().catch(() => 0);

    if (elementCount > 0) {
      log(`SPA — testing ${elementCount} clickable elements...`);
    }

    const maxTest = Math.min(elementCount, 12);
    for (let i = 0; i < maxTest; i++) {
      if (discovered.length + visited.size >= maxPages) break;

      log(`SPA — clicking element ${i + 1}/${maxTest}...`);

      try {
        // Reset to origin before each click
        await page.goto(pageUrl, { waitUntil: 'networkidle', timeout: 15000 });
        await page.waitForTimeout(800);

        const beforeUrl = page.url();
        const el = page.locator(SPA_NAV_SELECTOR).nth(i);

        if (!await el.isVisible({ timeout: 2000 })) continue;

        await el.click({ timeout: 3000 });

        // Wait for URL change
        try {
          await page.waitForURL((url: URL) => url.toString() !== beforeUrl, { timeout: 5000 });
        } catch {
          // URL didn't change — not navigation (modal, expand, etc.)
          continue;
        }
        await page.waitForTimeout(500);

        const afterUrl = page.url();
        if (afterUrl !== beforeUrl) {
          try {
            const u = new URL(afterUrl);
            if (u.origin !== origin) continue;
          } catch { continue; }

          const norm = normalizeUrl(afterUrl);
          if (
            !visited.has(norm) &&
            !existingQueue.some((q: string) => normalizeUrl(q) === norm) &&
            !discovered.some(d => normalizeUrl(d) === norm)
          ) {
            discovered.push(afterUrl);
            log(`SPA — found route: ${afterUrl}`);
          }
        }
      } catch {
        // Click failed — skip element
      }
    }

    if (discovered.length > 0) {
      log(`SPA discovery done — ${discovered.length} new routes`);
    } else if (elementCount > 0) {
      log('SPA discovery done — no new routes');
    }
  } catch {
    // SPA discovery failed entirely — non-fatal
  } finally {
    await page.close().catch(() => {});
  }

  return discovered;
}

/**
 * Open navigation drawers/sidebars and extract links from within.
 */
async function discoverDrawerLinks(page: any, origin: string): Promise<string[]> {
  const links: string[] = [];

  // Try each drawer trigger
  for (const sel of DRAWER_TRIGGERS) {
    try {
      const trigger = page.locator(sel).first();
      if (await trigger.isVisible({ timeout: 500 })) {
        await trigger.click({ timeout: 2000 });
        await page.waitForTimeout(800);
        break; // Only need to open one drawer
      }
    } catch {}
  }

  // Extract links from opened drawer/sidebar
  const drawerLinks: string[] = await page.evaluate((origin: string) => {
    const DRAWER_LINK_SELECTORS = [
      'nav a[href]',
      '.v-navigation-drawer a[href]',
      '[role="navigation"] a[href]',
      '.sidebar a[href]',
      '[class*="drawer"] a[href]',
      '[class*="sidebar"] a[href]',
      '[class*="nav-menu"] a[href]',
    ];

    const found: string[] = [];
    const seen = new Set<string>();

    for (const sel of DRAWER_LINK_SELECTORS) {
      document.querySelectorAll(sel).forEach(el => {
        const href = (el as HTMLAnchorElement).href;
        if (!href || seen.has(href)) return;
        seen.add(href);
        try {
          const u = new URL(href);
          if (u.origin === origin && !u.pathname.match(/\.(pdf|zip|png|jpg|svg|ico|css|js)$/i)) {
            found.push(href);
          }
        } catch {}
      });
    }

    return found;
  }, origin);

  links.push(...drawerLinks);
  return links;
}

// ── Helpers ────────────────────────────────────────────────────────────

function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    const pathname = u.pathname.replace(/\/$/, '');
    // Include hash for SPA routing (#/path)
    const hash = u.hash.startsWith('#/') ? u.hash : '';
    return `${u.origin}${pathname}${hash}`;
  } catch {
    return url;
  }
}

function urlToSlug(url: string, origin: string): string {
  try {
    const u = new URL(url);
    let rel = u.pathname.replace(/^\//, '').replace(/\/$/, '') || '';
    // Include hash route in slug
    if (u.hash.startsWith('#/')) {
      const hashPath = u.hash.slice(2).replace(/^\//, '').replace(/\/$/, '');
      rel = rel ? `${rel}--${hashPath}` : hashPath;
    }
    rel = rel || 'home';
    return rel
      .replace(/[^a-zA-Z0-9/]/g, '-')
      .replace(/-{2,}/g, '-')
      .replace(/\//g, '--')
      .slice(0, 60) || 'home';
  } catch {
    return 'home';
  }
}

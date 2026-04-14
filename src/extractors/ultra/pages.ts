import * as fs from 'fs';
import * as path from 'path';
import { PageScreenshot, SectionScreenshot } from '../../types-ultra';
import { loadPlaywright } from '../../playwright-loader';

/**
 * Ultra mode — Page & Section Screenshots
 *
 * 1. Crawl up to `maxPages` internal links from the origin URL
 * 2. Take a full-page screenshot for each (screens/pages/[slug].png)
 * 3. Detect major sections (section, article, main > div, height > 300px)
 *    and clip one screenshot per section (screens/sections/[page]-section-N.png)
 *
 * Requires Playwright (optional peer dependency).
 */
export async function capturePageScreenshots(
  originUrl: string,
  skillDir: string,
  maxPages: number
): Promise<{ pages: PageScreenshot[]; sections: SectionScreenshot[] }> {
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
  });

  try {
    const origin = new URL(originUrl).origin;
    const visited = new Set<string>();
    const queue: string[] = [originUrl];

    while (queue.length > 0 && visited.size < maxPages) {
      const url = queue.shift()!;
      const normalized = normalizeUrl(url);
      if (visited.has(normalized)) continue;
      visited.add(normalized);

      const slug = urlToSlug(url, origin);
      const pageFile = path.join(pagesDir, `${slug}.png`);

      try {
        const page = await context.newPage();
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

        // Discover internal links for queue
        if (visited.size < maxPages) {
          const links = await page.evaluate((origin: string) => {
            return Array.from(document.querySelectorAll('a[href]'))
              .map((a) => (a as HTMLAnchorElement).href)
              .filter((href) => {
                try {
                  const u = new URL(href);
                  return (
                    u.origin === origin &&
                    !u.pathname.match(/\.(pdf|zip|png|jpg|svg|ico|css|js|xml|json|txt)$/i) &&
                    !u.hash
                  );
                } catch {
                  return false;
                }
              })
              .slice(0, 20);
          }, origin);

          for (const link of links) {
            const norm = normalizeUrl(link);
            if (!visited.has(norm) && !queue.includes(link)) {
              queue.push(link);
            }
          }
        }

        await page.close();
      } catch (err) {
        // Page failed — continue with next
        try { await context.pages()[0]?.close(); } catch {}
      }
    }
  } finally {
    await browser.close().catch(() => {});
  }

  return { pages, sections };
}

function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`.replace(/\/$/, '');
  } catch {
    return url;
  }
}

function urlToSlug(url: string, origin: string): string {
  try {
    const u = new URL(url);
    const rel = u.pathname.replace(/^\//, '').replace(/\/$/, '') || 'home';
    return rel
      .replace(/[^a-zA-Z0-9/]/g, '-')
      .replace(/\//g, '--')
      .replace(/-{2,}/g, '-')
      .slice(0, 60) || 'home';
  } catch {
    return 'home';
  }
}

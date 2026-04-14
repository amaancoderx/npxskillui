import { LayoutRecord } from '../../types-ultra';
import { loadPlaywright } from '../../playwright-loader';

/**
 * Ultra mode — DOM Layout Extractor
 *
 * Crawls the page DOM and extracts layout information from significant containers:
 * - flex/grid parents
 * - section-level wrappers
 * - nav/header/footer
 *
 * Returns LayoutRecord[] for LAYOUT.md generation.
 * Requires Playwright (optional peer dependency).
 */
export async function extractLayouts(url: string): Promise<LayoutRecord[]> {
  const playwright = loadPlaywright();
  if (!playwright) return [];

  const browser = await playwright.chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    });

    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'networkidle', timeout: 25000 });
    await page.waitForTimeout(1000);

    const records: LayoutRecord[] = await page.evaluate(() => {
      const LAYOUT_SELECTORS = [
        'header',
        'nav',
        'main',
        'footer',
        'section',
        'article',
        '[class*="container"]',
        '[class*="wrapper"]',
        '[class*="layout"]',
        '[class*="grid"]',
        '[class*="flex"]',
        '[class*="row"]',
        '[class*="col"]',
        '[class*="hero"]',
        '[class*="card"]',
      ];

      function getDepth(el: Element): number {
        let depth = 0;
        let node: Element | null = el.parentElement;
        while (node) { depth++; node = node.parentElement; }
        return depth;
      }

      function buildSelector(el: Element): string {
        const tag = el.tagName.toLowerCase();
        const id = el.id ? `#${el.id}` : '';
        const classes = Array.from(el.classList)
          .filter(c => !/^(js-|is-|has-)/.test(c))
          .slice(0, 2)
          .map(c => `.${c}`)
          .join('');
        return `${tag}${id}${classes}`.slice(0, 60);
      }

      const seen = new WeakSet<Element>();
      const results: LayoutRecord[] = [];

      for (const sel of LAYOUT_SELECTORS) {
        const elements = document.querySelectorAll(sel);
        elements.forEach((el) => {
          if (seen.has(el)) return;
          seen.add(el);

          const s = window.getComputedStyle(el);
          const display = s.display;

          // Only capture flex/grid/block containers with children
          if (!['flex', 'grid', 'block', 'inline-flex', 'inline-grid'].includes(display)) return;

          const rect = el.getBoundingClientRect();
          if (rect.width < 100 || rect.height < 30) return;

          const childCount = el.children.length;
          if (childCount === 0) return;

          results.push({
            tag: el.tagName.toLowerCase(),
            selector: buildSelector(el),
            display,
            flexDirection: s.flexDirection || '',
            flexWrap: s.flexWrap || '',
            justifyContent: s.justifyContent || '',
            alignItems: s.alignItems || '',
            gap: s.gap || '',
            rowGap: s.rowGap || '',
            columnGap: s.columnGap || '',
            padding: s.padding || '',
            margin: s.margin || '',
            gridTemplateColumns: s.gridTemplateColumns || '',
            gridTemplateRows: s.gridTemplateRows || '',
            maxWidth: s.maxWidth || '',
            width: s.width || '',
            height: s.height || '',
            position: s.position || '',
            childCount,
            depth: getDepth(el),
          });

          if (results.length >= 60) return;
        });
      }

      // Sort by depth (shallower = more structural)
      return results.sort((a, b) => a.depth - b.depth).slice(0, 40);
    });

    await page.close();
    await browser.close();
    return records;
  } catch {
    await browser.close().catch(() => {});
    return [];
  }
}

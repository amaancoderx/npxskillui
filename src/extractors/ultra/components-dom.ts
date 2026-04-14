import { DOMComponent } from '../../types-ultra';
import { loadPlaywright } from '../../playwright-loader';

/**
 * Ultra mode — DOM Component Detector
 *
 * Detects repeated UI components by analyzing DOM structure:
 * - Elements with the same class pattern appearing 3+ times → component
 * - Groups by normalized class fingerprint
 * - Extracts representative HTML snippet
 *
 * Requires Playwright (optional peer dependency).
 */
export async function detectDOMComponents(url: string): Promise<DOMComponent[]> {
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

    const components: DOMComponent[] = await page.evaluate(() => {
      // ── Fingerprint an element by its structure ───────────────────────
      function fingerprint(el: Element): string {
        const tag = el.tagName.toLowerCase();
        // Normalize class names: remove dynamic/utility classes, sort
        const stableClasses = Array.from(el.classList)
          .filter(c => {
            // Skip Tailwind utility classes, JS hooks, state classes
            if (/^(js-|is-|has-|data-|aria-)/.test(c)) return false;
            if (/^(hover:|focus:|active:|sm:|md:|lg:|xl:|2xl:)/.test(c)) return false;
            // Keep semantic/BEM-like classes
            return c.length >= 3 && c.length <= 40 && /^[a-zA-Z]/.test(c);
          })
          .sort()
          .slice(0, 4);
        const childTags = Array.from(el.children)
          .slice(0, 4)
          .map(c => c.tagName.toLowerCase())
          .join(',');
        return `${tag}[${stableClasses.join('.')}](${childTags})`;
      }

      // ── Serialize HTML snippet (truncated) ─────────────────────────────
      function htmlSnippet(el: Element): string {
        const clone = el.cloneNode(true) as Element;
        // Remove deeply nested children to keep snippet readable
        const children = clone.querySelectorAll('*');
        if (children.length > 12) {
          Array.from(children).slice(12).forEach(c => c.remove());
        }
        // Truncate text nodes
        clone.querySelectorAll('*').forEach(n => {
          if (n.children.length === 0 && n.textContent && n.textContent.length > 40) {
            n.textContent = n.textContent.slice(0, 40) + '…';
          }
        });
        return clone.outerHTML.replace(/\s+/g, ' ').slice(0, 600);
      }

      // ── Categorize a component ────────────────────────────────────────
      function categorize(el: Element, classes: string[]): DOMComponent['category'] {
        const tag = el.tagName.toLowerCase();
        const classStr = classes.join(' ').toLowerCase();

        if (/card|tile|item|product|post/.test(classStr)) return 'card';
        if (/nav.*item|menu.*item|tab/.test(classStr)) return 'nav-item';
        if (tag === 'li' || /list.*item/.test(classStr)) return 'list-item';
        if (tag === 'button' || /btn|button/.test(classStr)) return 'button';
        if (/badge|tag|chip|label/.test(classStr)) return 'badge';
        if (/field|input|form/.test(classStr)) return 'form-field';
        return 'unknown';
      }

      // ── Walk all elements with 1+ class ─────────────────────────────────
      const allElements = document.querySelectorAll('[class]');
      const groups = new Map<string, Element[]>();

      allElements.forEach(el => {
        const rect = el.getBoundingClientRect();
        // Must be visible and reasonably sized
        if (rect.width < 40 || rect.height < 20) return;
        // Skip wrapper-only elements (body, html, main, etc.)
        const tag = el.tagName.toLowerCase();
        if (['html', 'body', 'main', 'head', 'script', 'style', 'link', 'meta'].includes(tag)) return;

        const fp = fingerprint(el);
        if (!groups.has(fp)) groups.set(fp, []);
        groups.get(fp)!.push(el);
      });

      // ── Filter to repeated components (3+ instances) ──────────────────
      const results: DOMComponent[] = [];

      for (const [fp, els] of groups.entries()) {
        if (els.length < 3) continue;

        const representative = els[0];
        const stableClasses = Array.from(representative.classList)
          .filter(c => {
            if (/^(js-|is-|has-)/.test(c)) return false;
            if (/^(hover:|focus:|sm:|md:|lg:)/.test(c)) return false;
            return c.length >= 3;
          })
          .sort()
          .slice(0, 6);

        // Generate a human-readable component name
        const tag = representative.tagName.toLowerCase();
        const mainClass = stableClasses[0] || tag;
        const name = mainClass
          .replace(/[-_]/g, ' ')
          .replace(/\b\w/g, l => l.toUpperCase())
          .trim() || tag;

        const category = categorize(representative, stableClasses);

        results.push({
          name,
          pattern: fp,
          instances: els.length,
          commonClasses: stableClasses,
          htmlSnippet: htmlSnippet(representative),
          category,
        });

        if (results.length >= 20) break;
      }

      // Sort by instance count descending
      return results.sort((a, b) => b.instances - a.instances);
    });

    await page.close();
    await browser.close();

    return components;
  } catch {
    await browser.close().catch(() => {});
    return [];
  }
}

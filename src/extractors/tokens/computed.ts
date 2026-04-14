import { RawTokens } from '../../types';
import { loadPlaywright } from '../../playwright-loader';

/**
 * URL mode: Extract computed styles from live DOM using Playwright.
 * Playwright is an optional peer dependency.
 */
export async function extractComputedTokens(url: string, maxPages = 5): Promise<RawTokens> {
  const tokens: RawTokens = {
    colors: [],
    fonts: [],
    spacingValues: [],
    shadows: [],
    cssVariables: [],
    breakpoints: [],
    borderRadii: [],
    gradients: [],
    fontVarMap: {},
    animations: [],
    darkModeVars: [],
    zIndexValues: [],
    containerMaxWidth: null,
    fontSources: [],
    pageSections: [],
    transitionDurations: [],
    transitionEasings: [],
  };

  const playwright = loadPlaywright();
  if (!playwright) {
    // Playwright not installed — caller should handle this
    return tokens;
  }

  const browser = await playwright.chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });

  try {
    const visited = new Set<string>();
    const toVisit = [url];

    while (toVisit.length > 0 && visited.size < maxPages) {
      const currentUrl = toVisit.shift()!;
      if (visited.has(currentUrl)) continue;
      visited.add(currentUrl);

      try {
        const page = await context.newPage();
        await page.goto(currentUrl, { waitUntil: 'networkidle', timeout: 20000 });

        // Wait a moment for any JS-rendered content
        await page.waitForTimeout(1500);

        // Extract comprehensive styles from the page
        const pageTokens = await page.evaluate(() => {
          const colors: Array<{ value: string; frequency: number }> = [];
          const fonts: Array<{ family: string; size?: string; weight?: string }> = [];
          const spacingValues: number[] = [];
          const shadows: Array<{ value: string }> = [];
          const cssVars: Array<{ name: string; value: string }> = [];
          const borderRadii: string[] = [];

          // ── Extract CSS custom properties from all stylesheets ──
          try {
            const sheets = document.styleSheets;
            for (let i = 0; i < sheets.length; i++) {
              try {
                const rules = sheets[i].cssRules;
                for (let j = 0; j < rules.length; j++) {
                  const rule = rules[j];
                  if (rule instanceof CSSStyleRule) {
                    // Get CSS variables from :root, body, html, .dark, etc.
                    if (/^(:root|html|body|\.dark)/.test(rule.selectorText)) {
                      for (let k = 0; k < rule.style.length; k++) {
                        const prop = rule.style[k];
                        if (prop.startsWith('--')) {
                          cssVars.push({
                            name: prop,
                            value: rule.style.getPropertyValue(prop).trim(),
                          });
                        }
                      }
                    }
                  }
                }
              } catch {
                // Cross-origin stylesheets
              }
            }
          } catch {
            // Ignore
          }

          // ── Sample elements for computed styles ──
          // Target semantically meaningful elements
          const selectors = [
            'body',
            'header', 'nav', 'main', 'footer', 'aside',
            'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
            'p', 'a', 'span',
            'button', 'input', 'select', 'textarea',
            'table', 'th', 'td',
            'img', 'svg',
            '[class*="card"]', '[class*="modal"]', '[class*="dialog"]',
            '[class*="badge"]', '[class*="chip"]', '[class*="tag"]',
            '[class*="btn"]', '[class*="button"]',
            '[class*="nav"]', '[class*="menu"]',
            '[class*="hero"]', '[class*="banner"]',
            '[class*="container"]', '[class*="wrapper"]',
            'section', 'article', 'div',
          ];

          const allElements = new Set<Element>();
          for (const sel of selectors) {
            try {
              const els = document.querySelectorAll(sel);
              els.forEach(el => allElements.add(el));
            } catch {
              // Invalid selector
            }
          }

          const colorMap = new Map<string, number>();
          const fontMap = new Map<string, { size: string; weight: string }>();

          const sampleSize = Math.min(allElements.size, 500);
          let count = 0;

          for (const el of allElements) {
            if (count++ >= sampleSize) break;

            const style = getComputedStyle(el);

            // ── Colors ──
            for (const prop of ['color', 'backgroundColor', 'borderColor', 'outlineColor'] as const) {
              const val = style[prop];
              if (val && val !== 'rgba(0, 0, 0, 0)' && val !== 'transparent' && val !== 'inherit') {
                colorMap.set(val, (colorMap.get(val) || 0) + 1);
              }
            }

            // ── Fonts ──
            const family = style.fontFamily.split(',')[0].replace(/["']/g, '').trim();
            if (family && family !== 'inherit') {
              if (!fontMap.has(family)) {
                fontMap.set(family, {
                  size: style.fontSize,
                  weight: style.fontWeight,
                });
              }
            }

            // ── Spacing ──
            for (const prop of [
              'paddingTop', 'paddingBottom', 'paddingLeft', 'paddingRight',
              'marginTop', 'marginBottom', 'marginLeft', 'marginRight',
              'gap', 'rowGap', 'columnGap',
            ] as const) {
              const val = parseFloat(style[prop]);
              if (val > 0 && val <= 200) spacingValues.push(Math.round(val));
            }

            // ── Shadows ──
            const shadow = style.boxShadow;
            if (shadow && shadow !== 'none') {
              shadows.push({ value: shadow });
            }

            // ── Border Radius ──
            const radius = style.borderRadius;
            if (radius && radius !== '0px') {
              borderRadii.push(radius);
            }
          }

          // Convert color map
          for (const [val, freq] of colorMap.entries()) {
            colors.push({ value: val, frequency: freq });
          }

          // Convert font map
          for (const [family, info] of fontMap.entries()) {
            fonts.push({ family, size: info.size, weight: info.weight });
          }

          return { colors, fonts, spacingValues, shadows, cssVars, borderRadii };
        });

        // Convert rgb() colors to hex
        for (const color of pageTokens.colors) {
          const hex = rgbStringToHex(color.value);
          if (hex) {
            const existing = tokens.colors.find(c => c.value === hex);
            if (existing) {
              existing.frequency += color.frequency;
            } else {
              tokens.colors.push({ value: hex, frequency: color.frequency, source: 'computed' });
            }
          }
        }

        for (const font of pageTokens.fonts) {
          if (font.family && !tokens.fonts.find(f => f.family === font.family)) {
            tokens.fonts.push({ ...font, source: 'computed' });
          }
        }

        tokens.spacingValues.push(...pageTokens.spacingValues);

        for (const shadow of pageTokens.shadows) {
          if (!tokens.shadows.find(s => s.value === shadow.value)) {
            tokens.shadows.push(shadow);
          }
        }

        for (const cssVar of pageTokens.cssVars) {
          if (!tokens.cssVariables.find(v => v.name === cssVar.name)) {
            tokens.cssVariables.push({ name: cssVar.name, value: cssVar.value });
          }
        }

        for (const radius of pageTokens.borderRadii) {
          if (!tokens.borderRadii.includes(radius)) {
            tokens.borderRadii.push(radius);
          }
        }

        // Find links for crawling
        const links: string[] = await page.evaluate((baseUrl: string) => {
          const origin = new URL(baseUrl).origin;
          return Array.from(document.querySelectorAll('a[href]'))
            .map(a => {
              try {
                return new URL((a as HTMLAnchorElement).href, baseUrl).href;
              } catch {
                return '';
              }
            })
            .filter(href => href.startsWith(origin) && !href.includes('#'));
        }, currentUrl);

        for (const link of links.slice(0, 10)) {
          if (!visited.has(link)) toVisit.push(link);
        }

        await page.close();
      } catch {
        // Skip pages that fail to load
      }
    }
  } finally {
    await browser.close();
  }

  return tokens;
}

function rgbStringToHex(rgb: string): string | null {
  const match = rgb.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (!match) return null;
  const [, r, g, b] = match;
  return '#' + [r, g, b].map(c => parseInt(c).toString(16).padStart(2, '0')).join('').toLowerCase();
}

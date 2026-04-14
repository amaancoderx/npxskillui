import * as fs from 'fs';
import * as path from 'path';
import { InteractionRecord, StyleDiff, StyleSnapshot } from '../../types-ultra';
import { loadPlaywright } from '../../playwright-loader';

const TRACKED_PROPS: (keyof StyleSnapshot)[] = [
  'backgroundColor',
  'color',
  'borderColor',
  'borderWidth',
  'boxShadow',
  'opacity',
  'transform',
  'outline',
  'outlineColor',
  'textDecoration',
  'transition',
];

const INTERACTIVE_SELECTORS: Array<{
  type: InteractionRecord['componentType'];
  selector: string;
}> = [
  { type: 'button', selector: 'button:not([disabled])' },
  { type: 'role-button', selector: '[role="button"]:not([disabled])' },
  { type: 'link', selector: 'a[href]:not([href^="#"]):not([href^="mailto"])' },
  { type: 'input', selector: 'input:not([type="hidden"]):not([disabled])' },
];

/**
 * Ultra mode — Micro-Interaction Extractor
 *
 * For each interactive element type (button, link, input, role-button):
 * - Capture default screenshot
 * - Simulate hover → capture screenshot + diff computed styles
 * - Simulate focus → capture screenshot + diff computed styles
 *
 * Saves screenshots to screens/states/
 * Returns InteractionRecord[] for INTERACTIONS.md generation.
 */
export async function captureInteractions(
  url: string,
  skillDir: string
): Promise<InteractionRecord[]> {
  const playwright = loadPlaywright();
  if (!playwright) return [];

  const statesDir = path.join(skillDir, 'screens', 'states');
  fs.mkdirSync(statesDir, { recursive: true });

  const records: InteractionRecord[] = [];

  const browser = await playwright.chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    });

    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'networkidle', timeout: 25000 });
    await page.waitForTimeout(1500);

    for (const { type, selector } of INTERACTIVE_SELECTORS) {
      try {
        // Find up to 3 visible elements of this type
        const elements = await page.locator(selector).all();
        const visible = [];
        for (const el of elements) {
          try {
            const box = await el.boundingBox();
            if (box && box.width > 0 && box.height > 0 && box.width < 800) {
              visible.push(el);
              if (visible.length >= 3) break;
            }
          } catch { /* skip */ }
        }

        for (let i = 0; i < visible.length; i++) {
          const el = visible[i];
          const prefix = `${type}-${i + 1}`;

          try {
            // Get label text
            const label = await el.evaluate((node: Element) => {
              const text = (node as HTMLElement).innerText?.trim() ||
                           node.getAttribute('aria-label') ||
                           node.getAttribute('placeholder') ||
                           node.getAttribute('type') ||
                           node.tagName.toLowerCase();
              return text.slice(0, 40);
            });

            // ── Default state ─────────────────────────────────────
            const defaultStyles = await getStyles(el);
            const defaultFile = `${prefix}-default.png`;
            await screenshotElement(el, path.join(statesDir, defaultFile));

            // ── Hover state ───────────────────────────────────────
            let hoverStyles: StyleSnapshot | null = null;
            let hoverFile: string | undefined;
            try {
              await el.hover({ force: true, timeout: 3000 });
              await page.waitForTimeout(300);
              hoverStyles = await getStyles(el);
              hoverFile = `${prefix}-hover.png`;
              await screenshotElement(el, path.join(statesDir, hoverFile));
              // Move away
              await page.mouse.move(0, 0);
              await page.waitForTimeout(200);
            } catch { /* hover not supported */ }

            // ── Focus state ───────────────────────────────────────
            let focusStyles: StyleSnapshot | null = null;
            let focusFile: string | undefined;
            try {
              await el.focus({ timeout: 3000 });
              await page.waitForTimeout(300);
              focusStyles = await getStyles(el);
              focusFile = `${prefix}-focus.png`;
              await screenshotElement(el, path.join(statesDir, focusFile));
              // Blur
              await page.evaluate(() => (document.activeElement as HTMLElement)?.blur?.());
              await page.waitForTimeout(200);
            } catch { /* focus not supported */ }

            const hoverChanges = hoverStyles
              ? diffStyles(defaultStyles, hoverStyles)
              : [];
            const focusChanges = focusStyles
              ? diffStyles(defaultStyles, focusStyles)
              : [];

            // Only record if there are actual visual changes
            if (
              hoverChanges.length > 0 ||
              focusChanges.length > 0 ||
              defaultFile
            ) {
              records.push({
                componentType: type,
                label: label || type,
                selector: `${selector}:nth-of-type(${i + 1})`,
                index: i + 1,
                screenshots: {
                  default: `screens/states/${defaultFile}`,
                  hover: hoverFile ? `screens/states/${hoverFile}` : undefined,
                  focus: focusFile ? `screens/states/${focusFile}` : undefined,
                },
                hoverChanges,
                focusChanges,
                transitionValue: defaultStyles.transition,
              });
            }
          } catch { /* element failed — skip */ }
        }
      } catch { /* selector failed — skip */ }
    }

    await page.close();
  } finally {
    await browser.close().catch(() => {});
  }

  return records;
}

async function getStyles(el: any): Promise<StyleSnapshot> {
  return el.evaluate((node: Element) => {
    const s = window.getComputedStyle(node);
    return {
      backgroundColor: s.backgroundColor,
      color: s.color,
      borderColor: s.borderColor,
      borderWidth: s.borderWidth,
      boxShadow: s.boxShadow,
      opacity: s.opacity,
      transform: s.transform,
      outline: s.outline,
      outlineColor: s.outlineColor,
      textDecoration: s.textDecoration,
      transition: s.transition,
    };
  });
}

async function screenshotElement(el: any, filePath: string): Promise<void> {
  try {
    await el.screenshot({ path: filePath });
  } catch {
    // Element screenshot failed — ignore
  }
}

function diffStyles(before: StyleSnapshot, after: StyleSnapshot): StyleDiff[] {
  const diffs: StyleDiff[] = [];
  for (const prop of TRACKED_PROPS) {
    const b = before[prop] || '';
    const a = after[prop] || '';
    if (b !== a && a !== '' && a !== 'none' && a !== 'normal') {
      diffs.push({ property: prop, from: b, to: a });
    }
  }
  return diffs;
}

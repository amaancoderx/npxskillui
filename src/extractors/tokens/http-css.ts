import * as csstree from 'css-tree';
import { RawTokens, AnimationToken, DarkModeVar, FontSource, PageSection, ComponentInfo } from '../../types';

/**
 * HTTP-based extraction: fetch a URL, download its HTML + linked CSS,
 * parse CSS for design tokens. Works WITHOUT Playwright.
 *
 * This is the fallback for URL mode when Playwright is not installed.
 * It also serves as a baseline even when Playwright IS available.
 */
export interface HttpExtractionResult {
  tokens: RawTokens;
  components: ComponentInfo[];
}

export async function extractHttpCSSTokens(url: string, maxPages = 3): Promise<HttpExtractionResult> {
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

  const visited = new Set<string>();
  const toVisit = [url];
  let origin: string;
  const allHtml: string[] = [];
  const allCssContent: string[] = [];

  try {
    origin = new URL(url).origin;
  } catch {
    console.error('  Invalid URL');
    return { tokens, components: [] };
  }

  while (toVisit.length > 0 && visited.size < maxPages) {
    const currentUrl = toVisit.shift()!;
    if (visited.has(currentUrl)) continue;
    visited.add(currentUrl);

    try {
      const html = await fetchText(currentUrl);
      if (!html) continue;
      allHtml.push(html);

      // Extract all linked CSS URLs from HTML
      const cssUrls = extractCSSUrls(html, currentUrl);

      // Extract inline <style> blocks (and resolve @import URLs within them)
      const inlineStyles = extractInlineStyles(html);

      // Extract inline style= attributes for color sampling
      extractInlineAttributeColors(html, tokens);

      // Extract meta theme-color
      extractMetaColors(html, tokens);

      // Detect fonts from <link> to Google Fonts / other font CDNs
      extractFontLinks(html, tokens);

      // Detect page structure for pseudo-components
      extractDOMStructure(html, tokens);

      // Detect and decode SPA modules (React, base64-encoded JS)
      extractSPAModules(html, tokens, allCssContent);

      // Collect @import URLs from inline styles
      for (const style of inlineStyles) {
        const importUrls = extractImportUrls(style, currentUrl);
        for (const importUrl of importUrls) {
          if (!cssUrls.includes(importUrl)) cssUrls.push(importUrl);
        }
      }

      // Fetch and parse each CSS file (including @import targets)
      const fetchedCss = new Set<string>();
      const cssQueue = [...cssUrls];
      while (cssQueue.length > 0) {
        const cssUrl = cssQueue.shift()!;
        if (fetchedCss.has(cssUrl)) continue;
        fetchedCss.add(cssUrl);
        try {
          const cssContent = await fetchText(cssUrl);
          if (cssContent) {
            allCssContent.push(cssContent);
            parseCSS(cssContent, tokens, cssUrl);
            // Follow nested @import URLs
            const nestedImports = extractImportUrls(cssContent, cssUrl);
            for (const ni of nestedImports) {
              if (!fetchedCss.has(ni)) cssQueue.push(ni);
            }
          }
        } catch {
          // Skip unreachable CSS files
        }
      }

      // Parse inline styles
      for (const style of inlineStyles) {
        allCssContent.push(style);
        parseCSS(style, tokens, currentUrl);
      }

      // Find additional page links for crawling (same origin only)
      if (visited.size < maxPages) {
        const links = extractPageLinks(html, currentUrl, origin);
        for (const link of links.slice(0, 5)) {
          if (!visited.has(link)) toVisit.push(link);
        }
      }

    } catch (err) {
      // Skip pages that fail to load
    }
  }

  // Post-process: build dark mode pairs
  buildDarkModePairs(tokens);

  // Decode SPA modules for component detection
  let decodedJS = '';
  const combinedHtml = allHtml.join('\n');
  const base64Modules = combinedHtml.matchAll(/data:application\/javascript;base64,([A-Za-z0-9+/=]+)/g);
  for (const m of base64Modules) {
    try {
      decodedJS += '\n' + Buffer.from(m[1], 'base64').toString('utf-8');
    } catch {}
  }

  // Detect real UI components from HTML + decoded JS + CSS
  const combinedCss = allCssContent.join('\n');
  const components = detectHTMLComponents(combinedHtml + '\n' + decodedJS, combinedCss);

  return { tokens, components };
}

// ── HTML Parsing Helpers ──────────────────────────────────────────────

function extractCSSUrls(html: string, baseUrl: string): string[] {
  const urls: string[] = [];

  // <link rel="stylesheet" href="...">
  const linkMatches = html.matchAll(/<link[^>]+rel\s*=\s*["']stylesheet["'][^>]*href\s*=\s*["']([^"']+)["']/gi);
  for (const m of linkMatches) {
    urls.push(resolveUrl(m[1], baseUrl));
  }

  // Also catch <link href="..." rel="stylesheet">
  const linkMatches2 = html.matchAll(/<link[^>]+href\s*=\s*["']([^"']+)["'][^>]*rel\s*=\s*["']stylesheet["']/gi);
  for (const m of linkMatches2) {
    const resolved = resolveUrl(m[1], baseUrl);
    if (!urls.includes(resolved)) urls.push(resolved);
  }

  // CSS @import from inline styles will be caught by css-tree

  return urls;
}

function extractImportUrls(css: string, baseUrl: string): string[] {
  const urls: string[] = [];
  // @import url("...") or @import url(...) or @import "..."
  const importMatches = css.matchAll(/@import\s+(?:url\(\s*["']?([^"')]+)["']?\s*\)|["']([^"']+)["'])/gi);
  for (const m of importMatches) {
    const importUrl = m[1] || m[2];
    if (importUrl) {
      urls.push(resolveUrl(importUrl, baseUrl));
    }
  }
  return urls;
}

function extractInlineStyles(html: string): string[] {
  const styles: string[] = [];
  const styleMatches = html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi);
  for (const m of styleMatches) {
    if (m[1].trim()) styles.push(m[1]);
  }
  return styles;
}

function extractInlineAttributeColors(html: string, tokens: RawTokens): void {
  // Extract colors from style="" attributes
  const styleAttrMatches = html.matchAll(/style\s*=\s*["']([^"']+)["']/gi);
  for (const m of styleAttrMatches) {
    const val = m[1];
    // Hex colors
    const hexMatches = val.matchAll(/#([0-9a-fA-F]{3,8})\b/g);
    for (const h of hexMatches) {
      const hex = normalizeHex(h[0]);
      addColor(tokens, hex, 'css');
    }
    // RGB colors
    const rgbMatches = val.matchAll(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/g);
    for (const r of rgbMatches) {
      addColor(tokens, rgbToHex(parseInt(r[1]), parseInt(r[2]), parseInt(r[3])), 'css');
    }
  }

  // Parse light-dark() CSS function — extract the LIGHT value (first arg)
  // light-dark(white, black) → use "white" as default
  parseLightDarkColors(html, tokens);
}

function parseLightDarkColors(content: string, tokens: RawTokens): void {
  // Parse property: light-dark(lightVal, darkVal) — context-aware
  // background: light-dark(white, black) → white is background
  // color: light-dark(black, white) → black is text
  const propMatches = content.matchAll(/(background|color|border-color)\s*:\s*light-dark\(\s*([^,]+)\s*,\s*([^)]+)\s*\)/gi);
  for (const m of propMatches) {
    const prop = m[1].toLowerCase();
    const lightVal = m[2].trim();
    const hex = tryParseColor(lightVal) || namedColorToHex(lightVal);
    if (hex) {
      if (prop === 'background') {
        addColor(tokens, hex, 'css', 'light-bg');
      } else if (prop === 'color') {
        addColor(tokens, hex, 'css', 'light-text');
      } else {
        addColor(tokens, hex, 'css', 'light-default');
      }
    }
  }

  // Also detect color-scheme to understand if site is light or dark
  const colorSchemeMatch = content.match(/color-scheme\s*:\s*([^;}\n]+)/i);
  if (colorSchemeMatch) {
    const scheme = colorSchemeMatch[1].trim().toLowerCase();
    if (scheme.startsWith('light')) {
      tokens.cssVariables.push({
        name: '--color-scheme-default',
        value: 'light',
        property: 'color',
      });
    }
  }
}

/**
 * Detect color-scheme from CSS file content (not HTML).
 * Called per-CSS-file so we catch :root { color-scheme: light dark; } in stylesheets.
 * Guards against false positives from inside @media (prefers-color-scheme: dark) blocks.
 */
function detectColorSchemeFromCSS(css: string, tokens: RawTokens): void {
  // Already detected — skip
  if (tokens.cssVariables.some(v => v.name === '--color-scheme-default')) return;

  // Strip dark-mode media query blocks before searching, so we don't pick up
  // color-scheme: dark from inside @media (prefers-color-scheme: dark) { ... }
  const withoutDarkMedia = css.replace(
    /@media\s*\(\s*prefers-color-scheme\s*:\s*dark\s*\)\s*\{[\s\S]*?\}\s*\}/g,
    ''
  );

  const match = withoutDarkMedia.match(/color-scheme\s*:\s*([^;}\n]+)/i);
  if (!match) return;

  const scheme = match[1].trim().toLowerCase();
  // "light", "light dark", "only light" → all indicate light as primary
  if (scheme.startsWith('light') || scheme === 'only light') {
    tokens.cssVariables.push({
      name: '--color-scheme-default',
      value: 'light',
      property: 'color',
    });
  }
}

/**
 * Returns true if a font family name looks like an icon/symbol font.
 * These should be excluded from the design typography documentation.
 */
function isIconFont(family: string): boolean {
  return /^(apple\s*(icons?|legacy|sf\s*symbols?)|material\s*(icons?|symbols?)|font\s*awesome|fontawesome|glyphicons?|ionicons?|feather|remixicon|octicons?|bootstrap\s*icons?|hero\s*icons?|phosphor|tabler|lucide)\b/i.test(family)
    || /^apple\s*icons?\s*\d+/i.test(family)
    || /^apple\s*legacy\s*chevron/i.test(family);
}

/**
 * Returns true if a font family is a system font that cannot be downloaded.
 */
function isSystemFont(family: string): boolean {
  return /^(-apple-system|blinkmacsystemfont|system-ui|ui-sans-serif|ui-serif|ui-monospace|segoe\s*ui|\.sf\s*(pro|compact))/i.test(family);
}

/**
 * Returns true if a font family is an emoji font (not useful for UI design docs).
 */
function isEmojiFont(family: string): boolean {
  return /^(apple\s*color\s*emoji|noto\s*color\s*emoji|segoe\s*ui\s*emoji|android\s*emoji|twemoji|emoji)/i.test(family);
}

/**
 * From a CSS font-family value string (possibly with fallbacks),
 * extract the first real, non-generic, non-system, non-emoji font name.
 * Used to resolve --font-* CSS variable values.
 */
function extractFirstRealFont(value: string): string | null {
  const candidates = value.split(',').map(f => f.replace(/["']/g, '').trim());
  for (const family of candidates) {
    if (!family) continue;
    if (family.startsWith('var(')) continue;
    if (isGenericFont(family)) continue;
    if (isSystemFont(family)) continue;
    if (isIconFont(family)) continue;
    if (isEmojiFont(family)) continue;
    if (!isValidFontName(family)) continue;
    return family;
  }
  return null;
}

function extractMetaColors(html: string, tokens: RawTokens): void {
  // <meta name="theme-color" content="#...">
  const themeColor = html.match(/<meta[^>]+name\s*=\s*["']theme-color["'][^>]+content\s*=\s*["']([^"']+)["']/i);
  if (themeColor) {
    const hex = tryParseColor(themeColor[1]);
    if (hex) addColor(tokens, hex, 'css', 'theme-color');
  }

  // <meta name="msapplication-TileColor">
  const tileColor = html.match(/<meta[^>]+name\s*=\s*["']msapplication-TileColor["'][^>]+content\s*=\s*["']([^"']+)["']/i);
  if (tileColor) {
    const hex = tryParseColor(tileColor[1]);
    if (hex) addColor(tokens, hex, 'css', 'tile-color');
  }

  // Favicon: <link rel="icon"> / <link rel="shortcut icon"> / <link rel="apple-touch-icon">
  if (!tokens.favicon) {
    const faviconPatterns = [
      /<link[^>]+rel\s*=\s*["'][^"']*\bicon\b[^"']*["'][^>]+href\s*=\s*["']([^"']+)["']/i,
      /<link[^>]+href\s*=\s*["']([^"']+)["'][^>]+rel\s*=\s*["'][^"']*\bicon\b[^"']*["']/i,
    ];
    for (const pat of faviconPatterns) {
      const m = html.match(pat);
      if (m && m[1]) {
        // Strip query strings from favicon URL — keep just the path/URL
        let faviconHref = m[1].split('?')[0].trim();
        // Prefer standard extensions
        if (/\.(ico|png|svg|jpg|webp)$/i.test(faviconHref)) {
          tokens.favicon = faviconHref;
        } else {
          tokens.favicon = faviconHref || '/favicon.ico';
        }
        break;
      }
    }
    // Default to /favicon.ico if none found
    if (!tokens.favicon) tokens.favicon = '/favicon.ico';
  }

  // Site title from <title> tag or og:title
  if (!tokens.siteTitle) {
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (titleMatch) tokens.siteTitle = titleMatch[1].trim();
  }
  if (!tokens.siteTitle) {
    const ogTitle = html.match(/<meta[^>]+property\s*=\s*["']og:title["'][^>]+content\s*=\s*["']([^"']+)["']/i);
    if (ogTitle) tokens.siteTitle = ogTitle[1].trim();
  }
}

function extractFontLinks(html: string, tokens: RawTokens): void {
  // Google Fonts: <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;700&...">
  const googleFontMatches = html.matchAll(/fonts\.googleapis\.com\/css2?\?[^"']*family=([^"'&]+)/gi);
  for (const m of googleFontMatches) {
    const families = decodeURIComponent(m[1]).split('|');
    for (const f of families) {
      const familyName = f.split(':')[0].replace(/\+/g, ' ').trim();
      if (familyName) {
        tokens.fonts.push({ family: familyName, source: 'css' });
      }
    }
  }

  // Detect font from @font-face in CSS (handled in parseCSS)

  // Also check for common font CDN patterns
  const fontCDNMatches = html.matchAll(/fonts\.[^"']+["']/gi);
  // Already handled above
}

function extractDOMStructure(html: string, tokens: RawTokens): void {
  // Detect viewport meta for responsive
  const viewportMatch = html.match(/<meta[^>]+name\s*=\s*["']viewport["'][^>]+content\s*=\s*["']([^"']+)["']/i);
  if (viewportMatch && viewportMatch[1].includes('width=device-width')) {
    // Responsive site
  }

  // Detect page sections by semantic HTML tags and class patterns
  detectPageSections(html, tokens);
}

function extractSPAModules(html: string, tokens: RawTokens, allCssContent: string[]): void {
  // Decode base64-encoded JS modules from importmap or inline scripts
  // These contain CSS classes, inline styles, and component structure
  const base64Matches = html.matchAll(/data:application\/javascript;base64,([A-Za-z0-9+/=]+)/g);
  for (const m of base64Matches) {
    try {
      const decoded = Buffer.from(m[1], 'base64').toString('utf-8');
      // Extract CSS-in-JS styles and class names
      extractColorsFromJSModule(decoded, tokens);
      extractClassNamesFromJS(decoded, tokens);
      // Also treat any inline CSS strings as CSS content
      const cssStrings = decoded.matchAll(/`([^`]*(?:background|color|font|padding|margin|border|display|flex)[^`]*)`/g);
      for (const cs of cssStrings) {
        allCssContent.push(cs[1]);
      }
    } catch {
      // Skip unparseable modules
    }
  }

  // Also check for esm.sh imports to detect frameworks
  if (/esm\.sh\/react@/i.test(html) || /from\s+["']react["']/i.test(html)) {
    // React SPA detected — fonts and components are rendered client-side
  }
}

function extractColorsFromJSModule(js: string, tokens: RawTokens): void {
  // Extract hex colors from JS string literals
  const hexMatches = js.matchAll(/["'`](#[0-9a-fA-F]{3,8})["'`]/g);
  for (const m of hexMatches) {
    const hex = normalizeHex(m[1]);
    if (isValidHex(hex)) {
      addColor(tokens, hex, 'css');
    }
  }

  // Extract rgb/rgba from JS
  const rgbMatches = js.matchAll(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/g);
  for (const m of rgbMatches) {
    addColor(tokens, rgbToHex(parseInt(m[1]), parseInt(m[2]), parseInt(m[3])), 'css');
  }

  // Extract CSS variable definitions from JS template literals
  const cssVarMatches = js.matchAll(/(--[\w-]+)\s*:\s*([^;}\n"'`]+)/g);
  for (const m of cssVarMatches) {
    const name = m[1];
    const value = m[2].trim();
    if (!tokens.cssVariables.find(v => v.name === name)) {
      tokens.cssVariables.push({ name, value, property: guessPropertyType(name) });
    }
    if (isColorVarName(name)) {
      const hex = tryParseColor(value);
      if (hex) addColor(tokens, hex, 'css', name.replace(/^--/, ''));
    }
  }

  // Extract SVG colors (fill, stroke attributes)
  const svgColorMatches = js.matchAll(/(?:fill|stroke)\s*[:=]\s*["']([^"']+)["']/g);
  for (const m of svgColorMatches) {
    const val = m[1].trim();
    const hex = tryParseColor(val) || namedColorToHex(val);
    if (hex) addColor(tokens, hex, 'css');
  }
}

function extractClassNamesFromJS(js: string, tokens: RawTokens): void {
  // Collect ALL Tailwind classes from className patterns
  const allClasses: string[] = [];
  const classNameMatches = js.matchAll(/className\s*[:=]\s*["'`]([^"'`]+)["'`]/g);
  for (const m of classNameMatches) {
    const classes = m[1].split(/\s+/).filter(Boolean);
    allClasses.push(...classes);
  }
  // Also from template literal className with interpolation
  const templateMatches = js.matchAll(/className\s*[:=]\s*`([^`]+)`/g);
  for (const m of templateMatches) {
    // Remove template expressions ${...} and split
    const cleaned = m[1].replace(/\$\{[^}]+\}/g, ' ');
    allClasses.push(...cleaned.split(/\s+/).filter(Boolean));
  }

  // Count class frequencies to determine primary patterns
  const classFreq = new Map<string, number>();
  for (const cls of allClasses) {
    classFreq.set(cls, (classFreq.get(cls) || 0) + 1);
  }

  // ── Colors from Tailwind classes ──
  const twColorMap: Record<string, string> = {
    'black': '#000000', 'white': '#ffffff',
    'gray-100': '#f3f4f6', 'gray-200': '#e5e7eb', 'gray-300': '#d1d5db',
    'gray-400': '#9ca3af', 'gray-500': '#6b7280', 'gray-600': '#4b5563',
    'gray-700': '#374151', 'gray-800': '#1f2937', 'gray-900': '#111827',
    'red-500': '#ef4444', 'red-600': '#dc2626',
    'blue-500': '#3b82f6', 'green-500': '#22c55e',
  };

  for (const cls of allClasses) {
    // Tailwind arbitrary colors: bg-[#ACD8C9], text-[#ACD8C9], border-[#hex]
    // Also with opacity: bg-[#ACD8C9]/95
    const arbColorMatch = cls.match(/^(?:bg|text|border|fill|stroke)-\[#([0-9a-fA-F]{3,8})\]/);
    if (arbColorMatch) {
      const hex = normalizeHex('#' + arbColorMatch[1]);
      if (isValidHex(hex)) addColor(tokens, hex, 'css');
    }

    // Named Tailwind colors: bg-black, text-white, text-black, border-black, bg-white
    const namedColorMatch = cls.match(/^(?:bg|text|border)-(black|white|gray-\d+|red-\d+|blue-\d+|green-\d+)(?:\/\d+)?$/);
    if (namedColorMatch && twColorMap[namedColorMatch[1]]) {
      addColor(tokens, twColorMap[namedColorMatch[1]], 'css');
    }

    // Arbitrary font family: font-['Custom Font']
    if (cls.startsWith('font-[') && cls.includes("'")) {
      const fontMatch = cls.match(/font-\[\s*'([^']+)'\s*\]/);
      if (fontMatch && !tokens.fonts.find(f => f.family === fontMatch[1])) {
        tokens.fonts.push({ family: fontMatch[1], source: 'css' });
      }
    }

    // Tailwind font classes: font-mono, font-sans, font-serif, font-doto (custom)
    const fontClassMatch = cls.match(/^font-(mono|sans|serif|doto|bold|black|medium|semibold|light|thin|extrabold)$/);
    if (fontClassMatch) {
      const fontType = fontClassMatch[1];
      if (fontType === 'mono' && !tokens.fonts.find(f => f.family === 'monospace')) {
        tokens.fonts.push({ family: 'monospace', source: 'css' });
      }
      // Custom font class like font-doto → Doto font
      if (!['mono', 'sans', 'serif', 'bold', 'black', 'medium', 'semibold', 'light', 'thin', 'extrabold'].includes(fontType)) {
        const capName = fontType.charAt(0).toUpperCase() + fontType.slice(1);
        if (!tokens.fonts.find(f => f.family.toLowerCase() === fontType)) {
          tokens.fonts.push({ family: capName, source: 'css' });
        }
      }
    }

    // Tailwind text sizes: text-xs, text-sm, text-[9px], text-[10px], text-2xl, text-4xl
    const textSizeMatch = cls.match(/^text-\[(\d+(?:px|rem))\]$/);
    if (textSizeMatch) {
      tokens.fonts.push({ family: '', size: textSizeMatch[1], source: 'css' });
    }
    const twSizeMap: Record<string, string> = {
      'text-xs': '12px', 'text-sm': '14px', 'text-base': '16px',
      'text-lg': '18px', 'text-xl': '20px', 'text-2xl': '24px',
      'text-3xl': '30px', 'text-4xl': '36px', 'text-5xl': '48px',
    };
    if (twSizeMap[cls]) {
      tokens.fonts.push({ family: '', size: twSizeMap[cls], source: 'css' });
    }

    // Tailwind rounded-none → border-radius: 0px
    if (cls === 'rounded-none') {
      if (!tokens.borderRadii.includes('0px')) tokens.borderRadii.push('0px');
    }
    // Standard Tailwind rounded classes
    const twRadiusMap: Record<string, string> = {
      'rounded-sm': '2px', 'rounded': '4px', 'rounded-md': '6px',
      'rounded-lg': '8px', 'rounded-xl': '12px', 'rounded-2xl': '16px',
      'rounded-3xl': '24px', 'rounded-full': '9999px',
    };
    if (twRadiusMap[cls] && !tokens.borderRadii.includes(twRadiusMap[cls])) {
      tokens.borderRadii.push(twRadiusMap[cls]);
    }

    // Tailwind arbitrary shadows: shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]
    const shadowMatch = cls.match(/^shadow-\[(.+)\]$/);
    if (shadowMatch) {
      const shadowVal = shadowMatch[1].replace(/_/g, ' ');
      if (!tokens.shadows.find(s => s.value === shadowVal)) {
        tokens.shadows.push({ value: shadowVal });
      }
    }

    // Tailwind spacing: p-1, px-2, py-6, m-4, gap-3, space-y-4
    const spacingMatch = cls.match(/^(?:p|px|py|pt|pb|pl|pr|m|mx|my|mt|mb|ml|mr|gap|space-[xy])-(\d+(?:\.\d+)?)$/);
    if (spacingMatch) {
      const twUnit = parseFloat(spacingMatch[1]) * 4; // Tailwind spacing: 1 = 4px
      if (twUnit > 0 && twUnit <= 200) tokens.spacingValues.push(Math.round(twUnit));
    }
    // Arbitrary spacing: p-[40px], px-10
    const arbSpacingMatch = cls.match(/^(?:p|px|py|m|mx|my|gap)-\[(\d+)px\]$/);
    if (arbSpacingMatch) {
      const px = parseInt(arbSpacingMatch[1]);
      if (px > 0 && px <= 200) tokens.spacingValues.push(px);
    }
  }

  // ── Detect font dominance ──
  // Count font-mono vs font-sans occurrences to determine primary font style
  const monoCount = classFreq.get('font-mono') || 0;
  const sansCount = classFreq.get('font-sans') || 0;
  if (monoCount > sansCount && monoCount >= 3) {
    // Monospace is the primary UI font — increase its frequency
    const monoFont = tokens.fonts.find(f => f.family === 'monospace');
    if (monoFont) {
      // Already added
    } else {
      tokens.fonts.push({ family: 'monospace', source: 'css' });
    }
    // Add extra frequency entries to make monospace the primary
    for (let i = 0; i < monoCount; i++) {
      tokens.fonts.push({ family: 'monospace', source: 'css' });
    }
  }

  // ── Detect uppercase/tracking patterns ──
  const uppercaseCount = classFreq.get('uppercase') || 0;
  const trackingCount = (classFreq.get('tracking-widest') || 0) + (classFreq.get('tracking-wider') || 0) + (classFreq.get('tracking-tight') || 0);
  // If heavy uppercase usage, this indicates a brutalist/terminal style
  // We'll capture this in antiPatterns or similar
  if (uppercaseCount >= 5) {
    // Uppercase-heavy UI — this is a style signal
  }

  // Also extract font-family from inline style objects in JSX
  const fontFamilyMatches = js.matchAll(/fontFamily\s*:\s*["'`]([^"'`]+)["'`]/g);
  for (const m of fontFamilyMatches) {
    const family = m[1].split(',')[0].replace(/["']/g, '').trim();
    if (family && family.length > 1 && family.length < 50 && !isGenericFont(family)) {
      if (!tokens.fonts.find(f => f.family === family)) {
        tokens.fonts.push({ family, source: 'css' });
      }
    }
  }

  // Extract border-radius from inline style objects
  const radiusMatches = js.matchAll(/borderRadius\s*:\s*["'`]?(\d+(?:px|rem|%)?)/g);
  for (const m of radiusMatches) {
    const val = m[1].includes('px') || m[1].includes('rem') || m[1].includes('%') ? m[1] : m[1] + 'px';
    if (!tokens.borderRadii.includes(val)) tokens.borderRadii.push(val);
  }

  // Extract spacing from inline style objects
  const spacingProps = ['padding', 'margin', 'gap', 'paddingTop', 'paddingBottom', 'paddingLeft', 'paddingRight', 'marginTop', 'marginBottom'];
  for (const prop of spacingProps) {
    const regex = new RegExp(`${prop}\\s*:\\s*["'\`]?(\\d+(?:px)?)`, 'g');
    const matches = js.matchAll(regex);
    for (const m of matches) {
      const px = parseInt(m[1]);
      if (px > 0 && px <= 200) tokens.spacingValues.push(px);
    }
  }
}

function detectPageSections(html: string, tokens: RawTokens): void {
  // Navigation
  const navMatch = html.match(/<nav[^>]*class\s*=\s*["']([^"']*)["'][^>]*>/i);
  if (navMatch || /<nav[\s>]/i.test(html)) {
    tokens.pageSections.push({
      type: 'navigation',
      tag: 'nav',
      classes: navMatch ? navMatch[1].split(/\s+/).filter(Boolean) : [],
      childCount: countChildLinks(html, 'nav'),
      description: 'Top navigation bar',
    });
  }

  // Hero section — look for common class patterns near the top
  const heroPatterns = [
    /class\s*=\s*["'][^"']*\b(hero|banner|jumbotron|masthead)\b[^"']*["']/i,
  ];
  for (const pattern of heroPatterns) {
    const heroMatch = html.match(pattern);
    if (heroMatch) {
      tokens.pageSections.push({
        type: 'hero',
        tag: 'section',
        classes: [heroMatch[1]],
        childCount: 0,
        description: 'Hero/banner section with headline and CTAs',
      });
      break;
    }
  }

  // If no explicit hero class, detect by structure: first large heading
  if (!tokens.pageSections.find(s => s.type === 'hero')) {
    const hasLargeHeading = /<(h1|h2)[^>]*>[\s\S]{5,}<\/(h1|h2)>/i.test(html);
    if (hasLargeHeading) {
      tokens.pageSections.push({
        type: 'hero',
        tag: 'section',
        classes: [],
        childCount: 0,
        description: 'Hero section (detected from heading structure)',
      });
    }
  }

  // Features/cards section
  const featurePatterns = /class\s*=\s*["'][^"']*\b(features?|benefits?|cards?-grid|card-container)\b[^"']*["']/i;
  const featureMatch = html.match(featurePatterns);
  if (featureMatch) {
    tokens.pageSections.push({
      type: 'features',
      tag: 'section',
      classes: [featureMatch[1]],
      childCount: countRepeatedElements(html, 'card'),
      description: 'Feature/benefit cards grid',
    });
  }

  // FAQ section
  const faqMatch = html.match(/class\s*=\s*["'][^"']*\b(faq|accordion|questions)\b[^"']*["']/i);
  if (faqMatch || /FAQ|Frequently Asked/i.test(html)) {
    tokens.pageSections.push({
      type: 'faq',
      tag: 'section',
      classes: faqMatch ? [faqMatch[1]] : ['faq'],
      childCount: 0,
      description: 'FAQ/accordion section',
    });
  }

  // Footer
  const footerMatch = html.match(/<footer[^>]*class\s*=\s*["']([^"']*)["'][^>]*>/i);
  if (footerMatch || /<footer[\s>]/i.test(html)) {
    tokens.pageSections.push({
      type: 'footer',
      tag: 'footer',
      classes: footerMatch ? footerMatch[1].split(/\s+/).filter(Boolean) : [],
      childCount: countChildLinks(html, 'footer'),
      description: 'Page footer with links and info',
    });
  }

  // CTA sections
  const ctaMatch = html.match(/class\s*=\s*["'][^"']*\b(cta|call-to-action|signup)\b[^"']*["']/i);
  if (ctaMatch) {
    tokens.pageSections.push({
      type: 'cta',
      tag: 'section',
      classes: [ctaMatch[1]],
      childCount: 0,
      description: 'Call-to-action section',
    });
  }

  // Stats section
  const statsMatch = html.match(/class\s*=\s*["'][^"']*\b(stats|metrics|numbers|counters)\b[^"']*["']/i);
  if (statsMatch) {
    tokens.pageSections.push({
      type: 'stats',
      tag: 'section',
      classes: [statsMatch[1]],
      childCount: 0,
      description: 'Statistics/metrics display',
    });
  }

  // Testimonials
  const testimonialMatch = html.match(/class\s*=\s*["'][^"']*\b(testimonials?|reviews?|quotes?)\b[^"']*["']/i);
  if (testimonialMatch) {
    tokens.pageSections.push({
      type: 'testimonials',
      tag: 'section',
      classes: [testimonialMatch[1]],
      childCount: 0,
      description: 'Testimonials/reviews section',
    });
  }

  // Detect card patterns anywhere (repeated elements with "card" in class)
  if (!tokens.pageSections.find(s => s.type === 'cards' || s.type === 'features')) {
    const cardCount = countRepeatedElements(html, 'card');
    if (cardCount >= 3) {
      tokens.pageSections.push({
        type: 'cards',
        tag: 'div',
        classes: ['card'],
        childCount: cardCount,
        description: `Grid of ${cardCount} card elements`,
      });
    }
  }
}

function countChildLinks(html: string, tag: string): number {
  const tagMatch = html.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  if (!tagMatch) return 0;
  const links = tagMatch[1].match(/<a\s/gi);
  return links ? links.length : 0;
}

function countRepeatedElements(html: string, classPattern: string): number {
  const regex = new RegExp(`class\\s*=\\s*["'][^"']*\\b${classPattern}\\b`, 'gi');
  const matches = html.match(regex);
  return matches ? matches.length : 0;
}

function extractTransitionParts(value: string, tokens: RawTokens): void {
  // Parse durations from transition shorthand (e.g., "all 150ms ease", "opacity 0.3s ease-out")
  const durationMatches = value.matchAll(/([\d.]+)(ms|s)\b/g);
  for (const m of durationMatches) {
    let dur = m[2] === 's' ? `${parseFloat(m[1]) * 1000}ms` : `${m[1]}ms`;
    if (!tokens.transitionDurations.includes(dur)) {
      tokens.transitionDurations.push(dur);
    }
  }

  // Parse easings
  const easingPatterns = [
    /\b(ease-in-out|ease-in|ease-out|ease|linear)\b/g,
    /cubic-bezier\([^)]+\)/g,
  ];
  for (const pattern of easingPatterns) {
    const matches = value.matchAll(pattern);
    for (const m of matches) {
      const easing = m[0];
      if (!tokens.transitionEasings.includes(easing)) {
        tokens.transitionEasings.push(easing);
      }
    }
  }
}

function extractPageLinks(html: string, baseUrl: string, origin: string): string[] {
  const links: string[] = [];
  const hrefMatches = html.matchAll(/<a[^>]+href\s*=\s*["']([^"'#]+)["']/gi);
  for (const m of hrefMatches) {
    try {
      const resolved = new URL(m[1], baseUrl).href;
      if (resolved.startsWith(origin) && !resolved.includes('#') && !links.includes(resolved)) {
        links.push(resolved);
      }
    } catch {
      // Invalid URL
    }
  }
  return links;
}

// ── CSS Parsing ───────────────────────────────────────────────────────

function parseCSS(content: string, tokens: RawTokens, cssBaseUrl?: string): void {
  // First, extract dark mode blocks via regex (before AST parsing may fail)
  extractDarkModeBlocks(content, tokens);

  // Detect color-scheme in CSS (e.g. :root { color-scheme: light dark; })
  detectColorSchemeFromCSS(content, tokens);

  // Extract @keyframes
  extractKeyframes(content, tokens);

  // Extract @font-face (with URL resolution)
  extractFontFace(content, tokens, cssBaseUrl);

  // Extract @media breakpoints
  extractMediaBreakpoints(content, tokens);

  // Extract z-index
  extractZIndex(content, tokens);

  // Extract container widths
  extractContainerWidth(content, tokens);

  // AST-based parsing
  try {
    const ast = csstree.parse(content, {
      parseCustomProperty: true,
      parseAtrulePrelude: true,
    });

    csstree.walk(ast, {
      visit: 'Declaration',
      enter(node: csstree.Declaration) {
        const prop = node.property;
        const rawValue = csstree.generate(node.value as csstree.CssNode);

        // CSS custom properties
        if (prop.startsWith('--')) {
          const trimmedValue = rawValue.trim();
          tokens.cssVariables.push({
            name: prop,
            value: trimmedValue,
            property: guessPropertyType(prop),
          });

          // Extract color from variable value
          if (isColorVarName(prop)) {
            const hex = tryParseColor(trimmedValue);
            if (hex) {
              const name = prop.replace(/^--/, '');
              addColor(tokens, hex, 'css', name);
            }
          }

          // Populate fontVarMap: --font-xxx, --font-sans, --font-mono, --default-font-family
          // e.g. --font-sans: 'delight' → fontVarMap['--font-sans'] = 'delight'
          if (/^--(font|default[-_]font)/i.test(prop)) {
            // Extract first real font from the value (skip generics/system/emoji)
            const fontVal = extractFirstRealFont(trimmedValue);
            if (fontVal) {
              tokens.fontVarMap[prop] = fontVal;
            }
          }
        }

        // Direct color properties
        if (isColorProperty(prop)) {
          extractColorsFromValue(rawValue, tokens);
        }

        // Font family — walk all comma-separated families, resolve vars, skip system/icon/emoji/generic
        if (prop === 'font-family') {
          const candidates = rawValue.split(',').map(f => f.replace(/["']/g, '').trim());
          for (let family of candidates) {
            if (!family) continue;
            // Resolve CSS variable reference: var(--font-delight) → 'delight'
            if (family.startsWith('var(')) {
              const varName = family.replace(/^var\(\s*/, '').replace(/\s*(?:,[^)]+)?\)$/, '').trim();
              const resolved = tokens.fontVarMap[varName] || tokens.fontVarMap[family];
              if (resolved) {
                family = resolved;
              } else {
                continue; // can't resolve yet — skip
              }
            }
            if (isGenericFont(family)) continue;
            if (isSystemFont(family)) continue;
            if (isIconFont(family)) continue;
            if (isEmojiFont(family)) continue;
            if (!isValidFontName(family)) continue;
            if (!tokens.fonts.find(f => f.family === family)) {
              tokens.fonts.push({ family, source: 'css' });
            }
            break; // use the first real (non-system) font in the stack
          }
        }

        // Font size
        if (prop === 'font-size') {
          const size = rawValue.trim();
          const existingNoSize = tokens.fonts.find(f => !f.size);
          if (existingNoSize) {
            existingNoSize.size = size;
          } else {
            tokens.fonts.push({ family: '', size, source: 'css' });
          }
        }

        // Font weight
        if (prop === 'font-weight') {
          const existingNoWeight = tokens.fonts.find(f => !f.weight);
          if (existingNoWeight) {
            existingNoWeight.weight = rawValue.trim();
          }
        }

        // Spacing
        if (isSpacingProperty(prop)) {
          extractSpacingValues(rawValue, tokens);
        }

        // Box shadow
        if (prop === 'box-shadow' && rawValue.trim() !== 'none') {
          if (!tokens.shadows.find(s => s.value === rawValue.trim())) {
            tokens.shadows.push({ value: rawValue.trim() });
          }
        }

        // Border radius — only collect single-value radii, skip CSS shorthand like "0 0 18px 18px"
        if (prop === 'border-radius' || (prop.startsWith('border-') && prop.endsWith('-radius'))) {
          const val = rawValue.trim();
          // Skip shorthand values (contain spaces between lengths) and slash syntax
          if (!val.includes(' ') && !val.includes('/')) {
            if (!tokens.borderRadii.includes(val)) {
              tokens.borderRadii.push(val);
            }
          }
        }

        // Gradients
        if (rawValue.includes('gradient(')) {
          tokens.gradients.push(rawValue.trim());
        }

        // Transitions
        if (prop === 'transition') {
          tokens.animations.push({
            name: 'css-transition',
            type: 'css-transition',
            value: rawValue.trim(),
            source: 'css',
          });
          // Parse durations and easings from shorthand
          extractTransitionParts(rawValue, tokens);
        }

        // Transition sub-properties (skip var() references — normalizer will handle)
        if (prop === 'transition-duration' || prop === 'animation-duration') {
          const dur = rawValue.trim();
          if (dur && !dur.includes('var(') && /^[\d.]+m?s$/.test(dur) && !tokens.transitionDurations.includes(dur)) {
            tokens.transitionDurations.push(dur);
          }
        }
        if (prop === 'transition-timing-function' || prop === 'animation-timing-function') {
          const ease = rawValue.trim();
          if (ease && !ease.includes('var(') && !tokens.transitionEasings.includes(ease)) {
            tokens.transitionEasings.push(ease);
          }
        }
      },
    });
  } catch {
    // Fallback: regex-based extraction for files css-tree can't parse
    extractWithRegex(content, tokens);
  }
}

function extractDarkModeBlocks(content: string, tokens: RawTokens): void {
  const rootVars = new Map<string, string>();
  const darkVars = new Map<string, string>();

  const rootBlocks = content.matchAll(/:root\s*\{([^}]+)\}/g);
  for (const m of rootBlocks) {
    const vars = m[1].matchAll(/(--[\w-]+)\s*:\s*([^;}\n]+)/g);
    for (const v of vars) {
      rootVars.set(v[1], v[2].trim());
    }
  }

  const darkPatterns = [
    /\.dark\s*\{([^}]+)\}/g,
    /\[data-theme\s*=\s*["']dark["']\]\s*\{([^}]+)\}/g,
    /\.dark\s+:root\s*\{([^}]+)\}/g,
    /:root\.dark\s*\{([^}]+)\}/g,
    /@media\s*\(\s*prefers-color-scheme\s*:\s*dark\s*\)\s*\{[^{]*:root\s*\{([^}]+)\}/g,
    /@media\s*\(\s*prefers-color-scheme\s*:\s*dark\s*\)\s*\{([^}]+)\}/g,
  ];

  for (const pattern of darkPatterns) {
    const matches = content.matchAll(pattern);
    for (const m of matches) {
      const vars = m[1].matchAll(/(--[\w-]+)\s*:\s*([^;}\n]+)/g);
      for (const v of vars) {
        darkVars.set(v[1], v[2].trim());
      }
    }
  }

  for (const [name, lightVal] of rootVars) {
    const darkVal = darkVars.get(name);
    if (darkVal && darkVal !== lightVal) {
      if (!tokens.darkModeVars.find(d => d.variable === name)) {
        tokens.darkModeVars.push({
          variable: name,
          lightValue: lightVal,
          darkValue: darkVal,
        });
      }
    }
  }
}

function extractKeyframes(content: string, tokens: RawTokens): void {
  const keyframeMatches = content.matchAll(/@keyframes\s+([\w-]+)\s*\{([^}]*(?:\{[^}]*\}[^}]*)*)\}/g);
  for (const m of keyframeMatches) {
    if (!tokens.animations.find(a => a.name === m[1])) {
      tokens.animations.push({
        name: m[1],
        type: 'css-keyframe',
        value: m[2].trim().slice(0, 200),
        source: 'css',
      });
    }
  }
}

function extractFontFace(content: string, tokens: RawTokens, cssBaseUrl?: string): void {
  const fontFaceMatches = content.matchAll(/@font-face\s*\{([^}]+)\}/g);
  for (const m of fontFaceMatches) {
    const familyMatch = m[1].match(/font-family\s*:\s*["']?([^"';,]+)["']?/);
    const weightMatch = m[1].match(/font-weight\s*:\s*(\d+)/);
    if (familyMatch) {
      const family = familyMatch[1].trim();
      if (!isValidFontName(family)) continue;
      // Skip icon fonts — they pollute typography documentation
      if (isIconFont(family)) continue;
      // Skip system fonts — they can't be downloaded and are implicit
      if (isSystemFont(family)) continue;

      if (!tokens.fonts.find(f => f.family === family)) {
        tokens.fonts.push({
          family,
          weight: weightMatch ? weightMatch[1] : undefined,
          source: 'css',
        });
      }

      // Extract font source URLs — skip icon/symbol font sources
      const srcMatches = m[1].matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g);
      for (const srcMatch of srcMatches) {
        let srcUrl = srcMatch[1].trim();
        // Resolve relative URLs to absolute
        if (cssBaseUrl && !srcUrl.startsWith('http') && !srcUrl.startsWith('data:')) {
          srcUrl = resolveUrl(srcUrl, cssBaseUrl);
        }
        // Detect format
        const formatMatch = m[1].match(new RegExp(`url\\([^)]*${escapeRegex(srcUrl)}[^)]*\\)\\s*format\\(\\s*["']?([^"')]+)["']?\\s*\\)`));
        const format = formatMatch ? formatMatch[1] : guessFormatFromUrl(srcUrl);

        if (!tokens.fontSources.find(fs => fs.family === family && fs.src === srcUrl)) {
          tokens.fontSources.push({
            family,
            src: srcUrl,
            format,
            weight: weightMatch ? weightMatch[1] : undefined,
          });
        }
      }
    }
  }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function guessFormatFromUrl(url: string): string | undefined {
  if (url.endsWith('.woff2')) return 'woff2';
  if (url.endsWith('.woff')) return 'woff';
  if (url.endsWith('.ttf')) return 'truetype';
  if (url.endsWith('.otf')) return 'opentype';
  if (url.endsWith('.eot')) return 'embedded-opentype';
  return undefined;
}

function extractMediaBreakpoints(content: string, tokens: RawTokens): void {
  const mediaMatches = content.matchAll(/@media[^{]*\(\s*min-width\s*:\s*([\d.]+)(px|em|rem)\s*\)/g);
  for (const m of mediaMatches) {
    const value = `${m[1]}${m[2]}`;
    if (!tokens.breakpoints.find(b => b.value === value)) {
      tokens.breakpoints.push({
        name: nameBreakpoint(parseFloat(m[1]), m[2]),
        value,
        source: 'css',
      });
    }
  }

  // Also max-width breakpoints
  const maxMediaMatches = content.matchAll(/@media[^{]*\(\s*max-width\s*:\s*([\d.]+)(px|em|rem)\s*\)/g);
  for (const m of maxMediaMatches) {
    const value = `${m[1]}${m[2]}`;
    if (!tokens.breakpoints.find(b => b.value === value)) {
      tokens.breakpoints.push({
        name: nameBreakpoint(parseFloat(m[1]), m[2]),
        value,
        source: 'css',
      });
    }
  }
}

function nameBreakpoint(px: number, unit: string): string {
  if (unit === 'em' || unit === 'rem') px *= 16;
  if (px <= 480) return 'xs';
  if (px <= 640) return 'sm';
  if (px <= 768) return 'md';
  if (px <= 1024) return 'lg';
  if (px <= 1280) return 'xl';
  return '2xl';
}

function extractZIndex(content: string, tokens: RawTokens): void {
  const zMatches = content.matchAll(/z-index\s*:\s*(\d+)/g);
  for (const m of zMatches) {
    const val = parseInt(m[1]);
    if (!tokens.zIndexValues.includes(val)) {
      tokens.zIndexValues.push(val);
    }
  }
}

function extractContainerWidth(content: string, tokens: RawTokens): void {
  const maxWidthMatches = content.matchAll(/max-width\s*:\s*([\d.]+)(px|rem|em|%)/g);
  for (const m of maxWidthMatches) {
    let px = parseFloat(m[1]);
    if (m[2] === 'rem' || m[2] === 'em') px *= 16;
    if (px >= 960 && px <= 1600) {
      tokens.containerMaxWidth = `${m[1]}${m[2]}`;
    }
  }
}

function extractWithRegex(content: string, tokens: RawTokens): void {
  // Hex colors
  const hexMatches = content.matchAll(/#([0-9a-fA-F]{3,8})\b/g);
  for (const m of hexMatches) {
    addColor(tokens, normalizeHex(m[0]), 'css');
  }

  // RGB/RGBA
  const rgbMatches = content.matchAll(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/g);
  for (const m of rgbMatches) {
    addColor(tokens, rgbToHex(parseInt(m[1]), parseInt(m[2]), parseInt(m[3])), 'css');
  }

  // HSL
  const hslMatches = content.matchAll(/hsla?\(\s*([\d.]+)\s*[,\s]\s*([\d.]+)%\s*[,\s]\s*([\d.]+)%/g);
  for (const m of hslMatches) {
    addColor(tokens, hslToHex(parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3])), 'css');
  }

  // CSS variables
  const varMatches = content.matchAll(/(--[\w-]+)\s*:\s*([^;}\n]+)/g);
  for (const m of varMatches) {
    tokens.cssVariables.push({
      name: m[1],
      value: m[2].trim(),
      property: guessPropertyType(m[1]),
    });

    if (isColorVarName(m[1])) {
      const hex = tryParseColor(m[2].trim());
      if (hex) addColor(tokens, hex, 'css', m[1].replace(/^--/, ''));
    }
  }

  // Font families
  const fontMatches = content.matchAll(/font-family\s*:\s*([^;}\n]+)/g);
  for (const m of fontMatches) {
    const family = m[1].replace(/["']/g, '').split(',')[0].trim();
    if (family && !isGenericFont(family) && isValidFontName(family) && !tokens.fonts.find(f => f.family === family)) {
      tokens.fonts.push({ family, source: 'css' });
    }
  }

  // Box shadows
  const shadowMatches = content.matchAll(/box-shadow\s*:\s*([^;}\n]+)/g);
  for (const m of shadowMatches) {
    const val = m[1].trim();
    if (val !== 'none' && !tokens.shadows.find(s => s.value === val)) {
      tokens.shadows.push({ value: val });
    }
  }

  // Border radius
  const radiusMatches = content.matchAll(/border-radius\s*:\s*([^;}\n]+)/g);
  for (const m of radiusMatches) {
    const val = m[1].trim();
    if (!tokens.borderRadii.includes(val)) {
      tokens.borderRadii.push(val);
    }
  }
}

function extractColorsFromValue(value: string, tokens: RawTokens): void {
  const hexMatches = value.matchAll(/#([0-9a-fA-F]{3,8})\b/g);
  for (const m of hexMatches) {
    addColor(tokens, normalizeHex(m[0]), 'css');
  }

  const rgbMatches = value.matchAll(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/g);
  for (const m of rgbMatches) {
    addColor(tokens, rgbToHex(parseInt(m[1]), parseInt(m[2]), parseInt(m[3])), 'css');
  }
}

function extractSpacingValues(value: string, tokens: RawTokens): void {
  const nums = value.matchAll(/([\d.]+)(px|rem|em)/g);
  for (const m of nums) {
    let px = parseFloat(m[1]);
    if (m[2] === 'rem' || m[2] === 'em') px *= 16;
    if (px > 0 && px <= 200) {
      tokens.spacingValues.push(Math.round(px));
    }
  }
}

// ── HTML Component Detection ──────────────────────────────────────────

function detectHTMLComponents(html: string, css: string): ComponentInfo[] {
  const components: ComponentInfo[] = [];
  const emptyTailwind = { backgrounds: [], borders: [], spacing: [], typography: [], effects: [], layout: [], interactive: [] };

  // Build a CSS rule lookup: class name → style declarations
  const cssRules = buildCSSRuleLookup(css);

  // 1. Buttons — detect from HTML tags, JSX, and class patterns
  const buttonPatterns = [
    /<button[^>]*class\s*=\s*["']([^"']*)["'][^>]*>([\s\S]*?)<\/button>/gi,
    /<a[^>]*class\s*=\s*["'][^"']*\b(btn|button|cta)\b[^"']*["'][^>]*>/gi,
  ];
  const buttonClasses = new Set<string>();
  for (const pattern of buttonPatterns) {
    const matches = html.matchAll(pattern);
    for (const m of matches) {
      const classes = (m[1] || '').split(/\s+/).filter(Boolean);
      classes.forEach(c => buttonClasses.add(c));
    }
  }
  // Also detect JSX button patterns: _jsx("button", ...) or createElement("button", ...)
  const jsxButtonPattern = /(?:_jsx|createElement)\s*\(\s*["']button["']/gi;
  const hasJSXButtons = jsxButtonPattern.test(html);
  if (buttonClasses.size > 0 || /<button[\s>]/i.test(html) || hasJSXButtons) {
    const btnStyles = extractMatchingStyles(cssRules, buttonClasses, ['btn', 'button', 'cta']);
    components.push({
      name: 'Button',
      filePath: 'html',
      variants: findVariants(buttonClasses, 'btn'),
      cssClasses: [...buttonClasses].slice(0, 10),
      jsxSnippet: '',
      props: [],
      category: 'data-input',
      hasAnimation: btnStyles.includes('transition'),
      animationDetails: [],
      statePatterns: [],
      tailwindPatterns: emptyTailwind,
    });
  }

  // 2. Inputs
  const hasInputs = /<input[^>]*type\s*=\s*["'](text|email|password|search|url|tel|number)["']/i.test(html)
    || /<textarea/i.test(html)
    || /<select/i.test(html)
    || /(?:_jsx|createElement)\s*\(\s*["']input["']/i.test(html)
    || /(?:_jsx|createElement)\s*\(\s*["']textarea["']/i.test(html);
  if (hasInputs) {
    const inputClasses = extractElementClasses(html, 'input');
    const inputStyles = extractMatchingStyles(cssRules, inputClasses, ['input', 'field', 'form']);
    components.push({
      name: 'Input',
      filePath: 'html',
      variants: [],
      cssClasses: [...inputClasses].slice(0, 10),
      jsxSnippet: '',
      props: [],
      category: 'data-input',
      hasAnimation: false,
      animationDetails: [],
      statePatterns: [':focus', ':placeholder'],
      tailwindPatterns: emptyTailwind,
    });
  }

  // 3. Cards
  const cardClasses = extractClassesByPattern(html, /\bcard\b/i);
  if (cardClasses.size >= 2) {
    components.push({
      name: 'Card',
      filePath: 'html',
      variants: findVariants(cardClasses, 'card'),
      cssClasses: [...cardClasses].slice(0, 10),
      jsxSnippet: '',
      props: [],
      category: 'data-display',
      hasAnimation: false,
      animationDetails: [],
      statePatterns: [],
      tailwindPatterns: emptyTailwind,
    });
  }

  // 4. Navigation / Header
  if (/<nav[\s>]/i.test(html) || /<header[\s>]/i.test(html) || /(?:_jsx|createElement)\s*\(\s*["']nav["']/i.test(html)) {
    const navClasses = new Set<string>();
    extractElementClasses(html, 'nav').forEach(c => navClasses.add(c));
    extractElementClasses(html, 'header').forEach(c => navClasses.add(c));
    const linkCount = countChildLinks(html, 'nav') || countChildLinks(html, 'header');
    components.push({
      name: 'Navigation',
      filePath: 'html',
      variants: [],
      cssClasses: [...navClasses].slice(0, 10),
      jsxSnippet: '',
      props: [],
      category: 'navigation',
      hasAnimation: false,
      animationDetails: [],
      statePatterns: [],
      tailwindPatterns: emptyTailwind,
    });
  }

  // 5. Chips / Tags / Badges
  const chipClasses = extractClassesByPattern(html, /\b(chip|tag|badge|label|pill)\b/i);
  if (chipClasses.size > 0) {
    components.push({
      name: 'Badge',
      filePath: 'html',
      variants: [],
      cssClasses: [...chipClasses].slice(0, 10),
      jsxSnippet: '',
      props: [],
      category: 'data-display',
      hasAnimation: false,
      animationDetails: [],
      statePatterns: [],
      tailwindPatterns: emptyTailwind,
    });
  }

  // 6. Modal / Dialog
  const modalClasses = extractClassesByPattern(html, /\b(modal|dialog|drawer|overlay|popup)\b/i);
  if (modalClasses.size > 0) {
    components.push({
      name: 'Modal',
      filePath: 'html',
      variants: [],
      cssClasses: [...modalClasses].slice(0, 10),
      jsxSnippet: '',
      props: [],
      category: 'overlay',
      hasAnimation: false,
      animationDetails: [],
      statePatterns: [],
      tailwindPatterns: emptyTailwind,
    });
  }

  // 7. Footer
  if (/<footer[\s>]/i.test(html) || /(?:_jsx|createElement)\s*\(\s*["']footer["']/i.test(html)) {
    const footerClasses = extractElementClasses(html, 'footer');
    components.push({
      name: 'Footer',
      filePath: 'html',
      variants: [],
      cssClasses: [...footerClasses].slice(0, 10),
      jsxSnippet: '',
      props: [],
      category: 'layout',
      hasAnimation: false,
      animationDetails: [],
      statePatterns: [],
      tailwindPatterns: emptyTailwind,
    });
  }

  // 8. Images / Media (hero images, avatars)
  const imgCount = (html.match(/<img\s/gi) || []).length;
  if (imgCount >= 3) {
    components.push({
      name: 'Image',
      filePath: 'html',
      variants: [],
      cssClasses: [],
      jsxSnippet: '',
      props: [],
      category: 'media',
      hasAnimation: false,
      animationDetails: [],
      statePatterns: [],
      tailwindPatterns: emptyTailwind,
    });
  }

  // 9. SVG / Icon patterns
  const svgCount = (html.match(/<svg[\s>]/gi) || []).length + (html.match(/(?:_jsx|createElement)\s*\(\s*["']svg["']/gi) || []).length;
  if (svgCount >= 3 || /lucide-react|heroicons|@phosphor|react-icons/i.test(html)) {
    components.push({
      name: 'Icon',
      filePath: 'html',
      variants: [],
      cssClasses: [],
      jsxSnippet: '',
      props: [],
      category: 'media',
      hasAnimation: false,
      animationDetails: [],
      statePatterns: [],
      tailwindPatterns: emptyTailwind,
    });
  }

  // 10. Lists / Timeline
  const listClasses = extractClassesByPattern(html, /\b(list|timeline|steps|progress)\b/i);
  if (listClasses.size > 0) {
    components.push({
      name: 'List',
      filePath: 'html',
      variants: [],
      cssClasses: [...listClasses].slice(0, 10),
      jsxSnippet: '',
      props: [],
      category: 'data-display',
      hasAnimation: false,
      animationDetails: [],
      statePatterns: [],
      tailwindPatterns: emptyTailwind,
    });
  }

  // 11. Map / Canvas (interactive visualization)
  if (/<canvas[\s>]/i.test(html) || /mapbox|leaflet|google.*maps/i.test(html) || /(?:_jsx|createElement)\s*\(\s*["']canvas["']/i.test(html) || /\bd3\b.*select|topojson/i.test(html)) {
    components.push({
      name: 'Map/Canvas',
      filePath: 'html',
      variants: [],
      cssClasses: [],
      jsxSnippet: '',
      props: [],
      category: 'media',
      hasAnimation: false,
      animationDetails: [],
      statePatterns: [],
      tailwindPatterns: emptyTailwind,
    });
  }

  return components;
}

function buildCSSRuleLookup(css: string): Map<string, string[]> {
  const rules = new Map<string, string[]>();
  // Simple regex-based extraction: .class-name { ... }
  const ruleMatches = css.matchAll(/\.([\w-]+)\s*\{([^}]*)\}/g);
  for (const m of ruleMatches) {
    const className = m[1];
    const declarations = m[2].trim();
    if (!rules.has(className)) {
      rules.set(className, []);
    }
    rules.get(className)!.push(declarations);
  }
  return rules;
}

function extractMatchingStyles(
  cssRules: Map<string, string[]>,
  classes: Set<string>,
  patterns: string[]
): string {
  const allDecls: string[] = [];
  for (const cls of classes) {
    const decls = cssRules.get(cls);
    if (decls) allDecls.push(...decls);
  }
  for (const pattern of patterns) {
    for (const [cls, decls] of cssRules) {
      if (cls.includes(pattern)) allDecls.push(...decls);
    }
  }
  return allDecls.join('; ');
}

function extractElementClasses(html: string, tag: string): Set<string> {
  const classes = new Set<string>();
  // HTML: <tag class="...">
  const regex = new RegExp(`<${tag}[^>]*class\\s*=\\s*["']([^"']*)["']`, 'gi');
  const matches = html.matchAll(regex);
  for (const m of matches) {
    m[1].split(/\s+/).filter(Boolean).forEach(c => classes.add(c));
  }
  // JSX: _jsx("tag", { className: "..." })
  const jsxRegex = new RegExp(`(?:_jsx|createElement)\\s*\\(\\s*["']${tag}["'][^)]*className\\s*:\\s*["'\`]([^"'\`]*)["'\`]`, 'gi');
  const jsxMatches = html.matchAll(jsxRegex);
  for (const m of jsxMatches) {
    m[1].split(/\s+/).filter(Boolean).forEach(c => classes.add(c));
  }
  return classes;
}

function extractClassesByPattern(html: string, pattern: RegExp): Set<string> {
  const classes = new Set<string>();
  // Match HTML class="..." and JSX className="..."
  const allClassAttrs = html.matchAll(/(?:class|className)\s*[:=]\s*["'`]([^"'`]*)["'`]/gi);
  for (const m of allClassAttrs) {
    const classList = m[1].split(/\s+/).filter(Boolean);
    for (const cls of classList) {
      if (pattern.test(cls)) {
        classes.add(cls);
      }
    }
  }
  return classes;
}

function findVariants(classes: Set<string>, base: string): string[] {
  const variants: string[] = [];
  for (const cls of classes) {
    if (cls.includes(base) && cls !== base) {
      const variant = cls.replace(new RegExp(`.*${base}[-_]?`, 'i'), '');
      if (variant && variant.length < 20) variants.push(variant);
    }
  }
  return [...new Set(variants)].slice(0, 5);
}

function buildDarkModePairs(tokens: RawTokens): void {
  const seen = new Set<string>();
  tokens.darkModeVars = tokens.darkModeVars.filter(v => {
    if (seen.has(v.variable)) return false;
    seen.add(v.variable);
    return true;
  });
}

// ── Utility Helpers ───────────────────────────────────────────────────

async function fetchText(url: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; skillui/1.0; +https://github.com/amaanbuilds/skillui)',
        'Accept': 'text/html,text/css,application/xhtml+xml,*/*',
      },
      redirect: 'follow',
    });

    clearTimeout(timeout);

    if (!response.ok) return null;
    return await response.text();
  } catch {
    return null;
  }
}

function resolveUrl(href: string, base: string): string {
  try {
    return new URL(href, base).href;
  } catch {
    return href;
  }
}

function addColor(tokens: RawTokens, hex: string, source: 'css' | 'computed', name?: string): void {
  if (!hex || !isValidHex(hex)) return;
  const existing = tokens.colors.find(c => c.value === hex);
  if (existing) {
    existing.frequency++;
    if (name && !existing.name) existing.name = name;
  } else {
    tokens.colors.push({ value: hex, frequency: 1, source, name });
  }
}

function tryParseColor(value: string): string | null {
  // Hex
  const hexMatch = value.match(/^#([0-9a-fA-F]{3,8})$/);
  if (hexMatch) return normalizeHex(value);

  // rgb()
  const rgbMatch = value.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (rgbMatch) return rgbToHex(parseInt(rgbMatch[1]), parseInt(rgbMatch[2]), parseInt(rgbMatch[3]));

  // hsl()
  const hslMatch = value.match(/^hsla?\(\s*([\d.]+)\s*[,\s]\s*([\d.]+)%\s*[,\s]\s*([\d.]+)%/);
  if (hslMatch) return hslToHex(parseFloat(hslMatch[1]), parseFloat(hslMatch[2]), parseFloat(hslMatch[3]));

  // Bare HSL: "220 20% 10%"
  const bareHslMatch = value.match(/^\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%\s*$/);
  if (bareHslMatch) return hslToHex(parseFloat(bareHslMatch[1]), parseFloat(bareHslMatch[2]), parseFloat(bareHslMatch[3]));

  return null;
}

function isColorProperty(prop: string): boolean {
  return /^(color|background-color|background|border-color|outline-color|fill|stroke|accent-color|caret-color|text-decoration-color|column-rule-color)$/i.test(prop);
}

function isSpacingProperty(prop: string): boolean {
  return /^(margin|padding|gap|row-gap|column-gap|margin-top|margin-right|margin-bottom|margin-left|padding-top|padding-right|padding-bottom|padding-left|top|right|bottom|left)$/i.test(prop);
}

function guessPropertyType(varName: string): string {
  if (/color|bg|background|foreground/i.test(varName)) return 'color';
  if (/font|family|typeface/i.test(varName)) return 'font';
  if (/size|spacing|gap|padding|margin|radius/i.test(varName)) return 'spacing';
  if (/shadow|elevation/i.test(varName)) return 'shadow';
  return 'unknown';
}

function isColorVarName(name: string): boolean {
  return /color|background|foreground|primary|secondary|accent|muted|destructive|border|card|popover|ring|input|chart|surface|text|brand|success|danger|warning|error|info/i.test(name) &&
    !/font|size|spacing|radius|shadow|width|height|duration|delay|family|weight|line/i.test(name);
}

function isGenericFont(f: string): boolean {
  return /^(sans-serif|serif|monospace|cursive|fantasy|system-ui|ui-sans-serif|ui-serif|ui-monospace|inherit|initial|unset)$/i.test(f);
}

function isValidFontName(f: string): boolean {
  // Reject font names that contain CSS syntax artifacts
  // These indicate a broken/concatenated CSS rule was parsed as a font name
  if (/[{};()]/.test(f)) return false;
  // Reject names containing newlines or HTML tags
  if (/[\n\r<>]/.test(f)) return false;
  // Reject CSS property names mistakenly captured
  if (/^\s*(font-family|font-size|font-weight|color|background|margin|padding)\b/i.test(f)) return false;
  // Reject names starting with var(
  if (/^var\(/i.test(f)) return false;
  // Reject names that are just numbers
  if (/^\d+(\.\d+)?(px|rem|em|%)?$/.test(f)) return false;
  // Reject names longer than 50 chars (no real font name is that long)
  if (f.length > 50) return false;
  return true;
}

function isValidHex(hex: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(hex);
}

function namedColorToHex(name: string): string | null {
  const map: Record<string, string | null> = {
    'black': '#000000', 'white': '#ffffff', 'red': '#ff0000', 'green': '#008000',
    'blue': '#0000ff', 'yellow': '#ffff00', 'orange': '#ffa500', 'purple': '#800080',
    'gray': '#808080', 'grey': '#808080', 'pink': '#ffc0cb', 'brown': '#a52a2a',
    'cyan': '#00ffff', 'magenta': '#ff00ff', 'transparent': null, 'none': null,
    'currentcolor': null, 'inherit': null,
  };
  return map[name.toLowerCase()] ?? null;
}

function normalizeHex(v: string): string {
  const match = v.match(/^#([0-9a-fA-F]{3})$/);
  if (match) {
    const [r, g, b] = match[1].split('');
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  return v.toLowerCase().slice(0, 7);
}

function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map(c => Math.max(0, Math.min(255, c)).toString(16).padStart(2, '0')).join('').toLowerCase();
}

function hslToHex(h: number, s: number, l: number): string {
  s /= 100;
  l /= 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; }
  else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; }
  else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; }
  else { r = c; b = x; }
  return rgbToHex(
    Math.round((r + m) * 255),
    Math.round((g + m) * 255),
    Math.round((b + m) * 255)
  );
}

import * as fs from 'fs';
import * as path from 'path';
import * as csstree from 'css-tree';
import { RawTokens, CSSVariable, AnimationToken, DarkModeVar } from '../../types';

const CSS_EXTENSIONS = ['.css', '.scss', '.less'];
const IGNORE_DIRS = ['node_modules', '.git', 'dist', 'build', '.next', '.nuxt'];

export function extractCSSTokens(projectDir: string): RawTokens {
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

  const cssFiles = findCSSFiles(projectDir);

  for (const file of cssFiles) {
    try {
      const content = fs.readFileSync(file, 'utf-8');
      extractFromCSS(content, tokens);
    } catch {
      // Skip files that can't be read/parsed
    }
  }

  // Extract dark mode variable pairs
  extractDarkModeVars(tokens);

  return tokens;
}

function findCSSFiles(dir: string, depth = 0): string[] {
  const files: string[] = [];
  if (depth > 6) return files;

  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (IGNORE_DIRS.includes(entry.name)) continue;

      const fullPath = path.join(dir, entry.name);
      if (entry.isFile() && CSS_EXTENSIONS.some(ext => entry.name.endsWith(ext))) {
        files.push(fullPath);
      } else if (entry.isDirectory()) {
        files.push(...findCSSFiles(fullPath, depth + 1));
      }
    }
  } catch {
    // Permission errors
  }

  return files;
}

function extractFromCSS(content: string, tokens: RawTokens): void {
  // Extract dark mode block variables (regex, works across all CSS flavors)
  extractDarkModeBlocks(content, tokens);

  // Extract CSS keyframe animations
  extractKeyframeAnimations(content, tokens);

  // Extract z-index values
  extractZIndexValues(content, tokens);

  // Extract container max-width
  extractContainerMaxWidth(content, tokens);

  // Use css-tree for AST-based extraction
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

          if (isColorVarName(prop)) {
            const hex = tryParseColorValue(trimmedValue);
            if (hex) {
              const name = prop.replace(/^--/, '').replace(/-/g, '-');
              tokens.colors.push({ value: hex, frequency: 1, source: 'css', name });
            }
          }
        }

        // Colors
        if (isColorProperty(prop)) {
          extractColorsFromValue(rawValue, tokens);
        }

        // Font family
        if (prop === 'font-family') {
          const family = rawValue.replace(/["']/g, '').split(',')[0].trim();
          if (family) {
            tokens.fonts.push({ family, source: 'css' });
          }
        }

        // Font size
        if (prop === 'font-size') {
          const existing = tokens.fonts.find(f => !f.size);
          if (existing) {
            existing.size = rawValue.trim();
          } else {
            tokens.fonts.push({ family: '', size: rawValue.trim(), source: 'css' });
          }
        }

        // Font weight
        if (prop === 'font-weight') {
          const existing = tokens.fonts.find(f => !f.weight);
          if (existing) {
            existing.weight = rawValue.trim();
          }
        }

        // Spacing-related properties
        if (isSpacingProperty(prop)) {
          extractSpacingValues(rawValue, tokens);
        }

        // Box shadow
        if (prop === 'box-shadow') {
          tokens.shadows.push({ value: rawValue.trim() });
        }

        // Border radius
        if (prop === 'border-radius' || prop.startsWith('border-') && prop.endsWith('-radius')) {
          tokens.borderRadii.push(rawValue.trim());
        }

        // Gradients
        if (rawValue.includes('gradient(')) {
          tokens.gradients.push(rawValue.trim());
        }

        // CSS transitions
        if (prop === 'transition') {
          tokens.animations.push({
            name: 'css-transition',
            type: 'css-transition',
            value: rawValue.trim(),
            source: 'css',
          });
        }
      },
    });

    // Extract @media breakpoints
    csstree.walk(ast, {
      visit: 'Atrule',
      enter(node: csstree.Atrule) {
        if (node.name === 'media' && node.prelude) {
          const mediaQuery = csstree.generate(node.prelude);
          const minWidthMatch = mediaQuery.match(/min-width:\s*([\d.]+(?:px|em|rem))/);
          if (minWidthMatch) {
            const existing = tokens.breakpoints.find(bp => bp.value === minWidthMatch[1]);
            if (!existing) {
              tokens.breakpoints.push({
                name: `breakpoint-${minWidthMatch[1]}`,
                value: minWidthMatch[1],
                source: 'css',
              });
            }
          }
        }
      },
    });
  } catch {
    // Fallback: regex-based extraction
    extractWithRegex(content, tokens);
  }
}

/**
 * Extract :root and .dark CSS variable blocks to detect light/dark mode pairs.
 */
function extractDarkModeBlocks(content: string, tokens: RawTokens): void {
  // Collect :root variables
  const rootVars = new Map<string, string>();
  const darkVars = new Map<string, string>();

  // Match :root { ... } blocks
  const rootBlocks = content.matchAll(/:root\s*\{([^}]+)\}/g);
  for (const m of rootBlocks) {
    const vars = m[1].matchAll(/(--[\w-]+)\s*:\s*([^;}\n]+)/g);
    for (const v of vars) {
      rootVars.set(v[1], v[2].trim());
    }
  }

  // Match .dark { ... } or [data-theme="dark"] { ... } or @media (prefers-color-scheme: dark) blocks
  const darkPatterns = [
    /\.dark\s*\{([^}]+)\}/g,
    /\[data-theme\s*=\s*["']dark["']\]\s*\{([^}]+)\}/g,
    /\.dark\s+:root\s*\{([^}]+)\}/g,
    /:root\.dark\s*\{([^}]+)\}/g,
    /@media\s*\(\s*prefers-color-scheme\s*:\s*dark\s*\)\s*\{[^{]*:root\s*\{([^}]+)\}/g,
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

  // Build dark mode var pairs
  for (const [name, lightVal] of rootVars) {
    const darkVal = darkVars.get(name);
    if (darkVal && darkVal !== lightVal) {
      tokens.darkModeVars.push({
        variable: name,
        lightValue: lightVal,
        darkValue: darkVal,
      });
    }
  }
}

/**
 * Extract @keyframes animations from CSS.
 */
function extractKeyframeAnimations(content: string, tokens: RawTokens): void {
  const keyframeMatches = content.matchAll(/@keyframes\s+([\w-]+)\s*\{([^}]*(?:\{[^}]*\}[^}]*)*)\}/g);
  for (const m of keyframeMatches) {
    tokens.animations.push({
      name: m[1],
      type: 'css-keyframe',
      value: m[2].trim().slice(0, 200),
      source: 'css',
    });
  }
}

/**
 * Extract z-index values used in the CSS.
 */
function extractZIndexValues(content: string, tokens: RawTokens): void {
  const zMatches = content.matchAll(/z-index\s*:\s*(\d+)/g);
  for (const m of zMatches) {
    const val = parseInt(m[1]);
    if (!tokens.zIndexValues.includes(val)) {
      tokens.zIndexValues.push(val);
    }
  }
}

/**
 * Extract container / max-width patterns.
 */
function extractContainerMaxWidth(content: string, tokens: RawTokens): void {
  const maxWidthMatches = content.matchAll(/max-width\s*:\s*([\d.]+(?:px|rem|em|%))/g);
  for (const m of maxWidthMatches) {
    const val = m[1];
    // Prefer larger container-level values
    if (parseFloat(val) >= 960 || val.includes('%')) {
      tokens.containerMaxWidth = val;
    }
  }

  // Also check CSS variables
  const containerVarMatch = content.match(/--(container|content|max-width|page-width)[\w-]*\s*:\s*([^;}\n]+)/);
  if (containerVarMatch) {
    tokens.containerMaxWidth = containerVarMatch[2].trim();
  }
}

function extractWithRegex(content: string, tokens: RawTokens): void {
  // Hex colors
  const hexMatches = content.matchAll(/#([0-9a-fA-F]{3,8})\b/g);
  for (const m of hexMatches) {
    const hex = normalizeHex(m[0]);
    const existing = tokens.colors.find(c => c.value === hex);
    if (existing) {
      existing.frequency++;
    } else {
      tokens.colors.push({ value: hex, frequency: 1, source: 'css' });
    }
  }

  // RGB/RGBA colors
  const rgbMatches = content.matchAll(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/g);
  for (const m of rgbMatches) {
    const hex = rgbToHex(parseInt(m[1]), parseInt(m[2]), parseInt(m[3]));
    const existing = tokens.colors.find(c => c.value === hex);
    if (existing) {
      existing.frequency++;
    } else {
      tokens.colors.push({ value: hex, frequency: 1, source: 'css' });
    }
  }

  // CSS variables
  const varMatches = content.matchAll(/(--[\w-]+)\s*:\s*([^;}\n]+)/g);
  for (const m of varMatches) {
    const varName = m[1];
    const varValue = m[2].trim();
    tokens.cssVariables.push({
      name: varName,
      value: varValue,
      property: guessPropertyType(varName),
    });

    if (isColorVarName(varName)) {
      const hex = tryParseColorValue(varValue);
      if (hex) {
        const name = varName.replace(/^--/, '');
        const existing = tokens.colors.find(c => c.value === hex);
        if (existing) {
          existing.frequency++;
          if (!existing.name) existing.name = name;
        } else {
          tokens.colors.push({ value: hex, frequency: 1, source: 'css', name });
        }
      }
    }
  }

  // Font families
  const fontMatches = content.matchAll(/font-family\s*:\s*([^;}\n]+)/g);
  for (const m of fontMatches) {
    const family = m[1].replace(/["']/g, '').split(',')[0].trim();
    if (family) {
      tokens.fonts.push({ family, source: 'css' });
    }
  }

  // Media queries
  const mediaMatches = content.matchAll(/@media[^{]*min-width:\s*([\d.]+(?:px|em|rem))/g);
  for (const m of mediaMatches) {
    if (!tokens.breakpoints.find(bp => bp.value === m[1])) {
      tokens.breakpoints.push({
        name: `breakpoint-${m[1]}`,
        value: m[1],
        source: 'css',
      });
    }
  }

  // Box shadows
  const shadowMatches = content.matchAll(/box-shadow\s*:\s*([^;}\n]+)/g);
  for (const m of shadowMatches) {
    tokens.shadows.push({ value: m[1].trim() });
  }
}

/**
 * Build dark mode variable pairs from collected CSS variables.
 * Detects patterns like --background (in :root) vs --background (in .dark).
 */
function extractDarkModeVars(tokens: RawTokens): void {
  // Already extracted in extractDarkModeBlocks, this is a post-processing step
  // Deduplicate
  const seen = new Set<string>();
  tokens.darkModeVars = tokens.darkModeVars.filter(v => {
    if (seen.has(v.variable)) return false;
    seen.add(v.variable);
    return true;
  });
}

function extractColorsFromValue(value: string, tokens: RawTokens): void {
  const hexMatches = value.matchAll(/#([0-9a-fA-F]{3,8})\b/g);
  for (const m of hexMatches) {
    const hex = normalizeHex(m[0]);
    const existing = tokens.colors.find(c => c.value === hex);
    if (existing) {
      existing.frequency++;
    } else {
      tokens.colors.push({ value: hex, frequency: 1, source: 'css' });
    }
  }

  const rgbMatches = value.matchAll(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/g);
  for (const m of rgbMatches) {
    const hex = rgbToHex(parseInt(m[1]), parseInt(m[2]), parseInt(m[3]));
    const existing = tokens.colors.find(c => c.value === hex);
    if (existing) {
      existing.frequency++;
    } else {
      tokens.colors.push({ value: hex, frequency: 1, source: 'css' });
    }
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

function isColorProperty(prop: string): boolean {
  return /^(color|background-color|background|border-color|outline-color|fill|stroke|--[\w-]*color[\w-]*)$/i.test(prop);
}

function isSpacingProperty(prop: string): boolean {
  return /^(margin|padding|gap|row-gap|column-gap|margin-top|margin-right|margin-bottom|margin-left|padding-top|padding-right|padding-bottom|padding-left|top|right|bottom|left|width|height|max-width|min-width)$/i.test(prop);
}

function guessPropertyType(varName: string): string {
  if (/color|bg|background|foreground/i.test(varName)) return 'color';
  if (/font|family|typeface/i.test(varName)) return 'font';
  if (/size|spacing|gap|padding|margin|radius/i.test(varName)) return 'spacing';
  if (/shadow|elevation/i.test(varName)) return 'shadow';
  return 'unknown';
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
  return '#' + [r, g, b].map(c => c.toString(16).padStart(2, '0')).join('').toLowerCase();
}

function isColorVarName(name: string): boolean {
  return /color|background|foreground|primary|secondary|accent|muted|destructive|border|card|popover|ring|input|chart/i.test(name) &&
    !/font|size|spacing|radius|shadow|width|height|duration|delay/i.test(name);
}

function tryParseColorValue(value: string): string | null {
  const hexMatch = value.match(/^#([0-9a-fA-F]{3,8})$/);
  if (hexMatch) return normalizeHex(value);

  const rgbMatch = value.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (rgbMatch) return rgbToHex(parseInt(rgbMatch[1]), parseInt(rgbMatch[2]), parseInt(rgbMatch[3]));

  const hslMatch = value.match(/^hsla?\(\s*([\d.]+)\s*[,\s]\s*([\d.]+)%\s*[,\s]\s*([\d.]+)%/);
  if (hslMatch) return hslToHex(parseFloat(hslMatch[1]), parseFloat(hslMatch[2]), parseFloat(hslMatch[3]));

  const bareHslMatch = value.match(/^\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%\s*$/);
  if (bareHslMatch) return hslToHex(parseFloat(bareHslMatch[1]), parseFloat(bareHslMatch[2]), parseFloat(bareHslMatch[3]));

  return null;
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

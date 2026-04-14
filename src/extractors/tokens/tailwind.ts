import * as fs from 'fs';
import * as path from 'path';
import { RawTokens, Breakpoint } from '../../types';

const TAILWIND_CONFIG_FILES = [
  'tailwind.config.js',
  'tailwind.config.ts',
  'tailwind.config.mjs',
  'tailwind.config.cjs',
];

// Tailwind v3 default spacing scale (in rem, converted to px at 16px base)
const TAILWIND_DEFAULT_SPACING_PX = [
  0, 1, 2, 4, 5, 6, 7, 8, 10, 11, 12, 14, 16, 20, 24, 28, 32, 36, 40, 44, 48, 52, 56, 60, 64, 72, 80, 96,
];

export function extractTailwindTokens(projectDir: string): RawTokens {
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

  const configPath = findTailwindConfig(projectDir);
  if (!configPath) return tokens;

  let config: any;
  try {
    const jiti = require('jiti')(__filename, { interopDefault: true });
    config = jiti(configPath);
    if (config.default) config = config.default;
  } catch {
    try {
      config = parseConfigFallback(configPath);
    } catch {
      // Config failed to load — still add Tailwind defaults since config exists
      config = null;
    }
  }

  // If config exists but failed to parse, still add sensible defaults
  if (!config) {
    tokens.spacingValues.push(...TAILWIND_DEFAULT_SPACING_PX.filter(v => v > 0));
    tokens.breakpoints = [
      { name: 'sm', value: '640px', source: 'tailwind' },
      { name: 'md', value: '768px', source: 'tailwind' },
      { name: 'lg', value: '1024px', source: 'tailwind' },
      { name: 'xl', value: '1280px', source: 'tailwind' },
      { name: '2xl', value: '1536px', source: 'tailwind' },
    ];
    // Try to extract font names from config file text as fallback
    extractFontsFromConfigText(configPath, tokens);
    return tokens;
  }

  const theme = config.theme || {};
  const extend = theme.extend || {};

  // Extract colors
  const colorSources = mergeDeep(theme.colors || {}, extend.colors || {});
  flattenColors(colorSources, '', tokens.colors);

  // Extract fonts and build var→name map
  const fontFamilies = mergeDeep(theme.fontFamily || {}, extend.fontFamily || {});
  for (const [name, value] of Object.entries(fontFamilies)) {
    const familyList = Array.isArray(value) ? value : [String(value)];
    const primaryFamily = familyList[0] as string;
    // Resolve CSS var references in font values
    const resolved = resolveFontName(primaryFamily, name);
    // Only add as a font if the config key maps to a real font name
    if (!isGenericConfigKey(name)) {
      tokens.fonts.push({ family: resolved, source: 'tailwind' });
    }
    // Always build the var map for resolving references later
    tokens.fontVarMap[`var(--font-${name})`] = resolved;
    tokens.fontVarMap[name] = resolved;
  }

  // Extract spacing — prefer explicit config, fall back to Tailwind defaults
  const spacing = mergeDeep(theme.spacing || {}, extend.spacing || {});
  const spacingEntries = Object.entries(spacing);
  if (spacingEntries.length > 0) {
    for (const [, value] of spacingEntries) {
      const num = parseFloat(String(value));
      if (!isNaN(num) && num > 0) {
        const px = String(value).includes('rem') ? num * 16 : num;
        tokens.spacingValues.push(Math.round(px));
      }
    }
  }
  // Always include Tailwind defaults as a baseline
  tokens.spacingValues.push(...TAILWIND_DEFAULT_SPACING_PX.filter(v => v > 0));

  // Extract border-radius
  const borderRadius = mergeDeep(theme.borderRadius || {}, extend.borderRadius || {});
  for (const [name, value] of Object.entries(borderRadius)) {
    if (typeof value === 'string') {
      tokens.borderRadii.push(value);
    }
  }

  // Extract shadows
  const boxShadow = mergeDeep(theme.boxShadow || {}, extend.boxShadow || {});
  for (const [name, value] of Object.entries(boxShadow)) {
    if (typeof value === 'string') {
      tokens.shadows.push({ value, name });
    }
  }

  // Extract breakpoints
  const screens = mergeDeep(theme.screens || {}, extend.screens || {});
  for (const [name, value] of Object.entries(screens)) {
    const bp: Breakpoint = {
      name,
      value: typeof value === 'string' ? value : typeof value === 'object' && value !== null && 'min' in value ? (value as any).min : String(value),
      source: 'tailwind',
    };
    tokens.breakpoints.push(bp);
  }

  if (tokens.breakpoints.length === 0) {
    tokens.breakpoints = [
      { name: 'sm', value: '640px', source: 'tailwind' },
      { name: 'md', value: '768px', source: 'tailwind' },
      { name: 'lg', value: '1024px', source: 'tailwind' },
      { name: 'xl', value: '1280px', source: 'tailwind' },
      { name: '2xl', value: '1536px', source: 'tailwind' },
    ];
  }

  return tokens;
}

/**
 * Resolve a CSS variable font name to a human-readable name.
 * e.g. "var(--font-exo2)" → "Exo 2", or just use the config key.
 */
function resolveFontName(primaryFamily: string, configKey: string): string {
  // If it's already a real font name, return it
  if (!primaryFamily.startsWith('var(') && !primaryFamily.startsWith('--')) {
    return primaryFamily.replace(/["']/g, '').trim();
  }

  // Try to derive from config key: "exo2" → "Exo 2", "jetbrains" → "JetBrains Mono"
  return configKeyToFontName(configKey);
}

function configKeyToFontName(key: string): string {
  // Common font name mappings from Tailwind config keys
  const known: Record<string, string> = {
    sans: 'Sans-serif',
    serif: 'Serif',
    mono: 'Monospace',
    display: 'Display',
    body: 'Body',
    exo2: 'Exo 2',
    exo: 'Exo',
    inter: 'Inter',
    roboto: 'Roboto',
    poppins: 'Poppins',
    montserrat: 'Montserrat',
    lato: 'Lato',
    nunito: 'Nunito',
    jetbrains: 'JetBrains Mono',
    'fira-code': 'Fira Code',
    'source-code': 'Source Code Pro',
    'space-grotesk': 'Space Grotesk',
    'space-mono': 'Space Mono',
    doto: 'Doto',
    geist: 'Geist',
    'geist-mono': 'Geist Mono',
    outfit: 'Outfit',
    manrope: 'Manrope',
    'dm-sans': 'DM Sans',
    'dm-mono': 'DM Mono',
    sora: 'Sora',
    'ibm-plex': 'IBM Plex Sans',
    'ibm-plex-mono': 'IBM Plex Mono',
    raleway: 'Raleway',
    'open-sans': 'Open Sans',
    'source-sans': 'Source Sans Pro',
    ubuntu: 'Ubuntu',
    'ubuntu-mono': 'Ubuntu Mono',
    barlow: 'Barlow',
    overpass: 'Overpass',
    rubik: 'Rubik',
    karla: 'Karla',
    cabin: 'Cabin',
    mulish: 'Mulish',
  };

  const lowerKey = key.toLowerCase().replace(/_/g, '-');
  if (known[lowerKey]) return known[lowerKey];

  // Fallback: capitalize and add spaces before digits
  return key
    .replace(/[-_]/g, ' ')
    .replace(/([a-z])(\d)/g, '$1 $2')
    .replace(/(\d)([a-z])/g, '$1 $2')
    .split(' ')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/**
 * Check if a fontFamily config key is a generic/functional name
 * (e.g., "sans", "heading", "body", "display") rather than an actual font name.
 * These resolve to CSS vars whose target font we can't determine statically.
 */
function isGenericConfigKey(key: string): boolean {
  return /^(sans|serif|mono|heading|body|display|code|ui)$/i.test(key);
}

function findTailwindConfig(dir: string): string | null {
  for (const file of TAILWIND_CONFIG_FILES) {
    const p = path.join(dir, file);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function flattenColors(
  obj: Record<string, any>,
  prefix: string,
  out: RawTokens['colors']
): void {
  for (const [key, value] of Object.entries(obj)) {
    const name = prefix ? `${prefix}-${key}` : key;
    if (typeof value === 'string') {
      if (isColorValue(value)) {
        out.push({ value: normalizeHex(value), frequency: 1, source: 'tailwind', name });
      }
    } else if (typeof value === 'object' && value !== null) {
      flattenColors(value as Record<string, any>, name, out);
    }
  }
}

function isColorValue(v: string): boolean {
  return /^#([0-9a-fA-F]{3,8})$/.test(v) ||
    /^rgb/i.test(v) ||
    /^hsl/i.test(v);
}

function normalizeHex(v: string): string {
  const match = v.match(/^#([0-9a-fA-F]{3})$/);
  if (match) {
    const [r, g, b] = match[1].split('');
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  return v.toLowerCase();
}

function mergeDeep(a: Record<string, any>, b: Record<string, any>): Record<string, any> {
  const result = { ...a };
  for (const key of Object.keys(b)) {
    if (typeof b[key] === 'object' && b[key] !== null && !Array.isArray(b[key]) &&
        typeof a[key] === 'object' && a[key] !== null && !Array.isArray(a[key])) {
      result[key] = mergeDeep(a[key], b[key]);
    } else {
      result[key] = b[key];
    }
  }
  return result;
}

/**
 * When jiti fails, try to extract font family names from the raw config text.
 * Only looks within fontFamily blocks to avoid false positives from content arrays etc.
 */
function extractFontsFromConfigText(configPath: string, tokens: RawTokens): void {
  try {
    const content = fs.readFileSync(configPath, 'utf-8');

    // Find the fontFamily block specifically
    const fontFamilyBlock = content.match(/fontFamily\s*:\s*\{([^}]+)\}/s);
    if (!fontFamilyBlock) return;

    const block = fontFamilyBlock[1];

    // Match entries like: sans: [var(--font-inter), ...] or mono: ["JetBrains Mono", ...]
    const entries = block.matchAll(/(\w[\w-]*)\s*:\s*\[([^\]]+)\]/g);
    for (const entry of entries) {
      const key = entry[1];
      const valueList = entry[2];

      // Check for var(--font-xxx) reference
      const varMatch = valueList.match(/var\(--font-(\w[\w-]*)\)/);
      if (varMatch) {
        const varName = varMatch[1];
        const resolved = configKeyToFontName(varName);
        // Skip generic config key names like "heading", "body", "sans", "display"
        // These are Tailwind key names, not font names
        if (!isGenericConfigKey(key)) {
          tokens.fonts.push({ family: resolved, source: 'tailwind' });
        }
        tokens.fontVarMap[`var(--font-${varName})`] = resolved;
        tokens.fontVarMap[key] = resolved;
        continue;
      }

      // Check for direct font name
      const nameMatch = valueList.match(/["']([^"']+)["']/);
      if (nameMatch) {
        const fontName = nameMatch[1];
        // Filter out generic CSS families
        if (!/^(sans-serif|serif|monospace|system-ui|ui-|inherit)/.test(fontName)) {
          tokens.fonts.push({ family: fontName, source: 'tailwind' });
          tokens.fontVarMap[key] = fontName;
        }
      }
    }
  } catch {
    // Ignore read errors
  }
}

function parseConfigFallback(configPath: string): any {
  const content = fs.readFileSync(configPath, 'utf-8');
  const match = content.match(/module\.exports\s*=\s*(\{[\s\S]*\})/);
  if (match) {
    try {
      return Function(`"use strict"; return (${match[1]})`)();
    } catch {
      return null;
    }
  }
  return null;
}

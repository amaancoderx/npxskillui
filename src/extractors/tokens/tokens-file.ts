import * as fs from 'fs';
import * as path from 'path';
import { RawTokens } from '../../types';

const TOKEN_FILE_NAMES = [
  'tokens.json',
  'design-tokens.json',
  'theme.json',
  'theme.ts',
  'theme.js',
  'tokens.ts',
  'tokens.js',
  'design-tokens.ts',
  'design-tokens.js',
];

const TOKEN_DIRS = ['', 'src', 'src/styles', 'src/theme', 'styles', 'theme', 'config'];

export function extractTokensFile(projectDir: string): RawTokens {
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

  for (const dir of TOKEN_DIRS) {
    for (const fileName of TOKEN_FILE_NAMES) {
      const filePath = path.join(projectDir, dir, fileName);
      if (fs.existsSync(filePath)) {
        try {
          extractFromFile(filePath, tokens);
        } catch {
          // Skip unreadable files
        }
      }
    }
  }

  return tokens;
}

function extractFromFile(filePath: string, tokens: RawTokens): void {
  const ext = path.extname(filePath);
  let data: any;

  if (ext === '.json') {
    data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } else {
    // Try jiti for JS/TS
    try {
      const jiti = require('jiti')(__filename, { interopDefault: true });
      data = jiti(filePath);
      if (data.default) data = data.default;
    } catch {
      // Fallback: try regex extraction
      const content = fs.readFileSync(filePath, 'utf-8');
      extractWithRegex(content, tokens);
      return;
    }
  }

  if (!data || typeof data !== 'object') return;

  // Recursively extract tokens from the object
  walkTokenObject(data, '', tokens);
}

function walkTokenObject(obj: any, prefix: string, tokens: RawTokens): void {
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;

    if (typeof value === 'string') {
      classifyValue(fullKey, value, tokens);
    } else if (typeof value === 'number') {
      // Could be spacing
      if (value > 0 && value <= 200) {
        tokens.spacingValues.push(value);
      }
    } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      // Design Tokens Community Group format: { value: "...", type: "..." }
      if ('value' in value && typeof (value as any).value === 'string') {
        const tokenValue = (value as any).value;
        const tokenType = (value as any).type || '';
        classifyTokenValue(fullKey, tokenValue, tokenType, tokens);
      } else {
        walkTokenObject(value, fullKey, tokens);
      }
    } else if (Array.isArray(value)) {
      // Font family arrays
      if (key.toLowerCase().includes('font') && value.every(v => typeof v === 'string')) {
        tokens.fonts.push({ family: value[0], source: 'tokens-file' });
      }
    }
  }
}

function classifyValue(key: string, value: string, tokens: RawTokens): void {
  const keyLower = key.toLowerCase();

  // Color
  if (isColorValue(value)) {
    const name = key.split('.').pop() || key;
    tokens.colors.push({
      value: normalizeHex(value),
      frequency: 1,
      source: 'tokens-file',
      name,
    });
    return;
  }

  // Font
  if (keyLower.includes('font') || keyLower.includes('family') || keyLower.includes('typeface')) {
    tokens.fonts.push({ family: value, source: 'tokens-file' });
    return;
  }

  // Shadow
  if (keyLower.includes('shadow') || keyLower.includes('elevation')) {
    tokens.shadows.push({ value, name: key.split('.').pop() });
    return;
  }

  // Spacing
  const pxMatch = value.match(/^(\d+(?:\.\d+)?)\s*(px|rem|em)?$/);
  if (pxMatch && (keyLower.includes('spacing') || keyLower.includes('space') || keyLower.includes('gap') || keyLower.includes('size'))) {
    let px = parseFloat(pxMatch[1]);
    if (pxMatch[2] === 'rem' || pxMatch[2] === 'em') px *= 16;
    if (px > 0 && px <= 200) {
      tokens.spacingValues.push(Math.round(px));
    }
  }
}

function classifyTokenValue(key: string, value: string, type: string, tokens: RawTokens): void {
  const typeLower = type.toLowerCase();

  if (typeLower === 'color' || isColorValue(value)) {
    const name = key.split('.').pop() || key;
    tokens.colors.push({
      value: normalizeHex(value),
      frequency: 1,
      source: 'tokens-file',
      name,
    });
  } else if (typeLower === 'fontfamily' || typeLower === 'fontfamilies') {
    tokens.fonts.push({ family: value, source: 'tokens-file' });
  } else if (typeLower === 'fontsize' || typeLower === 'fontsizes') {
    tokens.fonts.push({ family: '', size: value, source: 'tokens-file' });
  } else if (typeLower === 'spacing') {
    const px = parseFloat(value);
    if (!isNaN(px) && px > 0) tokens.spacingValues.push(px);
  } else if (typeLower === 'boxshadow' || typeLower === 'shadow') {
    tokens.shadows.push({ value, name: key.split('.').pop() });
  } else {
    // Generic classify
    classifyValue(key, value, tokens);
  }
}

function extractWithRegex(content: string, tokens: RawTokens): void {
  // Extract hex colors
  const hexMatches = content.matchAll(/#([0-9a-fA-F]{3,8})\b/g);
  for (const m of hexMatches) {
    tokens.colors.push({ value: normalizeHex(m[0]), frequency: 1, source: 'tokens-file' });
  }

  // Extract font strings
  const fontMatches = content.matchAll(/['"]?(Inter|Roboto|Helvetica|Arial|Poppins|Montserrat|Open Sans|Lato|Nunito|Source Sans|JetBrains Mono|Fira Code|SF Mono|Menlo|Consolas)['"]?/gi);
  for (const m of fontMatches) {
    tokens.fonts.push({ family: m[1], source: 'tokens-file' });
  }
}

function isColorValue(v: string): boolean {
  return /^#([0-9a-fA-F]{3,8})$/.test(v) || /^rgb/i.test(v) || /^hsl/i.test(v);
}

function normalizeHex(v: string): string {
  if (/^#([0-9a-fA-F]{3})$/.test(v)) {
    const [r, g, b] = v.slice(1).split('');
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  return v.toLowerCase().slice(0, 7);
}

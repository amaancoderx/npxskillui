import * as fs from 'fs';
import * as path from 'path';
import { FontSource } from './types';

/**
 * Resolve font families via the Google Fonts API.
 *
 * Downloads real .ttf files for each font family needed by the project.
 * No local fonts-main/ directory required.
 */

const GOOGLE_FONTS_API_KEY = 'AIzaSyCETey82fDURE2zp-MPF2lb_R-9PeAcPjY';
const GOOGLE_FONTS_API = `https://www.googleapis.com/webfonts/v1/webfonts`;

/** Returns true for fonts that cannot or should not be downloaded (system, generic, icon). */
function isSkippableFont(family: string): boolean {
  if (!family) return true;
  // Generic CSS families
  if (/^(sans-serif|serif|monospace|cursive|fantasy|system-ui|ui-sans-serif|ui-serif|ui-monospace|inherit|initial|unset)$/i.test(family)) return true;
  // System fonts (OS-level, not on Google Fonts)
  if (/^(-apple-system|blinkmacsystemfont|\.sf\s*(pro|compact)|sf\s*(pro|compact)|segoe\s*ui|helvetica\s*neue|helvetica|arial)/i.test(family)) return true;
  // Proprietary fonts (Google internal, etc.)
  if (/^(google\s*sans|product\s*sans|roboto\s*flex)/i.test(family)) return false; // These ARE on Google Fonts
  // Icon/symbol fonts
  if (/^(apple\s*(icons?|legacy|sf\s*symbols?)|material\s*(icons?|symbols?)|font\s*awesome|fontawesome|glyphicons?|ionicons?)/i.test(family)) return true;
  if (/^apple\s*icons?\s*\d+/i.test(family)) return true;
  return false;
}

interface GoogleFontFile {
  family: string;
  weight: string;
  url: string;       // download URL from API
  fileName: string;  // sanitized filename for saving
}

/**
 * Query Google Fonts API for a specific font family.
 * Returns download URLs for each weight variant (TTF format).
 */
async function fetchFontMetadata(family: string): Promise<GoogleFontFile[]> {
  // No capability param — default returns real .ttf URLs
  const url = `${GOOGLE_FONTS_API}?key=${GOOGLE_FONTS_API_KEY}&family=${encodeURIComponent(family)}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return [];

    const data = await res.json() as any;
    if (!data.items || data.items.length === 0) return [];

    const item = data.items[0];
    const files: GoogleFontFile[] = [];

    // item.files is { "regular": "url", "700": "url", "italic": "url", ... }
    if (item.files) {
      for (const [variant, fileUrl] of Object.entries(item.files)) {
        // Skip italic variants to keep package small
        if (/italic/i.test(variant)) continue;

        const weight = variantToWeight(variant);
        const safeName = family.replace(/\s+/g, '') + '-' + weightToLabel(variant) + '.ttf';

        files.push({
          family: item.family || family,
          weight,
          url: fileUrl as string,
          fileName: safeName,
        });
      }
    }

    return files;
  } catch {
    return [];
  }
}

function variantToWeight(variant: string): string {
  const map: Record<string, string> = {
    '100': '100', '200': '200', '300': '300',
    'regular': '400', '400': '400',
    '500': '500', '600': '600',
    '700': '700', '800': '800', '900': '900',
  };
  return map[variant] || '400';
}

function weightToLabel(variant: string): string {
  const map: Record<string, string> = {
    '100': 'Thin',
    '200': 'ExtraLight',
    '300': 'Light',
    'regular': 'Regular',
    '400': 'Regular',
    '500': 'Medium',
    '600': 'SemiBold',
    '700': 'Bold',
    '800': 'ExtraBold',
    '900': 'Black',
  };
  return map[variant] || variant;
}

/**
 * Download a font file from a URL and save it locally.
 * Accepts TTF, OTF, and WOFF2 formats.
 */
async function downloadFont(url: string, destPath: string): Promise<boolean> {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok) return false;
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length < 4) return false;
    const magic = buffer.readUInt32BE(0);
    // TTF: 0x00010000 or 0x74727565 ('true')
    // OTF: 0x4F54544F ('OTTO')
    // WOFF2: 0x774F4632
    // WOFF:  0x774F4646
    const validMagics = [0x00010000, 0x74727565, 0x4F54544F, 0x774F4632, 0x774F4646];
    if (!validMagics.includes(magic)) return false;
    fs.writeFileSync(destPath, buffer);
    return true;
  } catch {
    return false;
  }
}

/**
 * Detect the font format from magic bytes.
 */
function detectFontFormat(buffer: Buffer): string {
  if (buffer.length < 4) return 'truetype';
  const magic = buffer.readUInt32BE(0);
  if (magic === 0x774F4632) return 'woff2';
  if (magic === 0x774F4646) return 'woff';
  if (magic === 0x4F54544F) return 'opentype';
  return 'truetype';
}

/**
 * Try to download a font directly from its source URL (for custom/proprietary fonts
 * not available on Google Fonts API). Returns the local file path or null.
 */
async function downloadFontFromSource(
  src: FontSource,
  fontsOutputDir: string
): Promise<FontSource | null> {
  if (!src.src || !src.src.startsWith('http')) return null;

  // Build a clean filename from family + weight + format
  const ext = src.src.includes('.woff2') ? 'woff2'
    : src.src.includes('.woff') ? 'woff'
    : src.src.includes('.otf') ? 'otf'
    : 'ttf';
  const weightLabel = src.weight === '400' || src.weight === 'regular' ? 'Regular' : (src.weight || 'Regular');
  const safeName = (src.family || 'Font').replace(/\s+/g, '') + '-' + weightLabel + '.' + ext;
  const destPath = path.join(fontsOutputDir, safeName);

  if (!fs.existsSync(destPath)) {
    const ok = await downloadFont(src.src, destPath);
    if (!ok) return null;
  }

  // Detect actual format from downloaded bytes
  let format = src.format || ext;
  try {
    const buf = fs.readFileSync(destPath);
    format = detectFontFormat(buf);
  } catch {}

  return {
    family: src.family,
    src: `fonts/${safeName}`,
    format,
    weight: src.weight,
  };
}

/**
 * Fetch font files from Google Fonts API and bundle them into the skill directory.
 * Downloads ALL available weights (non-italic) for each font family.
 */
export async function bundleFonts(
  fontSources: FontSource[],
  fontFamilies: string[],
  skillDir: string,
  _usedWeights?: Set<string>
): Promise<{ updatedSources: FontSource[]; bundledCount: number }> {
  const fontsOutputDir = path.join(skillDir, 'fonts');
  let bundledCount = 0;
  const updatedSources: FontSource[] = [];
  const bundledFamilies = new Set<string>();

  // Collect all unique font families — skip generics, system fonts, and icon fonts
  const allFamilies = new Set<string>();
  for (const src of fontSources) {
    if (!isSkippableFont(src.family)) allFamilies.add(src.family);
  }
  for (const f of fontFamilies) {
    if (f && !isSkippableFont(f)) allFamilies.add(f);
  }

  for (const family of allFamilies) {
    // Try Google Fonts API first
    const fontFiles = await fetchFontMetadata(family);

    if (fontFiles.length > 0) {
      // Create fonts/ directory if needed
      if (!fs.existsSync(fontsOutputDir)) {
        fs.mkdirSync(fontsOutputDir, { recursive: true });
      }

      // Download ALL available weights (non-italic already filtered)
      for (const font of fontFiles) {
        const destPath = path.join(fontsOutputDir, font.fileName);
        if (!fs.existsSync(destPath)) {
          const ok = await downloadFont(font.url, destPath);
          if (!ok) continue;
          bundledCount++;
        }
        updatedSources.push({
          family: font.family,
          src: `fonts/${font.fileName}`,
          format: 'truetype',
          weight: font.weight,
        });
      }
      bundledFamilies.add(family);
    } else {
      // Not on Google Fonts — try downloading directly from fontSources URLs
      // (handles custom/proprietary fonts like "delight", or self-hosted woff2)
      const sourcesForFamily = fontSources.filter(s => s.family === family);
      if (sourcesForFamily.length > 0) {
        if (!fs.existsSync(fontsOutputDir)) {
          fs.mkdirSync(fontsOutputDir, { recursive: true });
        }
        let downloadedAny = false;
        for (const src of sourcesForFamily) {
          const downloaded = await downloadFontFromSource(src, fontsOutputDir);
          if (downloaded) {
            updatedSources.push(downloaded);
            bundledCount++;
            downloadedAny = true;
          }
        }
        if (downloadedAny) bundledFamilies.add(family);
      }
    }
  }

  // Keep remote sources for fonts we couldn't download at all
  for (const src of fontSources) {
    if (!bundledFamilies.has(src.family)) {
      updatedSources.push(src);
    }
  }

  return { updatedSources, bundledCount };
}

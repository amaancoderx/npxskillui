import { extractComputedTokens } from '../extractors/tokens/computed';
import { extractHttpCSSTokens } from '../extractors/tokens/http-css';
import { normalize } from '../normalizer';
import { captureScreenshot } from '../screenshot';
import { DesignProfile, RawTokens, ComponentInfo } from '../types';
import { loadPlaywright } from '../playwright-loader';

/**
 * URL mode: crawl a live website and extract design tokens.
 *
 * Strategy:
 * 1. ALWAYS fetch HTML + linked CSS via HTTP (no Playwright needed)
 * 2. If Playwright is available, ALSO extract computed styles from live DOM
 * 3. Merge both token sets for maximum coverage
 */
export async function runUrlMode(url: string, nameOverride?: string, skillDir?: string): Promise<{ profile: DesignProfile; screenshotPath: string | null; cssColorCount: number; cssFontCount: number; computedColorCount: number; hadPlaywright: boolean }> {
  const projectName = nameOverride || deriveUrlName(url);

  // Step 1: HTTP-based extraction (always works, no Playwright)
  const httpResult = await extractHttpCSSTokens(url, 5);
  const httpTokens = httpResult.tokens;
  const httpComponents = httpResult.components;
  const cssColorCount = httpTokens.colors.length;
  const cssFontCount = httpTokens.fonts.length;

  // Step 2: Try Playwright for computed styles (optional enhancement)
  let computedTokens: RawTokens | null = null;
  let hadPlaywright = false;
  let computedColorCount = 0;
  hadPlaywright = !!loadPlaywright();

  if (hadPlaywright) {
    try {
      computedTokens = await extractComputedTokens(url, 3);
      computedColorCount = computedTokens.colors.length;
    } catch { /* Playwright extraction failed, use CSS-only */ }
  }

  // Step 3: Merge HTTP + computed tokens
  const merged = mergeUrlTokens(httpTokens, computedTokens);

  // Step 4: Normalize into a design profile
  const profile = normalize(projectName, [], merged, httpComponents, {
    iconLibrary: null,
    stateLibrary: null,
    animationLibrary: null,
  });

  // Attach URL metadata to profile
  profile.siteUrl = url;
  profile.favicon = merged.favicon || null;

  // Step 5: Capture screenshot (best-effort, non-blocking)
  let screenshotPath: string | null = null;
  if (skillDir) {
    screenshotPath = await captureScreenshot(url, skillDir);
  }

  return { profile, screenshotPath, cssColorCount, cssFontCount, computedColorCount, hadPlaywright };
}

function mergeUrlTokens(http: RawTokens, computed: RawTokens | null): RawTokens {
  if (!computed) return http;

  const merged: RawTokens = {
    colors: [...http.colors],
    fonts: [...http.fonts],
    spacingValues: [...http.spacingValues, ...computed.spacingValues],
    shadows: [...http.shadows],
    cssVariables: [...http.cssVariables],
    breakpoints: [...http.breakpoints],
    borderRadii: [...http.borderRadii],
    gradients: [...http.gradients],
    fontVarMap: { ...http.fontVarMap },
    animations: [...http.animations],
    darkModeVars: [...http.darkModeVars],
    zIndexValues: [...(http.zIndexValues || [])],
    containerMaxWidth: http.containerMaxWidth || computed.containerMaxWidth || null,
    fontSources: [...(http.fontSources || [])],
    pageSections: [...(http.pageSections || [])],
    transitionDurations: [...(http.transitionDurations || [])],
    transitionEasings: [...(http.transitionEasings || [])],
    favicon: http.favicon || computed.favicon || null,
    siteTitle: http.siteTitle || computed.siteTitle || null,
  };

  // Merge computed colors
  for (const color of computed.colors) {
    const existing = merged.colors.find(c => c.value === color.value);
    if (existing) {
      existing.frequency += color.frequency;
    } else {
      merged.colors.push({ ...color });
    }
  }

  // Merge computed fonts (computed styles are more authoritative for actual rendering)
  for (const font of computed.fonts) {
    if (font.family && !merged.fonts.find(f => f.family === font.family)) {
      merged.fonts.push({ ...font });
    }
  }

  // Merge shadows
  for (const shadow of computed.shadows) {
    if (!merged.shadows.find(s => s.value === shadow.value)) {
      merged.shadows.push({ ...shadow });
    }
  }

  // Merge CSS variables
  for (const v of computed.cssVariables) {
    if (!merged.cssVariables.find(cv => cv.name === v.name)) {
      merged.cssVariables.push({ ...v });
    }
  }

  // Merge border radii
  for (const r of (computed.borderRadii || [])) {
    if (!merged.borderRadii.includes(r)) {
      merged.borderRadii.push(r);
    }
  }

  // Merge breakpoints
  for (const bp of computed.breakpoints) {
    if (!merged.breakpoints.find(b => b.value === bp.value)) {
      merged.breakpoints.push({ ...bp });
    }
  }

  // Merge font sources
  for (const fs of (computed.fontSources || [])) {
    if (!merged.fontSources.find(f => f.family === fs.family && f.src === fs.src)) {
      merged.fontSources.push(fs);
    }
  }

  // Merge transition data
  for (const d of (computed.transitionDurations || [])) {
    if (!merged.transitionDurations.includes(d)) merged.transitionDurations.push(d);
  }
  for (const e of (computed.transitionEasings || [])) {
    if (!merged.transitionEasings.includes(e)) merged.transitionEasings.push(e);
  }

  return merged;
}

function deriveUrlName(url: string): string {
  try {
    const hostname = new URL(url).hostname;
    return hostname.replace(/^www\./, '').split('.')[0];
  } catch {
    return 'website';
  }
}

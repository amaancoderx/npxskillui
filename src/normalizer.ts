import {
  DesignProfile,
  DesignTraits,
  RawTokens,
  ColorToken,
  ColorRole,
  TypographyToken,
  TypographyRole,
  SpacingScale,
  ShadowToken,
  ShadowLevel,
  Framework,
  ComponentInfo,
  ComponentCategory,
  AnimationToken,
  MotionTokens,
} from './types';

/**
 * Normalize raw extracted tokens into a clean DesignProfile.
 * Pure deterministic logic — no AI, no inference beyond rule-based heuristics.
 */
export function normalize(
  projectName: string,
  frameworks: Framework[],
  rawTokens: RawTokens,
  components: ComponentInfo[],
  libraries?: { iconLibrary: string | null; stateLibrary: string | null; animationLibrary: string | null }
): DesignProfile {
  // Light scheme: explicit color-scheme declaration OR heuristic (most frequent high-lightness colors)
  const hasExplicitLight = rawTokens.cssVariables.some(v => v.name === '--color-scheme-default' && v.value === 'light');
  const isLightScheme = hasExplicitLight || detectLightSchemeHeuristic(rawTokens.colors);

  const colors = normalizeColors(rawTokens.colors, isLightScheme);
  const typography = normalizeTypography(rawTokens.fonts, rawTokens.fontVarMap);
  const spacing = normalizeSpacing(rawTokens.spacingValues);
  const shadows = normalizeShadows(rawTokens.shadows);
  const borderRadius = normalizeBorderRadius(rawTokens.borderRadii, components);
  const fontVarMap = rawTokens.fontVarMap || {};
  const animations = normalizeAnimations(rawTokens.animations);
  const darkModeVars = rawTokens.darkModeVars || [];

  // Detect anti-patterns from the codebase
  const antiPatterns = detectAntiPatterns(rawTokens, components, shadows);

  // Build component categories
  const componentCategories = buildComponentCategories(components);

  // z-index scale
  const zIndexScale = [...new Set(rawTokens.zIndexValues || [])].sort((a, b) => a - b);

  // Compute design traits
  const designTraits = computeDesignTraits(colors, typography, spacing, shadows, rawTokens, animations);

  // Build motion tokens
  const motionTokens = normalizeMotionTokens(rawTokens, animations);

  return {
    projectName,
    favicon: rawTokens.favicon,
    frameworks,
    colors,
    typography,
    spacing,
    shadows,
    components,
    breakpoints: deduplicateBreakpoints(rawTokens.breakpoints),
    cssVariables: rawTokens.cssVariables,
    borderRadius,
    fontVarMap,
    antiPatterns,
    designTraits,
    animations,
    darkModeVars,
    iconLibrary: libraries?.iconLibrary || null,
    stateLibrary: libraries?.stateLibrary || null,
    componentCategories,
    zIndexScale,
    containerMaxWidth: rawTokens.containerMaxWidth || null,
    fontSources: rawTokens.fontSources || [],
    pageSections: deduplicatePageSections(rawTokens.pageSections || []),
    motionTokens,
  };
}

/**
 * Heuristic: if the top-frequency colors skew light (lightness > 0.6),
 * treat as a light-scheme site even without an explicit color-scheme declaration.
 */
function detectLightSchemeHeuristic(rawColors: RawTokens['colors']): boolean {
  if (rawColors.length === 0) return false;
  // Look at the 10 most frequent colors
  const top = [...rawColors].sort((a, b) => b.frequency - a.frequency).slice(0, 10);
  let lightCount = 0;
  let darkCount = 0;
  for (const c of top) {
    const rgb = hexToRgb(c.value);
    if (!rgb) continue;
    const lightness = (Math.max(rgb.r, rgb.g, rgb.b) + Math.min(rgb.r, rgb.g, rgb.b)) / 2 / 255;
    if (lightness > 0.6) lightCount++;
    else if (lightness < 0.35) darkCount++;
  }
  return lightCount > darkCount;
}

// ── Colors ────────────────────────────────────────────────────────────

function normalizeColors(rawColors: RawTokens['colors'], isLightScheme = false): ColorToken[] {
  if (rawColors.length === 0) return [];

  const deduplicated = deduplicateColors(rawColors);
  deduplicated.sort((a, b) => b.frequency - a.frequency);
  return assignColorRoles(deduplicated, isLightScheme);
}

function deduplicateColors(colors: RawTokens['colors']): ColorToken[] {
  const groups: Array<{
    representative: string;
    name?: string;
    frequency: number;
    source: ColorToken['source'];
  }> = [];

  for (const color of colors) {
    const hex = color.value;
    if (!isValidHex(hex)) continue;

    const rgb = hexToRgb(hex);
    if (!rgb) continue;

    let merged = false;
    for (const group of groups) {
      const groupRgb = hexToRgb(group.representative);
      if (groupRgb && colorDistance(rgb, groupRgb) < 15) {
        group.frequency += color.frequency;
        if (color.name && !group.name) group.name = color.name;
        merged = true;
        break;
      }
    }

    if (!merged) {
      groups.push({
        representative: hex,
        name: color.name,
        frequency: color.frequency,
        source: color.source,
      });
    }
  }

  return groups.map(g => ({
    hex: g.representative,
    name: g.name,
    role: 'unknown' as ColorRole,
    frequency: g.frequency,
    source: g.source,
  }));
}

function assignColorRoles(colors: ColorToken[], isLightScheme = false): ColorToken[] {
  if (colors.length === 0) return colors;

  const assigned = new Set<number>();

  const assign = (index: number, role: ColorRole) => {
    if (index >= 0 && !assigned.has(index)) {
      colors[index].role = role;
      assigned.add(index);
    }
  };

  // First pass: assign from CSS variable names (most reliable signal)
  for (let i = 0; i < colors.length; i++) {
    const name = colors[i].name?.toLowerCase() || '';
    if (!name) continue;

    // light-bg comes from light-dark() on background property
    if (name === 'light-bg' && isLightScheme) {
      assign(i, 'background');
    // light-text comes from light-dark() on color property
    } else if (name === 'light-text' && isLightScheme) {
      assign(i, 'text-primary');
    } else if (/\b(surface|card|panel)\b/.test(name) && !assigned.has(i)) {
      assign(i, 'surface');
    } else if (/\b(accent|primary-action)\b/.test(name) && !/text|font/i.test(name)) {
      assign(i, 'accent');
    } else if (/\b(muted|subtle|secondary|placeholder|caption)\b/.test(name) && /text|fg|foreground|font|color/i.test(name)) {
      assign(i, 'text-muted');
    } else if (/\b(glow|highlight|hover)\b/.test(name)) {
      // Glows/highlights are extended palette, leave as unknown for now
    }
  }

  const withInfo = colors.map((c, i) => ({
    ...c,
    index: i,
    ...getColorInfo(c.hex),
  }));

  // For light-scheme sites: lightest = background, darkest = text
  if (isLightScheme) {
    // Background: lightest frequent color (if not already assigned)
    if (!colors.some(c => c.role === 'background')) {
      const lightColors = withInfo
        .filter(c => c.lightness > 0.7 && !assigned.has(c.index))
        .sort((a, b) => b.lightness - a.lightness || b.frequency - a.frequency);
      if (lightColors.length > 0) assign(lightColors[0].index, 'background');
    }

    // Text primary: darkest high-frequency color
    const darkColors = withInfo
      .filter(c => c.lightness < 0.2 && !assigned.has(c.index))
      .sort((a, b) => b.frequency - a.frequency);
    if (darkColors.length > 0) assign(darkColors[0].index, 'text-primary');

    // Surface: second lightest or a mid-tone
    const surfaceCandidates = withInfo
      .filter(c => c.lightness > 0.5 && !assigned.has(c.index))
      .sort((a, b) => b.lightness - a.lightness);
    if (surfaceCandidates.length > 0) assign(surfaceCandidates[0].index, 'surface');
  } else {
    // Dark theme: darkest = background, lightest = text
    // Background: darkest frequent color
    const darkColors = withInfo
      .filter(c => c.lightness < 0.25)
      .sort((a, b) => b.frequency - a.frequency);
    if (darkColors.length > 0) assign(darkColors[0].index, 'background');

    // Surface: second darkest
    if (darkColors.length > 1) assign(darkColors[1].index, 'surface');

    // Text primary: lightest high-frequency color
    const lightColors = withInfo
      .filter(c => c.lightness > 0.7 && !assigned.has(c.index))
      .sort((a, b) => b.frequency - a.frequency);
    if (lightColors.length > 0) assign(lightColors[0].index, 'text-primary');
  }

  // Text muted: medium lightness, low saturation — for dark sites use a wider range
  const mutedColors = withInfo
    .filter(c => c.lightness > 0.25 && c.lightness < 0.75 && c.saturation < 0.35 && !assigned.has(c.index))
    .sort((a, b) => b.frequency - a.frequency);
  if (mutedColors.length > 0) assign(mutedColors[0].index, 'text-muted');

  // Danger: red-ish
  const redish = withInfo
    .filter(c => c.saturation > 0.3 && (c.hue < 30 || c.hue > 330) && !assigned.has(c.index));
  if (redish.length > 0) assign(redish[0].index, 'danger');

  // Success: green-ish
  const greenish = withInfo
    .filter(c => c.saturation > 0.3 && c.hue > 90 && c.hue < 170 && !assigned.has(c.index));
  if (greenish.length > 0) assign(greenish[0].index, 'success');

  // Warning: yellow-orange
  const yellowish = withInfo
    .filter(c => c.saturation > 0.3 && c.hue > 30 && c.hue < 60 && !assigned.has(c.index));
  if (yellowish.length > 0) assign(yellowish[0].index, 'warning');

  // Info: blue-ish
  const blueish = withInfo
    .filter(c => c.saturation > 0.3 && c.hue > 180 && c.hue < 260 && !assigned.has(c.index));
  if (blueish.length > 0) assign(blueish[0].index, 'info');

  // Accent: most saturated mid-lightness color
  const accentCandidates = withInfo
    .filter(c => c.saturation > 0.15 && c.lightness > 0.3 && c.lightness < 0.85 && !assigned.has(c.index))
    .sort((a, b) => b.saturation - a.saturation || b.frequency - a.frequency);
  if (accentCandidates.length > 0) assign(accentCandidates[0].index, 'accent');

  // Border: low-saturation, medium value
  const borderCandidates = withInfo
    .filter(c => c.saturation < 0.2 && c.lightness > 0.1 && c.lightness < 0.4 && !assigned.has(c.index))
    .sort((a, b) => b.frequency - a.frequency);
  if (borderCandidates.length > 0) assign(borderCandidates[0].index, 'border');

  // Light theme fallback
  if (!colors.some(c => c.role === 'background')) {
    const lightBg = withInfo
      .filter(c => c.lightness > 0.9 && !assigned.has(c.index))
      .sort((a, b) => b.frequency - a.frequency);
    if (lightBg.length > 0) assign(lightBg[0].index, 'background');

    const darkText = withInfo
      .filter(c => c.lightness < 0.3 && !assigned.has(c.index))
      .sort((a, b) => b.frequency - a.frequency);
    if (darkText.length > 0) assign(darkText[0].index, 'text-primary');
  }

  return colors.slice(0, 20);
}

function getColorInfo(hex: string): { hue: number; saturation: number; lightness: number } {
  const rgb = hexToRgb(hex);
  if (!rgb) return { hue: 0, saturation: 0, lightness: 0 };

  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
    else if (max === g) h = ((b - r) / d + 2) * 60;
    else h = ((r - g) / d + 4) * 60;
  }

  return { hue: h, saturation: s, lightness: l };
}

function colorDistance(a: { r: number; g: number; b: number }, b: { r: number; g: number; b: number }): number {
  return Math.sqrt(
    Math.pow(a.r - b.r, 2) +
    Math.pow(a.g - b.g, 2) +
    Math.pow(a.b - b.b, 2)
  );
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const match = hex.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i);
  if (!match) return null;
  return {
    r: parseInt(match[1], 16),
    g: parseInt(match[2], 16),
    b: parseInt(match[3], 16),
  };
}

function isValidHex(hex: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(hex);
}

/** Remove duplicate breakpoint values, keep unique pixel values sorted ascending. */
function deduplicateBreakpoints(bps: RawTokens['breakpoints']): RawTokens['breakpoints'] {
  const seen = new Set<string>();
  return bps
    .filter(bp => {
      if (seen.has(bp.value)) return false;
      seen.add(bp.value);
      return true;
    })
    .sort((a, b) => {
      const av = parseFloat(a.value);
      const bv = parseFloat(b.value);
      return av - bv;
    });
}

/** Remove duplicate page sections (same type appearing from multiple crawled pages). */
function deduplicatePageSections(sections: import('./types').PageSection[]): import('./types').PageSection[] {
  const seen = new Map<string, import('./types').PageSection>();
  for (const s of sections) {
    const key = `${s.type}:${s.description}`;
    if (!seen.has(key)) seen.set(key, s);
  }
  return Array.from(seen.values());
}

// ── Typography ────────────────────────────────────────────────────────

function normalizeTypography(
  rawFonts: RawTokens['fonts'],
  fontVarMap: Record<string, string>
): TypographyToken[] {
  if (rawFonts.length === 0) return [];

  const resolvedFonts = rawFonts.map(f => ({
    ...f,
    family: resolveFontFamily(f.family, fontVarMap),
  }));

  const familyFreq = new Map<string, number>();
  for (const f of resolvedFonts) {
    if (!f.family) continue;
    const normalized = f.family.replace(/["']/g, '').trim();
    if (normalized && !isGenericFamily(normalized)) {
      familyFreq.set(normalized, (familyFreq.get(normalized) || 0) + 1);
    }
  }

  // Merge "Foo Fallback" entries into "Foo" if both exist
  // Browsers generate "X Fallback" names for @font-face fonts during loading
  const mergedFreq = new Map<string, number>();
  for (const [family, freq] of familyFreq.entries()) {
    const baseName = family.replace(/\s+Fallback$/i, '');
    if (baseName !== family && familyFreq.has(baseName)) {
      // "Foo Fallback" exists alongside "Foo" — merge into "Foo"
      mergedFreq.set(baseName, (mergedFreq.get(baseName) || 0) + freq);
    } else if (baseName !== family && !familyFreq.has(baseName)) {
      // Only "Foo Fallback" exists — use the base name "Foo"
      mergedFreq.set(baseName, (mergedFreq.get(baseName) || 0) + freq);
    } else if (!family.endsWith(' Fallback') || !familyFreq.has(family.replace(/\s+Fallback$/i, ''))) {
      mergedFreq.set(family, (mergedFreq.get(family) || 0) + freq);
    }
  }

  const sortedFamilies = Array.from(mergedFreq.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([family]) => family);

  const primaryFont = sortedFamilies[0] || 'sans-serif';
  const secondaryFont = sortedFamilies.find(f => f !== primaryFont && !isMonoFont(f));
  const monoFont = sortedFamilies.find(f => isMonoFont(f));

  const sizes = new Map<string, number>();
  for (const f of resolvedFonts) {
    if (f.size) {
      sizes.set(f.size, (sizes.get(f.size) || 0) + 1);
    }
  }

  const sortedSizes = Array.from(sizes.entries())
    .sort((a, b) => parseSizeToPixels(b[0]) - parseSizeToPixels(a[0]));

  // Separate sizes into heading-range (>= 24px) and body-range (< 24px)
  const headingSizes = sortedSizes.filter(([s]) => parseSizeToPixels(s) >= 24);
  const bodySizes = sortedSizes.filter(([s]) => {
    const px = parseSizeToPixels(s);
    return px >= 10 && px < 24;
  });

  const tokens: TypographyToken[] = [];
  const headingRoles: TypographyRole[] = ['heading-1', 'heading-2', 'heading-3'];
  const bodyRoles: TypographyRole[] = ['body', 'caption'];

  // If we have a good spread of both heading and body sizes, use smart assignment
  if (headingSizes.length >= 2 && bodySizes.length >= 1) {
    // Assign headings from largest down
    for (let i = 0; i < Math.min(headingRoles.length, headingSizes.length); i++) {
      tokens.push({
        role: headingRoles[i],
        fontFamily: secondaryFont || primaryFont,
        fontSize: headingSizes[i][0],
        fontWeight: '700',
        source: rawFonts[0]?.source || 'css',
      });
    }

    // Assign body/caption from the body-range sizes (most frequent first)
    const bodyByFreq = [...bodySizes].sort((a, b) => b[1] - a[1]);
    for (let i = 0; i < Math.min(bodyRoles.length, bodyByFreq.length); i++) {
      tokens.push({
        role: bodyRoles[i],
        fontFamily: primaryFont,
        fontSize: bodyByFreq[i][0],
        fontWeight: '400',
        source: rawFonts[0]?.source || 'css',
      });
    }
  } else if (sortedSizes.length >= 4) {
    // Fallback: simple assignment from largest to smallest
    const roles: TypographyRole[] = ['heading-1', 'heading-2', 'heading-3', 'body', 'caption'];
    for (let i = 0; i < Math.min(roles.length, sortedSizes.length); i++) {
      const isHeading = roles[i].startsWith('heading');
      tokens.push({
        role: roles[i],
        fontFamily: isHeading && secondaryFont ? secondaryFont : primaryFont,
        fontSize: sortedSizes[i][0],
        fontWeight: isHeading ? '700' : '400',
        source: rawFonts[0]?.source || 'css',
      });
    }
  } else {
    const defaultScale = [
      { role: 'heading-1' as TypographyRole, size: '48px / 3rem', weight: '700' },
      { role: 'heading-2' as TypographyRole, size: '32px / 2rem', weight: '600' },
      { role: 'heading-3' as TypographyRole, size: '24px / 1.5rem', weight: '600' },
      { role: 'body' as TypographyRole, size: '16px / 1rem', weight: '400' },
      { role: 'caption' as TypographyRole, size: '12px / 0.75rem', weight: '400' },
    ];

    for (const item of defaultScale) {
      const isHeading = item.role.startsWith('heading');
      tokens.push({
        role: item.role,
        fontFamily: isHeading && secondaryFont ? secondaryFont : primaryFont,
        fontSize: item.size,
        fontWeight: item.weight,
        source: rawFonts[0]?.source || 'css',
      });
    }
  }

  if (monoFont) {
    tokens.push({
      role: 'code',
      fontFamily: monoFont,
      fontSize: '14px',
      fontWeight: '400',
      source: rawFonts[0]?.source || 'css',
    });
  }

  return tokens;
}

function resolveFontFamily(family: string, varMap: Record<string, string>): string {
  if (!family) return family;

  if (family.startsWith('var(')) {
    const resolved = varMap[family];
    if (resolved) return resolved;
    const varName = family.replace(/^var\(/, '').replace(/\)$/, '').trim();
    if (varMap[varName]) return varMap[varName];
  }

  if (varMap[family]) return varMap[family];

  return family.replace(/["']/g, '').trim();
}

function isGenericFamily(f: string): boolean {
  if (/^(sans-serif|serif|monospace|cursive|fantasy|system-ui|ui-sans-serif|ui-serif|ui-monospace)$/i.test(f)) return true;
  // Filter out unresolved CSS variable references (e.g. "var(--default-font-family")
  if (/^var\(/.test(f)) return true;
  // Filter out font names that are just numbers or very short
  if (f.length < 2) return true;
  // Filter out malformed font names with CSS syntax artifacts
  if (/[{};()\n\r<>]/.test(f)) return true;
  // Filter out names that are too long to be real font names
  if (f.length > 50) return true;
  // Filter out icon/symbol fonts
  if (/^(apple\s*(icons?|legacy|sf\s*symbols?)|material\s*(icons?|symbols?)|font\s*awesome|fontawesome|glyphicons?|ionicons?)/i.test(f)) return true;
  if (/^apple\s*icons?\s*\d+/i.test(f)) return true;
  // Filter out system font names
  if (/^(-apple-system|blinkmacsystemfont|\.sf\s*(pro|compact))/i.test(f)) return true;
  // Filter out emoji fonts
  if (/^(apple\s*color\s*emoji|noto\s*color\s*emoji|segoe\s*ui\s*emoji|android\s*emoji|twemoji)/i.test(f)) return true;
  // Filter out font fallback auto-generated names (e.g. "delight Fallback")
  if (/\bfallback\b/i.test(f)) return true;
  return false;
}

function isMonoFont(family: string): boolean {
  return /mono|consolas|courier|fira code|jetbrains|sf mono|menlo|hack|source code/i.test(family);
}

function parseSizeToPixels(size: string): number {
  const px = size.match(/([\d.]+)\s*px/);
  if (px) return parseFloat(px[1]);
  const rem = size.match(/([\d.]+)\s*rem/);
  if (rem) return parseFloat(rem[1]) * 16;
  return 0;
}

// ── Spacing ───────────────────────────────────────────────────────────

function normalizeSpacing(values: number[]): SpacingScale {
  if (values.length === 0) {
    return { base: 4, values: [4, 8, 12, 16, 20, 24, 32, 40, 48, 64], unit: 'px' };
  }

  const unique = [...new Set(values)]
    .filter(v => v > 0 && v <= 200)
    .sort((a, b) => a - b);

  const base = detectBase(unique);

  const aligned = unique.filter(v => v % base === 0);
  const halfAligned = unique.filter(v => v % (base / 2) === 0 && !aligned.includes(v));
  const combined = [...new Set([...aligned, ...halfAligned])].sort((a, b) => a - b);

  let finalValues: number[];
  if (combined.length >= 6) {
    finalValues = combined;
  } else if (aligned.length >= 4) {
    finalValues = aligned;
  } else {
    finalValues = [];
    for (let m = 1; m <= 24; m++) {
      const v = base * m;
      if (v <= 200) finalValues.push(v);
    }
  }

  return {
    base,
    values: finalValues.slice(0, 15),
    unit: 'px',
  };
}

function detectBase(values: number[]): number {
  if (values.length < 2) return values[0] || 4;

  const candidates = [8, 4, 6, 5, 10];
  let bestBase = 4;
  let bestScore = 0;

  for (const base of candidates) {
    const divisible = values.filter(v => v % base === 0);
    const ratio = divisible.length / values.length;
    const score = ratio + (base >= 8 ? 0.05 : 0);
    if (score > bestScore) {
      bestScore = score;
      bestBase = base;
    }
  }

  return bestBase;
}

// ── Shadows ───────────────────────────────────────────────────────────

function normalizeShadows(rawShadows: RawTokens['shadows']): ShadowToken[] {
  if (rawShadows.length === 0) return [];

  const seen = new Set<string>();
  const unique: Array<{ value: string; name?: string }> = [];
  for (const s of rawShadows) {
    const normalized = s.value.trim().toLowerCase();
    if (!normalized || normalized === 'none') continue;
    // Skip pure Tailwind CSS variable chains — they have no real shadow value
    // e.g. "var(--tw-inset-shadow),var(--tw-ring-shadow),var(--tw-shadow)"
    // These expand to 'none' unless Tailwind is running — useless in standalone CSS
    if (/^var\(--tw-/.test(normalized) && !normalized.match(/\d+px/)) continue;
    if (!seen.has(normalized)) {
      seen.add(normalized);
      unique.push(s);
    }
  }

  return unique.map(s => ({
    value: s.value,
    level: classifyShadow(s.value),
    name: s.name,
  })).sort((a, b) => shadowLevelOrder(a.level) - shadowLevelOrder(b.level));
}

function classifyShadow(value: string): ShadowLevel {
  const numbers = value.match(/(\d+(?:\.\d+)?)\s*px/g);
  if (!numbers) return 'raised';

  const pxValues = numbers.map(n => parseFloat(n));
  const maxBlur = Math.max(...pxValues);

  if (maxBlur <= 2) return 'flat';
  if (maxBlur <= 8) return 'raised';
  if (maxBlur <= 20) return 'floating';
  return 'overlay';
}

function shadowLevelOrder(level: ShadowLevel): number {
  const order: Record<ShadowLevel, number> = { flat: 0, raised: 1, floating: 2, overlay: 3 };
  return order[level];
}

// ── Border Radius ─────────────────────────────────────────────────────

function normalizeBorderRadius(radii: string[], components: ComponentInfo[]): string[] {
  const allRadii: string[] = [...radii];

  for (const comp of components) {
    for (const cls of comp.cssClasses) {
      if (cls.startsWith('rounded')) {
        const twRadius = tailwindRoundedToValue(cls);
        if (twRadius) allRadii.push(twRadius);
      }
    }
  }

  // Count frequency of each radius value to detect dominant patterns
  const radiusFreq = new Map<string, number>();
  for (const r of allRadii) {
    const normalized = r === '0' ? '0px' : r;
    radiusFreq.set(normalized, (radiusFreq.get(normalized) || 0) + 1);
  }

  // Check if 0px (sharp corners) is the dominant radius
  const zeroCount = (radiusFreq.get('0px') || 0) + (radiusFreq.get('0') || 0);
  const totalCount = allRadii.length;
  const sharpCornersDesign = zeroCount > 0 && zeroCount >= totalCount * 0.5;

  const unique = [...new Set(allRadii)]
    .filter(r => {
      // Filter out CSS variable references (var(--...))
      if (r.includes('var(')) return false;
      // Filter out pill/full radius
      if (r.includes('9999') || r === '50%') return false;
      // Filter out infinity values (e.g. 3.40282e38px from CSS)
      const numVal = parseFloat(r);
      if (!isNaN(numVal) && numVal > 1000) return false;
      // Keep 0px only if sharp corners dominate (brutalist/sharp design)
      if ((r === '0' || r === '0px') && !sharpCornersDesign) return false;
      return true;
    })
    .sort((a, b) => parseFloat(a) - parseFloat(b));

  return unique.length > 0 ? unique : ['8px'];
}

function tailwindRoundedToValue(cls: string): string | null {
  const map: Record<string, string> = {
    'rounded-none': '0px',
    'rounded-sm': '2px',
    'rounded': '4px',
    'rounded-md': '6px',
    'rounded-lg': '8px',
    'rounded-xl': '12px',
    'rounded-2xl': '16px',
    'rounded-3xl': '24px',
    'rounded-full': '9999px',
  };
  const baseClass = cls.replace(/-(t|b|l|r|tl|tr|bl|br)-/, '-');
  return map[baseClass] || null;
}

// ── Animations ────────────────────────────────────────────────────────

function normalizeAnimations(rawAnimations: AnimationToken[]): AnimationToken[] {
  const seen = new Set<string>();
  const unique: AnimationToken[] = [];
  for (const anim of rawAnimations) {
    const key = `${anim.type}:${anim.name}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(anim);
    }
  }
  return unique;
}

// ── Motion Tokens ─────────────────────────────────────────────────────

function normalizeMotionTokens(rawTokens: RawTokens, animations: AnimationToken[]): MotionTokens {
  // Collect durations — only clean values, no var() references
  const durations = new Set<string>();
  for (const d of (rawTokens.transitionDurations || [])) {
    if (!d.includes('var(') && /^[\d.]+m?s$/.test(d.trim())) {
      durations.add(d.trim());
    }
  }

  // Also parse durations from transition shorthands
  for (const anim of animations) {
    if (anim.type === 'css-transition') {
      const durMatch = anim.value.matchAll(/([\d.]+)(ms|s)\b/g);
      for (const m of durMatch) {
        const dur = m[2] === 's' ? `${parseFloat(m[1]) * 1000}ms` : `${m[1]}ms`;
        durations.add(dur);
      }
    }
  }

  // Collect easings — only clean values, no var() references
  const easings = new Set<string>();
  for (const e of (rawTokens.transitionEasings || [])) {
    if (!e.includes('var(') && (
      /^(ease|ease-in|ease-out|ease-in-out|linear)$/.test(e.trim()) ||
      /^cubic-bezier\(/.test(e.trim())
    )) {
      easings.add(e.trim());
    }
  }
  for (const anim of animations) {
    if (anim.type === 'css-transition') {
      const easingPatterns = [
        /\b(ease-in-out|ease-in|ease-out|ease|linear)\b/g,
        /cubic-bezier\([^)]+\)/g,
      ];
      for (const pattern of easingPatterns) {
        const matches = anim.value.matchAll(pattern);
        for (const m of matches) {
          easings.add(m[0]);
        }
      }
    }
  }

  // Collect animated properties
  const properties = new Set<string>();
  for (const anim of animations) {
    if (anim.type === 'css-transition') {
      // Extract property names from "all 150ms ease", "opacity 0.3s", etc.
      const parts = anim.value.split(',');
      for (const part of parts) {
        const propMatch = part.trim().match(/^([\w-]+)\s/);
        if (propMatch && !['all'].includes(propMatch[1])) {
          properties.add(propMatch[1]);
        }
      }
    }
  }

  // Sort durations numerically
  const sortedDurations = [...durations].sort((a, b) => {
    const ams = parseFloat(a);
    const bms = parseFloat(b);
    return ams - bms;
  });

  return {
    durations: sortedDurations,
    easings: [...easings],
    properties: [...properties],
  };
}

// ── Component Categories ──────────────────────────────────────────────

function buildComponentCategories(components: ComponentInfo[]): Record<ComponentCategory, string[]> {
  const cats: Record<ComponentCategory, string[]> = {
    'layout': [],
    'navigation': [],
    'data-display': [],
    'data-input': [],
    'feedback': [],
    'overlay': [],
    'typography': [],
    'media': [],
    'other': [],
  };

  for (const comp of components) {
    cats[comp.category].push(comp.name);
  }

  return cats;
}

// ── Anti-Patterns Detection ───────────────────────────────────────────

function detectAntiPatterns(
  rawTokens: RawTokens,
  components: ComponentInfo[],
  shadows: ShadowToken[]
): string[] {
  const patterns: string[] = [];

  if (shadows.length === 0) patterns.push('no-shadows');
  if ((rawTokens.gradients || []).length === 0) patterns.push('no-gradients');

  let hasBlur = false;
  let hasSkeletonLoaders = false;
  let hasParallax = false;

  for (const comp of components) {
    for (const cls of comp.cssClasses) {
      if (cls.includes('blur') || cls.includes('backdrop-blur')) hasBlur = true;
      if (cls.includes('skeleton') || cls.includes('animate-pulse')) hasSkeletonLoaders = true;
      if (cls.includes('parallax')) hasParallax = true;
    }
    if (comp.jsxSnippet) {
      if (/skeleton|shimmer|pulse/i.test(comp.jsxSnippet)) hasSkeletonLoaders = true;
      if (/toast|Toaster|sonner/i.test(comp.jsxSnippet)) patterns.push('has-toasts');
    }
  }

  if (!hasBlur) patterns.push('no-blur');
  if (hasSkeletonLoaders) patterns.push('has-skeleton-loaders');
  if (hasParallax) patterns.push('has-parallax');

  let hasZebraStriping = false;
  for (const comp of components) {
    if (/even:|odd:|striped|zebra/i.test(comp.cssClasses.join(' '))) {
      hasZebraStriping = true;
    }
  }
  if (!hasZebraStriping) patterns.push('no-zebra-striping');

  return patterns;
}

// ── Design Traits ─────────────────────────────────────────────────────

function computeDesignTraits(
  colors: ColorToken[],
  typography: TypographyToken[],
  spacing: SpacingScale,
  shadows: ShadowToken[],
  rawTokens: RawTokens,
  animations: AnimationToken[]
): DesignTraits {
  const bg = colors.find(c => c.role === 'background');
  const accent = colors.find(c => c.role === 'accent');
  const primaryFont = typography.find(t => t.role === 'body')?.fontFamily || 'sans-serif';

  const isDark = bg ? isColorDark(bg.hex) : false;

  const tempColor = accent?.hex || bg?.hex || '#333333';
  const tempRgb = hexToRgb(tempColor);
  let primaryColorTemp: 'warm' | 'cool' | 'neutral' = 'neutral';
  if (tempRgb) {
    if (tempRgb.r > tempRgb.b + 30) primaryColorTemp = 'warm';
    else if (tempRgb.b > tempRgb.r + 30) primaryColorTemp = 'cool';
  }

  let fontStyle: 'serif' | 'sans-serif' | 'monospace' = 'sans-serif';
  if (isMonoFont(primaryFont)) fontStyle = 'monospace';
  else if (/serif|georgia|times|garamond|merriweather|playfair/i.test(primaryFont) &&
           !/sans/i.test(primaryFont)) fontStyle = 'serif';

  let density: 'compact' | 'standard' | 'spacious' = 'standard';
  if (spacing.base <= 4) density = 'compact';
  else if (spacing.base >= 12) density = 'spacious';

  const radii = (rawTokens.borderRadii || []).map(r => parseFloat(r)).filter(n => !isNaN(n) && n < 9999);
  const maxBorderRadius = radii.length > 0 ? Math.max(...radii) : 8;

  const hasAnimations = animations.length > 0;
  // hasDarkMode = site has a TOGGLEABLE dark mode (light/dark switch), NOT just "is dark"
  // A dark-primary site with no light mode toggle should have hasDarkMode = false
  const hasDarkMode = (rawTokens.darkModeVars || []).length > 0;

  // Motion style — based on number and type of animations, NOT binary has/doesn't
  let motionStyle: 'none' | 'subtle' | 'expressive' = 'none';
  if (animations.length > 0 || (rawTokens.transitionDurations || []).length > 0) {
    const hasFramerMotion = animations.some(a => a.type === 'framer-motion' || a.type === 'spring');
    const hasLayoutAnims = animations.some(a => a.value.includes('layout-animation'));
    if (hasFramerMotion || hasLayoutAnims || animations.length > 5) {
      motionStyle = 'expressive';
    } else {
      motionStyle = 'subtle';
    }
  }

  return {
    isDark,
    hasShadows: shadows.length > 0,
    hasGradients: (rawTokens.gradients || []).length > 0,
    hasRoundedFull: (rawTokens.borderRadii || []).some(r => r.includes('9999') || r === '50%'),
    maxBorderRadius,
    primaryColorTemp,
    fontStyle,
    density,
    hasAnimations,
    hasDarkMode,
    motionStyle,
  };
}

function isColorDark(hex: string): boolean {
  const rgb = hexToRgb(hex);
  if (!rgb) return false;
  const luminance = (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255;
  return luminance < 0.5;
}

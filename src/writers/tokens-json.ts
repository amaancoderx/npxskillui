import * as fs from 'fs';
import * as path from 'path';
import { DesignProfile } from '../types';

/**
 * Ultra mode — Token JSON Writer
 *
 * Writes structured JSON token files to tokens/ directory:
 * - tokens/colors.json
 * - tokens/spacing.json
 * - tokens/typography.json
 */
export function writeTokensJson(profile: DesignProfile, skillDir: string): void {
  const tokensDir = path.join(skillDir, 'tokens');
  fs.mkdirSync(tokensDir, { recursive: true });

  writeColorsJson(profile, tokensDir);
  writeSpacingJson(profile, tokensDir);
  writeTypographyJson(profile, tokensDir);
}

// ── colors.json ──────────────────────────────────────────────────────

function writeColorsJson(profile: DesignProfile, tokensDir: string): void {
  const core: Record<string, any> = {};
  const extended: Record<string, any> = {};
  const status: Record<string, any> = {};

  for (const color of profile.colors) {
    const token: Record<string, any> = {
      value: color.hex,
      role: color.role,
    };
    if (color.name) token.name = color.name;

    switch (color.role) {
      case 'background':
      case 'surface':
      case 'text-primary':
      case 'text-muted':
      case 'accent':
      case 'border':
        core[color.role] = token;
        break;
      case 'danger':
      case 'success':
      case 'warning':
        status[color.role] = token;
        break;
      default:
        const key = color.name
          ? color.name.replace(/\s+/g, '-').toLowerCase()
          : color.hex.replace('#', 'color-');
        extended[key] = token;
    }
  }

  const output = {
    $schema: 'https://design-tokens.github.io/community-group/format/',
    core,
    status,
    extended,
    meta: {
      theme: profile.designTraits.isDark ? 'dark' : 'light',
      extracted: new Date().toISOString().slice(0, 10),
    },
  };

  fs.writeFileSync(
    path.join(tokensDir, 'colors.json'),
    JSON.stringify(output, null, 2),
    'utf-8'
  );
}

// ── spacing.json ─────────────────────────────────────────────────────

function writeSpacingJson(profile: DesignProfile, tokensDir: string): void {
  const { base, values, unit } = profile.spacing;

  // Named semantic scale
  const scale: Record<string, any> = {};
  const sortedValues = [...values].sort((a, b) => a - b);

  // Assign t-shirt sizes
  const labels = ['xs', 'sm', 'md', 'lg', 'xl', '2xl', '3xl', '4xl', '5xl', '6xl'];
  sortedValues.slice(0, labels.length).forEach((v, i) => {
    scale[labels[i]] = { value: `${v}${unit}`, px: v };
  });

  // Multiplier aliases
  const multipliers: Record<string, number> = {};
  for (let i = 1; i <= 16; i++) {
    multipliers[`${i}x`] = base * i;
  }

  const output = {
    base: { value: `${base}px`, description: 'Grid unit — all spacing must be multiples of this' },
    unit,
    scale,
    multipliers: Object.fromEntries(
      Object.entries(multipliers).map(([k, v]) => [k, { value: `${v}px`, raw: v }])
    ),
    meta: {
      totalValues: values.length,
      min: sortedValues[0] ?? 0,
      max: sortedValues[sortedValues.length - 1] ?? 0,
    },
  };

  fs.writeFileSync(
    path.join(tokensDir, 'spacing.json'),
    JSON.stringify(output, null, 2),
    'utf-8'
  );
}

// ── typography.json ──────────────────────────────────────────────────

function writeTypographyJson(profile: DesignProfile, tokensDir: string): void {
  const scale: Record<string, any> = {};

  for (const token of profile.typography) {
    const key = token.role;
    scale[key] = {
      fontFamily: token.fontFamily,
      fontSize: token.fontSize || null,
      fontWeight: token.fontWeight || null,
      lineHeight: token.lineHeight || null,
      source: token.source,
    };
  }

  // Unique font families
  const families = [...new Set(profile.typography.map(t => t.fontFamily).filter(Boolean))];

  // Font face declarations
  const fontFaces = profile.fontSources.map(src => ({
    family: src.family,
    src: src.src,
    format: src.format || 'truetype',
    weight: src.weight || '400',
  }));

  const output = {
    families,
    scale,
    fontFaces,
    rules: {
      maxSizesPerScreen: 4,
      headingWeightRange: '600-700',
      bodyWeight: 400,
      lineHeightBody: 1.5,
      lineHeightHeading: 1.2,
    },
  };

  fs.writeFileSync(
    path.join(tokensDir, 'typography.json'),
    JSON.stringify(output, null, 2),
    'utf-8'
  );
}

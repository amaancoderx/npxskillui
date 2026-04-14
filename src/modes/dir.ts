import { detectFrameworks, getProjectName } from '../extractors/framework';
import { extractTailwindTokens } from '../extractors/tokens/tailwind';
import { extractCSSTokens } from '../extractors/tokens/css';
import { extractTokensFile } from '../extractors/tokens/tokens-file';
import { extractComponents, detectProjectLibraries } from '../extractors/components';
import { normalize } from '../normalizer';
import { RawTokens, DesignProfile } from '../types';

/**
 * DIR mode: scan a local project directory and extract design tokens.
 */
export async function runDirMode(projectDir: string, nameOverride?: string): Promise<DesignProfile> {
  // Step 1: Detect frameworks
  const frameworks = detectFrameworks(projectDir);
  const projectName = getProjectName(projectDir, nameOverride);

  // Step 2: Detect project libraries (icons, state, animations)
  const libraries = detectProjectLibraries(projectDir);

  // Step 3: Extract raw tokens from all sources (priority order)
  const tailwindTokens = extractTailwindTokens(projectDir);
  const tokensFileTokens = extractTokensFile(projectDir);
  const cssTokens = extractCSSTokens(projectDir);

  // Merge all raw tokens
  const merged = mergeRawTokens([tailwindTokens, tokensFileTokens, cssTokens]);

  // Step 4: Extract components
  const components = extractComponents(projectDir);

  // Step 5: Scan component files for additional color/font tokens
  for (const comp of components) {
    extractComponentTokens(comp, merged);
  }

  // Step 6: Collect animation tokens from components
  for (const comp of components) {
    if (comp.hasAnimation) {
      for (const detail of comp.animationDetails) {
        if (detail.startsWith('framer-motion')) {
          merged.animations.push({
            name: 'framer-motion',
            type: 'framer-motion',
            value: detail,
            source: comp.filePath,
          });
        } else if (detail.startsWith('spring:')) {
          merged.animations.push({
            name: 'spring-config',
            type: 'spring',
            value: detail.replace('spring: ', ''),
            source: comp.filePath,
          });
        } else if (detail.startsWith('tw-animate-')) {
          merged.animations.push({
            name: detail.replace('tw-', ''),
            type: 'css-keyframe',
            value: detail,
            source: comp.filePath,
          });
        }
      }
    }
  }

  // Step 7: Normalize into clean DesignProfile
  return normalize(projectName, frameworks, merged, components, libraries);
}

function mergeRawTokens(sources: RawTokens[]): RawTokens {
  const merged: RawTokens = {
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

  for (const src of sources) {
    // Merge colors, deduplicating by hex value
    for (const color of src.colors) {
      const existing = merged.colors.find(c => c.value === color.value);
      if (existing) {
        existing.frequency += color.frequency;
        if (color.name && !existing.name) existing.name = color.name;
      } else {
        merged.colors.push({ ...color });
      }
    }

    // Merge fonts
    for (const font of src.fonts) {
      if (font.family && !merged.fonts.find(f => f.family === font.family && f.size === font.size)) {
        merged.fonts.push({ ...font });
      }
    }

    // Merge spacing
    merged.spacingValues.push(...src.spacingValues);

    // Merge shadows
    for (const shadow of src.shadows) {
      if (!merged.shadows.find(s => s.value === shadow.value)) {
        merged.shadows.push({ ...shadow });
      }
    }

    // Merge CSS variables
    for (const v of src.cssVariables) {
      if (!merged.cssVariables.find(cv => cv.name === v.name)) {
        merged.cssVariables.push({ ...v });
      }
    }

    // Merge breakpoints (prefer tailwind over css)
    for (const bp of src.breakpoints) {
      if (!merged.breakpoints.find(b => b.value === bp.value)) {
        merged.breakpoints.push({ ...bp });
      }
    }

    // Merge border radii
    if (src.borderRadii) {
      for (const r of src.borderRadii) {
        if (!merged.borderRadii.includes(r)) merged.borderRadii.push(r);
      }
    }

    // Merge gradients
    if (src.gradients) {
      merged.gradients.push(...src.gradients);
    }

    // Merge font var map
    if (src.fontVarMap) {
      Object.assign(merged.fontVarMap, src.fontVarMap);
    }

    // Merge animations
    if (src.animations) {
      merged.animations.push(...src.animations);
    }

    // Merge dark mode vars
    if (src.darkModeVars) {
      for (const dmv of src.darkModeVars) {
        if (!merged.darkModeVars.find(d => d.variable === dmv.variable)) {
          merged.darkModeVars.push(dmv);
        }
      }
    }

    // Merge z-index values
    if (src.zIndexValues) {
      for (const z of src.zIndexValues) {
        if (!merged.zIndexValues.includes(z)) merged.zIndexValues.push(z);
      }
    }

    // Container max-width: prefer explicit
    if (src.containerMaxWidth && !merged.containerMaxWidth) {
      merged.containerMaxWidth = src.containerMaxWidth;
    }

    // Merge font sources
    if (src.fontSources) {
      for (const fs of src.fontSources) {
        if (!merged.fontSources.find(f => f.family === fs.family && f.src === fs.src)) {
          merged.fontSources.push(fs);
        }
      }
    }

    // Merge page sections
    if (src.pageSections) {
      for (const ps of src.pageSections) {
        if (!merged.pageSections.find(p => p.type === ps.type)) {
          merged.pageSections.push(ps);
        }
      }
    }

    // Merge transition durations/easings
    if (src.transitionDurations) {
      for (const d of src.transitionDurations) {
        if (!merged.transitionDurations.includes(d)) merged.transitionDurations.push(d);
      }
    }
    if (src.transitionEasings) {
      for (const e of src.transitionEasings) {
        if (!merged.transitionEasings.includes(e)) merged.transitionEasings.push(e);
      }
    }
  }

  return merged;
}

function extractComponentTokens(comp: any, tokens: RawTokens): void {
  if (comp.jsxSnippet) {
    const hexMatches = comp.jsxSnippet.matchAll(/#([0-9a-fA-F]{3,6})\b/g);
    for (const m of hexMatches) {
      let hex = m[0].toLowerCase();
      if (hex.length === 4) {
        const [, r, g, b] = hex.split('');
        hex = `#${r}${r}${g}${g}${b}${b}`;
      }
      const existing = tokens.colors.find(c => c.value === hex);
      if (existing) {
        existing.frequency++;
      } else {
        tokens.colors.push({ value: hex, frequency: 1, source: 'component' });
      }
    }
  }
}

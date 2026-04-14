import * as fs from 'fs';
import * as path from 'path';
import * as archiver from 'archiver';
import { DesignProfile, ComponentInfo, ComponentCategory } from '../types';
import { FullAnimationResult } from '../types-ultra';
import { bundleFonts } from '../font-resolver';
import { generateDesignMd } from './design-md';

/**
 * Generate SKILL.md + references/DESIGN.md and package as .skill zip file.
 * @param screenshotPath - optional local path to homepage screenshot (relative to skillDir)
 * @param ultraResult - optional full animation/ultra data for embedding scroll journey
 */
export async function generateSkill(
  profile: DesignProfile,
  designMdContent: string,
  outputDir: string,
  screenshotPath?: string | null,
  ultraResult?: FullAnimationResult | null
): Promise<{ skillDir: string; skillFile: string }> {
  const safeName = profile.projectName.replace(/[^a-zA-Z0-9-_]/g, '-').toLowerCase();
  const skillDirName = `${safeName}-design`;
  const skillDir = path.join(outputDir, skillDirName);
  const refsDir = path.join(skillDir, 'references');

  fs.mkdirSync(refsDir, { recursive: true });

  // Bundle font files from Google Fonts API into the skill package
  let bundledFontCount = 0;
  const fontFamilies = profile.typography.map(t => t.fontFamily).filter(Boolean);
  if (fontFamilies.length > 0 || profile.fontSources.length > 0) {
    const usedWeights = new Set(profile.typography.map(t => String(t.fontWeight || '400')));
    const result = await bundleFonts(profile.fontSources, fontFamilies, skillDir, usedWeights);
    profile = { ...profile, fontSources: result.updatedSources };
    bundledFontCount = result.bundledCount;
  }

  // If fonts were bundled, regenerate DESIGN.md with local font paths
  const finalDesignMd = bundledFontCount > 0 ? generateDesignMd(profile, screenshotPath) : designMdContent;
  fs.writeFileSync(path.join(refsDir, 'DESIGN.md'), finalDesignMd, 'utf-8');

  // Generate SKILL.md — core content first, then embed all reference files inline
  let skillMd = generateSkillMd(profile, screenshotPath, ultraResult);
  skillMd += embedReferenceFiles(refsDir, skillDir);
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), skillMd, 'utf-8');

  // Write zip to PARENT dir first (avoids circular: zipping a folder that contains the zip being written)
  const skillFile = path.join(skillDir, `${skillDirName}.skill`);
  const tempZip = path.join(outputDir, `${skillDirName}.skill`);
  await createZip(skillDir, tempZip);
  // Move into skillDir (overwrite if already exists)
  fs.renameSync(tempZip, skillFile);

  return { skillDir, skillFile };
}

/**
 * Embed all reference files + token files inline into SKILL.md so that
 * when Claude Code loads the skill via /skills, it has the full design
 * system context without needing to read separate files.
 */
function embedReferenceFiles(refsDir: string, skillDir: string): string {
  let md = `\n---\n\n# Full Reference Files\n\n`;
  md += `> Every output file is embedded below. Claude has full design system context from /skills alone.\n\n`;

  // ── 1. Reference markdown files ────────────────────────────────────────
  const refFiles: Array<{ file: string; title: string }> = [
    { file: 'DESIGN.md',       title: 'Design System Tokens (DESIGN.md)' },
    { file: 'VISUAL_GUIDE.md', title: 'Visual Guide — Screenshots (VISUAL_GUIDE.md)' },
    { file: 'ANIMATIONS.md',   title: 'Animations & Motion (ANIMATIONS.md)' },
    { file: 'LAYOUT.md',       title: 'Layout & Grid (LAYOUT.md)' },
    { file: 'COMPONENTS.md',   title: 'Component Patterns (COMPONENTS.md)' },
    { file: 'INTERACTIONS.md', title: 'Interactions & States (INTERACTIONS.md)' },
  ];

  for (const { file, title } of refFiles) {
    const filePath = path.join(refsDir, file);
    if (!fs.existsSync(filePath)) continue;
    let content = fs.readFileSync(filePath, 'utf-8').trim();
    if (content.startsWith('---')) {
      const end = content.indexOf('---', 3);
      if (end !== -1) content = content.slice(end + 3).trim();
    }
    md += `## ${title}\n\n${content}\n\n`;
  }

  // ── 2. Token JSON files ─────────────────────────────────────────────────
  const tokensDir = path.join(skillDir, 'tokens');
  const tokenFiles = ['colors.json', 'spacing.json', 'typography.json'];
  const tokenSections: string[] = [];

  for (const tf of tokenFiles) {
    const p = path.join(tokensDir, tf);
    if (!fs.existsSync(p)) continue;
    tokenSections.push(`### tokens/${tf}\n\`\`\`json\n${fs.readFileSync(p, 'utf-8').trim()}\n\`\`\``);
  }

  if (tokenSections.length > 0) {
    md += `## Design Tokens — JSON Files\n\n${tokenSections.join('\n\n')}\n\n`;
  }

  // ── 3. Fonts inventory ──────────────────────────────────────────────────
  const fontsDir = path.join(skillDir, 'fonts');
  if (fs.existsSync(fontsDir)) {
    const fontFiles = fs.readdirSync(fontsDir).filter(f => /\.(woff2?|ttf|otf)$/i.test(f));
    if (fontFiles.length > 0) {
      md += `## Bundled Fonts (fonts/)\n\n`;
      md += `The following font files are bundled in the \`fonts/\` directory:\n\n`;
      for (const f of fontFiles) {
        md += `- \`fonts/${f}\`\n`;
      }
      md += `\nUse these local font files in \`@font-face\` declarations instead of fetching from Google Fonts.\n\n`;
    }
  }

  // ── 4. Screenshots inventory ────────────────────────────────────────────
  const screensDir = path.join(skillDir, 'screens');
  if (fs.existsSync(screensDir)) {
    md += `## Screenshots Inventory (screens/)\n\n`;
    md += `> Study all screenshots carefully before implementing any UI. Match every visual detail exactly.\n\n`;

    const screenSubDirs: Array<{ dir: string; label: string; desc: string }> = [
      { dir: 'scroll',    label: 'Scroll Journey',        desc: 'Cinematic scroll states — page visual at each scroll depth' },
      { dir: 'pages',     label: 'Full Page Screenshots', desc: 'Full-page screenshots of each crawled URL' },
      { dir: 'sections',  label: 'Section Clips',         desc: 'Clipped individual sections and components' },
      { dir: 'states',    label: 'Interaction States',    desc: 'Hover, focus, and active state captures' },
    ];

    for (const { dir, label, desc } of screenSubDirs) {
      const subDir = path.join(screensDir, dir);
      if (!fs.existsSync(subDir)) continue;
      const imgs = fs.readdirSync(subDir).filter(f => /\.(png|jpg|jpeg|webp)$/i.test(f)).sort();
      if (imgs.length === 0) continue;
      md += `### ${label} (screens/${dir}/)\n\n*${desc}*\n\n`;
      for (const img of imgs) {
        md += `![${img}](screens/${dir}/${img})\n\n`;
      }
    }

    // Also embed the screenshots index if it exists
    const indexPath = path.join(screensDir, 'INDEX.md');
    if (fs.existsSync(indexPath)) {
      const indexContent = fs.readFileSync(indexPath, 'utf-8').trim();
      md += `### Screenshot Index (screens/INDEX.md)\n\n${indexContent}\n\n`;
    }
  }

  // ── 5. Homepage screenshot ──────────────────────────────────────────────
  const ssDir = path.join(skillDir, 'screenshots');
  if (fs.existsSync(ssDir)) {
    const ssFiles = fs.readdirSync(ssDir).filter(f => /\.(png|jpg|jpeg|webp)$/i.test(f));
    if (ssFiles.length > 0) {
      md += `## Homepage Screenshots (screenshots/)\n\n`;
      for (const f of ssFiles) {
        md += `![${f}](screenshots/${f})\n\n`;
      }
    }
  }

  return md;
}

function generateSkillMd(profile: DesignProfile, screenshotPath?: string | null, ultraResult?: FullAnimationResult | null): string {
  const bg = profile.colors.find(c => c.role === 'background');
  const surface = profile.colors.find(c => c.role === 'surface');
  const accent = profile.colors.find(c => c.role === 'accent');
  const textPrimary = profile.colors.find(c => c.role === 'text-primary');
  const textMuted = profile.colors.find(c => c.role === 'text-muted');
  const border = profile.colors.find(c => c.role === 'border');
  const danger = profile.colors.find(c => c.role === 'danger');
  const success = profile.colors.find(c => c.role === 'success');
  const warning = profile.colors.find(c => c.role === 'warning');
  const allFonts = [...new Set(profile.typography.map(t => t.fontFamily))].filter(f => f);
  const displayFonts = allFonts.filter(f => !/mono|consolas|courier|fira code|jetbrains|sf mono|menlo/i.test(f));
  const fonts = allFonts; // Keep for backward compat
  const primaryFont = displayFonts[0] || allFonts[0] || 'sans-serif';
  const borderRadius = profile.borderRadius.filter(r => !r.includes('9999'));
  const commonRadius = borderRadius[Math.floor(borderRadius.length / 2)] || '8px';
  const traits = profile.designTraits;
  const theme = traits.isDark ? 'dark' : 'light';

  let md = '';

  const isUltra = !!(ultraResult && (ultraResult.scrollFrames.length > 0 || ultraResult.keyframes.length > 0));

  // ── Frontmatter ──────────────────────────────────────────────────────
  const ultraDesc = isUltra
    ? ` Includes ultra-mode visual journey: read references/ANIMATIONS.md, references/LAYOUT.md, references/COMPONENTS.md, and references/INTERACTIONS.md for full motion and layout details.`
    : '';
  md += `---
name: ${profile.projectName}-design
description: Design system skill for ${profile.projectName}. Activate when building UI components, pages, or any visual elements. Provides exact color tokens, typography scale, spacing grid, component patterns, and craft rules. Read references/DESIGN.md before writing any CSS or JSX.${ultraDesc}
---

`;

  // ── Header ───────────────────────────────────────────────────────────
  md += `# ${profile.projectName} Design System\n\n`;
  md += `You are building UI for **${profile.projectName}**. ${getAestheticSummary(profile)}\n\n`;

  // ── Visual Reference ─────────────────────────────────────────────────
  if (screenshotPath || isUltra) {
    md += `## Visual Reference\n\n`;
    md += `**IMPORTANT**: Study ALL screenshots below before writing any UI. Match colors, typography, spacing, layout, and motion exactly as shown.\n\n`;
    if (screenshotPath) {
      md += `### Homepage\n\n`;
      md += `![${profile.projectName} Homepage](${screenshotPath})\n\n`;
    }
    // Embed scroll journey frames
    if (isUltra && ultraResult!.scrollFrames.length > 0) {
      md += `### Scroll Journey (Cinematic Visual States)\n\n`;
      md += `> These screenshots capture the website at different scroll depths. The design changes dramatically as you scroll — each frame shows a different cinematic state. Replicate these exact visual transitions.\n\n`;
      for (const frame of ultraResult!.scrollFrames) {
        // Convert absolute path to relative path from skillDir
        const relPath = frame.filePath.replace(/\\/g, '/');
        const label = frame.scrollPercent === 0 ? 'Hero / Above the fold'
          : frame.scrollPercent === 100 ? 'Footer / End of page'
          : `Mid-page at ${frame.scrollPercent}% scroll`;
        md += `#### ${frame.scrollPercent}% — ${label}\n\n`;
        md += `![Scroll ${frame.scrollPercent}%](${relPath})\n\n`;
      }
    }
    // Embed video first frames
    if (isUltra && ultraResult!.videos.some(v => v.firstFramePath)) {
      md += `### Video Backgrounds (First Frames)\n\n`;
      for (const v of ultraResult!.videos.filter(vv => vv.firstFramePath)) {
        const relPath = v.firstFramePath!.replace(/\\/g, '/');
        md += `![Video ${v.index} (${v.role})](${relPath})\n\n`;
      }
    }
    md += `> Read \`references/DESIGN.md\` for full token details.`;
    if (isUltra) {
      md += ` Read \`references/ANIMATIONS.md\` for motion specs. Read \`references/LAYOUT.md\` for layout structure. Read \`references/COMPONENTS.md\` for component patterns.`;
    }
    md += `\n\n`;
  }

  // ── Ultra Reference Files Index ──────────────────────────────────────
  if (isUltra) {
    md += `## Ultra Reference Files\n\n`;
    md += `This package includes extended documentation. **Read these files before implementing:**\n\n`;
    md += `| File | Contents |\n`;
    md += `|------|----------|\n`;
    md += `| \`references/DESIGN.md\` | Full design system tokens, colors, typography, spacing |\n`;
    md += `| \`references/VISUAL_GUIDE.md\` | **START HERE** — Master visual guide with all screenshots embedded |\n`;
    md += `| \`references/ANIMATIONS.md\` | CSS keyframes, scroll triggers, motion library stack, video specs |\n`;
    md += `| \`references/LAYOUT.md\` | Flex/grid containers, page structure, spacing relationships |\n`;
    md += `| \`references/COMPONENTS.md\` | DOM component patterns, HTML structure, class fingerprints |\n`;
    md += `| \`references/INTERACTIONS.md\` | Hover/focus states with before/after style diffs |\n`;
    if (ultraResult!.scrollFrames.length > 0) {
      md += `| \`screens/scroll/\` | ${ultraResult!.scrollFrames.length} scroll journey screenshots showing cinematic states |\n`;
    }
    md += `\n`;
    // Animation stack summary
    if (ultraResult!.libraries.length > 0) {
      md += `### Animation Stack Detected\n\n`;
      for (const lib of ultraResult!.libraries) {
        md += `- **${lib.name}**${lib.version ? ` v${lib.version}` : ''} — ${lib.type}${lib.cdn ? ` ([CDN](${lib.cdn}))` : ''}\n`;
      }
      md += `\n`;
    }
  }

  // ── Section 1: Design Philosophy ─────────────────────────────────────
  md += `## Design Philosophy\n\n`;
  md += generateDesignPhilosophy(profile, fonts, primaryFont, traits);

  // ── Section 2: Color System ──────────────────────────────────────────
  md += `## Color System\n\n`;
  md += generateColorSystem(profile, bg, surface, accent, textPrimary, textMuted, border, danger, success, warning);

  // ── Section 3: Typography ────────────────────────────────────────────
  md += `## Typography\n\n`;
  md += generateTypographySection(profile, fonts, primaryFont);

  // ── Section 4: Spacing & Layout ──────────────────────────────────────
  md += `## Spacing & Layout\n\n`;
  md += generateSpacingSection(profile, commonRadius);

  // ── Section 5: Component Patterns ────────────────────────────────────
  md += `## Component Patterns\n\n`;
  md += generateComponentPatterns(profile, bg, surface, accent, textPrimary, textMuted, border, commonRadius);

  // ── Section 5b: Page Sections (URL mode) ─────────────────────────────
  if (profile.pageSections.length > 0) {
    md += `## Page Structure\n\n`;
    md += `The following page sections were detected:\n\n`;
    for (const section of profile.pageSections) {
      md += `- **${section.type.charAt(0).toUpperCase() + section.type.slice(1)}** — ${section.description}`;
      if (section.childCount > 0) md += ` (${section.childCount} items)`;
      md += `\n`;
    }
    md += `\nWhen building pages, follow this section order and structure.\n\n`;
  }

  // ── Section 6: Animation & Motion ────────────────────────────────────
  // Always output motion section — use extracted tokens or defaults
  md += `## Animation & Motion\n\n`;
  md += generateAnimationSection(profile);

  // ── Section 7: Dark Mode ─────────────────────────────────────────────
  if (traits.hasDarkMode && profile.darkModeVars.length > 0) {
    md += `## Dark Mode\n\n`;
    md += generateDarkModeSection(profile);
  }

  // ── Section 8: Depth & Elevation ─────────────────────────────────────
  md += `## Depth & Elevation\n\n`;
  md += generateElevationSection(profile, traits, surface, bg);

  // ── Section 9: Anti-Patterns ─────────────────────────────────────────
  md += `## Anti-Patterns (Never Do)\n\n`;
  md += generateAntiPatterns(profile, fonts, traits);

  // ── Section 10: Workflow ─────────────────────────────────────────────
  md += `## Workflow\n\n`;
  md += generateWorkflow(profile, fonts);

  // ── Section 10b: Brand Spec ───────────────────────────────────────────
  md += `## Brand Spec\n\n`;
  if (profile.favicon) {
    md += `- **Favicon:** \`${profile.favicon}\`\n`;
  }
  if (profile.siteUrl) {
    md += `- **Site URL:** \`${profile.siteUrl}\`\n`;
  }
  const brandColor = accent;
  if (brandColor?.hex) {
    md += `- **Brand color:** \`${brandColor.hex}\`\n`;
  }
  const primaryFontForBrand = profile.typography.find(t => t.fontFamily && !/(mono|dm mono|consolas|courier)/i.test(t.fontFamily));
  if (primaryFontForBrand?.fontFamily) {
    md += `- **Brand typeface:** ${primaryFontForBrand.fontFamily}\n`;
  }
  md += `\n`;

  // ── Section 11: Quick Reference Table ────────────────────────────────
  md += `## Quick Reference\n\n`;
  md += generateQuickReference(profile, bg, surface, accent, textPrimary, textMuted, border, primaryFont, commonRadius);

  // ── Section 12: When to Trigger ──────────────────────────────────────
  md += `## When to Trigger\n\n`;
  md += `Activate this skill when:\n`;
  md += `- Creating new components, pages, or visual elements for ${profile.projectName}\n`;
  md += `- Writing CSS, Tailwind classes, styled-components, or inline styles\n`;
  md += `- Building page layouts, templates, or responsive designs\n`;
  md += `- Reviewing UI code for design consistency\n`;
  md += `- The user mentions "${profile.projectName}" design, style, UI, or theme\n`;
  md += `- Generating mockups, wireframes, or visual prototypes\n`;

  return md;
}

// ── Section Generators ─────────────────────────────────────────────────

function generateDesignPhilosophy(
  profile: DesignProfile,
  fonts: string[],
  primaryFont: string,
  traits: DesignProfile['designTraits']
): string {
  let s = '';

  // Core principles
  if (traits.isDark && !traits.hasShadows) {
    s += `- **Flat elevation** — depth through color shifts and borders, never shadows. Surfaces get progressively lighter to indicate elevation.\n`;
  } else if (traits.hasShadows) {
    s += `- **Layered depth** — use shadow tokens to create a sense of physical layering. Each elevation level has a specific shadow.\n`;
  }

  if (!traits.hasGradients) {
    s += `- **Solid colors only** — no gradients anywhere. Every surface is a single flat color.\n`;
  } else {
    s += `- **Gradient accents** — gradients are used thoughtfully for emphasis, not decoration.\n`;
  }

  const displayFonts = fonts.filter(f => !/mono|consolas|courier|fira code|jetbrains|sf mono|menlo/i.test(f));
  if (displayFonts.length === 1) {
    s += `- **Single typeface** — ${primaryFont} carries all text. Hierarchy comes from size, weight, and color — never font mixing.\n`;
  } else if (displayFonts.length >= 2) {
    s += `- **Type pairing** — ${displayFonts[0]} for body/UI text, ${displayFonts[1]} for headings/display. Never introduce a third typeface.\n`;
  }

  s += `- **${traits.density} density** — ${profile.spacing.base}px base grid. Every dimension is a multiple of ${profile.spacing.base}.\n`;
  s += `- **${traits.primaryColorTemp} palette** — the color temperature runs ${traits.primaryColorTemp}, matching the ${traits.fontStyle} typography.\n`;

  const accentColor = profile.colors.find(c => c.role === 'accent');
  if (accentColor) {
    s += `- **Restrained accent** — \`${accentColor.hex}\` is the only pop of color. Used exclusively for CTAs, links, focus rings, and active states.\n`;
  }

  if (traits.motionStyle === 'expressive') {
    s += `- **Expressive motion** — animations are an integral part of the experience. Use spring physics and layout animations.\n`;
  } else if (traits.motionStyle === 'subtle') {
    s += `- **Subtle motion** — transitions smooth state changes. Keep durations under 300ms, use ease-out curves.\n`;
  } else {
    s += `- **Minimal motion** — prefer instant state changes. Only use transitions for loading and page transitions.\n`;
  }

  if (profile.iconLibrary) {
    s += `- **${profile.iconLibrary} icons** — use ${profile.iconLibrary} for all iconography. Do not mix icon libraries.\n`;
  }

  s += '\n';
  return s;
}

function generateColorSystem(
  profile: DesignProfile,
  bg: any, surface: any, accent: any, textPrimary: any, textMuted: any,
  border: any, danger: any, success: any, warning: any
): string {
  let s = '';

  s += `### Core Palette\n\n`;
  s += `| Role | Token | Hex | Use |\n`;
  s += `|------|-------|-----|-----|\n`;

  if (bg) s += `| Background | \`--background\` | \`${bg.hex}\` | Page/app background |\n`;
  if (surface) s += `| Surface | \`--surface\` | \`${surface.hex}\` | Cards, panels, modals |\n`;
  if (textPrimary) s += `| Text Primary | \`--text-primary\` | \`${textPrimary.hex}\` | Headings, body text |\n`;
  if (textMuted) s += `| Text Muted | \`--text-muted\` | \`${textMuted.hex}\` | Captions, placeholders |\n`;
  if (accent) s += `| Accent | \`--accent\` | \`${accent.hex}\` | CTAs, links, focus rings |\n`;
  if (border) s += `| Border | \`--border\` | \`${border.hex}\` | Dividers, card borders |\n`;

  s += '\n';

  // Status colors
  if (danger || success || warning) {
    s += `### Status Colors\n\n`;
    s += `| Status | Hex | Use |\n`;
    s += `|--------|-----|-----|\n`;
    if (success) s += `| Success | \`${success.hex}\` | Confirmations, positive trends |\n`;
    if (warning) s += `| Warning | \`${warning.hex}\` | Caution states, pending items |\n`;
    if (danger) s += `| Danger | \`${danger.hex}\` | Errors, destructive actions |\n`;
    s += '\n';
  }

  // Additional palette colors — with usage context for named tokens
  const extraColors = profile.colors.filter(c =>
    c.role === 'unknown' || c.role === 'info'
  ).slice(0, 8);

  if (extraColors.length > 0) {
    s += `### Extended Palette\n\n`;
    for (const c of extraColors) {
      const usage = guessExtendedColorUsage(c.name || '', c.hex);
      s += `- ${c.name ? `**${c.name}:** ` : ''}\`${c.hex}\`${usage ? ` — ${usage}` : ''}\n`;
    }
    s += '\n';
  }

  // CSS variable tokens subsection — filter out Tailwind internal/utility vars
  const colorVars = profile.cssVariables.filter(v =>
    /foreground|background|primary|secondary|muted|accent|destructive|border|card|popover/i.test(v.name) &&
    v.value.length < 40 &&
    !/^--tw-|^--vt-|^--un-/i.test(v.name)  // exclude Tailwind, UnoCSS, Vite internals
  );

  if (colorVars.length > 0) {
    s += `### CSS Variable Tokens\n\n`;
    s += `\`\`\`css\n`;
    for (const v of colorVars.slice(0, 20)) {
      s += `${v.name}: ${v.value};\n`;
    }
    s += `\`\`\`\n\n`;
  }

  return s;
}

function generateTypographySection(
  profile: DesignProfile,
  fonts: string[],
  primaryFont: string
): string {
  let s = '';

  s += `### Font Stack\n\n`;
  for (const font of fonts) {
    const roles = profile.typography.filter(t => t.fontFamily === font).map(t => formatRole(t.role));
    s += `- **${font}** — ${roles.join(', ')}\n`;
  }
  s += '\n';

  // Font sources (@font-face declarations)
  if (profile.fontSources.length > 0) {
    s += `### Font Sources\n\n`;
    s += `\`\`\`css\n`;
    // Group by family, pick best format (prefer woff2)
    const families = [...new Set(profile.fontSources.map(fs => fs.family))];
    // Collect weights actually used in the type scale
    const usedWeights = new Set(profile.typography.map(t => t.fontWeight || '400'));
    usedWeights.add('400'); // always include regular
    usedWeights.add('700'); // always include bold
    for (const family of families) {
      const sources = profile.fontSources.filter(fs => fs.family === family);
      // Pick best source per weight, but limit to key weights
      const byWeight = new Map<string, typeof sources[0]>();
      // Check for variable fonts first — they cover all weights in one file
      const variableSource = sources.find(s => s.weight === 'variable');
      if (variableSource) {
        s += `@font-face {\n`;
        s += `  font-family: "${family}";\n`;
        s += `  src: url("${variableSource.src}")${variableSource.format ? ` format("${variableSource.format}")` : ''};\n`;
        s += `  font-weight: 100 900;\n`;
        s += `}\n`;
      } else {
        for (const src of sources) {
          const w = src.weight || '400';
          // Only include weights used in type scale, or standard 400/700
          if (!usedWeights.has(w)) continue;
          const existing = byWeight.get(w);
          if (!existing || (src.format === 'woff2' && existing.format !== 'woff2')) {
            byWeight.set(w, src);
          }
        }
        // If no weights matched (all non-standard), fall back to first available
        if (byWeight.size === 0 && sources.length > 0) {
          byWeight.set(sources[0].weight || '400', sources[0]);
        }
        for (const [weight, src] of byWeight) {
          s += `@font-face {\n`;
          s += `  font-family: "${family}";\n`;
          s += `  src: url("${src.src}")${src.format ? ` format("${src.format}")` : ''};\n`;
          s += `  font-weight: ${weight};\n`;
          s += `}\n`;
        }
      }
    }
    s += `\`\`\`\n\n`;
  }

  s += `### Type Scale\n\n`;
  s += `| Role | Family | Size | Weight |\n`;
  s += `|------|--------|------|--------|\n`;
  for (const t of profile.typography) {
    s += `| ${formatRole(t.role)} | ${t.fontFamily} | ${t.fontSize || 'inherit'} | ${t.fontWeight || 'inherit'} |\n`;
  }
  s += '\n';

  s += `### Typography Rules\n\n`;
  const dispFonts = fonts.filter(f => !/mono|consolas|courier|fira code|jetbrains|sf mono|menlo/i.test(f));
  if (dispFonts.length <= 1) {
    s += `- All text uses **${primaryFont}** — never add another font family\n`;
  } else {
    s += `- Body/UI: **${dispFonts[0]}**, Headings: **${dispFonts[1]}** — these are the only display fonts\n`;
  }
  s += `- Max 3-4 font sizes per screen\n`;
  s += `- Headings: weight 600-700, body: weight 400\n`;
  s += `- Use color and opacity for text hierarchy, not additional font sizes\n`;
  s += `- Line height: 1.5 for body, 1.2 for headings\n\n`;

  return s;
}

function generateSpacingSection(profile: DesignProfile, commonRadius: string): string {
  const sp = profile.spacing;
  let s = '';

  s += `### Base Grid: ${sp.base}px\n\n`;
  s += `Every dimension (margin, padding, gap, width, height) must be a multiple of **${sp.base}px**.\n\n`;

  s += `### Spacing Scale\n\n`;
  s += `\`${sp.values.slice(0, 12).join(', ')}\` px\n\n`;

  s += `### Spacing as Meaning\n\n`;
  s += `| Spacing | Use |\n`;
  s += `|---------|-----|\n`;
  if (sp.base <= 4) {
    s += `| ${sp.base}-${sp.base * 2}px | Tight: related items (icon + label, avatar + name) |\n`;
    s += `| ${sp.base * 3}-${sp.base * 4}px | Medium: between groups within a section |\n`;
    s += `| ${sp.base * 6}-${sp.base * 8}px | Wide: between distinct sections |\n`;
    s += `| ${sp.base * 12}px+ | Vast: major page section breaks |\n`;
  } else {
    s += `| ${sp.base / 2}-${sp.base}px | Tight: related items within a group |\n`;
    s += `| ${sp.base * 2}px | Medium: between groups |\n`;
    s += `| ${sp.base * 3}-${sp.base * 4}px | Wide: between sections |\n`;
    s += `| ${sp.base * 6}px+ | Vast: major section breaks |\n`;
  }
  s += '\n';

  // Border radius
  s += `### Border Radius\n\n`;
  const radii = profile.borderRadius.filter(r => !r.includes('9999'));
  if (radii.length > 0) {
    s += `Scale: \`${radii.join(', ')}\`\n`;
    s += `Default: \`${commonRadius}\`\n\n`;
  } else {
    s += `Default: \`${commonRadius}\`\n\n`;
  }

  // Container
  if (profile.containerMaxWidth) {
    s += `### Container\n\n`;
    s += `Max-width: \`${profile.containerMaxWidth}\`, centered with auto margins.\n\n`;
  }

  // Breakpoints
  if (profile.breakpoints.length > 0) {
    s += `### Breakpoints\n\n`;
    s += `| Name | Value |\n`;
    s += `|------|-------|\n`;
    for (const bp of profile.breakpoints) {
      s += `| ${bp.name} | ${bp.value} |\n`;
    }
    s += '\nMobile-first: design for small screens, layer on responsive overrides.\n\n';
  }

  return s;
}

function generateComponentPatterns(
  profile: DesignProfile,
  bg: any, surface: any, accent: any, textPrimary: any, textMuted: any,
  border: any, commonRadius: string
): string {
  let s = '';
  const sp = profile.spacing;
  const hasColors = profile.colors.length > 0;

  // Helper: output a real hex color. When token is missing, derive a sensible
  // fallback from the actual extracted palette rather than an unresolved var() ref.
  const col = (token: any, role?: string): string => {
    if (token?.hex) return token.hex;
    if (role === 'text-muted') {
      // Derive muted text from text-primary dimmed to ~55%
      if (textPrimary?.hex) {
        const r = parseInt(textPrimary.hex.slice(1, 3), 16);
        const g = parseInt(textPrimary.hex.slice(3, 5), 16);
        const b = parseInt(textPrimary.hex.slice(5, 7), 16);
        const dim = (v: number) => Math.round(v * 0.55).toString(16).padStart(2, '0');
        return `#${dim(r)}${dim(g)}${dim(b)}`;
      }
      return profile.designTraits.isDark ? '#888888' : '#6b7280';
    }
    if (role === 'surface') return bg?.hex || (profile.designTraits.isDark ? '#1a1a1a' : '#f9fafb');
    return profile.designTraits.isDark ? '#444444' : '#cccccc';
  };

  // Card
  s += `### Card\n\n`;
  s += `\`\`\`css\n`;
  s += `.card {\n`;
  s += `  background: ${col(surface || bg, 'surface')};\n`;
  if (border) s += `  border: 1px solid ${border.hex};\n`;
  s += `  border-radius: ${commonRadius};\n`;
  s += `  padding: ${pickSpacing(sp, 4)}px;\n`;
  if (profile.designTraits.hasShadows && profile.shadows.length > 0) {
    const cardShadow = profile.shadows.find(s => s.level === 'raised') || profile.shadows[0];
    s += `  box-shadow: ${cardShadow.value};\n`;
  }
  s += `}\n`;
  s += `\`\`\`\n\n`;
  s += `\`\`\`html\n`;
  s += `<div class="card">\n`;
  s += `  <h3>Card Title</h3>\n`;
  s += `  <p>Card content goes here.</p>\n`;
  s += `</div>\n`;
  s += `\`\`\`\n\n`;

  // Button
  s += `### Button\n\n`;
  s += `\`\`\`css\n`;
  s += `/* Primary */\n`;
  s += `.btn-primary {\n`;
  s += `  background: ${col(accent, 'accent')};\n`;
  s += `  color: ${col(textPrimary, 'text-on-accent')};\n`;
  s += `  border-radius: ${commonRadius};\n`;
  s += `  padding: ${pickSpacing(sp, 2)}px ${pickSpacing(sp, 4)}px;\n`;
  s += `  font-weight: 500;\n`;
  s += `  transition: opacity 150ms ease;\n`;
  s += `}\n`;
  s += `.btn-primary:hover { opacity: 0.9; }\n\n`;
  s += `/* Ghost */\n`;
  s += `.btn-ghost {\n`;
  s += `  background: transparent;\n`;
  if (border) s += `  border: 1px solid ${border.hex};\n`;
  else s += `  border: 1px solid ${col(null, 'border')};\n`;
  s += `  color: ${col(textPrimary, 'text-primary')};\n`;
  s += `  border-radius: ${commonRadius};\n`;
  s += `  padding: ${pickSpacing(sp, 2)}px ${pickSpacing(sp, 4)}px;\n`;
  s += `}\n`;
  s += `\`\`\`\n\n`;
  s += `\`\`\`html\n`;
  s += `<button class="btn-primary">Get Started</button>\n`;
  s += `<button class="btn-ghost">Learn More</button>\n`;
  s += `\`\`\`\n\n`;

  // Input
  s += `### Input\n\n`;
  s += `\`\`\`css\n`;
  s += `.input {\n`;
  s += `  background: ${col(bg, 'background')};\n`;
  if (border) s += `  border: 1px solid ${border.hex};\n`;
  else s += `  border: 1px solid ${col(null, 'border')};\n`;
  s += `  border-radius: ${commonRadius};\n`;
  s += `  padding: ${pickSpacing(sp, 2)}px ${pickSpacing(sp, 3)}px;\n`;
  s += `  color: ${col(textPrimary, 'text-primary')};\n`;
  s += `  font-size: 14px;\n`;
  s += `}\n`;
  if (accent) s += `.input:focus { border-color: ${accent.hex}; outline: none; }\n`;
  else s += `.input:focus { border-color: var(--accent); outline: none; }\n`;
  s += `\`\`\`\n\n`;
  s += `\`\`\`html\n`;
  s += `<input class="input" type="text" placeholder="Search..." />\n`;
  s += `\`\`\`\n\n`;

  // Badge
  s += `### Badge / Chip\n\n`;
  s += `\`\`\`css\n`;
  s += `.badge {\n`;
  s += `  display: inline-flex;\n`;
  s += `  align-items: center;\n`;
  s += `  padding: ${pickSpacing(sp, 1)}px ${pickSpacing(sp, 2)}px;\n`;
  s += `  border-radius: 9999px;\n`;
  s += `  font-size: 12px;\n`;
  s += `  font-weight: 500;\n`;
  s += `  background: ${col(surface, 'surface')};\n`;
  s += `  color: ${col(textMuted, 'text-muted')};\n`;
  s += `}\n`;
  s += `\`\`\`\n\n`;
  s += `\`\`\`html\n`;
  s += `<span class="badge">New</span>\n`;
  s += `<span class="badge">Beta</span>\n`;
  s += `\`\`\`\n\n`;

  // Modal
  s += `### Modal / Dialog\n\n`;
  s += `\`\`\`css\n`;
  s += `.modal-backdrop { background: rgba(0, 0, 0, 0.6); }\n`;
  s += `.modal {\n`;
  s += `  background: ${col(surface || bg, 'surface')};\n`;
  if (border) s += `  border: 1px solid ${border.hex};\n`;
  s += `  border-radius: ${getRadius(profile, 'xl')};\n`;
  s += `  padding: ${pickSpacing(sp, 6)}px;\n`;
  s += `  max-width: 480px;\n`;
  s += `  width: 90vw;\n`;
  if (profile.designTraits.hasShadows && profile.shadows.length > 0) {
    const modalShadow = profile.shadows.find(s => s.level === 'overlay' || s.level === 'floating') || profile.shadows[profile.shadows.length - 1];
    s += `  box-shadow: ${modalShadow.value};\n`;
  }
  s += `}\n`;
  s += `\`\`\`\n\n`;
  s += `\`\`\`html\n`;
  s += `<div class="modal-backdrop">\n`;
  s += `  <div class="modal">\n`;
  s += `    <h2>Dialog Title</h2>\n`;
  s += `    <p>Dialog content.</p>\n`;
  s += `    <button class="btn-primary">Confirm</button>\n`;
  s += `    <button class="btn-ghost">Cancel</button>\n`;
  s += `  </div>\n`;
  s += `</div>\n`;
  s += `\`\`\`\n\n`;

  // Table
  s += `### Table\n\n`;
  s += `\`\`\`css\n`;
  s += `.table { width: 100%; border-collapse: collapse; }\n`;
  s += `.table th {\n`;
  s += `  text-align: left;\n`;
  s += `  padding: ${pickSpacing(sp, 2)}px ${pickSpacing(sp, 3)}px;\n`;
  s += `  font-weight: 500;\n`;
  s += `  font-size: 12px;\n`;
  s += `  color: ${col(textMuted, 'text-muted')};\n`;
  s += `  text-transform: uppercase;\n`;
  s += `  letter-spacing: 0.05em;\n`;
  if (border) s += `  border-bottom: 1px solid ${border.hex};\n`;
  else s += `  border-bottom: 1px solid ${col(null, 'border')};\n`;
  s += `}\n`;
  s += `.table td {\n`;
  s += `  padding: ${pickSpacing(sp, 3)}px;\n`;
  if (border) s += `  border-bottom: 1px solid ${border.hex};\n`;
  else s += `  border-bottom: 1px solid ${col(null, 'border')};\n`;
  s += `}\n`;
  s += `\`\`\`\n\n`;
  s += `\`\`\`html\n`;
  s += `<table class="table">\n`;
  s += `  <thead><tr><th>Name</th><th>Status</th><th>Date</th></tr></thead>\n`;
  s += `  <tbody>\n`;
  s += `    <tr><td>Item One</td><td>Active</td><td>Jan 1</td></tr>\n`;
  s += `    <tr><td>Item Two</td><td>Pending</td><td>Jan 2</td></tr>\n`;
  s += `  </tbody>\n`;
  s += `</table>\n`;
  s += `\`\`\`\n\n`;

  // Navigation
  s += `### Navigation\n\n`;
  s += `\`\`\`css\n`;
  s += `.nav {\n`;
  s += `  display: flex;\n`;
  s += `  align-items: center;\n`;
  s += `  gap: ${pickSpacing(sp, 2)}px;\n`;
  s += `  padding: ${pickSpacing(sp, 3)}px ${pickSpacing(sp, 4)}px;\n`;
  if (border) s += `  border-bottom: 1px solid ${border.hex};\n`;
  s += `}\n`;
  s += `.nav-link {\n`;
  s += `  color: ${col(textMuted, 'text-muted')};\n`;
  s += `  padding: ${pickSpacing(sp, 2)}px ${pickSpacing(sp, 3)}px;\n`;
  s += `  border-radius: ${commonRadius};\n`;
  s += `  transition: color 150ms;\n`;
  s += `}\n`;
  if (textPrimary) s += `.nav-link:hover { color: ${textPrimary.hex}; }\n`;
  if (accent) s += `.nav-link.active { color: ${accent.hex}; }\n`;
  s += `\`\`\`\n\n`;
  s += `\`\`\`html\n`;
  s += `<nav class="nav">\n`;
  s += `  <a href="/" class="nav-link active">Home</a>\n`;
  s += `  <a href="/about" class="nav-link">About</a>\n`;
  s += `  <a href="/pricing" class="nav-link">Pricing</a>\n`;
  s += `  <button class="btn-primary" style="margin-left: auto">Get Started</button>\n`;
  s += `</nav>\n`;
  s += `\`\`\`\n\n`;

  // If we have actual extracted components, show the top ones
  const significantComponents = profile.components
    .filter(c => c.variants.length > 0 || c.props.length > 3 || c.cssClasses.length > 5)
    .slice(0, 10);

  if (significantComponents.length > 0) {
    s += `### Extracted Components\n\n`;
    s += `These components were found in the codebase:\n\n`;
    for (const comp of significantComponents) {
      s += `**${comp.name}** (\`${comp.filePath}\`)\n`;
      if (comp.variants.length > 0) s += `- Variants: ${comp.variants.map(v => `\`${v}\``).join(', ')}\n`;
      if (comp.props.length > 0) s += `- Props: ${comp.props.slice(0, 6).map(p => `\`${p}\``).join(', ')}\n`;

      const keyStyles = getKeyStyles(comp);
      if (keyStyles.length > 0) s += `- Styles: ${keyStyles.join(', ')}\n`;
      s += '\n';
    }
  }

  return s;
}

function generateAnimationSection(profile: DesignProfile): string {
  let s = '';

  if (profile.designTraits.motionStyle === 'expressive') {
    s += `This project uses **expressive motion**. Animations are part of the design language.\n\n`;
  } else {
    s += `This project uses **subtle motion**. Transitions smooth state changes without calling attention.\n\n`;
  }

  // Framer Motion patterns
  const hasFramerMotion = profile.animations.some(a => a.type === 'framer-motion');
  if (hasFramerMotion) {
    s += `### Framer Motion\n\n`;
    s += `\`\`\`tsx\n`;
    s += `// Standard enter animation\n`;
    s += `<motion.div\n`;
    s += `  initial={{ opacity: 0, y: 8 }}\n`;
    s += `  animate={{ opacity: 1, y: 0 }}\n`;
    s += `  transition={{ duration: 0.3, ease: "easeOut" }}\n`;
    s += `/>\n\n`;
    s += `// List stagger\n`;
    s += `const container = { hidden: {}, show: { transition: { staggerChildren: 0.05 } } }\n`;
    s += `const item = { hidden: { opacity: 0, y: 8 }, show: { opacity: 1, y: 0 } }\n`;
    s += `\`\`\`\n\n`;

    // Spring configs if detected
    const springs = profile.animations.filter(a => a.type === 'spring');
    if (springs.length > 0) {
      s += `### Spring Configs\n\n`;
      for (const sp of springs.slice(0, 3)) {
        s += `\`\`\`\n${sp.value}\n\`\`\`\n`;
      }
      s += '\n';
    }
  }

  // CSS keyframes
  const keyframes = profile.animations.filter(a => a.type === 'css-keyframe');
  if (keyframes.length > 0) {
    s += `### CSS Animations\n\n`;
    for (const kf of keyframes.slice(0, 5)) {
      s += `- \`${kf.name}\`\n`;
    }
    s += '\n';
  }

  // Motion tokens — real extracted values
  const mt = profile.motionTokens;
  if (mt.durations.length > 0 || mt.easings.length > 0) {
    s += `### Motion Tokens\n\n`;
    if (mt.durations.length > 0) {
      s += `- **Duration scale:** ${mt.durations.map(d => `\`${d}\``).join(', ')}\n`;
    }
    if (mt.easings.length > 0) {
      s += `- **Easing functions:** ${mt.easings.map(e => `\`${e}\``).join(', ')}\n`;
    }
    if (mt.properties.length > 0) {
      s += `- **Animated properties:** ${mt.properties.map(p => `\`${p}\``).join(', ')}\n`;
    }
    s += '\n';
  }

  s += `### Motion Guidelines\n\n`;
  if (mt.durations.length > 0) {
    s += `- **Duration:** Use values from the duration scale above. Short (${mt.durations[0]}) for micro-interactions, long (${mt.durations[mt.durations.length - 1]}) for page transitions\n`;
  } else {
    s += `- **Duration:** 150-300ms for micro-interactions, 300-500ms for page transitions\n`;
  }
  if (mt.easings.length > 0) {
    s += `- **Easing:** Use \`${mt.easings[0]}\` as the default easing curve\n`;
  } else {
    s += `- **Easing:** \`ease-out\` for enters, \`ease-in\` for exits\n`;
  }
  s += `- **Direction:** Elements enter from bottom/right, exit to top/left\n`;
  s += `- **Reduced motion:** Always respect \`prefers-reduced-motion\` — disable animations when set\n\n`;

  return s;
}

function generateDarkModeSection(profile: DesignProfile): string {
  let s = '';

  s += `This project supports **light and dark mode** via CSS variables.\n\n`;

  s += `### Token Mapping\n\n`;
  s += `| Variable | Light | Dark |\n`;
  s += `|----------|-------|------|\n`;
  for (const dmv of profile.darkModeVars.slice(0, 15)) {
    s += `| \`${dmv.variable}\` | \`${dmv.lightValue}\` | \`${dmv.darkValue}\` |\n`;
  }

  s += `\n### Implementation\n\n`;
  s += `- Toggle via \`.dark\` class on \`<html>\` or \`[data-theme="dark"]\`\n`;
  s += `- Always use CSS variables for colors — never hardcode hex values\n`;
  s += `- Test both modes for contrast and readability\n\n`;

  return s;
}

function generateElevationSection(
  profile: DesignProfile,
  traits: DesignProfile['designTraits'],
  surface: any,
  bg: any
): string {
  let s = '';

  if (!traits.hasShadows) {
    s += `This design uses **flat elevation** — no box-shadows anywhere.\n\n`;
    s += `### Elevation Strategy\n\n`;
    s += `| Level | Technique | Use |\n`;
    s += `|-------|-----------|-----|\n`;
    s += `| 0 — Base | Background color | Page background |\n`;
    s += `| 1 — Raised | Lighter surface + subtle border | Cards, panels |\n`;
    s += `| 2 — Floating | Even lighter surface + stronger border | Dropdowns, popovers |\n`;
    s += `| 3 — Overlay | Backdrop + modal surface | Modals, dialogs |\n\n`;
  } else {
    s += `### Shadow Tokens\n\n`;
    const levelNames: Record<string, string> = {
      flat: 'Subtle',
      raised: 'Raised (cards, buttons)',
      floating: 'Floating (dropdowns, popovers)',
      overlay: 'Overlay (modals, dialogs)',
    };

    for (const shadow of profile.shadows.slice(0, 6)) {
      const label = shadow.name ? `**${shadow.name}** (${levelNames[shadow.level] || shadow.level})` : levelNames[shadow.level] || shadow.level;
      s += `- ${label}: \`${shadow.value}\`\n`;
    }
    s += '\n';
  }

  // z-index scale
  if (profile.zIndexScale.length > 0) {
    s += `### Z-Index Scale\n\n`;
    s += `\`${profile.zIndexScale.join(', ')}\`\n\n`;
    s += `Use these exact values — never invent z-index values.\n\n`;
  }

  return s;
}

function generateAntiPatterns(
  profile: DesignProfile,
  fonts: string[],
  traits: DesignProfile['designTraits']
): string {
  let s = '';

  // Core anti-patterns from traits
  if (!traits.hasShadows) s += `- **No box-shadow** on any element — use borders and surface colors for depth\n`;
  if (!traits.hasGradients) s += `- **No gradients** — solid colors only, everywhere\n`;
  if (profile.antiPatterns.includes('no-blur')) s += `- **No blur effects** — no backdrop-blur, no filter: blur()\n`;
  if (profile.antiPatterns.includes('no-zebra-striping')) s += `- **No zebra striping** — tables and lists use borders for separation\n`;

  // Color discipline
  s += `- **No invented colors** — every hex value must come from the palette above\n`;
  s += `- **No arbitrary spacing** — every dimension is a multiple of ${profile.spacing.base}px\n`;

  // Font discipline
  if (fonts.length > 0) {
    const monoFont = fonts.find(f => /mono|consolas|courier|fira code|jetbrains|sf mono|menlo/i.test(f));
    const dFonts = fonts.filter(f => !/mono|consolas|courier|fira code|jetbrains|sf mono|menlo/i.test(f));
    const fontList = [...dFonts, ...(monoFont ? [monoFont] : [])].join(' and ');
    s += `- **No extra fonts** — only ${fontList} are allowed\n`;
  }

  // Border radius discipline — only show px/rem values, cap at 10 entries
  const cleanRadii = profile.borderRadius
    .filter(r => !r.includes('9999') && !r.includes('%') && !/^(inherit|initial|unset|revert)$/.test(r))
    .filter(r => /^[\d.]+(px|rem|em)?$/.test(r.trim()))
    .slice(0, 10);
  if (cleanRadii.length > 0) {
    s += `- **No arbitrary border-radius** — use the scale: ${cleanRadii.join(', ')}\n`;
  }

  // Opacity anti-pattern
  s += `- **No opacity for disabled states** — use muted colors instead\n`;

  // If project has specific patterns
  if (!traits.hasRoundedFull) {
    s += `- **No pill shapes** — this design doesn't use rounded-full / 9999px radius\n`;
  }

  s += '\n';
  return s;
}

function generateWorkflow(profile: DesignProfile, fonts: string[]): string {
  let s = '';

  s += `1. **Read** \`references/DESIGN.md\` before writing any UI code\n`;
  s += `2. **Pick colors** from the Color System section — never invent new ones\n`;
  s += `3. **Set typography** — ${fonts.length > 0 ? fonts.join(', ') : 'project font'} only, using the type scale\n`;
  s += `4. **Build layout** on the ${profile.spacing.base}px grid — check every margin, padding, gap\n`;
  s += `5. **Match components** to patterns above before creating new ones\n`;
  s += `6. **Apply elevation** — ${profile.designTraits.hasShadows ? 'use shadow tokens' : 'flat, surface color shifts only'}\n`;
  s += `7. **Validate** — every value traces back to a design token. No magic numbers.\n\n`;

  return s;
}

function generateQuickReference(
  profile: DesignProfile,
  bg: any, surface: any, accent: any, textPrimary: any, textMuted: any,
  border: any, primaryFont: string, commonRadius: string
): string {
  let s = '';

  s += `\`\`\`\n`;
  s += `Background:     ${bg?.hex || '(not extracted)'}\n`;
  s += `Surface:        ${surface?.hex || '(not extracted)'}\n`;
  s += `Text:           ${textPrimary?.hex || '(not extracted)'} / ${textMuted?.hex || '(not extracted)'}\n`;
  s += `Accent:         ${accent?.hex || '(not extracted)'}\n`;
  s += `Border:         ${border?.hex || '(not extracted)'}\n`;
  s += `Font:           ${primaryFont}\n`;
  s += `Spacing:        ${profile.spacing.base}px grid\n`;
  s += `Radius:         ${commonRadius}\n`;

  const frameworkList = profile.frameworks.map(f => f.name).join(', ');
  if (frameworkList) s += `Frameworks:     ${frameworkList}\n`;
  if (profile.iconLibrary) s += `Icons:          ${profile.iconLibrary}\n`;
  if (profile.stateLibrary) s += `State:          ${profile.stateLibrary}\n`;

  s += `Components:     ${profile.components.length} detected\n`;
  s += `\`\`\`\n\n`;

  return s;
}

// ── Helpers ────────────────────────────────────────────────────────────

function getAestheticSummary(profile: DesignProfile): string {
  const traits = profile.designTraits;
  const fonts = [...new Set(profile.typography.map(t => t.fontFamily))].filter(f => f);
  const primaryFont = fonts[0] || 'sans-serif';
  const theme = traits.isDark ? 'Dark' : 'Light';

  const parts: string[] = [];
  parts.push(`${theme}-themed`);
  parts.push(`${traits.primaryColorTemp} palette`);
  parts.push(`${traits.fontStyle} typography (${primaryFont})`);
  parts.push(`${traits.density} density on a ${profile.spacing.base}px grid`);

  if (!traits.hasShadows) parts.push('flat elevation (no shadows)');
  if (traits.motionStyle === 'expressive') parts.push('expressive motion');

  return parts.join(', ') + '.';
}

function formatRole(role: string): string {
  return role.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function guessExtendedColorUsage(name: string, hex: string): string {
  const n = name.toLowerCase();

  // Glow / ambient light effects
  if (/glow/.test(n)) return 'Radial gradient depth layer for background glow effect';

  // Brand colors
  if (/brand/.test(n) && /orange|red|coral|primary/.test(n)) return 'Brand color for logo, CTAs, and primary emphasis';
  if (/brand/.test(n)) return 'Core brand color';

  // Gradient stops
  if (/gradient/.test(n)) return 'Gradient stop for decorative background or accent';

  // Danger / destructive
  if (/danger|destructive|error/.test(n)) return 'Destructive actions, error states';

  // Warning
  if (/warn/.test(n)) return 'Warning banners, caution states';

  // Success / positive
  if (/success|positive|confirm/.test(n)) return 'Confirmations, positive trend indicators';

  // Muted / secondary text
  if (/muted|secondary|subtle/.test(n)) return 'Secondary text, placeholder text';

  // Overlay / scrim
  if (/overlay|scrim|backdrop/.test(n)) return 'Modal/dialog backdrop overlay';

  // Analyze hex value if name gives no clue
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  if (isNaN(r)) return '';

  const max = Math.max(r, g, b) / 255;
  const min = Math.min(r, g, b) / 255;
  const lightness = (max + min) / 2;

  // Very dark colors — likely backgrounds or shadow layers
  if (lightness < 0.12) return 'Deep background layer or shadow color';

  // Very light colors — likely surface or highlight
  if (lightness > 0.88) return 'Light surface or highlight color';

  // Warm-red / orange tones
  if (r > 180 && g < 100 && b < 100) return 'Warm accent — hover glow or decorative highlight';

  return '';
}

function pickSpacing(spacing: { base: number; values: number[] }, multiplier: number): number {
  const target = spacing.base * multiplier;
  const clamped = Math.min(target, 32);
  if (spacing.values.length > 0) {
    return spacing.values.reduce((prev, curr) =>
      Math.abs(curr - clamped) < Math.abs(prev - clamped) ? curr : prev
    );
  }
  return clamped;
}

function getRadius(profile: DesignProfile, size: string): string {
  const radii = profile.borderRadius.filter(r => !r.includes('9999'));
  if (radii.length === 0) return '8px';

  switch (size) {
    case 'sm': return radii[0] || '4px';
    case 'md': return radii[Math.floor(radii.length / 3)] || '6px';
    case 'lg': return radii[Math.floor(radii.length * 2 / 3)] || '8px';
    case 'xl': return radii[radii.length - 1] || '12px';
    default: return radii[Math.floor(radii.length / 2)] || '8px';
  }
}

function getKeyStyles(comp: ComponentInfo): string[] {
  const styles: string[] = [];
  const tp = comp.tailwindPatterns;

  if (tp.backgrounds.length > 0) styles.push(tp.backgrounds[0]);
  if (tp.borders.length > 0) styles.push(tp.borders[0]);
  if (tp.spacing.length > 0) styles.push(tp.spacing[0]);
  if (tp.typography.length > 0) styles.push(tp.typography[0]);
  if (tp.effects.length > 0) styles.push(tp.effects[0]);

  return styles.map(s => `\`${s}\``);
}

function createZip(sourceDir: string, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outputPath);
    const archive = archiver.default('zip', { zlib: { level: 9 } });

    output.on('close', resolve);
    archive.on('error', reject);

    archive.pipe(output);
    archive.directory(sourceDir, path.basename(sourceDir));
    archive.finalize();
  });
}

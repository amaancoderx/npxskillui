import { DesignProfile, ColorToken, ShadowToken, ComponentInfo, ComponentCategory } from '../types';

/**
 * Generate DESIGN.md in Google Stitch / awesome-design-md format.
 * Pure template-driven — no AI.
 */
export function generateDesignMd(profile: DesignProfile, screenshotPath?: string | null): string {
  const sections = [
    generateHeader(profile, screenshotPath),
    generateVisualTheme(profile),
    generateColorPalette(profile),
    generateTypography(profile),
    generateComponentStylings(profile),
    generateLayoutPrinciples(profile),
    generateDepthElevation(profile),
    generateAnimationMotion(profile),
    generateDosAndDonts(profile),
    generateResponsiveBehavior(profile),
    generateAgentPromptGuide(profile),
  ];

  return sections.filter(s => s).join('\n\n---\n\n');
}

// ── Header ────────────────────────────────────────────────────────────

function generateHeader(profile: DesignProfile, screenshotPath?: string | null): string {
  const frameworkList = profile.frameworks.map(f =>
    f.version ? `${f.name} ${f.version}` : f.name
  ).join(' + ');

  const fonts = [...new Set(profile.typography.map(t => t.fontFamily))].filter(f => f);

  let header = `# ${profile.projectName} DESIGN.md

> Auto-generated design system — reverse-engineered via static analysis by skillui.
> Frameworks: ${frameworkList || 'None detected'}
> Colors: ${profile.colors.length} · Fonts: ${fonts.length} · Components: ${profile.components.length}
> Icon library: ${profile.iconLibrary || 'not detected'} · State: ${profile.stateLibrary || 'not detected'}
> Primary theme: ${profile.designTraits.isDark ? 'dark' : 'light'} · Dark mode toggle: ${profile.designTraits.hasDarkMode ? 'yes' : 'no'} · Motion: ${profile.designTraits.motionStyle}`;

  if (screenshotPath) {
    header += `\n\n## Visual Reference\n\n**Match this design exactly** — study colors, fonts, spacing, and component shapes before writing any UI code.\n\n![${profile.projectName} Homepage](../${screenshotPath})`;
  }

  return header;
}

// ── Section 1: Visual Theme & Atmosphere ──────────────────────────────

function generateVisualTheme(profile: DesignProfile): string {
  const traits = profile.designTraits;
  const bg = profile.colors.find(c => c.role === 'background');
  const accent = profile.colors.find(c => c.role === 'accent');
  const fonts = [...new Set(profile.typography.map(t => t.fontFamily))].filter(f => f);
  const isMono = (f: string) => /mono|consolas|courier|fira code|jetbrains|sf mono|menlo/i.test(f);
  const displayFonts = fonts.filter(f => !isMono(f));
  const primaryFont = displayFonts[0] || fonts[0] || 'sans-serif';
  const theme = traits.isDark ? 'dark' : 'light';

  const lines: string[] = [];

  // Overall vibe
  if (traits.isDark && !traits.hasShadows) {
    lines.push(`This is a **${theme}-themed** interface with a flat, ${traits.primaryColorTemp} visual language. Elevation is achieved through color and border shifts rather than shadows — a clean, industrial aesthetic.`);
  } else if (traits.isDark) {
    lines.push(`This is a **${theme}-themed** interface with a ${traits.primaryColorTemp} tone. Depth is expressed through layered shadows and subtle surface color variation.`);
  } else {
    lines.push(`This is a **${theme}-themed** interface with a ${traits.primaryColorTemp}, approachable feel. The light background emphasizes content clarity.`);
  }

  // Typography character
  if (displayFonts.length >= 2) {
    const displayFont = displayFonts.find(f => f !== primaryFont) || displayFonts[1];
    lines.push(`Typography pairs **${displayFont}** for display/headings with **${primaryFont}** for body text, creating clear visual hierarchy through type contrast.`);
  } else {
    const fontDesc = traits.fontStyle === 'monospace' ? 'technical, developer-focused'
      : traits.fontStyle === 'serif' ? 'editorial, refined'
      : 'clean, modern';
    lines.push(`Typography uses **${primaryFont}** throughout — a ${fontDesc} choice that maintains consistency.`);
  }

  // Spacing + density
  lines.push(`Spacing follows a **${profile.spacing.base}px base grid** (${traits.density} density), with scale: ${profile.spacing.values.slice(0, 8).join(', ')}px.`);

  // Accent + color strategy
  if (accent) {
    const colorCount = profile.colors.filter(c => c.role !== 'unknown').length;
    const neutralCount = profile.colors.filter(c =>
      c.role === 'background' || c.role === 'surface' || c.role === 'text-primary' || c.role === 'text-muted' || c.role === 'border'
    ).length;

    if (neutralCount >= 3 && colorCount - neutralCount <= 3) {
      lines.push(`The palette is predominantly monochromatic with **${accent.hex}** as the single accent color — used sparingly for interactive elements and emphasis.`);
    } else {
      lines.push(`The accent color **${accent.hex}** anchors interactive elements (buttons, links, focus rings).`);
    }
  }

  // Motion summary
  if (traits.motionStyle === 'expressive') {
    lines.push('Motion is expressive — spring physics, layout animations, and staggered reveals are part of the visual language.');
  } else if (traits.motionStyle === 'subtle') {
    lines.push('Motion is subtle — smooth transitions (150-300ms) ease state changes without drawing attention.');
  }

  return `## 1. Visual Theme & Atmosphere

${lines.join(' ')}`;
}

// ── Section 2: Color Palette & Roles ──────────────────────────────────

function generateColorPalette(profile: DesignProfile): string {
  if (profile.colors.length === 0) {
    return `## 2. Color Palette & Roles

No colors detected in the project.`;
  }

  const roleOrder: string[] = ['background', 'surface', 'text-primary', 'text-muted', 'border', 'accent', 'danger', 'success', 'warning', 'info', 'unknown'];

  const sorted = [...profile.colors].sort((a, b) => {
    const ai = roleOrder.indexOf(a.role);
    const bi = roleOrder.indexOf(b.role);
    return ai - bi;
  });

  let table = '| Token | Hex | Role | Use |\n|---|---|---|---|\n';
  for (const color of sorted) {
    const name = color.name || color.role;
    const roleDesc = getColorRoleDescription(color.role);
    table += `| ${name} | \`${color.hex}\` | ${color.role} | ${roleDesc} |\n`;
  }

  // Dark/light mode variable mapping
  let modeSection = '';
  if (profile.darkModeVars.length > 0) {
    modeSection = '\n### Dark Mode Token Mapping\n\n';
    modeSection += '| Variable | Light | Dark |\n|---|---|---|\n';
    for (const v of profile.darkModeVars.slice(0, 20)) {
      modeSection += `| \`${v.variable}\` | \`${v.lightValue}\` | \`${v.darkValue}\` |\n`;
    }
  }

  // CSS variable tokens
  const modeVars = profile.cssVariables.filter(v =>
    /foreground|background|primary|secondary|muted|accent|destructive|border|card|popover/i.test(v.name) &&
    v.value.length < 40
  );

  let cssVarSection = '';
  if (modeVars.length > 0) {
    cssVarSection = '\n### CSS Variable Tokens\n\n';
    cssVarSection += '```css\n';
    for (const v of modeVars.slice(0, 20)) {
      cssVarSection += `${v.name}: ${v.value};\n`;
    }
    cssVarSection += '```\n';
  }

  return `## 2. Color Palette & Roles

${table}${modeSection}${cssVarSection}`;
}

function getColorRoleDescription(role: string): string {
  const descriptions: Record<string, string> = {
    'background': 'Page background, darkest surface',
    'surface': 'Card and panel backgrounds',
    'text-primary': 'Headings and body text',
    'text-muted': 'Captions, placeholders, secondary info',
    'accent': 'CTAs, links, focus rings, active states',
    'border': 'Dividers, card borders, outlines',
    'danger': 'Error states, destructive actions',
    'success': 'Success states, positive indicators',
    'warning': 'Warning states, caution indicators',
    'info': 'Informational highlights',
    'unknown': 'Palette color',
  };
  return descriptions[role] || 'Palette color';
}

// ── Section 3: Typography Rules ───────────────────────────────────────

function generateTypography(profile: DesignProfile): string {
  if (profile.typography.length === 0) {
    return `## 3. Typography Rules

No typography tokens detected.`;
  }

  const fonts = [...new Set(profile.typography.map(t => t.fontFamily))].filter(f => f);
  let fontStack = '';
  if (fonts.length > 0) {
    fontStack = '**Font Stack:**\n';
    for (const font of fonts) {
      const roles = profile.typography.filter(t => t.fontFamily === font).map(t => formatTypographyRole(t.role));
      fontStack += `- **${font}** — ${roles.join(', ')}\n`;
    }
    fontStack += '\n';
  }

  // Font source declarations
  let fontSources = '';
  if (profile.fontSources.length > 0) {
    fontSources = '**Font Sources:**\n\n```css\n';
    const families = [...new Set(profile.fontSources.map(fs => fs.family))];
    // Collect weights actually used in the type scale
    const usedWeights = new Set(profile.typography.map(t => t.fontWeight || '400'));
    usedWeights.add('400');
    usedWeights.add('700');
    for (const family of families) {
      const sources = profile.fontSources.filter(fs => fs.family === family);
      // Check for variable fonts first
      const variableSource = sources.find(s => s.weight === 'variable');
      if (variableSource) {
        fontSources += `@font-face {\n  font-family: "${family}";\n  src: url("${variableSource.src}")${variableSource.format ? ` format("${variableSource.format}")` : ''};\n  font-weight: 100 900;\n}\n`;
      } else {
        const byWeight = new Map<string, typeof sources[0]>();
        for (const src of sources) {
          const w = src.weight || '400';
          if (!usedWeights.has(w)) continue;
          const existing = byWeight.get(w);
          if (!existing || (src.format === 'woff2' && existing.format !== 'woff2')) {
            byWeight.set(w, src);
          }
        }
        if (byWeight.size === 0 && sources.length > 0) {
          byWeight.set(sources[0].weight || '400', sources[0]);
        }
        for (const [weight, src] of byWeight) {
          fontSources += `@font-face {\n  font-family: "${family}";\n  src: url("${src.src}")${src.format ? ` format("${src.format}")` : ''};\n  font-weight: ${weight};\n}\n`;
        }
      }
    }
    fontSources += '```\n\n';
  }

  let table = '| Role | Font | Size | Weight |\n|---|---|---|---|\n';
  for (const t of profile.typography) {
    const roleName = formatTypographyRole(t.role);
    table += `| ${roleName} | ${t.fontFamily} | ${t.fontSize || 'inherit'} | ${t.fontWeight || 'inherit'} |\n`;
  }

  const isMono = (f: string) => /mono|consolas|courier|fira code|jetbrains|sf mono|menlo/i.test(f);
  const displayFonts = fonts.filter(f => !isMono(f));

  let rules = '\n**Typographic Rules:**\n';
  if (displayFonts.length <= 1) {
    rules += `- Use **${displayFonts[0] || fonts[0]}** for all text — do not mix font families\n`;
  } else {
    rules += `- Limit to ${fonts.length} font families max per screen\n`;
    rules += `- Use **${displayFonts[0]}** for body/UI text, **${displayFonts[1]}** for display/headings\n`;
  }
  rules += '- Maintain consistent hierarchy: no more than 3-4 font sizes per screen\n';
  rules += '- Headings use bold (600-700), body uses regular (400)\n';
  rules += '- Line height: 1.5 for body text, 1.2 for headings\n';
  rules += '- Use color and opacity for secondary hierarchy, not additional font sizes\n';

  return `## 3. Typography Rules

${fontStack}${fontSources}${table}${rules}`;
}

function formatTypographyRole(role: string): string {
  return role.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

// ── Section 4: Component Stylings ─────────────────────────────────────

function generateComponentStylings(profile: DesignProfile): string {
  if (profile.components.length === 0) {
    return `## 4. Component Stylings

No components detected. Scan \`src/components/\` or \`components/\` to populate this section.`;
  }

  let content = '';

  // Group by category
  const categories: ComponentCategory[] = ['layout', 'navigation', 'data-display', 'data-input', 'feedback', 'overlay', 'typography', 'media', 'other'];
  const categoryNames: Record<ComponentCategory, string> = {
    'layout': 'Layout',
    'navigation': 'Navigation',
    'data-display': 'Data Display',
    'data-input': 'Data Input',
    'feedback': 'Feedback',
    'overlay': 'Overlay',
    'typography': 'Typography',
    'media': 'Media',
    'other': 'Other',
  };

  for (const cat of categories) {
    const comps = profile.components.filter(c => c.category === cat);
    if (comps.length === 0) continue;

    content += `### ${categoryNames[cat]} (${comps.length})\n\n`;

    for (const comp of comps.slice(0, 8)) {
      content += `**${comp.name}** — \`${comp.filePath}\`\n`;

      if (comp.variants.length > 0) {
        content += `- Variants: ${comp.variants.map(v => `\`${v}\``).join(', ')}\n`;
      }

      if (comp.props.length > 0) {
        content += `- Props: ${comp.props.slice(0, 8).map(p => `\`${p}\``).join(', ')}`;
        if (comp.props.length > 8) content += ` (+${comp.props.length - 8} more)`;
        content += '\n';
      }

      const visualProps = extractVisualProperties(comp);
      if (visualProps.length > 0) {
        content += `- Key Styles: ${visualProps.join(', ')}\n`;
      }

      if (comp.hasAnimation) {
        content += `- Animation: ${comp.animationDetails.slice(0, 3).join(', ')}\n`;
      }

      if (comp.statePatterns.length > 0) {
        content += `- State: ${comp.statePatterns.join(', ')}\n`;
      }

      // Show JSX snippet (compact)
      if (comp.jsxSnippet) {
        const cleanSnippet = comp.jsxSnippet.split('\n').slice(0, 12).join('\n').trim();
        if (cleanSnippet) {
          content += `\n\`\`\`tsx\n${cleanSnippet}\n\`\`\`\n`;
        }
      }

      content += '\n';
    }

    if (comps.length > 8) {
      content += `*...and ${comps.length - 8} more ${categoryNames[cat].toLowerCase()} components.*\n\n`;
    }
  }

  return `## 4. Component Stylings

${content}`;
}

function extractVisualProperties(comp: ComponentInfo): string[] {
  const props: string[] = [];
  const tp = comp.tailwindPatterns;

  // Pick the most representative class from each category
  if (tp.borders.length > 0) {
    const rounded = tp.borders.find(c => c.startsWith('rounded'));
    if (rounded) props.push(`\`${rounded}\``);
    const borderColor = tp.borders.find(c => c.startsWith('border-') && !c.startsWith('border-t') && !c.startsWith('border-b'));
    if (borderColor) props.push(`\`${borderColor}\``);
  }

  if (tp.backgrounds.length > 0) {
    props.push(`\`${tp.backgrounds[0]}\``);
  }

  if (tp.spacing.length > 0) {
    props.push(`\`${tp.spacing[0]}\``);
  }

  if (tp.typography.length > 0) {
    const textSize = tp.typography.find(c => /text-(xs|sm|base|lg|xl|2xl|3xl|4xl)/.test(c));
    if (textSize) props.push(`\`${textSize}\``);
    const font = tp.typography.find(c => c.startsWith('font-'));
    if (font) props.push(`\`${font}\``);
  }

  if (tp.effects.length > 0) {
    props.push(`\`${tp.effects[0]}\``);
  }

  if (tp.interactive.length > 0) {
    props.push(`\`${tp.interactive[0]}\``);
  }

  return props;
}

// ── Section 5: Layout Principles ──────────────────────────────────────

function generateLayoutPrinciples(profile: DesignProfile): string {
  const sp = profile.spacing;
  const scaleStr = sp.values.slice(0, 12).join(', ');

  let content = `- **Base spacing unit:** ${sp.base}px\n`;
  content += `- **Spacing scale:** ${scaleStr}\n`;

  // Border radius
  if (profile.borderRadius.length > 0) {
    const radii = profile.borderRadius.filter(r => !r.includes('9999'));
    if (radii.length > 0) {
      content += `- **Border radius:** ${radii.join(', ')}\n`;
    }
  }

  // Container
  if (profile.containerMaxWidth) {
    content += `- **Max content width:** ${profile.containerMaxWidth}\n`;
  }

  // Grid usage from component classes
  const gridClasses = new Set<string>();
  for (const comp of profile.components) {
    for (const cls of comp.tailwindPatterns.layout) {
      if (/grid-cols-\d+|col-span|columns-\d+/.test(cls)) {
        gridClasses.add(cls);
      }
    }
  }

  if (gridClasses.size > 0) {
    content += `- **Grid usage:** ${Array.from(gridClasses).slice(0, 5).map(c => `\`${c}\``).join(', ')}\n`;
  }

  const hasTailwind = profile.frameworks.some(f => f.id === 'tailwind');
  if (hasTailwind) {
    content += `- **Container:** Tailwind \`container\` class with responsive padding\n`;
  }

  // Spacing philosophy
  content += `\n**Spacing as Meaning:**\n`;
  content += `| Spacing | Use |\n|---|---|\n`;
  if (sp.base <= 4) {
    content += `| ${sp.base}-${sp.base * 2}px | Tight: related items within a group |\n`;
    content += `| ${sp.base * 3}-${sp.base * 4}px | Medium: between groups |\n`;
    content += `| ${sp.base * 6}-${sp.base * 8}px | Wide: between sections |\n`;
    content += `| ${sp.base * 12}px+ | Vast: major section breaks |\n`;
  } else {
    content += `| ${sp.base / 2}-${sp.base}px | Tight: related items within a group |\n`;
    content += `| ${sp.base * 2}px | Medium: between groups |\n`;
    content += `| ${sp.base * 3}-${sp.base * 4}px | Wide: between sections |\n`;
    content += `| ${sp.base * 6}px+ | Vast: major section breaks |\n`;
  }

  return `## 5. Layout Principles

${content}`;
}

// ── Section 6: Depth & Elevation ──────────────────────────────────────

function generateDepthElevation(profile: DesignProfile): string {
  if (profile.shadows.length === 0) {
    let content = '';

    if (profile.designTraits.isDark) {
      content += 'No box-shadow values detected. The design uses a **flat visual style** — elevation is conveyed through background color shifts and borders rather than shadows.\n\n';
      content += '**Elevation Strategy:**\n';
      content += '| Level | Technique | Use |\n|---|---|---|\n';
      content += '| 0 — Base | Background color | Page background |\n';
      content += '| 1 — Raised | Lighter surface + subtle border | Cards, panels |\n';
      content += '| 2 — Floating | Even lighter surface + stronger border | Dropdowns, popovers |\n';
      content += '| 3 — Overlay | Backdrop + modal surface | Modals, dialogs |\n';
    } else {
      content += 'No box-shadow values detected. The design appears to use a flat visual style.\n';
    }

    // z-index
    if (profile.zIndexScale.length > 0) {
      content += `\n**Z-Index Scale:** \`${profile.zIndexScale.join(', ')}\`\n`;
    }

    return `## 6. Depth & Elevation

${content}`;
  }

  let content = '';
  const levels: Record<string, ShadowToken[]> = {};
  for (const shadow of profile.shadows) {
    if (!levels[shadow.level]) levels[shadow.level] = [];
    levels[shadow.level].push(shadow);
  }

  const levelDescriptions: Record<string, string> = {
    flat: 'Flat — subtle depth hints',
    raised: 'Raised — cards, buttons, interactive elements',
    floating: 'Floating — dropdowns, popovers, modals',
    overlay: 'Overlay — full-screen overlays, top-level dialogs',
  };

  for (const [level, shadows] of Object.entries(levels)) {
    content += `### ${levelDescriptions[level] || level}\n\n`;
    for (const s of shadows.slice(0, 3)) {
      const label = s.name ? `**${s.name}:** ` : '';
      content += `- ${label}\`${s.value}\`\n`;
    }
    content += '\n';
  }

  // z-index
  if (profile.zIndexScale.length > 0) {
    content += `### Z-Index Scale\n\n`;
    content += `\`${profile.zIndexScale.join(', ')}\`\n\n`;
  }

  return `## 6. Depth & Elevation

${content}`;
}

// ── Section 7: Animation & Motion ─────────────────────────────────────

function generateAnimationMotion(profile: DesignProfile): string {
  if (!profile.designTraits.hasAnimations && profile.designTraits.motionStyle === 'none') {
    return ''; // Skip section entirely
  }

  let content = '';

  if (profile.designTraits.motionStyle === 'expressive') {
    content += 'This project uses **expressive motion**. Animations are an integral part of the experience.\n\n';
  } else {
    content += 'This project uses **subtle motion**. Transitions smooth state changes without demanding attention.\n\n';
  }

  // Framer Motion
  const hasFramerMotion = profile.animations.some(a => a.type === 'framer-motion');
  if (hasFramerMotion) {
    content += '### Framer Motion Patterns\n\n';
    content += '```tsx\n';
    content += '// Standard enter animation\n';
    content += '<motion.div\n';
    content += '  initial={{ opacity: 0, y: 8 }}\n';
    content += '  animate={{ opacity: 1, y: 0 }}\n';
    content += '  transition={{ duration: 0.3, ease: "easeOut" }}\n';
    content += '/>\n\n';
    content += '// List stagger\n';
    content += 'const container = {\n';
    content += '  hidden: {},\n';
    content += '  show: { transition: { staggerChildren: 0.05 } }\n';
    content += '}\n';
    content += 'const item = {\n';
    content += '  hidden: { opacity: 0, y: 8 },\n';
    content += '  show: { opacity: 1, y: 0 }\n';
    content += '}\n';
    content += '```\n\n';
  }

  // CSS keyframes
  const keyframes = profile.animations.filter(a => a.type === 'css-keyframe');
  if (keyframes.length > 0) {
    content += '### CSS Animations\n\n';
    for (const kf of keyframes.slice(0, 8)) {
      content += `- \`@keyframes ${kf.name}\`\n`;
    }
    content += '\n';
  }

  // Animation components
  const animatedComps = profile.components.filter(c => c.hasAnimation).slice(0, 5);
  if (animatedComps.length > 0) {
    content += '### Animated Components\n\n';
    for (const comp of animatedComps) {
      content += `- **${comp.name}**: ${comp.animationDetails.slice(0, 3).join(', ')}\n`;
    }
    content += '\n';
  }

  content += '### Motion Guidelines\n\n';
  content += '- Duration: 150-300ms for micro-interactions, 300-500ms for page transitions\n';
  content += '- Easing: `ease-out` for enters, `ease-in` for exits\n';
  content += '- Always respect `prefers-reduced-motion`\n';

  return `## 7. Animation & Motion

${content}`;
}

// ── Section 8: Do's and Don'ts ────────────────────────────────────────

function generateDosAndDonts(profile: DesignProfile): string {
  const dos: string[] = [];
  const donts: string[] = [];
  const traits = profile.designTraits;

  const accent = profile.colors.find(c => c.role === 'accent');
  const bg = profile.colors.find(c => c.role === 'background');
  const fonts = [...new Set(profile.typography.map(t => t.fontFamily))];
  const isMono = (f: string) => /mono|consolas|courier|fira code|jetbrains|sf mono|menlo/i.test(f);
  const dFonts = fonts.filter(f => !isMono(f));

  if (accent) {
    dos.push(`Use \`${accent.hex}\` for interactive elements (buttons, links, focus rings)`);
  }
  if (bg) {
    dos.push(`Use \`${bg.hex}\` as the primary page background`);
  }

  donts.push("Don't introduce colors outside this palette — extend the design tokens first");

  if (dFonts.length <= 1 && dFonts[0]) {
    dos.push(`Use **${dFonts[0]}** for all UI text`);
    donts.push(`Don't mix font families — use ${dFonts[0]} consistently`);
  } else if (dFonts.length >= 2) {
    dos.push(`Pair **${dFonts[0]}** (body) with **${dFonts[1]}** (display) — these are the only allowed fonts`);
    donts.push(`Don't introduce additional font families beyond ${fonts.join(' and ')}`);
  }

  dos.push(`Follow the **${profile.spacing.base}px** spacing grid for all margins, padding, and gaps`);
  donts.push(`Don't use arbitrary spacing values — stick to multiples of ${profile.spacing.base}px`);

  if (!traits.hasShadows) {
    dos.push('Use border and background shifts for elevation — not shadows');
    donts.push("Don't add box-shadow — this design system uses flat elevation");
  } else {
    dos.push('Use the defined shadow tokens for elevation — see Section 6');
    donts.push("Don't create custom box-shadow values outside the system tokens");
  }

  if (!traits.hasGradients) {
    donts.push("Don't use gradients — the design uses solid colors only");
  }

  if (profile.borderRadius.length > 0) {
    dos.push(`Use border-radius from the scale: ${profile.borderRadius.filter(r => !r.includes('9999')).slice(0, 5).join(', ')}`);
    donts.push(`Don't use arbitrary border-radius values — pick from the defined scale`);
  }

  if (profile.components.length > 0) {
    dos.push('Reuse existing components from Section 4 before creating new ones');
    donts.push("Don't duplicate component patterns — check Section 4 first");
  }

  if (profile.iconLibrary) {
    dos.push(`Use **${profile.iconLibrary}** for all icons`);
    donts.push("Don't mix icon libraries — consistency matters");
  }

  if (profile.antiPatterns.includes('no-blur')) {
    donts.push("Don't use backdrop-blur or blur effects");
  }

  if (profile.designTraits.hasDarkMode) {
    dos.push('Always use CSS variables for colors — never hardcode hex');
    dos.push('Test both light and dark modes for contrast');
  }

  let content = "### Do's\n\n";
  for (const d of dos) content += `- ${d}\n`;

  content += "\n### Don'ts\n\n";
  for (const d of donts) content += `- ${d}\n`;

  // Detected anti-patterns
  const explicitAntiPatterns: string[] = [];
  if (profile.antiPatterns.includes('no-shadows')) explicitAntiPatterns.push('No box-shadow on any element');
  if (profile.antiPatterns.includes('no-gradients')) explicitAntiPatterns.push('No gradient backgrounds');
  if (profile.antiPatterns.includes('no-blur')) explicitAntiPatterns.push('No blur or backdrop-blur effects');
  if (profile.antiPatterns.includes('no-zebra-striping')) explicitAntiPatterns.push('No zebra striping on tables/lists');

  if (explicitAntiPatterns.length >= 2) {
    content += '\n### Anti-Patterns (detected from codebase)\n\n';
    for (const ap of explicitAntiPatterns) {
      content += `- ${ap}\n`;
    }
  }

  return `## 8. Do's and Don'ts

${content}`;
}

// ── Section 9: Responsive Behavior ────────────────────────────────────

function generateResponsiveBehavior(profile: DesignProfile): string {
  if (profile.breakpoints.length === 0) {
    return `## 9. Responsive Behavior

No breakpoints detected. Consider adding responsive breakpoints to the design system.`;
  }

  let table = '| Name | Value | Source |\n|---|---|---|\n';
  for (const bp of profile.breakpoints) {
    table += `| ${bp.name} | ${bp.value} | ${bp.source} |\n`;
  }

  const hasTailwind = profile.frameworks.some(f => f.id === 'tailwind');
  let content = table;

  if (hasTailwind) {
    content += `\n**Approach:** Mobile-first using Tailwind responsive prefixes (\`sm:\`, \`md:\`, \`lg:\`, \`xl:\`, \`2xl:\`).\n`;
    content += 'Always design for mobile first, then layer on responsive overrides.\n';
  } else {
    content += '\n**Approach:** Use `@media (min-width: ...)` queries matching the breakpoints above.\n';
  }

  return `## 9. Responsive Behavior

${content}`;
}

// ── Section 10: Agent Prompt Guide ────────────────────────────────────

function generateAgentPromptGuide(profile: DesignProfile): string {
  const bg = profile.colors.find(c => c.role === 'background');
  const surface = profile.colors.find(c => c.role === 'surface');
  const accent = profile.colors.find(c => c.role === 'accent');
  const text = profile.colors.find(c => c.role === 'text-primary');
  const textMuted = profile.colors.find(c => c.role === 'text-muted');
  const border = profile.colors.find(c => c.role === 'border');
  const fonts = [...new Set(profile.typography.map(t => t.fontFamily))].filter(f => f);
  const primaryFont = fonts[0] || 'sans-serif';
  const borderRadius = findBorderRadius(profile);

  const shadowNote = profile.designTraits.hasShadows
    ? 'Use shadow tokens from Section 6.'
    : 'No shadows — use borders and surface colors for depth.';

  let content = 'Use these as starting points when building new UI:\n\n';

  // Helper: use extracted token or a CSS variable reference, never a hardcoded hex
  const col = (token: any, varName: string): string => token?.hex || `var(--${varName})`;

  // Card prompt
  content += '### Build a Card\n\n';
  content += '```\n';
  content += `Background: ${col(surface || bg, 'surface')}\n`;
  content += `Border: 1px solid ${col(border, 'border')}\n`;
  content += `Radius: ${borderRadius}\n`;
  content += `Padding: ${pickSpacing(profile.spacing, 4)}px\n`;
  content += `Font: ${primaryFont}\n`;
  content += `${shadowNote}\n`;
  content += '```\n\n';

  // Button prompt
  content += '### Build a Button\n\n';
  content += '```\n';
  content += `Primary: bg ${col(accent, 'accent')}, text white\n`;
  content += `Ghost: bg transparent, border ${col(border, 'border')}\n`;
  content += `Padding: ${pickSpacing(profile.spacing, 2)}px ${pickSpacing(profile.spacing, 4)}px\n`;
  content += `Radius: ${borderRadius}\n`;
  content += `Hover: opacity 0.9 or lighter shade\n`;
  content += `Focus: ring with ${col(accent, 'accent')}\n`;
  content += '```\n\n';

  // Page layout prompt
  content += '### Build a Page Layout\n\n';
  content += '```\n';
  content += `Background: ${col(bg, 'background')}\n`;
  content += `Max-width: ${profile.containerMaxWidth || '1280px'}, centered\n`;
  content += `Grid: ${profile.spacing.base}px base\n`;
  content += `Responsive: mobile-first, breakpoints from Section 9\n`;
  content += '```\n\n';

  // Stats / Data card
  content += '### Build a Stats Card\n\n';
  content += '```\n';
  content += `Surface: ${col(surface || bg, 'surface')}\n`;
  content += `Label: ${col(textMuted, 'text-muted')} (muted, 12px, uppercase)\n`;
  content += `Value: ${col(text, 'text-primary')} (primary, 24-32px, bold)\n`;
  content += `Status: use success/warning/danger from Section 2\n`;
  content += '```\n\n';

  // Form
  content += '### Build a Form\n\n';
  content += '```\n';
  content += `Input bg: ${col(bg, 'background')}\n`;
  content += `Input border: 1px solid ${col(border, 'border')}\n`;
  content += `Focus: border-color ${col(accent, 'accent')}\n`;
  content += `Label: ${col(textMuted, 'text-muted')} 12px\n`;
  content += `Spacing: ${pickSpacing(profile.spacing, 4)}px between fields\n`;
  content += `Radius: ${borderRadius}\n`;
  content += '```\n\n';

  // General
  content += '### General Component\n\n';
  content += '```\n';
  content += `1. Read DESIGN.md Sections 2-6 for tokens\n`;
  content += `2. Colors: only from palette\n`;
  content += `3. Font: ${primaryFont}, type scale from Section 3\n`;
  content += `4. Spacing: ${profile.spacing.base}px grid\n`;
  content += `5. Components: match patterns from Section 4\n`;
  content += `6. Elevation: ${profile.designTraits.hasShadows ? 'shadow tokens' : 'flat, surface shifts'}\n`;
  content += '```\n';

  return `## 10. Agent Prompt Guide

${content}`;
}

function findBorderRadius(profile: DesignProfile): string {
  const radii = profile.borderRadius.filter(r => !r.includes('9999'));
  if (radii.length > 0) {
    return radii[Math.floor(radii.length / 2)];
  }
  const radiusVar = profile.cssVariables.find(v => /radius/i.test(v.name));
  if (radiusVar) return radiusVar.value;
  return '8px';
}

// ── Helpers ───────────────────────────────────────────────────────────

function pickSpacing(spacing: { base: number; values: number[] }, multiplier: number): number {
  const target = spacing.base * multiplier;
  const clamped = Math.min(target, 32);
  if (spacing.values.length > 0) {
    const closest = spacing.values.reduce((prev, curr) =>
      Math.abs(curr - clamped) < Math.abs(prev - clamped) ? curr : prev
    );
    return closest;
  }
  return clamped;
}

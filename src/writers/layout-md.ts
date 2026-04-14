import { LayoutRecord } from '../types-ultra';
import { DesignProfile } from '../types';

/**
 * Generate references/LAYOUT.md
 * Documents DOM layout patterns, spacing relationships, and grid system.
 */
export function generateLayoutMd(
  layouts: LayoutRecord[],
  profile: DesignProfile
): string {
  let md = `# Layout Reference\n\n`;
  md += `> Auto-extracted from live DOM. Use this to understand how the site is structured spatially.\n\n`;

  if (layouts.length === 0) {
    md += `No layout data extracted (Playwright required).\n`;
    return md;
  }

  // ── Spacing System ─────────────────────────────────────────────────
  md += `## Spacing System\n\n`;
  md += `**Base grid:** ${profile.spacing.base}px\n\n`;

  if (profile.spacing.values.length > 0) {
    md += `**Scale:** \`${profile.spacing.values.slice(0, 16).join(', ')}\` px\n\n`;
  }

  md += `| Spacing | Semantic Use |\n`;
  md += `|---------|-------------|\n`;
  const base = profile.spacing.base;
  md += `| ${base}px | Tight — within a component |\n`;
  md += `| ${base * 2}px | Medium — between sibling items |\n`;
  md += `| ${base * 4}px | Wide — between sections |\n`;
  md += `| ${base * 8}px | Vast — major section breaks |\n`;
  md += `\n`;

  // ── Flex Layouts ────────────────────────────────────────────────────
  const flexLayouts = layouts.filter(l => l.display === 'flex' || l.display === 'inline-flex');
  if (flexLayouts.length > 0) {
    md += `## Flex Layouts\n\n`;
    md += `| Element | Direction | Justify | Align | Gap | Children |\n`;
    md += `|---------|-----------|---------|-------|-----|----------|\n`;
    for (const l of flexLayouts.slice(0, 15)) {
      const dir = l.flexDirection || 'row';
      const justify = simplify(l.justifyContent);
      const align = simplify(l.alignItems);
      const gap = l.gap && l.gap !== 'normal' ? l.gap : '—';
      md += `| \`${l.selector}\` | ${dir} | ${justify} | ${align} | ${gap} | ${l.childCount} |\n`;
    }
    md += `\n`;
  }

  // ── Grid Layouts ────────────────────────────────────────────────────
  const gridLayouts = layouts.filter(l => l.display === 'grid' || l.display === 'inline-grid');
  if (gridLayouts.length > 0) {
    md += `## Grid Layouts\n\n`;
    md += `| Element | Template Columns | Gap | Children |\n`;
    md += `|---------|-----------------|-----|----------|\n`;
    for (const l of gridLayouts.slice(0, 10)) {
      const cols = l.gridTemplateColumns && l.gridTemplateColumns !== 'none'
        ? l.gridTemplateColumns.slice(0, 50)
        : '—';
      const gap = l.gap && l.gap !== 'normal' ? l.gap : '—';
      md += `| \`${l.selector}\` | \`${cols}\` | ${gap} | ${l.childCount} |\n`;
    }
    md += `\n`;
  }

  // ── Key Layout Containers ──────────────────────────────────────────
  const structural = layouts.filter(l =>
    ['header', 'nav', 'main', 'footer', 'section', 'article'].includes(l.tag)
  );
  if (structural.length > 0) {
    md += `## Structural Containers\n\n`;
    for (const l of structural.slice(0, 12)) {
      md += `### \`<${l.tag}>\` ${l.selector !== l.tag ? `(\`${l.selector}\`)` : ''}\n\n`;
      md += `\`\`\`\n`;
      md += `display:          ${l.display}\n`;
      if (l.display === 'flex' || l.display === 'inline-flex') {
        md += `flex-direction:   ${l.flexDirection || 'row'}\n`;
        md += `justify-content:  ${simplify(l.justifyContent)}\n`;
        md += `align-items:      ${simplify(l.alignItems)}\n`;
      }
      if (l.display === 'grid' || l.display === 'inline-grid') {
        if (l.gridTemplateColumns && l.gridTemplateColumns !== 'none') {
          md += `grid-template-columns: ${l.gridTemplateColumns.slice(0, 60)}\n`;
        }
      }
      if (l.gap && l.gap !== 'normal') md += `gap:              ${l.gap}\n`;
      if (l.padding && l.padding !== '0px') md += `padding:          ${l.padding}\n`;
      if (l.maxWidth && l.maxWidth !== 'none') md += `max-width:        ${l.maxWidth}\n`;
      md += `children:         ${l.childCount}\n`;
      md += `\`\`\`\n\n`;
    }
  }

  // ── Layout Anti-Patterns ───────────────────────────────────────────
  md += `## Layout Rules\n\n`;
  const hasContainer = layouts.some(l => l.maxWidth && l.maxWidth !== 'none' && l.maxWidth !== '');
  if (hasContainer) {
    const containerEl = layouts.find(l => l.maxWidth && l.maxWidth !== 'none');
    md += `- **Container max-width:** \`${containerEl?.maxWidth}\` — always center with \`margin: auto\`\n`;
  }

  const hasGrid = gridLayouts.length > 0;
  const hasFlex = flexLayouts.length > 0;
  if (hasFlex) md += `- Primary layout system: **Flexbox**\n`;
  if (hasGrid) md += `- Secondary layout system: **CSS Grid** (used for card grids and multi-column layouts)\n`;
  md += `- Every spacing value must be a multiple of **${base}px**\n`;
  md += `- Never use arbitrary margin/padding values outside the spacing scale\n`;
  md += `\n`;

  return md;
}

function simplify(val: string): string {
  if (!val) return '—';
  const map: Record<string, string> = {
    'flex-start': 'start',
    'flex-end': 'end',
    'space-between': 'space-between',
    'space-around': 'space-around',
    'space-evenly': 'space-evenly',
    'center': 'center',
    'stretch': 'stretch',
    'normal': '—',
  };
  return map[val] || val;
}

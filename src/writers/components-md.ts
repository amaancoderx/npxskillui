import { DOMComponent } from '../types-ultra';
import { DesignProfile } from '../types';

/**
 * Generate references/COMPONENTS.md
 * Documents all detected repeated DOM components with HTML snippets.
 */
export function generateComponentsMd(
  domComponents: DOMComponent[],
  profile: DesignProfile
): string {
  let md = `# Component Reference\n\n`;
  md += `> Repeated DOM patterns detected by structural analysis. Each component appeared 3+ times.\n\n`;

  if (domComponents.length === 0) {
    md += `No repeated components detected (Playwright required).\n`;
    return md;
  }

  // ── Overview ────────────────────────────────────────────────────────
  md += `## Detected Components\n\n`;
  md += `| Component | Category | Instances | Key Classes |\n`;
  md += `|-----------|----------|-----------|-------------|\n`;
  for (const c of domComponents) {
    const classes = c.commonClasses.slice(0, 3).map(cl => `\`.${cl}\``).join(', ');
    md += `| **${c.name}** | ${c.category} | ${c.instances}× | ${classes} |\n`;
  }
  md += `\n`;

  // ── Category Groups ─────────────────────────────────────────────────
  const byCategory = groupBy(domComponents, c => c.category);
  const categoryOrder: DOMComponent['category'][] = [
    'card', 'list-item', 'nav-item', 'button', 'badge', 'form-field', 'unknown'
  ];

  const accent = profile.colors.find(c => c.role === 'accent');
  const bg = profile.colors.find(c => c.role === 'background');
  const surface = profile.colors.find(c => c.role === 'surface');
  const border = profile.colors.find(c => c.role === 'border');
  const textPrimary = profile.colors.find(c => c.role === 'text-primary');
  const commonRadius = profile.borderRadius.filter(r => !r.includes('9999'))[
    Math.floor(profile.borderRadius.length / 2)
  ] || '8px';

  for (const category of categoryOrder) {
    const comps = byCategory[category];
    if (!comps?.length) continue;

    md += `## ${formatCategory(category)}\n\n`;

    for (const comp of comps) {
      md += `### ${comp.name}\n\n`;
      md += `**Instances found:** ${comp.instances}\n\n`;

      if (comp.commonClasses.length > 0) {
        md += `**CSS classes:** ${comp.commonClasses.map(c => `\`.${c}\``).join(' ')}\n\n`;
      }

      // HTML snippet
      md += `**HTML structure:**\n\n`;
      md += `\`\`\`html\n`;
      md += `${comp.htmlSnippet}\n`;
      md += `\`\`\`\n\n`;

      // Suggested base CSS from design tokens
      const suggestedCss = buildSuggestedCss(comp, {
        accent, bg, surface, border, textPrimary, commonRadius, profile
      });
      if (suggestedCss) {
        md += `**Base styles (from design tokens):**\n\n`;
        md += `\`\`\`css\n`;
        md += suggestedCss;
        md += `\`\`\`\n\n`;
      }
    }
  }

  // ── Rules ───────────────────────────────────────────────────────────
  md += `## Component Rules\n\n`;
  md += `- Match class names exactly from the patterns above\n`;
  md += `- Each component instance must be visually identical to others of its type\n`;
  md += `- Do not add extra wrappers or change the DOM structure\n`;
  if (border) {
    md += `- Use \`${border.hex}\` for all dividers within components\n`;
  }
  if (accent) {
    md += `- Use \`${accent.hex}\` for all interactive/active states\n`;
  }
  md += `\n`;

  return md;
}

interface TokenSet {
  accent: any;
  bg: any;
  surface: any;
  border: any;
  textPrimary: any;
  commonRadius: string;
  profile: DesignProfile;
}

function buildSuggestedCss(comp: DOMComponent, tokens: TokenSet): string {
  const { accent, surface, border, textPrimary, commonRadius, profile } = tokens;
  const sp = profile.spacing;
  const pad = sp.base * 2;

  const lines: string[] = [];
  const mainClass = comp.commonClasses[0] || comp.name.toLowerCase().replace(/\s+/g, '-');
  lines.push(`.${mainClass} {`);

  switch (comp.category) {
    case 'card':
      if (surface) lines.push(`  background: ${surface.hex};`);
      if (border) lines.push(`  border: 1px solid ${border.hex};`);
      lines.push(`  border-radius: ${commonRadius};`);
      lines.push(`  padding: ${pad}px;`);
      break;

    case 'button':
      if (accent) lines.push(`  background: ${accent.hex};`);
      if (textPrimary) lines.push(`  color: ${textPrimary.hex};`);
      lines.push(`  border-radius: ${commonRadius};`);
      lines.push(`  padding: ${sp.base}px ${pad}px;`);
      lines.push(`  cursor: pointer;`);
      break;

    case 'badge':
      if (surface) lines.push(`  background: ${surface.hex};`);
      if (border) lines.push(`  border: 1px solid ${border.hex};`);
      lines.push(`  border-radius: ${commonRadius};`);
      lines.push(`  padding: ${Math.round(sp.base * 0.5)}px ${sp.base}px;`);
      lines.push(`  font-size: 12px;`);
      break;

    case 'nav-item':
      lines.push(`  padding: ${sp.base}px ${pad}px;`);
      lines.push(`  cursor: pointer;`);
      if (accent) lines.push(`  /* active: color: ${accent.hex}; */`);
      break;

    case 'list-item':
      lines.push(`  padding: ${sp.base}px 0;`);
      if (border) lines.push(`  border-bottom: 1px solid ${border.hex};`);
      break;

    default:
      if (surface) lines.push(`  background: ${surface.hex};`);
      lines.push(`  padding: ${sp.base}px;`);
  }

  lines.push(`}`);
  return lines.join('\n');
}

function formatCategory(cat: string): string {
  const map: Record<string, string> = {
    card: 'Cards',
    'list-item': 'List Items',
    'nav-item': 'Navigation Items',
    button: 'Buttons',
    badge: 'Badges & Chips',
    'form-field': 'Form Fields',
    unknown: 'Other Components',
  };
  return map[cat] || cat;
}

function groupBy<T>(arr: T[], key: (item: T) => string): Record<string, T[]> {
  return arr.reduce((acc, item) => {
    const k = key(item);
    if (!acc[k]) acc[k] = [];
    acc[k].push(item);
    return acc;
  }, {} as Record<string, T[]>);
}

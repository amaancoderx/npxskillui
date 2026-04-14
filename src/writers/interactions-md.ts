import { InteractionRecord } from '../types-ultra';
import { DesignProfile } from '../types';

/**
 * Generate references/INTERACTIONS.md
 * Documents hover/focus micro-interactions with style diffs and screenshot references.
 */
export function generateInteractionsMd(
  interactions: InteractionRecord[],
  profile: DesignProfile
): string {
  let md = `# Interaction Reference\n\n`;
  md += `> Micro-interactions extracted from live DOM. Recreate these exactly for authentic feel.\n\n`;

  if (interactions.length === 0) {
    md += `No interaction data extracted (Playwright required).\n`;
    return md;
  }

  // ── Overview ────────────────────────────────────────────────────────
  const byType = groupBy(interactions, i => i.componentType);
  md += `## Coverage\n\n`;
  md += `| Component Type | Count | States Captured |\n`;
  md += `|----------------|-------|----------------|\n`;
  for (const [type, records] of Object.entries(byType)) {
    const states = new Set<string>();
    records.forEach(r => {
      if (r.screenshots.default) states.add('default');
      if (r.screenshots.hover) states.add('hover');
      if (r.screenshots.focus) states.add('focus');
    });
    md += `| ${formatType(type)} | ${records.length} | ${[...states].join(', ')} |\n`;
  }
  md += `\n`;

  // ── Transition System ───────────────────────────────────────────────
  const transitionValues = interactions
    .map(i => i.transitionValue)
    .filter(t => t && t !== 'all 0s ease 0s' && t !== 'none' && !t.startsWith('all 0s'));
  const uniqueTransitions = [...new Set(transitionValues)];

  if (uniqueTransitions.length > 0) {
    md += `## Transition System\n\n`;
    md += `These transition declarations were extracted from interactive elements:\n\n`;
    md += `\`\`\`css\n`;
    for (const t of uniqueTransitions.slice(0, 8)) {
      md += `transition: ${t};\n`;
    }
    md += `\`\`\`\n\n`;
    md += `Apply these to all interactive elements. Never invent new durations or easings.\n\n`;
  }

  // ── Per Component Type ─────────────────────────────────────────────
  for (const [type, records] of Object.entries(byType)) {
    md += `## ${formatType(type)} Interactions\n\n`;

    for (const rec of records) {
      md += `### ${formatType(type)} ${rec.index} — \`${rec.label}\`\n\n`;

      // Screenshots
      if (rec.screenshots.default || rec.screenshots.hover || rec.screenshots.focus) {
        md += `**States:**\n\n`;
        if (rec.screenshots.default) {
          md += `- Default: \`../${rec.screenshots.default}\`\n`;
        }
        if (rec.screenshots.hover) {
          md += `- Hover: \`../${rec.screenshots.hover}\`\n`;
        }
        if (rec.screenshots.focus) {
          md += `- Focus: \`../${rec.screenshots.focus}\`\n`;
        }
        md += `\n`;
      }

      // Hover changes
      if (rec.hoverChanges.length > 0) {
        md += `**On hover:**\n\n`;
        md += `\`\`\`css\n`;
        for (const diff of rec.hoverChanges) {
          md += `/* ${cssProperty(diff.property)}: ${diff.from} → */ ${cssProperty(diff.property)}: ${diff.to};\n`;
        }
        md += `\`\`\`\n\n`;
      }

      // Focus changes
      if (rec.focusChanges.length > 0) {
        md += `**On focus:**\n\n`;
        md += `\`\`\`css\n`;
        for (const diff of rec.focusChanges) {
          md += `/* ${cssProperty(diff.property)}: ${diff.from} → */ ${cssProperty(diff.property)}: ${diff.to};\n`;
        }
        md += `\`\`\`\n\n`;
      }

      // Transition
      if (rec.transitionValue && rec.transitionValue !== 'none' && rec.transitionValue !== 'all 0s ease 0s') {
        md += `**Transition:** \`${rec.transitionValue}\`\n\n`;
      }

      if (rec.hoverChanges.length === 0 && rec.focusChanges.length === 0) {
        md += `_No visible style changes detected for this element._\n\n`;
      }
    }
  }

  // ── Interaction Rules ──────────────────────────────────────────────
  md += `## Interaction Rules\n\n`;

  const accent = profile.colors.find(c => c.role === 'accent');
  if (accent) {
    md += `- Accent color \`${accent.hex}\` is used for focus rings, active states, and hover highlights\n`;
  }

  const hasOpacityHover = interactions.some(i =>
    i.hoverChanges.some(d => d.property === 'opacity')
  );
  if (hasOpacityHover) {
    md += `- Hover effects use **opacity** changes, not color shifts\n`;
  }

  const hasColorHover = interactions.some(i =>
    i.hoverChanges.some(d => d.property === 'color' || d.property === 'backgroundColor')
  );
  if (hasColorHover) {
    md += `- Hover effects include **color transitions** — use the extracted values, not approximations\n`;
  }

  const hasFocusOutline = interactions.some(i =>
    i.focusChanges.some(d => d.property === 'outline' || d.property === 'outlineColor')
  );
  if (hasFocusOutline) {
    md += `- Focus states use **outline** (not box-shadow) — always match the extracted focus ring\n`;
  }

  if (uniqueTransitions.length > 0) {
    const durations = uniqueTransitions
      .join(' ')
      .match(/\d+(?:\.\d+)?(?:ms|s)/g) || [];
    const uniqueDurations = [...new Set(durations)];
    if (uniqueDurations.length > 0) {
      md += `- Transition durations in use: ${uniqueDurations.map(d => `\`${d}\``).join(', ')}\n`;
    }
  }

  md += `- Always respect \`prefers-reduced-motion\` — set all transitions to \`0s\` when enabled\n`;
  md += `\n`;

  return md;
}

function formatType(type: string): string {
  const map: Record<string, string> = {
    button: 'Button',
    link: 'Link',
    input: 'Input',
    'role-button': 'Role Button',
  };
  return map[type] || type;
}

function cssProperty(camelCase: string): string {
  return camelCase.replace(/([A-Z])/g, '-$1').toLowerCase();
}

function groupBy<T>(arr: T[], key: (item: T) => string): Record<string, T[]> {
  return arr.reduce((acc, item) => {
    const k = key(item);
    if (!acc[k]) acc[k] = [];
    acc[k].push(item);
    return acc;
  }, {} as Record<string, T[]>);
}

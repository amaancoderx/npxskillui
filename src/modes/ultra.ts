import * as fs from 'fs';
import * as path from 'path';
import { DesignProfile } from '../types';
import { UltraOptions, UltraResult, FullAnimationResult } from '../types-ultra';
import { capturePageScreenshots } from '../extractors/ultra/pages';
import { captureInteractions } from '../extractors/ultra/interactions';
import { extractLayouts } from '../extractors/ultra/layout';
import { detectDOMComponents } from '../extractors/ultra/components-dom';
import { captureAnimations } from '../extractors/ultra/animations';
import { generateLayoutMd } from '../writers/layout-md';
import { generateInteractionsMd } from '../writers/interactions-md';
import { generateComponentsMd } from '../writers/components-md';
import { generateAnimationsMd } from '../writers/animations-md';
import { writeTokensJson } from '../writers/tokens-json';
import { loadPlaywright } from '../playwright-loader';

/**
 * Ultra mode orchestrator.
 *
 * Runs AFTER the normal url mode pipeline. Adds:
 * - screens/pages/      — full-page screenshots per crawled page
 * - screens/sections/   — clipped section screenshots per page
 * - screens/states/     — hover/focus state screenshots per interactive element
 * - screens/scroll/     — 7 scroll-journey screenshots + video first frames
 * - references/LAYOUT.md
 * - references/INTERACTIONS.md
 * - references/COMPONENTS.md
 * - references/ANIMATIONS.md  ← NEW: cinematic animation documentation
 * - tokens/colors.json
 * - tokens/spacing.json
 * - tokens/typography.json
 *
 * All existing outputs remain untouched.
 */
export async function runUltraMode(
  url: string,
  profile: DesignProfile,
  skillDir: string,
  opts: UltraOptions
): Promise<UltraResult> {
  // Ensure all output directories exist
  fs.mkdirSync(path.join(skillDir, 'screens', 'pages'), { recursive: true });
  fs.mkdirSync(path.join(skillDir, 'screens', 'sections'), { recursive: true });
  fs.mkdirSync(path.join(skillDir, 'screens', 'states'), { recursive: true });
  fs.mkdirSync(path.join(skillDir, 'screens', 'scroll'), { recursive: true });
  fs.mkdirSync(path.join(skillDir, 'references'), { recursive: true });
  fs.mkdirSync(path.join(skillDir, 'tokens'), { recursive: true });

  const hasPlaywright = loadPlaywright() !== null;

  if (!hasPlaywright) {
    process.stdout.write('\n  ⚠  Playwright not found — ultra visual features skipped\n');
    process.stdout.write('     Fix: npm install -g playwright && npx playwright install chromium\n\n');
    writeTokensJson(profile, skillDir);
    writeStubs(skillDir);
    const emptyAnim = emptyAnimResult();
    return { pageScreenshots: [], sectionScreenshots: [], interactions: [], layouts: [], domComponents: [], animations: emptyAnim };
  }

  // ── Step 1: Animation extraction (scroll journey + keyframes + libraries) ──
  const animations = await captureAnimations(url, skillDir);

  // ── Step 2: Multi-page screenshots + section clips ─────────────────────
  const { pages, sections } = await capturePageScreenshots(url, skillDir, opts.screens);

  // ── Step 3: Micro-interactions ────────────────────────────────────────
  const interactions = await captureInteractions(url, skillDir);

  // ── Step 4: Layout extraction ──────────────────────────────────────────
  const layouts = await extractLayouts(url);

  // ── Step 5: DOM component detection ───────────────────────────────────
  const domComponents = await detectDOMComponents(url);

  // ── Step 6: Write all reference files ─────────────────────────────────

  const refsDir = path.join(skillDir, 'references');

  // ANIMATIONS.md — cinematic motion documentation
  const animMd = generateAnimationsMd(animations, profile);
  fs.writeFileSync(path.join(refsDir, 'ANIMATIONS.md'), animMd, 'utf-8');

  // LAYOUT.md
  const layoutMd = generateLayoutMd(layouts, profile);
  fs.writeFileSync(path.join(refsDir, 'LAYOUT.md'), layoutMd, 'utf-8');

  // INTERACTIONS.md
  const interactionsMd = generateInteractionsMd(interactions, profile);
  fs.writeFileSync(path.join(refsDir, 'INTERACTIONS.md'), interactionsMd, 'utf-8');

  // COMPONENTS.md
  const componentsMd = generateComponentsMd(domComponents, profile);
  fs.writeFileSync(path.join(refsDir, 'COMPONENTS.md'), componentsMd, 'utf-8');

  // Token JSON files
  writeTokensJson(profile, skillDir);

  // VISUAL_GUIDE.md — master visual reference embedding all screenshots
  const visualGuideMd = generateVisualGuideMd(profile, pages, sections, animations);
  fs.writeFileSync(path.join(refsDir, 'VISUAL_GUIDE.md'), visualGuideMd, 'utf-8');

  // Ultra screenshot index
  writeScreensIndex(pages, sections, animations, skillDir);

  console.log(' ✓');

  // ── Print ultra summary ────────────────────────────────────────────────
  printUltraSummary(animations);

  return { pageScreenshots: pages, sectionScreenshots: sections, interactions, layouts, domComponents, animations };
}

// ── Visual Guide Generator ────────────────────────────────────────────

function generateVisualGuideMd(
  profile: DesignProfile,
  pages: import('../types-ultra').PageScreenshot[],
  sections: import('../types-ultra').SectionScreenshot[],
  anim: FullAnimationResult
): string {
  let md = `# ${profile.projectName} — Visual Guide\n\n`;
  md += `> Master visual reference. Study every screenshot carefully before implementing any UI.\n`;
  md += `> Match colors, layout, typography, spacing, and motion states exactly.\n\n`;

  // Animation stack summary
  if (anim.libraries.length > 0) {
    const libs = anim.libraries.map(l => `**${l.name}**`).join(', ');
    md += `**Motion Stack:** ${libs}\n\n`;
  }
  if (anim.webglDetected) {
    md += `**WebGL/3D:** Detected (${anim.canvasCount} canvas elements) — replicate with Three.js or CSS 3D transforms\n\n`;
  }

  // Scroll journey — most important section
  if (anim.scrollFrames.length > 0) {
    md += `## Scroll Journey\n\n`;
    md += `The page has cinematic scroll animations. Each screenshot below shows the exact visual state at that scroll depth.\n`;
    md += `**Replicate these transitions precisely** — the design changes dramatically as you scroll.\n\n`;

    for (const frame of anim.scrollFrames) {
      const relPath = `../screens/scroll/${path.basename(frame.filePath)}`;
      const label = frame.scrollPercent === 0 ? 'Hero — Above the fold'
        : frame.scrollPercent === 100 ? 'Footer — End of page'
        : `${frame.scrollPercent}% scroll depth`;
      md += `### ${label}\n\n`;
      md += `*Scroll position: ${frame.scrollY}px of ${frame.pageHeight}px total*\n\n`;
      md += `![${label}](${relPath})\n\n`;
    }
  }

  // Video backgrounds
  if (anim.videos.some(v => v.firstFramePath)) {
    md += `## Video Backgrounds\n\n`;
    md += `These videos play as background elements. Use first-frame as poster image while video loads.\n\n`;
    for (const v of anim.videos.filter(vv => vv.firstFramePath)) {
      const relPath = `../screens/scroll/${path.basename(v.firstFramePath!)}`;
      md += `### Video ${v.index} (${v.role})\n\n`;
      if (v.src) md += `*Source: \`${v.src.slice(0, 80)}...\`*\n\n`;
      md += `![Video ${v.index} first frame](${relPath})\n\n`;
    }
  }

  // Page screenshots
  if (pages.length > 0) {
    md += `## Full Page Screenshots\n\n`;
    for (const p of pages) {
      const relPath = `../screens/pages/${path.basename(p.filePath)}`;
      md += `### ${p.title}\n\n`;
      md += `*URL: \`${p.url}\`*\n\n`;
      md += `![${p.title}](${relPath})\n\n`;
    }
  }

  // Section clips
  if (sections.length > 0) {
    md += `## Section Screenshots\n\n`;
    md += `Clipped sections showing individual components in context.\n\n`;
    for (const s of sections) {
      const relPath = `../screens/sections/${path.basename(s.filePath)}`;
      md += `### Section ${s.index} — \`${s.selector}\`\n\n`;
      md += `*${s.width}×${s.height}px*\n\n`;
      md += `![Section ${s.index}](${relPath})\n\n`;
    }
  }

  return md;
}

// ── Helpers ───────────────────────────────────────────────────────────

function printUltraSummary(anim: FullAnimationResult): void {
  const libs = anim.libraries.map(l => l.name).join(', ') || 'none';
  console.log('');
  console.log(`  Animation Stack: ${libs}`);
  if (anim.webglDetected) console.log(`  WebGL/3D: detected (${anim.canvasCount} canvas elements)`);
  if (anim.videos.length > 0) {
    const bg = anim.videos.filter(v => v.role === 'background').length;
    console.log(`  Video: ${anim.videos.length} elements (${bg} background)`);
  }
  if (anim.lottieCount > 0) console.log(`  Lottie: ${anim.lottieCount} players`);
  if (anim.keyframes.length > 0) console.log(`  Keyframes: ${anim.keyframes.length} extracted`);
  if (anim.scrollPatterns.length > 0) console.log(`  Scroll patterns: ${anim.scrollPatterns.length} types`);
}

function writeScreensIndex(
  pages: import('../types-ultra').PageScreenshot[],
  sections: import('../types-ultra').SectionScreenshot[],
  anim: FullAnimationResult,
  skillDir: string
): void {
  let md = `# Screenshot Index\n\n`;

  // Scroll journey (most important for animation sites)
  if (anim.scrollFrames.length > 0) {
    md += `## Scroll Journey\n\n`;
    md += `> Shows the cinematic state at each point of the page\n\n`;
    md += `| Scroll | Y Position | File |\n`;
    md += `|--------|-----------|------|\n`;
    for (const f of anim.scrollFrames) {
      md += `| ${f.scrollPercent}% | ${f.scrollY}px | \`${f.filePath}\` |\n`;
    }
    md += `\n`;
  }

  // Video frames
  if (anim.videos.some(v => v.firstFramePath)) {
    md += `## Video First Frames\n\n`;
    for (const v of anim.videos) {
      if (v.firstFramePath) {
        md += `- Video ${v.index} (${v.role}): \`${v.firstFramePath}\`\n`;
      }
    }
    md += `\n`;
  }

  if (pages.length > 0) {
    md += `## Pages\n\n`;
    md += `| Page | URL | File |\n`;
    md += `|------|-----|------|\n`;
    for (const p of pages) {
      md += `| ${p.title} | \`${p.url}\` | \`${p.filePath}\` |\n`;
    }
    md += `\n`;
  }

  if (sections.length > 0) {
    md += `## Sections\n\n`;
    md += `| Page | Section | File |\n`;
    md += `|------|---------|------|\n`;
    for (const s of sections) {
      md += `| ${s.page} | #${s.index} (${s.selector}) | \`${s.filePath}\` |\n`;
    }
    md += `\n`;
  }

  fs.writeFileSync(path.join(skillDir, 'screens', 'INDEX.md'), md, 'utf-8');
}

function writeStubs(skillDir: string): void {
  const refsDir = path.join(skillDir, 'references');
  const note = '> Install Playwright to enable: `npm install playwright && npx playwright install chromium`\n\nRun `skillui --url <url> --mode ultra` after installing.\n';

  for (const file of ['ANIMATIONS.md', 'LAYOUT.md', 'INTERACTIONS.md', 'COMPONENTS.md']) {
    const filePath = path.join(refsDir, file);
    if (!fs.existsSync(filePath)) {
      const title = file.replace('.md', '').replace(/-/g, ' ');
      fs.writeFileSync(filePath, `# ${title} Reference\n\n${note}`, 'utf-8');
    }
  }
}

function emptyAnimResult(): FullAnimationResult {
  return {
    keyframes: [],
    scrollFrames: [],
    libraries: [],
    videos: [],
    scrollPatterns: [],
    animationVars: [],
    globalTransitions: [],
    canvasCount: 0,
    webglDetected: false,
    lottieCount: 0,
  };
}

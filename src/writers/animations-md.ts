import { FullAnimationResult, ExtractedKeyframe, ScrollAnimationPattern } from '../types-ultra';
import { DesignProfile } from '../types';

/**
 * Generate references/ANIMATIONS.md
 *
 * Cinematic-quality animation documentation:
 * - Technology stack (GSAP, Lottie, Three.js, etc.)
 * - Scroll journey (7 screenshots from top to bottom)
 * - Every CSS @keyframe with full code + usage context
 * - Scroll-triggered animation patterns
 * - Video background specifications
 * - Canvas / WebGL indicators
 * - CSS animation variables / tokens
 * - Implementation guide (how to recreate the motion design)
 */
export function generateAnimationsMd(
  anim: FullAnimationResult,
  profile: DesignProfile
): string {
  let md = `# Animation Reference\n\n`;
  md += `> Cinematic motion design extracted from live DOM. Follow these specs exactly to recreate the experience.\n\n`;

  // ── Technology Stack ────────────────────────────────────────────────
  md += `## Motion Technology Stack\n\n`;

  if (anim.libraries.length === 0 && anim.canvasCount === 0 && !anim.webglDetected) {
    md += `Pure CSS animations — no external animation libraries detected.\n\n`;
  } else {
    md += `| Library | Type | Notes |\n`;
    md += `|---------|------|-------|\n`;
    for (const lib of anim.libraries) {
      const ver = lib.version ? ` v${lib.version}` : '';
      const cdn = lib.cdn ? ` ([CDN](${lib.cdn}))` : '';
      md += `| **${lib.name}${ver}** | ${lib.type} | ${cdn} |\n`;
    }
    if (anim.canvasCount > 0) {
      const webglLabel = anim.webglDetected ? 'WebGL/3D' : '2D Canvas';
      md += `| Canvas (${anim.canvasCount} elements) | ${webglLabel} | ${anim.webglDetected ? 'WebGL context detected — likely Three.js or custom shader' : '2D canvas rendering'} |\n`;
    }
    if (anim.lottieCount > 0) {
      md += `| Lottie (${anim.lottieCount} players) | vector | JSON-based vector animations |\n`;
    }
    md += `\n`;
  }

  // ── Scroll Journey ──────────────────────────────────────────────────
  if (anim.scrollFrames.length > 0) {
    md += `## Scroll Journey\n\n`;
    md += `The page is **${Math.round(anim.scrollFrames[0]?.pageHeight || 0).toLocaleString()}px** tall. `;
    md += `Each frame below shows what the user sees at that scroll depth.\n\n`;
    md += `> **Use these screenshots to understand WHAT animates, WHEN it animates, and HOW it moves.**\n\n`;

    for (const frame of anim.scrollFrames) {
      const sectionLabel = getScrollLabel(frame.scrollPercent);
      md += `### ${frame.scrollPercent}% — ${sectionLabel}\n`;
      md += `Scroll position: ${frame.scrollY.toLocaleString()}px\n\n`;
      md += `![Scroll ${frame.scrollPercent}%](../${frame.filePath})\n\n`;
    }
  }

  // ── Video Backgrounds ────────────────────────────────────────────────
  if (anim.videos.length > 0) {
    md += `## Video Elements\n\n`;
    md += `| # | Role | Autoplay | Loop | Muted | Size | First Frame |\n`;
    md += `|---|------|----------|------|-------|------|-------------|\n`;
    for (const v of anim.videos) {
      const size = v.width && v.height ? `${v.width}×${v.height}` : '—';
      const frame = v.firstFramePath ? `[view](../${v.firstFramePath})` : '—';
      md += `| ${v.index} | ${v.role} | ${v.autoplay ? '✓' : '—'} | ${v.loop ? '✓' : '—'} | ${v.muted ? '✓' : '—'} | ${size} | ${frame} |\n`;
    }
    md += `\n`;
    for (const v of anim.videos) {
      if (v.firstFramePath) {
        md += `**Video ${v.index} first frame:**\n\n`;
        md += `![Video ${v.index} Frame](../${v.firstFramePath})\n\n`;
      }
      if (v.src) {
        md += `- **Source:** \`${v.src.slice(0, 120)}\`\n`;
      }
      if (v.poster) md += `- **Poster:** \`${v.poster.slice(0, 120)}\`\n`;
    }
    md += `\n`;
  }

  // ── Scroll Animation Patterns ────────────────────────────────────────
  if (anim.scrollPatterns.length > 0) {
    md += `## Scroll Animation Patterns\n\n`;
    md += `| Pattern | Library | Element Count | Duration | Delay | Easing |\n`;
    md += `|---------|---------|---------------|----------|-------|--------|\n`;
    for (const p of anim.scrollPatterns) {
      md += `| ${p.animationType} | ${p.library} | ${p.count} | ${p.duration || '—'} | ${p.delay || '—'} | ${p.easing || '—'} |\n`;
    }
    md += `\n`;

    // Implementation guide per library
    const libsUsed = [...new Set(anim.scrollPatterns.map(p => p.library))];
    for (const lib of libsUsed) {
      const patterns = anim.scrollPatterns.filter(p => p.library === lib);
      md += `### ${lib} Implementation\n\n`;
      if (lib === 'AOS') {
        md += `\`\`\`html\n<!-- Add to <head> -->\n<link rel="stylesheet" href="https://unpkg.com/aos@2.3.1/dist/aos.css">\n\n`;
        md += `<!-- Add before </body> -->\n<script src="https://unpkg.com/aos@2.3.1/dist/aos.js"></script>\n<script>AOS.init({ once: true, offset: 80 });</script>\n\`\`\`\n\n`;
        for (const p of patterns.slice(0, 5)) {
          const dur = p.duration ? ` data-aos-duration="${p.duration}"` : '';
          const del = p.delay ? ` data-aos-delay="${p.delay}"` : '';
          md += `\`\`\`html\n<div data-aos="${p.animationType}"${dur}${del}>...</div>\n\`\`\`\n\n`;
        }
      } else if (lib.includes('GSAP')) {
        md += `\`\`\`javascript\n// GSAP ScrollTrigger\ngsap.registerPlugin(ScrollTrigger);\n\n`;
        md += `gsap.from('.element', {\n  opacity: 0,\n  y: 60,\n  duration: 0.8,\n  ease: 'power2.out',\n  scrollTrigger: {\n    trigger: '.element',\n    start: 'top 80%',\n    end: 'bottom 20%',\n  }\n});\n\`\`\`\n\n`;
      } else if (lib === 'CSS + IntersectionObserver') {
        md += `\`\`\`css\n.animate-on-scroll {\n  opacity: 0;\n  transform: translateY(40px);\n  animation: fadeSlideUp 0.6s ease-out forwards;\n  animation-play-state: paused;\n}\n.animate-on-scroll.visible {\n  animation-play-state: running;\n}\n\`\`\`\n\n`;
        md += `\`\`\`javascript\nconst observer = new IntersectionObserver((entries) => {\n  entries.forEach(e => {\n    if (e.isIntersecting) e.target.classList.add('visible');\n  });\n}, { threshold: 0.1 });\ndocument.querySelectorAll('.animate-on-scroll').forEach(el => observer.observe(el));\n\`\`\`\n\n`;
      }
    }
  }

  // ── CSS Keyframes ─────────────────────────────────────────────────────
  if (anim.keyframes.length > 0) {
    md += `## CSS Keyframes (${anim.keyframes.length} extracted)\n\n`;

    // Sort: most-used keyframes first
    const sorted = [...anim.keyframes].sort((a, b) => (b.usedBy.length) - (a.usedBy.length));

    for (const kf of sorted) {
      md += `### \`@keyframes ${kf.name}\`\n\n`;

      // Meta row
      const meta: string[] = [];
      if (kf.animDuration) meta.push(`Duration: \`${kf.animDuration}\``);
      if (kf.animEasing) meta.push(`Easing: \`${kf.animEasing}\``);
      if (kf.animDelay) meta.push(`Delay: \`${kf.animDelay}\``);
      if (kf.animIteration) meta.push(`Iteration: \`${kf.animIteration}\``);
      if (kf.animFillMode) meta.push(`Fill: \`${kf.animFillMode}\``);
      if (meta.length > 0) md += meta.join(' · ') + `\n\n`;

      if (kf.usedBy.length > 0) {
        md += `Used by: ${kf.usedBy.slice(0, 4).map(s => `\`${s}\``).join(', ')}\n\n`;
      }

      // Full keyframe code
      md += `\`\`\`css\n@keyframes ${kf.name} {\n`;
      for (const stop of kf.stops) {
        md += `  ${stop.stop} {\n`;
        for (const [prop, val] of Object.entries(stop.properties)) {
          if (val && val !== 'initial') {
            md += `    ${prop}: ${val};\n`;
          }
        }
        md += `  }\n`;
      }
      md += `}\n\`\`\`\n\n`;

      // Detect animation type and describe what it does
      const description = describeKeyframe(kf);
      if (description) md += `> ${description}\n\n`;
    }
  }

  // ── Animation CSS Variables ───────────────────────────────────────────
  if (anim.animationVars.length > 0) {
    md += `## Motion Tokens (CSS Variables)\n\n`;

    const byCategory: Record<string, typeof anim.animationVars> = {};
    for (const v of anim.animationVars) {
      if (!byCategory[v.category]) byCategory[v.category] = [];
      byCategory[v.category].push(v);
    }

    const catOrder = ['duration', 'easing', 'delay', 'animation', 'other'];
    for (const cat of catOrder) {
      const vars = byCategory[cat];
      if (!vars?.length) continue;

      md += `### ${cat.charAt(0).toUpperCase() + cat.slice(1)} Tokens\n\n`;
      md += `\`\`\`css\n`;
      for (const v of vars) {
        md += `${v.name}: ${v.value};\n`;
      }
      md += `\`\`\`\n\n`;
    }
  }

  // ── Global Transitions ────────────────────────────────────────────────
  if (anim.globalTransitions.length > 0) {
    md += `## Global Transition Declarations\n\n`;
    md += `These \`transition\` values were extracted from CSS rules across the site:\n\n`;
    md += `\`\`\`css\n`;
    const uniqueT = [...new Set(anim.globalTransitions)].slice(0, 12);
    for (const t of uniqueT) {
      md += `transition: ${t};\n`;
    }
    md += `\`\`\`\n\n`;
  }

  // ── Implementation Guide ──────────────────────────────────────────────
  md += `## How to Recreate This Motion Design\n\n`;

  // Step 1: Libraries
  if (anim.libraries.length > 0) {
    md += `### Step 1 — Install Dependencies\n\n\`\`\`bash\n`;
    for (const lib of anim.libraries) {
      const pkg = libraryToPackage(lib.name);
      if (pkg) md += `npm install ${pkg}\n`;
    }
    md += `\`\`\`\n\n`;
  }

  // Step 2: Scroll animations
  md += `### Step 2 — Scroll-Reveal Pattern\n\n`;
  md += `Elements that animate into view follow this pattern:\n\n`;
  md += `\`\`\`css\n/* Initial hidden state */\n.reveal {\n  opacity: 0;\n  transform: translateY(40px);\n`;

  const mainDuration = anim.animationVars.find(v => v.category === 'duration')?.value
    || anim.globalTransitions[0]?.match(/\d+\.?\d*(?:ms|s)/)?.[0]
    || '0.6s';
  const mainEase = anim.animationVars.find(v => v.category === 'easing')?.value
    || 'cubic-bezier(0.4, 0, 0.2, 1)';

  md += `  transition: opacity ${mainDuration} ${mainEase},\n              transform ${mainDuration} ${mainEase};\n}\n.reveal.visible {\n  opacity: 1;\n  transform: translateY(0);\n}\n\`\`\`\n\n`;

  // Step 3: Key animation recommendations
  md += `### Step 3 — Key Motion Principles\n\n`;

  if (anim.webglDetected) {
    md += `- **WebGL/3D layer detected** — product visualizations use Three.js or custom WebGL. Use \`<canvas>\` with Three.js for 3D product renders\n`;
  }
  if (anim.videos.filter(v => v.role === 'background').length > 0) {
    md += `- **Video backgrounds** — use \`<video autoplay loop muted playsinline>\` for background videos. Always include a poster image fallback\n`;
  }
  if (anim.libraries.some(l => l.name === 'GSAP' || l.name === 'ScrollTrigger')) {
    md += `- **GSAP ScrollTrigger** — scroll-linked animations (product rotation, parallax) use \`ScrollTrigger.scrub\` for frame-perfect scroll sync\n`;
  }
  if (anim.canvasCount > 0) {
    md += `- **Canvas elements (${anim.canvasCount})** — animated via requestAnimationFrame loop. Use canvas for particle effects, gradient animations, and WebGL scenes\n`;
  }

  // Extract main transition duration for reference
  const durations = anim.animationVars.filter(v => v.category === 'duration').map(v => v.value);
  const globalDurations = anim.globalTransitions
    .join(' ')
    .match(/\d+\.?\d*(?:ms|s)/g)
    ?.slice(0, 5) || [];
  const allDurations = [...new Set([...durations, ...globalDurations])];

  if (allDurations.length > 0) {
    md += `- **Duration scale:** ${allDurations.map(d => `\`${d}\``).join(' · ')} — use these values, never invent new durations\n`;
  }

  md += `- **Always add** \`@media (prefers-reduced-motion: reduce) { * { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; } }\`\n`;
  md += `\n`;

  // Step 4: Scroll journey reference
  if (anim.scrollFrames.length > 0) {
    md += `### Step 4 — Scroll Journey Reference\n\n`;
    md += `Match what happens at each scroll position:\n\n`;
    for (const f of anim.scrollFrames) {
      md += `- **${f.scrollPercent}%** (\`${f.scrollY}px\`) → \`${f.filePath}\`\n`;
    }
    md += `\n`;
  }

  return md;
}

// ── Helpers ───────────────────────────────────────────────────────────

function getScrollLabel(pct: number): string {
  if (pct === 0) return 'Top / Hero';
  if (pct <= 20) return 'Opening Section';
  if (pct <= 40) return 'First Feature Section';
  if (pct <= 60) return 'Mid-Page';
  if (pct <= 80) return 'Lower Content';
  if (pct < 100) return 'Near Footer';
  return 'Bottom / Footer';
}

function describeKeyframe(kf: ExtractedKeyframe): string {
  const allProps = kf.stops.flatMap(s => Object.keys(s.properties));
  const uniq = [...new Set(allProps)];

  const has = (p: string) => uniq.some(u => u.includes(p));

  const descriptions: string[] = [];
  if (has('opacity') && has('transform')) descriptions.push('Fade + motion enter animation');
  else if (has('opacity')) descriptions.push('Opacity fade');
  else if (has('transform')) descriptions.push('Transform/motion animation');
  if (has('background')) descriptions.push('Background color/gradient shift');
  if (has('clip-path') || has('clipPath')) descriptions.push('Clip-path reveal');
  if (has('filter')) descriptions.push('Filter effect (blur/brightness)');
  if (has('stroke')) descriptions.push('SVG stroke animation');
  if (has('width') || has('height') || has('max-height') || has('max-width')) descriptions.push('Dimension expand/collapse');
  if (has('border')) descriptions.push('Border animation');
  if (has('box-shadow')) descriptions.push('Shadow pulse/glow effect');
  if (has('background-position')) descriptions.push('Background position (shimmer/scroll)');
  if (has('color')) descriptions.push('Text color shift');

  return descriptions.slice(0, 2).join(' · ');
}

function libraryToPackage(name: string): string {
  const map: Record<string, string> = {
    'GSAP': 'gsap',
    'ScrollTrigger': 'gsap',
    'ScrollSmoother': 'gsap',
    'Lottie': 'lottie-web',
    'Bodymovin (Lottie)': 'lottie-web',
    'Three.js': 'three',
    'PixiJS': 'pixi.js',
    'Framer Motion': 'framer-motion',
    'Motion One / Framer Motion': 'motion',
    'AOS (Animate On Scroll)': 'aos',
    'AOS': 'aos',
    'Anime.js': 'animejs',
    'Velocity.js': 'velocity-animate',
    'Matter.js (Physics)': 'matter-js',
    'Locomotive Scroll': 'locomotive-scroll',
  };
  return map[name] || '';
}

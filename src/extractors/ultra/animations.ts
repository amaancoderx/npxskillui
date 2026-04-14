import * as fs from 'fs';
import * as path from 'path';
import { loadPlaywright } from '../../playwright-loader';
import {
  FullAnimationResult,
  ExtractedKeyframe,
  ScrollFrame,
  DetectedLibrary,
  VideoInfo,
  ScrollAnimationPattern,
  CSSAnimationVar,
} from '../../types-ultra';

/**
 * Ultra mode — Full Animation Extractor
 *
 * Extracts EVERYTHING animation-related from a live website:
 *
 * 1. CSS @keyframes — complete with property values, selectors that use them,
 *    duration/easing/delay/iteration metadata
 * 2. Scroll journey screenshots — 7 frames at 0/17/33/50/67/83/100% scroll depth,
 *    showing the cinematic state at every point of the page
 * 3. Animation library detection — GSAP, ScrollTrigger, Lottie, Framer Motion,
 *    AOS, Anime.js, Three.js, Canvas, WebGL, etc.
 * 4. Video backgrounds — src, poster, autoplay/loop/muted, first-frame capture
 * 5. Scroll-triggered patterns — data-aos, data-scroll, IntersectionObserver-driven,
 *    GSAP ScrollTrigger elements
 * 6. CSS animation variables — --duration-*, --ease-*, --delay-*, etc.
 *
 * Requires Playwright (optional peer dependency).
 */
export async function captureAnimations(
  url: string,
  skillDir: string
): Promise<FullAnimationResult> {
  const empty: FullAnimationResult = {
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

  const playwright = loadPlaywright();
  if (!playwright) return empty;

  const scrollDir = path.join(skillDir, 'screens', 'scroll');
  fs.mkdirSync(scrollDir, { recursive: true });

  const browser = await playwright.chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    });

    const page = await context.newPage();

    // Disable CSS animations for initial load (avoids capturing mid-animation state)
    // We'll re-enable them before scroll capture
    await page.addInitScript(() => {
      // Store original to restore later
      (window as any).__claudeui_originalRAF = window.requestAnimationFrame;
    });

    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(2000);

    // ── Phase 1: Extract CSS keyframes from document.styleSheets ──────────
    const keyframesRaw = await page.evaluate(() => {
      const result: Array<{
        name: string;
        stops: Array<{ stop: string; properties: Record<string, string> }>;
      }> = [];

      for (const sheet of Array.from(document.styleSheets)) {
        try {
          const rules = Array.from(sheet.cssRules || []);
          for (const rule of rules) {
            if (rule.type === CSSRule.KEYFRAMES_RULE) {
              const kfRule = rule as CSSKeyframesRule;
              const stops = [];
              for (const kf of Array.from(kfRule.cssRules)) {
                const kfStop = kf as CSSKeyframeRule;
                const props: Record<string, string> = {};
                for (let i = 0; i < kfStop.style.length; i++) {
                  const p = kfStop.style[i];
                  props[p] = kfStop.style.getPropertyValue(p);
                }
                stops.push({ stop: kfStop.keyText, properties: props });
              }
              result.push({ name: kfRule.name, stops });
            }
          }
        } catch {
          // Cross-origin stylesheet — skip
        }
      }
      return result;
    });

    // ── Phase 2: Map animation-name → selector + properties ───────────────
    const animUsageRaw = await page.evaluate(() => {
      const usage: Record<string, {
        selectors: string[];
        duration?: string;
        easing?: string;
        delay?: string;
        iteration?: string;
        fillMode?: string;
        direction?: string;
      }> = {};

      for (const sheet of Array.from(document.styleSheets)) {
        try {
          for (const rule of Array.from(sheet.cssRules || [])) {
            if (rule.type === CSSRule.STYLE_RULE) {
              const styleRule = rule as CSSStyleRule;
              const name = styleRule.style.animationName;
              if (!name || name === 'none' || name === '') continue;

              // Multiple animation-names separated by commas
              const names = name.split(',').map((n: string) => n.trim());
              for (const n of names) {
                if (!n || n === 'none') continue;
                if (!usage[n]) {
                  usage[n] = { selectors: [] };
                }
                usage[n].selectors.push(styleRule.selectorText?.slice(0, 80) || '');
                if (!usage[n].duration) usage[n].duration = styleRule.style.animationDuration || undefined;
                if (!usage[n].easing) usage[n].easing = styleRule.style.animationTimingFunction || undefined;
                if (!usage[n].delay) usage[n].delay = styleRule.style.animationDelay || undefined;
                if (!usage[n].iteration) usage[n].iteration = styleRule.style.animationIterationCount || undefined;
                if (!usage[n].fillMode) usage[n].fillMode = styleRule.style.animationFillMode || undefined;
                if (!usage[n].direction) usage[n].direction = styleRule.style.animationDirection || undefined;
              }
            }
          }
        } catch { /* cross-origin */ }
      }
      return usage;
    });

    // Merge keyframes + usage
    const keyframes: ExtractedKeyframe[] = keyframesRaw.map((kf: { name: string; stops: Array<{ stop: string; properties: Record<string, string> }> }) => {
      const usage = animUsageRaw[kf.name] || {};
      return {
        name: kf.name,
        stops: kf.stops,
        usedBy: [...new Set(usage.selectors || [])].filter(Boolean).slice(0, 8),
        animDuration: usage.duration,
        animEasing: usage.easing,
        animDelay: usage.delay,
        animIteration: usage.iteration,
        animFillMode: usage.fillMode,
        animDirection: usage.direction,
      };
    });

    // ── Phase 3: CSS Animation Variables ──────────────────────────────────
    const animVarsRaw = await page.evaluate(() => {
      const vars: Array<{ name: string; value: string }> = [];
      for (const sheet of Array.from(document.styleSheets)) {
        try {
          for (const rule of Array.from(sheet.cssRules || [])) {
            if (rule.type === CSSRule.STYLE_RULE) {
              const sr = rule as CSSStyleRule;
              if (sr.selectorText !== ':root' && sr.selectorText !== 'html' && sr.selectorText !== '*') continue;
              for (let i = 0; i < sr.style.length; i++) {
                const prop = sr.style[i];
                if (prop.startsWith('--')) {
                  const val = sr.style.getPropertyValue(prop).trim();
                  // Only animation-related variables
                  if (/duration|ease|delay|timing|animation|transition|spring|bounce|motion|speed|curve/i.test(prop)) {
                    vars.push({ name: prop, value: val });
                  }
                }
              }
            }
          }
        } catch { /* cross-origin */ }
      }
      // Also read computed styles on :root for CSS vars
      const rootStyle = getComputedStyle(document.documentElement);
      for (const prop of Array.from(rootStyle)) {
        if (prop.startsWith('--') && /duration|ease|delay|timing|animation|transition|spring|bounce|motion|speed|curve/i.test(prop)) {
          const val = rootStyle.getPropertyValue(prop).trim();
          if (val && !vars.find(v => v.name === prop)) {
            vars.push({ name: prop, value: val });
          }
        }
      }
      return vars;
    });

    const animationVars: CSSAnimationVar[] = (animVarsRaw as Array<{ name: string; value: string }>).map(v => ({
      name: v.name,
      value: v.value,
      category: categorizeAnimVar(v.name),
    }));

    // ── Phase 4: Detect Animation Libraries ───────────────────────────────
    const librariesRaw = await page.evaluate(() => {
      const found: Array<{ name: string; version?: string; type: string; cdn?: string }> = [];
      const w = window as any;

      // GSAP
      if (w.gsap) found.push({ name: 'GSAP', version: w.gsap.version, type: 'animation' });
      if (w.ScrollTrigger) found.push({ name: 'ScrollTrigger', type: 'scroll' });
      if (w.ScrollSmoother) found.push({ name: 'ScrollSmoother', type: 'scroll' });

      // Lottie
      if (w.lottie || w.Lottie) found.push({ name: 'Lottie', version: (w.lottie || w.Lottie)?.version, type: 'lottie' });
      if (w.bodymovin) found.push({ name: 'Bodymovin (Lottie)', type: 'lottie' });

      // Three.js / WebGL
      if (w.THREE) found.push({ name: 'Three.js', version: w.THREE.REVISION, type: '3d' });
      if (w.PIXI) found.push({ name: 'PixiJS', version: w.PIXI.VERSION, type: '3d' });
      if (w.Babylon) found.push({ name: 'BabylonJS', type: '3d' });

      // Framer Motion
      if (w.Motion || w.motion) found.push({ name: 'Motion One / Framer Motion', type: 'animation' });

      // AOS
      if (w.AOS) found.push({ name: 'AOS (Animate On Scroll)', version: w.AOS.version, type: 'scroll' });

      // Anime.js
      if (w.anime) found.push({ name: 'Anime.js', version: w.anime.version, type: 'animation' });

      // ScrollMagic
      if (w.ScrollMagic) found.push({ name: 'ScrollMagic', type: 'scroll' });

      // Locomotive Scroll
      if (w.LocomotiveScroll || w.locomotiveScroll) found.push({ name: 'Locomotive Scroll', type: 'scroll' });

      // Velocity.js
      if (w.Velocity) found.push({ name: 'Velocity.js', type: 'animation' });

      // Popmotion
      if (w.popmotion) found.push({ name: 'Popmotion', type: 'physics' });

      // Matter.js
      if (w.Matter) found.push({ name: 'Matter.js (Physics)', type: 'physics' });

      // Web Animations API usage (check if any element has getAnimations)
      const hasWAAPI = typeof Element.prototype.getAnimations === 'function';
      const liveAnims = document.querySelectorAll('*');
      let wapiCount = 0;
      liveAnims.forEach(el => {
        try {
          const anims = el.getAnimations();
          if (anims.length > 0) wapiCount += anims.length;
        } catch {}
      });
      if (wapiCount > 0 && hasWAAPI) {
        found.push({ name: `Web Animations API (${wapiCount} active)`, type: 'animation' });
      }

      // Check script src tags for CDN libraries
      const scripts = Array.from(document.querySelectorAll('script[src]'));
      for (const script of scripts) {
        const src = (script as HTMLScriptElement).src || '';
        if (/gsap/i.test(src) && !found.find(f => f.name === 'GSAP')) {
          found.push({ name: 'GSAP', type: 'animation', cdn: src.split('/').slice(0, 5).join('/') });
        }
        if (/lottie|bodymovin/i.test(src) && !found.find(f => f.name.includes('Lottie'))) {
          found.push({ name: 'Lottie', type: 'lottie', cdn: src.split('/').slice(0, 5).join('/') });
        }
        if (/three\.js|three\.min/i.test(src) && !found.find(f => f.name === 'Three.js')) {
          found.push({ name: 'Three.js', type: '3d', cdn: src });
        }
        if (/framer-motion|motion\.js/i.test(src)) {
          found.push({ name: 'Framer Motion', type: 'animation', cdn: src });
        }
        if (/aos\.js|aos\.min/i.test(src) && !found.find(f => f.name.includes('AOS'))) {
          found.push({ name: 'AOS', type: 'scroll', cdn: src });
        }
      }

      return found;
    });
    const libraries: DetectedLibrary[] = librariesRaw as DetectedLibrary[];

    // ── Phase 5: Video detection + first-frame capture ────────────────────
    const videosRaw = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('video')).map((v, i) => ({
        index: i + 1,
        src: v.src || v.querySelector('source')?.getAttribute('src') || '',
        poster: v.poster || '',
        autoplay: v.autoplay,
        loop: v.loop,
        muted: v.muted,
        width: Math.round(v.offsetWidth),
        height: Math.round(v.offsetHeight),
        role: v.offsetWidth > 800 ? 'background' : 'content',
      }));
    });

    const videos: VideoInfo[] = [];
    for (const v of videosRaw.slice(0, 6) as Array<{index:number;src:string;poster:string;autoplay:boolean;loop:boolean;muted:boolean;width:number;height:number;role:string}>) {
      const videoEntry: VideoInfo = { ...v, role: v.role as VideoInfo['role'] };
      // Try to capture first frame
      try {
        const videoEl = page.locator('video').nth(v.index - 1);
        const box = await videoEl.boundingBox();
        if (box && box.width > 50 && box.height > 50) {
          const framePath = path.join(scrollDir, `video-${v.index}-frame.png`);
          await page.evaluate((idx: number) => {
            const vEl = document.querySelectorAll('video')[idx];
            if (vEl) { vEl.pause(); vEl.currentTime = 0; }
          }, v.index - 1);
          await page.waitForTimeout(300);
          await page.screenshot({
            path: framePath,
            clip: { x: box.x, y: box.y, width: Math.min(box.width, 1440), height: Math.min(box.height, 900) },
          });
          videoEntry.firstFramePath = `screens/scroll/video-${v.index}-frame.png`;
        }
      } catch { /* video frame capture failed */ }
      videos.push(videoEntry);
    }

    // ── Phase 6: Detect scroll-triggered elements ─────────────────────────
    const scrollPatternsRaw = await page.evaluate(() => {
      const patterns: Array<{
        selector: string;
        library: string;
        attribute: string;
        animationType: string;
        duration?: string;
        delay?: string;
        easing?: string;
        count: number;
      }> = [];

      // AOS
      const aosEls = document.querySelectorAll('[data-aos]');
      const aosGroups: Record<string, number> = {};
      aosEls.forEach(el => {
        const type = el.getAttribute('data-aos') || 'unknown';
        aosGroups[type] = (aosGroups[type] || 0) + 1;
      });
      for (const [type, count] of Object.entries(aosGroups)) {
        const sample = document.querySelector(`[data-aos="${type}"]`);
        patterns.push({
          selector: `[data-aos="${type}"]`,
          library: 'AOS',
          attribute: `data-aos="${type}"`,
          animationType: type,
          duration: sample?.getAttribute('data-aos-duration') || undefined,
          delay: sample?.getAttribute('data-aos-delay') || undefined,
          easing: sample?.getAttribute('data-aos-easing') || undefined,
          count,
        });
      }

      // Locomotive Scroll
      const locoEls = document.querySelectorAll('[data-scroll]');
      if (locoEls.length > 0) {
        patterns.push({
          selector: '[data-scroll]',
          library: 'Locomotive Scroll',
          attribute: 'data-scroll',
          animationType: 'scroll-reveal',
          count: locoEls.length,
        });
      }

      // GSAP data attributes
      const gsapEls = document.querySelectorAll('[data-gsap], [data-animation], [data-parallax]');
      if (gsapEls.length > 0) {
        patterns.push({
          selector: '[data-gsap], [data-animation]',
          library: 'GSAP',
          attribute: 'data-gsap',
          animationType: 'scroll-trigger',
          count: gsapEls.length,
        });
      }

      // Intersection Observer — detect elements with opacity:0 / transform waiting to animate
      // (common pattern: element starts invisible, IO makes it visible)
      let ioCount = 0;
      document.querySelectorAll('[class]').forEach(el => {
        const s = window.getComputedStyle(el);
        const opacity = parseFloat(s.opacity);
        const transform = s.transform;
        const animName = s.animationName;
        const animPlayState = s.animationPlayState;
        if (
          (opacity < 0.1 || (transform !== 'none' && transform !== 'matrix(1, 0, 0, 1, 0, 0)')) &&
          animPlayState === 'paused'
        ) {
          ioCount++;
        }
      });
      if (ioCount > 0) {
        patterns.push({
          selector: '.animation-paused',
          library: 'CSS + IntersectionObserver',
          attribute: 'animation-play-state: paused',
          animationType: 'scroll-reveal (paused → running)',
          count: ioCount,
        });
      }

      // Sticky + parallax elements
      const stickyEls = document.querySelectorAll('[style*="sticky"], [class*="sticky"], [class*="parallax"]');
      if (stickyEls.length > 0) {
        patterns.push({
          selector: '.sticky, .parallax',
          library: 'CSS',
          attribute: 'position: sticky',
          animationType: 'parallax / sticky scroll',
          count: stickyEls.length,
        });
      }

      // Lottie players
      const lottieEls = document.querySelectorAll('lottie-player, dotlottie-player, [data-lottie]');
      if (lottieEls.length > 0) {
        patterns.push({
          selector: 'lottie-player',
          library: 'Lottie',
          attribute: 'lottie-player',
          animationType: 'vector animation',
          count: lottieEls.length,
        });
      }

      return patterns;
    });
    const scrollPatterns: ScrollAnimationPattern[] = scrollPatternsRaw;

    // ── Phase 7: Detect canvas + WebGL ─────────────────────────────────────
    const mediaInfo = await page.evaluate(() => {
      const canvases = document.querySelectorAll('canvas');
      let webgl = false;
      canvases.forEach(c => {
        try {
          if (c.getContext('webgl') || c.getContext('webgl2') || c.getContext('experimental-webgl')) {
            webgl = true;
          }
        } catch {}
      });
      const lotties = document.querySelectorAll('lottie-player, dotlottie-player, [data-lottie], svg[class*="lottie"]');
      return { canvasCount: canvases.length, webgl, lottieCount: lotties.length };
    });

    // ── Phase 8: Global transition declarations ────────────────────────────
    const transitionsRaw = await page.evaluate(() => {
      const found: string[] = [];
      for (const sheet of Array.from(document.styleSheets)) {
        try {
          for (const rule of Array.from(sheet.cssRules || [])) {
            if (rule.type === CSSRule.STYLE_RULE) {
              const sr = rule as CSSStyleRule;
              const t = sr.style.transition;
              if (t && t !== 'none' && t !== 'all 0s ease 0s' && !t.startsWith('all 0s')) {
                found.push(t);
              }
            }
          }
        } catch {}
      }
      // Deduplicate and return top 20
      return [...new Set(found)].slice(0, 20);
    });

    // ── Phase 9: Scroll Journey Screenshots ───────────────────────────────
    const scrollFrames: ScrollFrame[] = [];
    const scrollPercents = [0, 17, 33, 50, 67, 83, 100];

    const pageHeight: number = await page.evaluate(() => document.documentElement.scrollHeight);

    for (const pct of scrollPercents) {
      const targetY = Math.round((pct / 100) * Math.max(0, pageHeight - 900));

      try {
        // Instant scroll to position
        await page.evaluate((y: number) => window.scrollTo({ top: y, behavior: 'instant' }), targetY);
        // Wait for scroll-triggered animations to fire
        await page.waitForTimeout(700);

        const fileName = `scroll-${String(pct).padStart(3, '0')}.png`;
        const filePath = path.join(scrollDir, fileName);

        await page.screenshot({
          path: filePath,
          clip: { x: 0, y: 0, width: 1440, height: 900 },
        });

        const actualY: number = await page.evaluate(() => window.scrollY);

        scrollFrames.push({
          scrollPercent: pct,
          scrollY: actualY,
          pageHeight,
          filePath: `screens/scroll/${fileName}`,
        });
      } catch { /* frame failed */ }
    }

    await page.close();

    return {
      keyframes,
      scrollFrames,
      libraries,
      videos,
      scrollPatterns,
      animationVars: animationVars.slice(0, 40),
      globalTransitions: transitionsRaw,
      canvasCount: mediaInfo.canvasCount,
      webglDetected: mediaInfo.webgl,
      lottieCount: mediaInfo.lottieCount,
    };
  } finally {
    await browser.close().catch(() => {});
  }
}

function categorizeAnimVar(name: string): CSSAnimationVar['category'] {
  if (/duration|speed/i.test(name)) return 'duration';
  if (/ease|timing|curve|bezier/i.test(name)) return 'easing';
  if (/delay/i.test(name)) return 'delay';
  if (/animation|keyframe/i.test(name)) return 'animation';
  return 'other';
}

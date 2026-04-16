import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import { runDirMode } from './modes/dir.js';
import { runRepoMode } from './modes/repo.js';
import { runUrlMode } from './modes/url.js';
import { runUltraMode } from './modes/ultra.js';
import { generateDesignMd } from './writers/design-md.js';
import { generateSkill } from './writers/skill.js';
import { CLIOptions, DesignProfile } from './types.js';
import {
  VERSION,
  showLogo,
  showMissionBrief,
  startSpinner,
  succeedSpinner,
  failSpinner,
  warnLine,
  showUltraPlaywrightError,
  showResults,
  runInteractivePrompts,
  promptLoginCredentials,
  showLoginSuccess,
  showLoginFailed,
} from './ui.js';
import { detectLoginPage, detectLoginPageWithPlaywright, performLogin, extractCookieHeader, StorageState } from './login.js';
import { loadPlaywright } from './playwright-loader.js';

const program = new Command();

// Ensure Ctrl+C kills the process even when Playwright browsers are running.
// Playwright child processes (Chromium) can keep the event loop alive and
// prevent a clean process.exit(). We use SIGKILL as a fallback.
process.on('SIGINT', () => {
  process.stderr.write('\n  Interrupted — shutting down...\n');
  // Give 3s for graceful cleanup, then force-kill
  const forceTimer = setTimeout(() => {
    process.kill(process.pid, 'SIGKILL');
  }, 3000);
  forceTimer.unref();
  process.exit(130);
});
process.on('SIGTERM', () => {
  const forceTimer = setTimeout(() => {
    process.kill(process.pid, 'SIGKILL');
  }, 3000);
  forceTimer.unref();
  process.exit(143);
});

program
  .name('skillui')
  .description('Reverse-engineer design systems from any project. Pure static analysis — no AI, no API keys.')
  .version(VERSION)
  .option('--dir <path>', 'Scan a local project directory')
  .option('--repo <url>', 'Clone and scan a git repository')
  .option('--url <url>', 'Crawl a live website')
  .option('--out <path>', 'Output directory', './')
  .option('--name <string>', 'Override project name')
  .option('--no-skill', 'Output DESIGN.md only, skip .skill packaging')
  .option('--format <format>', 'Output format: design-md | skill | both', 'both')
  .option('--mode <mode>', 'Extraction mode: default | ultra', 'default')
  .option('--screens <number>', 'Ultra mode: max pages to crawl (default: 5)', '5')
  .option('--user <string>', 'Login username or email (for authenticated sites)')
  .option('--pass <string>', 'Login password (for authenticated sites)')
  .option('--login', 'Force login prompt (skip auto-detection)')
  .action(async (opts: CLIOptions) => {
    // Always show the logo on every command
    await showLogo();

    const modes = [opts.dir, opts.repo, opts.url].filter(Boolean);

    if (modes.length === 0) {
      // No args — ask step-by-step questions
      const answers = await runInteractivePrompts();
      if (!answers) process.exit(0);
      opts.url  = answers.source === 'url'  ? answers.target : undefined;
      opts.dir  = answers.source === 'dir'  ? answers.target : undefined;
      opts.repo = answers.source === 'repo' ? answers.target : undefined;
      opts.mode = answers.mode;
      opts.out  = answers.out || './';
    } else if (modes.length > 1) {
      console.error('  Error: Specify only one of --dir, --repo, or --url\n');
      process.exit(1);
    }

    // ── Determine target label for brief ──────────────────────────────
    const target = opts.url || opts.dir || opts.repo || '';
    showMissionBrief(opts.mode || 'default', target, path.resolve(opts.out));

    try {
      let profile: DesignProfile;
      let screenshotPath: string | null = null;
      let storageState: StorageState | null = null;

      const outputDir = path.resolve(opts.out);
      fs.mkdirSync(outputDir, { recursive: true });

      // ── Dir mode ──────────────────────────────────────────────────
      if (opts.dir) {
        const resolvedDir = path.resolve(opts.dir);
        if (!fs.existsSync(resolvedDir)) {
          console.error(`\n  Error: Directory not found: ${resolvedDir}\n`);
          process.exit(1);
        }
        const sp = startSpinner('Scanning local directory...');
        try {
          profile = await runDirMode(resolvedDir, opts.name);
          succeedSpinner(sp, 'Directory scan', `${profile.colors.length} colors · ${profile.components.length} components`);
        } catch (e: any) {
          failSpinner(sp, 'Directory scan', e.message);
          throw e;
        }

      // ── Repo mode ─────────────────────────────────────────────────
      } else if (opts.repo) {
        const sp = startSpinner('Cloning repository...');
        try {
          profile = await runRepoMode(opts.repo, opts.name);
          succeedSpinner(sp, 'Repo clone + scan', `${profile.colors.length} colors · ${profile.components.length} components`);
        } catch (e: any) {
          failSpinner(sp, 'Repo clone', e.message);
          throw e;
        }

      // ── URL mode ──────────────────────────────────────────────────
      } else {
        const safeName = (opts.name || new URL(opts.url!).hostname.replace(/^www\./, '').split('.')[0])
          .replace(/[^a-zA-Z0-9-_]/g, '-').toLowerCase();
        const skillDir = path.join(outputDir, `${safeName}-design`);
        fs.mkdirSync(path.join(skillDir, 'screenshots'), { recursive: true });

        // ── Login detection + auth (BEFORE spinner) ──────────────────
        // Support SKILLUI_USER / SKILLUI_PASSWORD env vars (avoids exposing creds in ps)
        const authUser = opts.user || process.env.SKILLUI_USER;
        const authPass = opts.pass || process.env.SKILLUI_PASSWORD;
        const preAuthCreds = authUser && authPass ? { username: authUser, password: authPass } : undefined;

        if (opts.login) {
          // --login flag: skip detection, prompt immediately
          const creds = preAuthCreds || await promptLoginCredentials();
          if (creds) {
            const spLogin = startSpinner('Authenticating...');
            storageState = await performLogin(opts.url!, creds);
            if (storageState) {
              succeedSpinner(spLogin, 'Login', 'authenticated successfully');
              showLoginSuccess(opts.url!);
            } else {
              failSpinner(spLogin, 'Login', 'authentication failed — continuing without auth');
              showLoginFailed();
            }
          }
        } else {
          // Auto-detect login page
          let loginUrl: string | null = null;

          const spDetect = startSpinner('Checking for login page...');
          try {
            // Pass 1: HTTP fetch
            const checkRes = await fetch(opts.url!, {
              headers: { 'User-Agent': 'Mozilla/5.0 (compatible; skillui/1.0)', 'Accept': 'text/html' },
              redirect: 'follow',
              signal: AbortSignal.timeout(10000),
            });
            if (checkRes.ok) {
              const checkHtml = await checkRes.text();
              if (detectLoginPage(checkHtml, checkRes.url)) {
                loginUrl = checkRes.url;
              }
            }
          } catch { /* pre-flight failed */ }

          // Pass 2: Playwright-based SPA detection
          if (!loginUrl && loadPlaywright()) {
            loginUrl = await detectLoginPageWithPlaywright(opts.url!);
          }

          if (loginUrl) {
            succeedSpinner(spDetect, 'Login detected', loginUrl);
            // Prompt for credentials (no spinner running — input fields visible)
            const creds = preAuthCreds || await promptLoginCredentials();
            if (creds) {
              const spLogin = startSpinner('Authenticating...');
              storageState = await performLogin(loginUrl, creds);
              if (storageState) {
                succeedSpinner(spLogin, 'Login', 'authenticated successfully');
                showLoginSuccess(opts.url!);
              } else {
                failSpinner(spLogin, 'Login', 'authentication failed — continuing without auth');
                showLoginFailed();
              }
            }
          } else {
            succeedSpinner(spDetect, 'Login check', 'no login page detected');
          }
        }

        // ── Extraction (with auth if available) ──────────────────────
        const sp1 = startSpinner('Fetching HTML + CSS...');
        let urlResult: Awaited<ReturnType<typeof runUrlMode>>;
        try {
          urlResult = await runUrlMode(opts.url!, opts.name, skillDir, storageState);
          const { cssColorCount, cssFontCount, computedColorCount, hadPlaywright } = urlResult;
          const detail = hadPlaywright
            ? `${cssColorCount} CSS colors · ${computedColorCount} computed · ${cssFontCount} fonts`
            : `${cssColorCount} colors · ${cssFontCount} fonts (Playwright not found)`;
          succeedSpinner(sp1, 'CSS + token extraction', detail);
          if (!hadPlaywright) {
            warnLine('Playwright not installed — computed style extraction skipped');
            warnLine('Fix: npm install -g playwright && npx playwright install chromium');
          }
        } catch (e: any) {
          failSpinner(sp1, 'CSS + token extraction', e.message);
          throw e;
        }
        profile = urlResult.profile;
        screenshotPath = urlResult.screenshotPath;
        storageState = urlResult.storageState || storageState;
      }

      // ── Ultra mode (URL only) ──────────────────────────────────────
      const isUltra = opts.mode === 'ultra' && !!opts.url;
      let ultraAnimations: import('./types-ultra.js').FullAnimationResult | null = null;

      if (isUltra) {
        const ultraScreens = Math.max(1, Math.min(20, parseInt(opts.screens, 10) || 5));
        const safeName = (opts.name || new URL(opts.url!).hostname.replace(/^www\./, '').split('.')[0])
          .replace(/[^a-zA-Z0-9-_]/g, '-').toLowerCase();
        const skillDir = path.join(path.resolve(opts.out), `${safeName}-design`);

        // Check playwright before spinning up ultra
        const { loadPlaywright } = await import('./playwright-loader.js');
        if (!loadPlaywright()) {
          showUltraPlaywrightError();
          warnLine('Continuing without ultra features...');
        } else {
          const spAnim = startSpinner('Capturing scroll journey + animations...');
          try {
            const ultraResult = await runUltraMode(opts.url!, profile, skillDir, { screens: ultraScreens }, storageState, (step) => {
              spAnim.text = step;
            });
            ultraAnimations = ultraResult.animations;
            const kf = ultraAnimations.keyframes.length;
            const sf = ultraAnimations.scrollFrames.length;
            const libs = ultraAnimations.libraries.map(l => l.name).join(', ') || 'none';
            succeedSpinner(spAnim, 'Ultra extraction', `${sf} scroll frames · ${kf} keyframes · ${libs}`);
          } catch (e: any) {
            failSpinner(spAnim, 'Ultra extraction', e.message);
            throw e;
          }
        }
      }

      // ── Generate + write outputs ───────────────────────────────────
      const shouldWriteDesignMd = opts.format === 'design-md' || opts.format === 'both';
      const shouldWriteSkill = opts.skill !== false && (opts.format === 'skill' || opts.format === 'both');

      const designMdContent = generateDesignMd(profile, screenshotPath);
      const safeName = profile.projectName.replace(/[^a-zA-Z0-9-_]/g, '-').toLowerCase();
      const designDir = path.join(path.resolve(opts.out), `${safeName}-design`);
      fs.mkdirSync(designDir, { recursive: true });

      let designMdPath: string | undefined;
      if (shouldWriteDesignMd) {
        const spWrite = startSpinner('Writing DESIGN.md...');
        designMdPath = path.join(designDir, 'DESIGN.md');
        fs.writeFileSync(designMdPath, designMdContent, 'utf-8');
        succeedSpinner(spWrite, 'DESIGN.md', designMdPath);
      }

      let skillFilePath: string | undefined;
      let skillInstalled = false;
      if (shouldWriteSkill) {
        const spSkill = startSpinner('Bundling .skill package...');
        try {
          const result = await generateSkill(profile, designMdContent, path.resolve(opts.out), screenshotPath, ultraAnimations);
          skillFilePath = result.skillFile;
          succeedSpinner(spSkill, '.skill package', skillFilePath);

          // ── Auto-install to ~/.claude/skills/ + write CLAUDE.md ──
          // Use the actual skillDir folder name (e.g. "ascend-design") as the skill name
          const skillFolderName = path.basename(result.skillDir);
          skillInstalled = installSkillForClaude(result.skillDir, skillFolderName);
          writeClaludeMd(result.skillDir, skillFolderName, profile.projectName);
        } catch (e: any) {
          failSpinner(spSkill, '.skill package', e.message);
          throw e;
        }
      }

      // ── Show results panel ─────────────────────────────────────────
      showResults({
        profile,
        animations: ultraAnimations ?? undefined,
        skillFilePath,
        designMdPath,
        projectName: safeName,
        skillInstalled,
      });

    } catch (err: any) {
      console.error(`\n  Error: ${err.message || err}\n`);
      process.exit(1);
    }
  });

program.parse();

// ── Write CLAUDE.md into the design folder so Claude Code picks it up ────
function writeClaludeMd(skillDir: string, safeName: string, projectName: string): void {
  try {
    const claudeMdPath = path.join(skillDir, 'CLAUDE.md');
    // Don't overwrite if one already exists
    if (fs.existsSync(claudeMdPath)) return;
    const content = `# ${projectName} Design System

This project uses the **${projectName}** design system extracted by skillui.

## How to use

Read \`SKILL.md\` in this directory for the full design system reference before writing any UI code.

Key files:
- \`SKILL.md\` — master design reference (read this first)
- \`references/DESIGN.md\` — extended tokens and component specs
- \`references/ANIMATIONS.md\` — motion and keyframe specs
- \`references/LAYOUT.md\` — grid and layout containers
- \`references/COMPONENTS.md\` — DOM component patterns
- \`screens/scroll/\` — scroll journey screenshots (study before implementing)

When building any UI, always read SKILL.md first and match colors, fonts, spacing, and motion exactly.
`;
    fs.writeFileSync(claudeMdPath, content, 'utf-8');
  } catch { /* non-fatal */ }
}

// ── Auto-install skill to ~/.claude/skills/<name>/SKILL.md ───────────────
// Claude Code requires each skill to be a FOLDER with SKILL.md inside it.
function installSkillForClaude(skillDir: string, safeName: string): boolean {
  try {
    const skillMdSrc = path.join(skillDir, 'SKILL.md');
    if (!fs.existsSync(skillMdSrc)) return false;

    const homeDir = process.env.USERPROFILE || process.env.HOME || '';
    if (!homeDir) return false;

    // ~/.claude/skills/<safeName>/SKILL.md  ← correct structure for /skills
    const destDir = path.join(homeDir, '.claude', 'skills', safeName);
    fs.mkdirSync(destDir, { recursive: true });
    fs.copyFileSync(skillMdSrc, path.join(destDir, 'SKILL.md'));

    return true;
  } catch {
    return false;
  }
}

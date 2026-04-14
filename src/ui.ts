import chalk from 'chalk';
import ora, { type Ora } from 'ora';
import boxen from 'boxen';
import gradient from 'gradient-string';
import stripAnsi from 'strip-ansi';
import { SingleBar, Presets } from 'cli-progress';
import * as path from 'path';
import type { DesignProfile } from './types';
import type { FullAnimationResult } from './types-ultra';

export const VERSION = '1.3.2';

// ── Helpers ───────────────────────────────────────────────────────────────

function padAnsi(str: string, width: number): string {
  const raw = stripAnsi(str);
  return str + ' '.repeat(Math.max(0, width - raw.length));
}

// ── Section 1: Hero ───────────────────────────────────────────────────────

export async function showLogo(): Promise<void> {
  // Use oh-my-logo's block font — same chunky solid-█ pixel style as Claude Code logo
  // It prints directly to terminal, no return value
  const { renderFilled } = await import('oh-my-logo');
  console.log('');
  await renderFilled('SKILLUI', {
    palette: ['#e8735a', '#d05a34', '#c04a28'],
    font: 'block',
    letterSpacing: 1,
  });

  const g = gradient(['#e8735a', '#c04a28']);
  console.log('   ' + g('Reverse-engineer any design system — No AI. No API keys. No cloud.'));
  console.log('');

  const C1 = chalk.hex('#e8735a');
  const C2 = chalk.hex('#c04a28');
  const featureLines = [
    C1('01') + ' ' + C2('\u2746') + ' ' + chalk.white.bold('Website crawling    ') + chalk.dim('Live URL + full CSS + DOM analysis'),
    C1('02') + ' ' + C2('\u2746') + ' ' + chalk.white.bold('Local dir scanning  ') + chalk.dim('CSS/SCSS/TSX/JSX token extraction'),
    C1('03') + ' ' + C2('\u2746') + ' ' + chalk.white.bold('Git repo cloning    ') + chalk.dim('Clone + scan + package automatically'),
    C1('04') + ' ' + C2('\u2746') + ' ' + chalk.white.bold('Ultra mode          ') + chalk.dim('7 scroll frames, keyframes, interactions'),
    C1('05') + ' ' + C2('\u2746') + ' ' + chalk.white.bold('.skill packaging    ') + chalk.dim('One ZIP, drop into Claude Code'),
    C1('06') + ' ' + C2('\u2746') + ' ' + chalk.white.bold('Zero API keys       ') + chalk.dim('Pure static analysis, no cloud'),
  ];

  for (const line of featureLines) {
    console.log('   ' + line);
  }

  console.log('');
  console.log('   ' + chalk.dim('\u2500'.repeat(70)));
  console.log('');
}

export async function showHelp(): Promise<void> {
  await showLogo();

  // Section 2: Examples
  const S = chalk.dim;
  const C = chalk.hex('#38bdf8');
  const F = chalk.hex('#a78bfa');
  const V = chalk.hex('#fbbf24');

  const examples = [
    S('  $ ') + C('skillui') + F(' --url ')  + V('https://linear.app') + S('                     # default mode'),
    S('  $ ') + C('skillui') + F(' --url ')  + V('https://linear.app') + F(' --mode ') + V('ultra') + S('       # cinematic'),
    S('  $ ') + C('skillui') + F(' --dir ')  + V('./my-app')           + S('                         # local scan'),
    S('  $ ') + C('skillui') + F(' --repo ') + V('https://github.com/org/repo') + S('          # git clone'),
  ].join('\n');

  console.log(boxen(examples, {
    title: chalk.bold(' Examples '),
    borderStyle: 'round',
    borderColor: 'cyan',
    width: 76,
    padding: { top: 0, bottom: 0, left: 1, right: 1 },
  }));
  console.log('');

  // Section 3: Output files
  const G = chalk.hex('#4ade80');
  const outputs = [
    [G(padAnsi('DESIGN.md', 18))       + chalk.dim('colors, fonts, spacing'),       G(padAnsi('ANIMATIONS.md', 18))   + chalk.dim('keyframes, motion specs')],
    [G(padAnsi('LAYOUT.md', 18))       + chalk.dim('flex/grid containers'),          G(padAnsi('COMPONENTS.md', 18))   + chalk.dim('DOM patterns, fingerprints')],
    [G(padAnsi('INTERACTIONS.md', 18)) + chalk.dim('hover/focus state diffs'),       G(padAnsi('tokens/*.json', 18))   + chalk.dim('colors, spacing, type')],
    [G(padAnsi('screens/scroll/', 18)) + chalk.dim('7 cinematic scroll frames'),     G(padAnsi('project.skill', 18))   + chalk.dim('ZIP, Claude Code ready')],
  ].map(([a, b]) => '  ' + a + '     ' + b).join('\n');

  console.log(boxen(outputs, {
    title: chalk.bold(' Output files '),
    borderStyle: 'round',
    borderColor: 'green',
    width: 76,
    padding: { top: 0, bottom: 0, left: 0, right: 0 },
  }));
  console.log('');

  // Section 4: Modes comparison
  const YES = chalk.hex('#4ade80')('\u2713');
  const NO  = chalk.dim('\u2013');

  const rows: Array<[string, boolean, boolean, string?]> = [
    ['CSS colors and fonts',             true,  true],
    ['Spacing and grid tokens',          true,  true],
    ['Component patterns',               true,  true],
    ['JSON token files',                 true,  true],
    ['Full-page screenshot',             false, true],
    ['7 scroll journey frames',          false, true],
    ['CSS @keyframe extraction',         false, true],
    ['Animation lib detection',          false, true,  'GSAP, Lottie, Three.js, AOS'],
    ['Hover/focus state diffs',          false, true],
    ['DOM component fingerprinting',     false, true],
    ['Flex/grid layout extraction',      false, true],
    ['Video background capture',         false, true],
  ];

  const modesHeader =
    '  ' + chalk.bold.white(padAnsi('Feature', 34)) + chalk.bold.white('DEFAULT') + '   ' + chalk.hex('#a78bfa').bold('ULTRA');
  const modesDivider = '  ' + chalk.dim('\u2500'.repeat(52));

  const modesRows = rows.map(([label, def, ultra, extra]) => {
    const extraStr = extra ? chalk.dim('  ' + extra) : '';
    return '  ' + chalk.dim(padAnsi(label, 34)) + (def ? YES : NO) + '         ' + (ultra ? YES : NO) + extraStr;
  }).join('\n');

  const modesBadges =
    '\n  ' + chalk.bgBlackBright.white(' DEFAULT ') + chalk.dim('  Fast, no Playwright required, CSS + tokens only') +
    '\n  ' + chalk.bgHex('#2a1a40').hex('#a78bfa')(' ULTRA   ') + chalk.dim('  Full cinematic, requires: npm install playwright');

  console.log(boxen(modesHeader + '\n' + modesDivider + '\n' + modesRows + modesBadges, {
    title: chalk.bold(' Modes '),
    borderStyle: 'round',
    borderColor: 'cyan',
    width: 76,
    padding: { top: 0, bottom: 0, left: 0, right: 1 },
  }));
  console.log('');

  // Section 5: All flags
  const flagRow = (flag: string, desc: string, hint: string) =>
    '  ' + chalk.hex('#38bdf8')(padAnsi(flag, 18)) + chalk.white(padAnsi(desc, 34)) + chalk.dim(hint);

  const flagsContent = [
    chalk.dim('  \u2500\u2500 INPUT \u2500\u2500'),
    flagRow('--url <url>',    'Crawl a live website',                ''),
    flagRow('--dir <path>',   'Scan a local project directory',      ''),
    flagRow('--repo <url>',   'Clone and scan a git repository',     ''),
    '',
    chalk.dim('  \u2500\u2500 OPTIONS \u2500\u2500'),
    flagRow('--mode ultra',   'Enable cinematic extraction',         'requires Playwright'),
    flagRow('--screens <n>',  'Pages to crawl in ultra mode',        'default: 5, max: 20'),
    flagRow('--out <path>',   'Output directory',                    'default: ./'),
    flagRow('--name <str>',   'Override the project name',           ''),
    flagRow('--format <fmt>', 'design-md | skill | both',            'default: both'),
    flagRow('--no-skill',     'Output DESIGN.md only',               'skip .skill packaging'),
  ].join('\n');

  console.log(boxen(flagsContent, {
    title: chalk.bold(' All flags '),
    borderStyle: 'round',
    borderColor: 'yellow',
    width: 76,
    padding: { top: 0, bottom: 0, left: 0, right: 1 },
  }));
  console.log('');

  // Section 6: Pipeline
  const pipeline =
    chalk.bgCyan.black(' URL/DIR/REPO ') +
    chalk.dim(' \u25ba\u25ba ') +
    chalk.bgGreen.black(' FETCH & CRAWL ') +
    chalk.dim(' \u25ba\u25ba ') +
    chalk.hex('#a78bfa').bold(' EXTRACT TOKENS ') +
    chalk.dim(' \u25ba\u25ba ') +
    chalk.bgYellow.black(' PACKAGE .skill ') +
    chalk.dim(' \u25ba\u25ba ') +
    chalk.bgMagenta.white(' CLAUDE READS IT ');

  const pipelineDesc = [
    chalk.dim('  \u2022 URL mode   -- fetches HTML, crawls CSS, extracts computed styles via Playwright DOM'),
    chalk.dim('  \u2022 Dir mode   -- scans .css .scss .ts .tsx for tokens, Tailwind config, CSS variables'),
    chalk.dim('  \u2022 Ultra mode -- scroll screenshots, animation lib detection from window.* globals'),
  ].join('\n');

  console.log(boxen('  ' + pipeline + '\n\n' + pipelineDesc, {
    title: chalk.bold(' How it works '),
    borderStyle: 'round',
    borderColor: 'blue',
    width: 76,
    padding: { top: 1, bottom: 0, left: 1, right: 1 },
  }));
  console.log('');
}

// ── Section 7: Mission briefing ───────────────────────────────────────────

export function showMissionBrief(mode: string, target: string, outputDir: string): void {
  const brief = [
    '  ' + chalk.dim(padAnsi('Mode', 7))   + '  ' + chalk.cyan.bold(mode === 'ultra' ? 'ultra' : 'default'),
    '  ' + chalk.dim(padAnsi('Target', 7)) + '  ' + chalk.white(target),
    '  ' + chalk.dim(padAnsi('Output', 7)) + '  ' + chalk.dim(outputDir),
  ].join('\n');

  console.log('');
  console.log(boxen(brief, {
    title: chalk.bold.cyan(' skillui v' + VERSION + ' '),
    borderStyle: 'round',
    borderColor: 'cyan',
    width: 76,
    padding: { top: 0, bottom: 0, left: 0, right: 0 },
  }));
  console.log('');
}

// ── Section 8: Spinners ───────────────────────────────────────────────────

export function startSpinner(text: string): Ora {
  return ora({
    text: chalk.white(text),
    color: 'cyan',
    spinner: 'dots',
  }).start();
}

export function succeedSpinner(spinner: Ora, label: string, result: string): void {
  spinner.stopAndPersist({
    symbol: chalk.green('\u2713'),
    text: chalk.white(label) + '  ' + chalk.dim(result),
  });
}

export function failSpinner(spinner: Ora, label: string, error: string): void {
  spinner.stopAndPersist({
    symbol: chalk.red('\u2717'),
    text: chalk.white(label) + '  ' + chalk.red(error),
  });
}

export function warnLine(message: string): void {
  console.log('  ' + chalk.yellow('\u26a0') + '  ' + chalk.dim(message));
}

export function infoLine(message: string): void {
  console.log('  ' + chalk.dim('\u2022') + '  ' + chalk.dim(message));
}

// ── Page crawl progress bar ───────────────────────────────────────────────

export function createPageBar(total: number): SingleBar {
  const bar = new SingleBar({
    format:
      '  ' + chalk.white('Crawling pages') + '  ' + chalk.cyan('[{bar}]') +
      ' {value}/{total}  ' + chalk.dim('{percentage}%'),
    barCompleteChar: '\u2588',
    barIncompleteChar: '\u2591',
    hideCursor: true,
    clearOnComplete: false,
  }, Presets.shades_classic);
  bar.start(total, 0);
  return bar;
}

// ── Ultra playwright error ────────────────────────────────────────────────

export function showUltraPlaywrightError(): void {
  console.log('');
  console.log(boxen(
    chalk.red.bold('  Ultra mode requires Playwright.\n\n') +
    chalk.white('  Run: ') + chalk.cyan('npm install -g playwright') +
    chalk.dim(' && ') + chalk.cyan('npx playwright install chromium'),
    {
      title: chalk.bold.red(' Missing dependency '),
      borderStyle: 'round',
      borderColor: 'red',
      width: 76,
      padding: { top: 0, bottom: 0, left: 0, right: 1 },
    }
  ));
  console.log('');
}

// ── Section 9: Results panel ──────────────────────────────────────────────

interface ResultsData {
  profile: DesignProfile;
  animations?: FullAnimationResult;
  skillFilePath?: string;
  designMdPath?: string;
  projectName: string;
  skillInstalled?: boolean;
}

export function showResults(data: ResultsData): void {
  const { profile, animations, skillFilePath, designMdPath, projectName, skillInstalled } = data;
  const fontCount = new Set(profile.typography.map(t => t.fontFamily)).size;
  const framework = profile.frameworks.map(f => f.name).join(', ') || 'none detected';
  const darkMode = profile.designTraits.hasDarkMode ? 'detected' : 'not detected';

  const L = (label: string) => chalk.hex('#38bdf8')(padAnsi(label, 22));
  const V2 = (val: string) => chalk.white.bold(val);

  const resultRows: string[] = [
    '  ' + L('Colors')       + V2(profile.colors.length + ' extracted'),
    '  ' + L('Fonts')        + V2(fontCount + ' families'),
    '  ' + L('Grid')         + V2(profile.spacing.base + 'px baseline'),
    '  ' + L('Components')   + V2(profile.components.length + ' patterns'),
    '  ' + L('Animations')   + V2(profile.animations.length + ' detected'),
    '  ' + L('Framework')    + V2(framework),
    '  ' + L('Dark mode')    + V2(darkMode),
  ];

  if (animations) {
    if (animations.keyframes.length > 0)
      resultRows.push('  ' + L('Keyframes') + V2(animations.keyframes.length + ' extracted'));
    if (animations.scrollFrames.length > 0)
      resultRows.push('  ' + L('Scroll frames') + V2(animations.scrollFrames.length + ' captured'));
    if (animations.libraries.length > 0)
      resultRows.push('  ' + L('Animation stack') + V2(animations.libraries.map(l => l.name).join(', ')));
    if (animations.videos.length > 0) {
      const bg = animations.videos.filter(v => v.role === 'background').length;
      resultRows.push('  ' + L('Video elements') + V2(animations.videos.length + ' (' + bg + ' background)'));
    }
  }

  console.log('');
  console.log(boxen(resultRows.join('\n'), {
    title: chalk.bold.magenta(' Extraction Complete '),
    borderStyle: 'double',
    borderColor: 'magenta',
    width: 76,
    padding: { top: 0, bottom: 0, left: 0, right: 1 },
  }));
  console.log('');

  // Output files box
  const G = chalk.hex('#4ade80');
  const rel = (p: string) => './' + path.relative(process.cwd(), p).replace(/\\/g, '/');
  const outputRows: string[] = [];
  if (designMdPath)  outputRows.push('  ' + G(padAnsi('DESIGN.md', 18))      + chalk.dim(rel(designMdPath)));
  if (skillFilePath) outputRows.push('  ' + G(padAnsi(projectName + '.skill', 18)) + chalk.dim(rel(skillFilePath)));

  if (outputRows.length > 0) {
    console.log(boxen(outputRows.join('\n'), {
      title: chalk.bold(' Output files '),
      borderStyle: 'round',
      borderColor: 'green',
      width: 76,
      padding: { top: 0, bottom: 0, left: 0, right: 1 },
    }));
    console.log('');
  }

  // Next steps box
  const nextSteps = [
    chalk.dim('  Open Claude Code inside the design folder:'),
    '    ' + chalk.hex('#38bdf8')('cd ' + projectName + '-design && claude'),
    '',
    chalk.dim('  Claude will auto-read CLAUDE.md and SKILL.md. Then ask:'),
    '    ' + chalk.dim('"Build me a UI that matches this design system"'),
  ].join('\n');

  console.log(boxen(nextSteps, {
    title: chalk.bold(' Next steps '),
    borderStyle: 'round',
    borderColor: 'green',
    width: 76,
    padding: { top: 0, bottom: 0, left: 0, right: 1 },
  }));
  console.log('');
}

// ── Section 10: Interactive prompts ──────────────────────────────────────

export interface InteractiveAnswers {
  source: 'url' | 'dir' | 'repo';
  target: string;
  mode: 'default' | 'ultra';
  out: string;
}

export async function runInteractivePrompts(): Promise<InteractiveAnswers | null> {
  const prompts = (await import('prompts')).default;

  const answers = await prompts(
    [
      {
        type: 'select',
        name: 'source',
        message: chalk.white('What do you want to extract from?'),
        choices: [
          { title: chalk.hex('#38bdf8')('Website URL')     + chalk.dim('  --  skillui --url https://yoursite.com'), value: 'url' },
          { title: chalk.hex('#4ade80')('Local directory') + chalk.dim('  --  skillui --dir ./my-app'),             value: 'dir' },
          { title: chalk.hex('#a78bfa')('Git repository')  + chalk.dim('  --  skillui --repo https://github.com/org/repo'), value: 'repo' },
        ],
      },
      {
        type: 'text',
        name: 'target',
        message: (prev: string) =>
          prev === 'url'  ? chalk.white('Enter the website URL:') :
          prev === 'dir'  ? chalk.white('Enter the directory path:') :
                            chalk.white('Enter the git repo URL:'),
      },
      {
        type: 'select',
        name: 'mode',
        message: chalk.white('Extraction mode?'),
        choices: [
          { title: chalk.white('Default') + chalk.dim('  --  fast, CSS + tokens, no Playwright needed'), value: 'default' },
          { title: chalk.hex('#a78bfa')('Ultra') + chalk.dim('    --  cinematic, scroll frames, requires Playwright'), value: 'ultra' },
        ],
      },
      {
        type: 'text',
        name: 'out',
        message: chalk.white('Output directory?'),
        initial: './',
      },
    ],
    { onCancel: () => process.exit(0) }
  ) as InteractiveAnswers;

  if (!answers.source || !answers.target) return null;
  console.log('');
  return answers;
}

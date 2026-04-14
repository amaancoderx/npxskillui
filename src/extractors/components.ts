import * as fs from 'fs';
import * as path from 'path';
import { ComponentInfo, ComponentCategory, TailwindPattern } from '../types';

const COMPONENT_DIRS = [
  'src/components',
  'components',
  'app/components',
  'src/app/components',
  'src/ui',
  'src/common',
  'lib/components',
  'src/lib/components',
  'src/features',
  'src/views',
  'src/pages',
  'app',
  'pages',
];

const COMPONENT_EXTENSIONS = ['.tsx', '.jsx', '.vue', '.svelte'];
const IGNORE_DIRS = ['node_modules', '.git', 'dist', 'build', '__tests__', '__mocks__', '.next', '.nuxt'];

// Category detection keywords for component names and file paths
const CATEGORY_PATTERNS: Record<ComponentCategory, RegExp> = {
  'layout': /^(layout|container|grid|stack|flex|page|section|wrapper|sidebar|header|footer|main|shell|frame|panel|divider|spacer|center)/i,
  'navigation': /^(nav|navbar|menu|breadcrumb|tab|tabs|pagination|stepper|link|drawer|appbar|topbar|bottombar)/i,
  'data-display': /^(card|list|table|avatar|badge|chip|tag|stat|metric|tooltip|accordion|collapse|timeline|tree|calendar|chart|graph|progress|indicator)/i,
  'data-input': /^(input|form|select|checkbox|radio|switch|toggle|slider|textarea|datepicker|timepicker|upload|dropdown|combobox|autocomplete|search|filter|rating)/i,
  'feedback': /^(alert|toast|snackbar|notification|banner|skeleton|spinner|loading|error|empty|placeholder|progress)/i,
  'overlay': /^(modal|dialog|popover|sheet|bottomsheet|lightbox|overlay|confirm|command|commandpalette)/i,
  'typography': /^(heading|text|title|paragraph|label|caption|code|highlight|prose|markdown|typography)/i,
  'media': /^(image|video|icon|logo|thumbnail|gallery|carousel|slider|embed|player)/i,
  'other': /./,
};

export function extractComponents(projectDir: string): ComponentInfo[] {
  const components: ComponentInfo[] = [];

  for (const dir of COMPONENT_DIRS) {
    const fullDir = path.join(projectDir, dir);
    if (fs.existsSync(fullDir)) {
      scanDirectory(fullDir, components, projectDir);
    }
  }

  return components;
}

/**
 * Detect which libraries the project uses (icons, state, animation).
 */
export function detectProjectLibraries(projectDir: string): {
  iconLibrary: string | null;
  stateLibrary: string | null;
  animationLibrary: string | null;
} {
  let iconLibrary: string | null = null;
  let stateLibrary: string | null = null;
  let animationLibrary: string | null = null;

  try {
    const pkgPath = path.join(projectDir, 'package.json');
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };

      // Icon libraries
      if (allDeps['lucide-react'] || allDeps['lucide-vue-next']) iconLibrary = 'Lucide';
      else if (allDeps['@heroicons/react'] || allDeps['heroicons']) iconLibrary = 'Heroicons';
      else if (allDeps['react-icons']) iconLibrary = 'React Icons';
      else if (allDeps['@phosphor-icons/react']) iconLibrary = 'Phosphor';
      else if (allDeps['@tabler/icons-react']) iconLibrary = 'Tabler Icons';
      else if (allDeps['@radix-ui/react-icons']) iconLibrary = 'Radix Icons';

      // State management
      if (allDeps['zustand']) stateLibrary = 'Zustand';
      else if (allDeps['@reduxjs/toolkit'] || allDeps['redux']) stateLibrary = 'Redux';
      else if (allDeps['jotai']) stateLibrary = 'Jotai';
      else if (allDeps['recoil']) stateLibrary = 'Recoil';
      else if (allDeps['valtio']) stateLibrary = 'Valtio';
      else if (allDeps['pinia']) stateLibrary = 'Pinia';
      else if (allDeps['mobx']) stateLibrary = 'MobX';

      // Animation
      if (allDeps['framer-motion'] || allDeps['motion']) animationLibrary = 'Framer Motion';
      else if (allDeps['@react-spring/web'] || allDeps['react-spring']) animationLibrary = 'React Spring';
      else if (allDeps['gsap']) animationLibrary = 'GSAP';
      else if (allDeps['animejs'] || allDeps['anime.js']) animationLibrary = 'Anime.js';
      else if (allDeps['@formkit/auto-animate']) animationLibrary = 'AutoAnimate';
    }
  } catch {
    // ignore
  }

  return { iconLibrary, stateLibrary, animationLibrary };
}

function scanDirectory(dir: string, components: ComponentInfo[], rootDir: string): void {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (IGNORE_DIRS.includes(entry.name)) continue;

      const fullPath = path.join(dir, entry.name);
      if (entry.isFile() && COMPONENT_EXTENSIONS.some(ext => entry.name.endsWith(ext))) {
        const component = parseComponent(fullPath, rootDir);
        if (component) components.push(component);
      } else if (entry.isDirectory()) {
        scanDirectory(fullPath, components, rootDir);
      }
    }
  } catch {
    // Permission errors
  }
}

function parseComponent(filePath: string, rootDir: string): ComponentInfo | null {
  let content: string;
  try {
    content = fs.readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }

  const fileName = path.basename(filePath, path.extname(filePath));
  if (['index', 'types', 'utils', 'helpers', 'constants', 'styles', 'hooks', 'context', 'store', 'provider'].includes(fileName.toLowerCase())) {
    if (fileName.toLowerCase() === 'index') {
      const dirName = path.basename(path.dirname(filePath));
      if (dirName === 'components' || dirName === 'ui' || dirName === 'lib') return null;
      return parseComponentContent(dirName, content, filePath, rootDir);
    }
    return null;
  }

  return parseComponentContent(fileName, content, filePath, rootDir);
}

function parseComponentContent(
  name: string,
  content: string,
  filePath: string,
  rootDir: string
): ComponentInfo | null {
  const hasJSX = /<[A-Z][a-zA-Z]*[\s/>]/.test(content) || /return\s*\(?\s*</.test(content);
  const hasExport = /export\s+(default\s+)?/.test(content);

  if (!hasJSX && !hasExport) return null;

  const componentName = toPascalCase(name);
  const relativePath = path.relative(rootDir, filePath).replace(/\\/g, '/');

  const variants = extractVariants(content);
  const cssClasses = extractCSSClasses(content);
  const jsxSnippet = extractJSXSnippet(content);
  const props = extractProps(content);
  const category = categorizeComponent(componentName, relativePath, content, cssClasses);
  const { hasAnimation, animationDetails } = detectAnimations(content);
  const statePatterns = detectStatePatterns(content);
  const tailwindPatterns = extractTailwindPatterns(cssClasses);

  return {
    name: componentName,
    filePath: relativePath,
    variants,
    cssClasses,
    jsxSnippet,
    props,
    category,
    hasAnimation,
    animationDetails,
    statePatterns,
    tailwindPatterns,
  };
}

function categorizeComponent(name: string, filePath: string, content: string, classes: string[]): ComponentCategory {
  // Check name first
  for (const [cat, pattern] of Object.entries(CATEGORY_PATTERNS)) {
    if (cat === 'other') continue;
    if (pattern.test(name)) return cat as ComponentCategory;
  }

  // Check file path for hints
  const pathLower = filePath.toLowerCase();
  if (/\/layout[s]?\//.test(pathLower)) return 'layout';
  if (/\/nav|\/menu|\/header|\/footer/.test(pathLower)) return 'navigation';
  if (/\/form[s]?\/|\/input[s]?\//.test(pathLower)) return 'data-input';
  if (/\/modal[s]?\/|\/dialog[s]?\/|\/overlay[s]?\//.test(pathLower)) return 'overlay';
  if (/\/feedback\/|\/toast|\/alert/.test(pathLower)) return 'feedback';

  // Check content for category hints
  if (/\<form[\s>]|onSubmit|handleSubmit/i.test(content)) return 'data-input';
  if (/\<table[\s>]|<thead|<tbody/i.test(content)) return 'data-display';
  if (/\<nav[\s>]|useRouter|useNavigate|Link\s/i.test(content)) return 'navigation';
  if (/AnimatePresence|createPortal|usePortal/i.test(content)) return 'overlay';

  // Check Tailwind classes
  const classStr = classes.join(' ');
  if (/grid-cols|flex.*gap|justify-between|items-center/.test(classStr)) return 'layout';

  return 'other';
}

function detectAnimations(content: string): { hasAnimation: boolean; animationDetails: string[] } {
  const details: string[] = [];

  // Framer Motion
  const motionVariants = content.match(/variants\s*=\s*\{([^}]+(?:\{[^}]*\}[^}]*)*)\}/g);
  if (motionVariants) {
    for (const v of motionVariants) {
      const trimmed = v.slice(0, 120);
      details.push(`motion-variant: ${trimmed}`);
    }
  }

  if (/motion\.|<motion\./.test(content)) {
    details.push('framer-motion');

    // Extract spring configs
    const springMatch = content.match(/spring\s*:\s*\{([^}]+)\}/);
    if (springMatch) details.push(`spring: {${springMatch[1].trim()}}`);

    // Extract transition props
    const transitionMatch = content.match(/transition\s*=\s*\{?\{([^}]+)\}/);
    if (transitionMatch) details.push(`transition: {${transitionMatch[1].trim()}}`);

    // Detect AnimatePresence
    if (/AnimatePresence/.test(content)) details.push('animate-presence');

    // Detect layout animations
    if (/layoutId|layout=/.test(content)) details.push('layout-animation');

    // Extract initial/animate/exit
    const animateMatch = content.match(/animate\s*=\s*\{?\{([^}]+)\}/);
    if (animateMatch) details.push(`animate: {${animateMatch[1].trim()}}`);
  }

  // CSS animations
  const animateClasses = content.match(/animate-[\w-]+/g);
  if (animateClasses) {
    details.push(...[...new Set(animateClasses)].map(c => `tw-${c}`));
  }

  // CSS transitions in Tailwind
  const transitionClasses = content.match(/transition-[\w-]+|duration-[\w-]+|ease-[\w-]+/g);
  if (transitionClasses) {
    const unique = [...new Set(transitionClasses)];
    if (unique.length > 0) details.push(`tw-transitions: ${unique.join(', ')}`);
  }

  // Hover/focus transforms
  if (/hover:scale|hover:translate|hover:-translate|group-hover:/.test(content)) {
    details.push('hover-transforms');
  }

  return { hasAnimation: details.length > 0, animationDetails: details };
}

function detectStatePatterns(content: string): string[] {
  const patterns: string[] = [];

  if (/useState/.test(content)) patterns.push('useState');
  if (/useReducer/.test(content)) patterns.push('useReducer');
  if (/useContext/.test(content)) patterns.push('useContext');
  if (/useStore|create\(/.test(content) && /zustand/i.test(content)) patterns.push('zustand');
  if (/useQuery|useMutation/.test(content)) patterns.push('react-query');
  if (/useSWR/.test(content)) patterns.push('swr');
  if (/useForm/.test(content)) patterns.push('react-hook-form');
  if (/useRef/.test(content)) patterns.push('useRef');
  if (/forwardRef/.test(content)) patterns.push('forwardRef');
  if (/React\.memo|memo\(/.test(content)) patterns.push('memo');

  return patterns;
}

function extractTailwindPatterns(classes: string[]): TailwindPattern {
  const pattern: TailwindPattern = {
    backgrounds: [],
    borders: [],
    spacing: [],
    typography: [],
    effects: [],
    layout: [],
    interactive: [],
  };

  for (const cls of classes) {
    if (/^bg-/.test(cls)) pattern.backgrounds.push(cls);
    else if (/^(border|rounded|ring|outline)/.test(cls)) pattern.borders.push(cls);
    else if (/^(p-|px-|py-|pt-|pb-|pl-|pr-|m-|mx-|my-|mt-|mb-|ml-|mr-|gap-|space-)/.test(cls)) pattern.spacing.push(cls);
    else if (/^(text-|font-|tracking-|leading-|truncate|line-clamp)/.test(cls)) pattern.typography.push(cls);
    else if (/^(shadow|opacity|blur|backdrop|ring|drop-shadow|filter)/.test(cls)) pattern.effects.push(cls);
    else if (/^(flex|grid|col-|row-|justify|items-|self-|w-|h-|min-|max-|overflow|relative|absolute|fixed|sticky|z-)/.test(cls)) pattern.layout.push(cls);
    else if (/^(hover:|focus:|active:|disabled:|group-|peer-|cursor-|pointer-events|select-)/.test(cls)) pattern.interactive.push(cls);
  }

  return pattern;
}

function extractVariants(content: string): string[] {
  const variants: string[] = [];

  const unionMatches = content.matchAll(/['"](\w+)['"]\s*\|/g);
  for (const m of unionMatches) {
    if (!variants.includes(m[1]) && isLikelyVariant(m[1])) variants.push(m[1]);
  }

  const lastUnionMatches = content.matchAll(/\|\s*['"](\w+)['"]/g);
  for (const m of lastUnionMatches) {
    if (!variants.includes(m[1]) && isLikelyVariant(m[1])) variants.push(m[1]);
  }

  // CVA / class-variance-authority
  const cvaMatches = content.matchAll(/variants?\s*:\s*\{([^}]+(?:\{[^}]*\}[^}]*)*)\}/gi);
  for (const m of cvaMatches) {
    const keys = m[1].matchAll(/(\w+)\s*:/g);
    for (const k of keys) {
      if (!variants.includes(k[1]) && isLikelyVariant(k[1])) variants.push(k[1]);
    }
  }

  return variants;
}

function isLikelyVariant(str: string): boolean {
  const variantKeywords = [
    'primary', 'secondary', 'tertiary', 'ghost', 'outline', 'link',
    'danger', 'warning', 'success', 'info', 'error',
    'sm', 'md', 'lg', 'xl', '2xl',
    'small', 'medium', 'large',
    'default', 'destructive', 'subtle',
    'solid', 'soft', 'plain', 'minimal', 'filled',
  ];
  return variantKeywords.includes(str.toLowerCase()) || str.length <= 15;
}

function extractCSSClasses(content: string): string[] {
  const classes = new Set<string>();

  // className="..." or class="..."
  const classMatches = content.matchAll(/class(?:Name)?\s*=\s*["']([^"']+)["']/g);
  for (const m of classMatches) {
    for (const cls of m[1].split(/\s+/)) {
      if (cls.trim()) classes.add(cls.trim());
    }
  }

  // Template literals: className={`...`}
  const templateMatches = content.matchAll(/class(?:Name)?\s*=\s*\{`([^`]+)`\}/g);
  for (const m of templateMatches) {
    const staticParts = m[1].replace(/\$\{[^}]+\}/g, ' ').split(/\s+/);
    for (const cls of staticParts) {
      if (cls.trim()) classes.add(cls.trim());
    }
  }

  // cn() / clsx() / classnames() / cva()
  const cnMatches = content.matchAll(/(?:cn|clsx|classnames|cva)\s*\(\s*["']([^"']+)["']/g);
  for (const m of cnMatches) {
    for (const cls of m[1].split(/\s+/)) {
      if (cls.trim()) classes.add(cls.trim());
    }
  }

  // Multi-line cn() calls — capture strings inside
  const cnBlockMatches = content.matchAll(/(?:cn|clsx|classnames)\s*\(([^)]+)\)/gs);
  for (const m of cnBlockMatches) {
    const innerStrings = m[1].matchAll(/["']([^"']+)["']/g);
    for (const s of innerStrings) {
      for (const cls of s[1].split(/\s+/)) {
        if (cls.trim() && !cls.includes('${')) classes.add(cls.trim());
      }
    }
  }

  return Array.from(classes).slice(0, 80);
}

function extractJSXSnippet(content: string): string {
  const returnMatch = content.match(/return\s*\(\s*\n?([\s\S]*?)\n?\s*\);?/);
  if (returnMatch) {
    const lines = returnMatch[1].split('\n').slice(0, 40);
    return lines.join('\n').trim();
  }

  const arrowMatch = content.match(/=>\s*\(\s*\n?([\s\S]*?)\n?\s*\);?/);
  if (arrowMatch) {
    const lines = arrowMatch[1].split('\n').slice(0, 40);
    return lines.join('\n').trim();
  }

  return '';
}

function extractProps(content: string): string[] {
  const props: string[] = [];

  const propsMatch = content.match(/(?:interface|type)\s+\w*Props\w*\s*(?:=\s*)?\{([^}]+)\}/);
  if (propsMatch) {
    const propLines = propsMatch[1].matchAll(/(\w+)\s*[?:]?\s*:/g);
    for (const m of propLines) {
      if (!props.includes(m[1])) props.push(m[1]);
    }
  }

  const destructMatch = content.match(/\(\s*\{\s*([^}]+)\s*\}\s*(?::\s*\w+)?\s*\)/);
  if (destructMatch) {
    const parts = destructMatch[1].split(',').map(s => s.trim().split(/[\s=:]/)[0].trim());
    for (const p of parts) {
      if (p && !props.includes(p) && /^[a-zA-Z]/.test(p)) props.push(p);
    }
  }

  return props;
}

function toPascalCase(str: string): string {
  return str
    .replace(/[-_\s]+(.)?/g, (_, c) => (c ? c.toUpperCase() : ''))
    .replace(/^./, s => s.toUpperCase());
}

// ── Core Design Profile ──────────────────────────────────────────────

export interface DesignProfile {
  projectName: string;
  siteUrl?: string;
  favicon?: string | null;
  frameworks: Framework[];
  colors: ColorToken[];
  typography: TypographyToken[];
  spacing: SpacingScale;
  shadows: ShadowToken[];
  components: ComponentInfo[];
  breakpoints: Breakpoint[];
  cssVariables: CSSVariable[];
  borderRadius: string[];
  fontVarMap: Record<string, string>; // maps CSS var names to resolved font names
  antiPatterns: string[];
  designTraits: DesignTraits;
  animations: AnimationToken[];
  darkModeVars: DarkModeVar[];
  iconLibrary: string | null;
  stateLibrary: string | null;
  componentCategories: Record<ComponentCategory, string[]>;
  zIndexScale: number[];
  containerMaxWidth: string | null;
  fontSources: FontSource[];
  pageSections: PageSection[];
  motionTokens: MotionTokens;
}

export interface DesignTraits {
  isDark: boolean;
  hasShadows: boolean;
  hasGradients: boolean;
  hasRoundedFull: boolean;
  maxBorderRadius: number;
  primaryColorTemp: 'warm' | 'cool' | 'neutral';
  fontStyle: 'serif' | 'sans-serif' | 'monospace';
  density: 'compact' | 'standard' | 'spacious';
  hasAnimations: boolean;
  hasDarkMode: boolean;
  motionStyle: 'none' | 'subtle' | 'expressive';
}

// ── Component Categories ────────────────────────────────────────────

export type ComponentCategory =
  | 'layout'
  | 'navigation'
  | 'data-display'
  | 'data-input'
  | 'feedback'
  | 'overlay'
  | 'typography'
  | 'media'
  | 'other';

// ── Animations ──────────────────────────────────────────────────────

export interface AnimationToken {
  name: string;
  type: 'css-keyframe' | 'css-transition' | 'framer-motion' | 'spring';
  value: string;
  source: string;
}

// ── Dark Mode ───────────────────────────────────────────────────────

export interface DarkModeVar {
  variable: string;
  lightValue: string;
  darkValue: string;
}

// ── Frameworks ───────────────────────────────────────────────────────

export type FrameworkId =
  | 'tailwind'
  | 'react'
  | 'vue'
  | 'next'
  | 'nuxt'
  | 'svelte'
  | 'angular'
  | 'css-in-js'
  | 'css-modules';

export interface Framework {
  id: FrameworkId;
  name: string;
  version?: string;
}

// ── Color Tokens ─────────────────────────────────────────────────────

export type ColorRole =
  | 'background'
  | 'surface'
  | 'text-primary'
  | 'text-muted'
  | 'accent'
  | 'border'
  | 'danger'
  | 'success'
  | 'warning'
  | 'info'
  | 'unknown';

export interface ColorToken {
  hex: string;
  name?: string;
  role: ColorRole;
  frequency: number;
  source: 'tailwind' | 'css' | 'tokens-file' | 'component' | 'computed';
}

// ── Typography ───────────────────────────────────────────────────────

export type TypographyRole =
  | 'heading-1'
  | 'heading-2'
  | 'heading-3'
  | 'heading-4'
  | 'body'
  | 'caption'
  | 'code'
  | 'unknown';

export interface TypographyToken {
  role: TypographyRole;
  fontFamily: string;
  fontSize?: string;
  fontWeight?: string | number;
  lineHeight?: string;
  source: 'tailwind' | 'css' | 'tokens-file' | 'component' | 'computed';
}

// ── Spacing ──────────────────────────────────────────────────────────

export interface SpacingScale {
  base: number;
  values: number[];
  unit: 'px' | 'rem';
}

// ── Shadows ──────────────────────────────────────────────────────────

export type ShadowLevel = 'flat' | 'raised' | 'floating' | 'overlay';

export interface ShadowToken {
  value: string;
  level: ShadowLevel;
  name?: string;
}

// ── Components ───────────────────────────────────────────────────────

export interface ComponentInfo {
  name: string;
  filePath: string;
  variants: string[];
  cssClasses: string[];
  jsxSnippet: string;
  props: string[];
  category: ComponentCategory;
  hasAnimation: boolean;
  animationDetails: string[];
  statePatterns: string[];
  tailwindPatterns: TailwindPattern;
}

export interface TailwindPattern {
  backgrounds: string[];
  borders: string[];
  spacing: string[];
  typography: string[];
  effects: string[];
  layout: string[];
  interactive: string[];
}

// ── Breakpoints ──────────────────────────────────────────────────────

export interface Breakpoint {
  name: string;
  value: string;
  source: 'tailwind' | 'css';
}

// ── CSS Variables ────────────────────────────────────────────────────

export interface CSSVariable {
  name: string;
  value: string;
  property?: string;
}

// ── Raw extraction (before normalization) ────────────────────────────

export interface RawTokens {
  colors: Array<{ value: string; frequency: number; source: ColorToken['source']; name?: string }>;
  fonts: Array<{ family: string; size?: string; weight?: string | number; source: TypographyToken['source'] }>;
  spacingValues: number[];
  shadows: Array<{ value: string; name?: string }>;
  cssVariables: CSSVariable[];
  breakpoints: Breakpoint[];
  borderRadii: string[];
  gradients: string[];
  fontVarMap: Record<string, string>;
  animations: AnimationToken[];
  darkModeVars: DarkModeVar[];
  zIndexValues: number[];
  containerMaxWidth: string | null;
  fontSources: FontSource[];
  pageSections: PageSection[];
  transitionDurations: string[];
  transitionEasings: string[];
  favicon?: string | null;
  siteTitle?: string | null;
}

// ── Font Sources ────────────────────────────────────────────────────

export interface FontSource {
  family: string;
  src: string;
  format?: string;
  weight?: string;
}

// ── Page Sections (URL mode) ────────────────────────────────────────

export interface PageSection {
  type: 'navigation' | 'hero' | 'features' | 'content' | 'cards' | 'faq' | 'footer' | 'cta' | 'stats' | 'testimonials';
  tag: string;
  classes: string[];
  childCount: number;
  description: string;
}

// ── Motion Tokens ───────────────────────────────────────────────────

export interface MotionTokens {
  durations: string[];
  easings: string[];
  properties: string[];
}

// ── CLI Options ──────────────────────────────────────────────────────

export interface CLIOptions {
  dir?: string;
  repo?: string;
  url?: string;
  out: string;
  name?: string;
  skill: boolean;
  format: 'design-md' | 'skill' | 'both';
  mode: 'default' | 'ultra';
  screens: string;
}

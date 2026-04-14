// ── Ultra Mode Types ─────────────────────────────────────────────────

export interface UltraOptions {
  /** Max pages to crawl (default: 5) */
  screens: number;
}

// ── Screenshots ─────────────────────────────────────────────────────

export interface PageScreenshot {
  url: string;
  slug: string;
  /** Relative path inside skillDir: screens/pages/[slug].png */
  filePath: string;
  title: string;
}

export interface SectionScreenshot {
  page: string;
  index: number;
  /** Relative path inside skillDir: screens/sections/[page]-section-[index].png */
  filePath: string;
  selector: string;
  height: number;
  width: number;
}

// ── Interactions ─────────────────────────────────────────────────────

export interface StyleSnapshot {
  backgroundColor: string;
  color: string;
  borderColor: string;
  borderWidth: string;
  boxShadow: string;
  opacity: string;
  transform: string;
  outline: string;
  outlineColor: string;
  textDecoration: string;
  transition: string;
}

export interface StyleDiff {
  property: string;
  from: string;
  to: string;
}

export interface InteractionRecord {
  componentType: 'button' | 'link' | 'input' | 'role-button';
  label: string;
  selector: string;
  index: number;
  screenshots: {
    default?: string;
    hover?: string;
    focus?: string;
  };
  hoverChanges: StyleDiff[];
  focusChanges: StyleDiff[];
  transitionValue: string;
}

// ── Layout ───────────────────────────────────────────────────────────

export interface LayoutRecord {
  tag: string;
  selector: string;
  display: string;
  flexDirection: string;
  flexWrap: string;
  justifyContent: string;
  alignItems: string;
  gap: string;
  rowGap: string;
  columnGap: string;
  padding: string;
  margin: string;
  gridTemplateColumns: string;
  gridTemplateRows: string;
  maxWidth: string;
  width: string;
  height: string;
  position: string;
  childCount: number;
  depth: number;
}

// ── DOM Components ───────────────────────────────────────────────────

export interface DOMComponent {
  name: string;
  pattern: string;
  instances: number;
  commonClasses: string[];
  htmlSnippet: string;
  category: 'card' | 'list-item' | 'nav-item' | 'form-field' | 'button' | 'badge' | 'unknown';
}

// ── Animation Extraction ─────────────────────────────────────────────

export interface KeyframeStop {
  stop: string;                      // '0%', '50%', 'from', 'to'
  properties: Record<string, string>;
}

export interface ExtractedKeyframe {
  name: string;
  stops: KeyframeStop[];
  usedBy: string[];                  // selectors using this animation
  animDuration?: string;
  animEasing?: string;
  animDelay?: string;
  animIteration?: string;
  animFillMode?: string;
  animDirection?: string;
}

export interface ScrollFrame {
  scrollPercent: number;             // 0..100
  scrollY: number;                   // absolute px from top
  pageHeight: number;
  filePath: string;                  // screens/scroll/scroll-NN.png
}

export interface DetectedLibrary {
  name: string;
  version?: string;
  type: 'animation' | 'scroll' | 'physics' | '3d' | 'lottie' | 'other';
  cdn?: string;
}

export interface VideoInfo {
  index: number;
  src: string;
  poster?: string;
  autoplay: boolean;
  loop: boolean;
  muted: boolean;
  width?: number;
  height?: number;
  role: 'background' | 'content' | 'unknown';
  firstFramePath?: string;           // screens/scroll/video-N-frame.png
}

export interface ScrollAnimationPattern {
  selector: string;
  library: string;                   // 'gsap' | 'aos' | 'intersection-observer' | 'css' | 'lottie'
  attribute?: string;                // e.g. data-aos="fade-up"
  animationType: string;             // 'fade-in' | 'slide-up' | 'scale' | 'parallax' | 'sticky' | etc.
  duration?: string;
  delay?: string;
  easing?: string;
  count: number;                     // how many elements share this pattern
}

export interface CSSAnimationVar {
  name: string;
  value: string;
  category: 'duration' | 'easing' | 'delay' | 'animation' | 'other';
}

export interface FullAnimationResult {
  keyframes: ExtractedKeyframe[];
  scrollFrames: ScrollFrame[];
  libraries: DetectedLibrary[];
  videos: VideoInfo[];
  scrollPatterns: ScrollAnimationPattern[];
  animationVars: CSSAnimationVar[];
  globalTransitions: string[];
  canvasCount: number;
  webglDetected: boolean;
  lottieCount: number;
}

// ── Ultra Result ─────────────────────────────────────────────────────

export interface UltraResult {
  pageScreenshots: PageScreenshot[];
  sectionScreenshots: SectionScreenshot[];
  interactions: InteractionRecord[];
  layouts: LayoutRecord[];
  domComponents: DOMComponent[];
  animations: FullAnimationResult;
}

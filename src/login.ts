import { loadPlaywright } from './playwright-loader';
import { StorageState } from './types';

/**
 * Login page detection + Playwright-based authentication.
 *
 * Flow:
 * 1. detectLoginPage() checks HTML/URL for login form signals
 * 2. performLogin() drives a headless browser through the form
 * 3. extractCookieHeader() turns Playwright storageState into an HTTP Cookie header
 */

// ── Detection ────────────────────────────────────────────────────────────

const LOGIN_URL_PATTERNS = /\/(login|signin|sign-in|sign_in|auth|sso|authenticate|session\/new|account\/login)\b/i;

const LOGIN_TEXT_PATTERNS = /\b(sign\s*in|log\s*in|log\s*on|enter\s*your\s*password|forgot\s*password|remember\s*me)\b/i;

/**
 * Returns true when the HTML + URL look like a login / sign-in page.
 *
 * Heuristic:
 *   - URL path matches common auth routes, OR
 *   - HTML contains a <form> with a password field AND login-related text
 */
export function detectLoginPage(html: string, url: string): boolean {
  const hasPasswordField = /<input[^>]*type\s*=\s*["']password["']/i.test(html);

  // Strong signal: URL is an auth route AND page has a password field
  if (LOGIN_URL_PATTERNS.test(url) && hasPasswordField) return true;

  // Medium signal: password field + login-related text
  if (hasPasswordField && LOGIN_TEXT_PATTERNS.test(html)) return true;

  // Weak signal: URL is an auth route even without password field (SSO pages, etc.)
  // Only flag this if the page also lacks substantial content (< 5 KB stripped)
  if (LOGIN_URL_PATTERNS.test(url)) {
    const stripped = html.replace(/<[^>]+>/g, '').trim();
    if (stripped.length < 5000) return true;
  }

  return false;
}

/**
 * Playwright-based login detection for SPAs.
 *
 * SPAs render login forms via JavaScript — the raw HTML from fetch() is an
 * empty shell. This function loads the page in a headless browser, waits for
 * JS to render, then checks the live DOM for login form elements.
 *
 * Also detects:
 * - Auth provider widgets (Clerk, Auth0, Firebase, Supabase, Cognito)
 * - Login forms inside iframes
 * - OAuth/SSO redirect pages
 * - Pages with minimal content (protected SPA that hasn't loaded)
 *
 * Returns the final URL (after any client-side redirects) if login detected,
 * or null if the page is NOT a login page.
 */
export async function detectLoginPageWithPlaywright(url: string): Promise<string | null> {
  const playwright = loadPlaywright();
  if (!playwright) return null;

  const browser = await playwright.chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    });

    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForTimeout(3000); // extra wait for auth provider widgets

    const finalUrl = page.url();

    // If the page redirected to a known auth provider domain, that's a login
    if (/\b(clerk\.|auth0\.com|accounts\.google|login\.microsoftonline|cognito|supabase\.co\/auth|firebase)\b/i.test(finalUrl)) {
      await browser.close();
      return finalUrl;
    }

    // Check the rendered DOM for login signals
    const isLogin = await page.evaluate(() => {
      // ── Standard password field in main DOM ─────────────────────────
      const hasPassword = document.querySelector('input[type="password"]') !== null;

      // ── Auth provider custom elements ───────────────────────────────
      const authProviderElements = [
        // Clerk
        'clerk-sign-in', 'clerk-sign-up', '[data-clerk]',
        '.cl-signIn-root', '.cl-component', '.cl-rootBox',
        // Auth0 Lock
        '.auth0-lock', '.auth0-lock-widget', '#auth0-lock-container-1',
        // Firebase UI
        '.firebaseui-container', '.firebaseui-auth-container',
        // Supabase
        '[data-supabase-auth]', '.supabase-auth-ui',
        // Generic OAuth buttons
        '[data-provider="google"]', '[data-provider="github"]',
        'button[class*="oauth"]', 'button[class*="social-login"]',
        'a[href*="oauth"]', 'a[href*="/auth/"]',
      ];
      const hasAuthProvider = authProviderElements.some(
        sel => { try { return document.querySelector(sel) !== null; } catch { return false; } }
      );

      // ── Login text in rendered content ──────────────────────────────
      const bodyText = document.body?.innerText || '';
      const hasLoginText = /\b(sign\s*in|log\s*in|log\s*on|forgot\s*password|remember\s*me|create\s*account|don'?t have an account|sign\s*up|welcome\s*back|enter\s*your\s*(email|credentials))\b/i.test(bodyText);

      // ── Username/email field ────────────────────────────────────────
      const hasUsernameField = document.querySelector(
        'input[type="email"], input[name="email"], input[name="username"], input[autocomplete="username"], input[autocomplete="email"]'
      ) !== null;

      // ── Login form ──────────────────────────────────────────────────
      const hasLoginForm = document.querySelector('form') !== null;

      // ── Password field inside iframes ───────────────────────────────
      let hasPasswordInIframe = false;
      try {
        const iframes = Array.from(document.querySelectorAll('iframe'));
        for (const iframe of iframes) {
          try {
            const iframeDoc = iframe.contentDocument;
            if (iframeDoc?.querySelector('input[type="password"]')) {
              hasPasswordInIframe = true;
              break;
            }
          } catch { /* cross-origin iframe */ }
        }
      } catch {}

      // ── Minimal content signal (protected SPA shell) ────────────────
      // If the visible text is very short, the page likely hasn't loaded
      // real content because it's waiting for authentication
      const visibleText = bodyText.replace(/\s+/g, ' ').trim();
      const isMinimalContent = visibleText.length < 200;

      // ── Decision logic ──────────────────────────────────────────────
      // Strong: password field + anything else
      if (hasPassword && (hasLoginText || hasLoginForm || hasUsernameField)) return true;
      // Strong: auth provider widget detected
      if (hasAuthProvider) return true;
      // Strong: password in iframe (auth provider)
      if (hasPasswordInIframe) return true;
      // Medium: username/email field + login text (no password yet — multi-step)
      if (hasUsernameField && hasLoginText) return true;
      // Medium: login text + minimal content (SPA hasn't loaded behind auth)
      if (hasLoginText && isMinimalContent) return true;
      // Weak: just a password field alone
      if (hasPassword) return true;

      return false;
    });

    // Also check URL-based signals on the final URL (after SPA routing)
    if (!isLogin && LOGIN_URL_PATTERNS.test(finalUrl)) {
      await browser.close();
      return finalUrl;
    }

    // ── Gateway page detection ────────────────────────────────────────
    // Some sites show a welcome/splash page with a LOGIN button that
    // navigates to the actual login form. If the current page has no
    // login form but has a "Login" / "Sign in" button, click it and
    // check the resulting page.
    if (!isLogin) {
      const LOGIN_BUTTON_SELECTORS = [
        'button:has-text("Login")',
        'button:has-text("Log in")',
        'button:has-text("Sign in")',
        'a:has-text("Login")',
        'a:has-text("Log in")',
        'a:has-text("Sign in")',
        '[role="button"]:has-text("Login")',
        '[role="button"]:has-text("Log in")',
        '[role="button"]:has-text("Sign in")',
      ];

      for (const sel of LOGIN_BUTTON_SELECTORS) {
        try {
          const btn = page.locator(sel).first();
          if (await btn.isVisible({ timeout: 500 })) {
            await btn.click();
            await page.waitForTimeout(3000);

            const afterClickUrl = page.url();

            // Check if we landed on a login page after clicking
            if (LOGIN_URL_PATTERNS.test(afterClickUrl)) {
              await browser.close();
              return afterClickUrl;
            }

            // Check the new DOM for login signals
            const hasLoginNow = await page.evaluate(() => {
              const hasPassword = document.querySelector('input[type="password"]') !== null;
              const hasUsername = document.querySelector(
                'input[type="email"], input[name="email"], input[name="username"], input[autocomplete="username"]'
              ) !== null;
              return hasPassword || hasUsername;
            });

            if (hasLoginNow) {
              await browser.close();
              return afterClickUrl;
            }
            break; // only try one button
          }
        } catch { /* selector not found or click failed */ }
      }
    }

    await browser.close();
    return isLogin ? finalUrl : null;
  } catch {
    await browser.close().catch(() => {});
    return null;
  }
}

// ── Authentication ───────────────────────────────────────────────────────

// Re-export for backwards compatibility
export type { StorageState } from './types';

const USERNAME_SELECTORS = [
  'input[type="email"]',
  'input[name="email"]',
  'input[name="username"]',
  'input[name="user"]',
  'input[name="login"]',
  'input[name="identifier"]',
  'input[id*="email" i]',
  'input[id*="user" i]',
  'input[autocomplete="username"]',
  'input[autocomplete="email"]',
  // Fallback: first visible text input that is NOT the password field
  'input[type="text"]',
];

const SUBMIT_SELECTORS = [
  'button[type="submit"]',
  'input[type="submit"]',
  'button:has-text("Sign in")',
  'button:has-text("Log in")',
  'button:has-text("Login")',
  'button:has-text("Continue")',
  'button:has-text("Submit")',
  'button:has-text("Next")',
  '[role="button"]:has-text("Sign in")',
  '[role="button"]:has-text("Log in")',
];

/**
 * Drive a headless Playwright browser through a login form.
 *
 * Steps:
 * 1. Navigate to loginUrl
 * 2. Fill username/email field
 * 3. Fill password field
 * 4. Submit the form
 * 5. Wait for navigation away from the login page
 * 6. Return the storage state (cookies + localStorage) or null on failure
 *
 * Handles multi-step logins (email first → password second) by checking
 * whether the password field is visible before and after filling username.
 */
export async function performLogin(
  loginUrl: string,
  credentials: { username: string; password: string }
): Promise<StorageState | null> {
  const playwright = loadPlaywright();
  if (!playwright) return null;

  const browser = await playwright.chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    });

    const page = await context.newPage();
    await page.goto(loginUrl, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(1500);

    // ── Step 1: Fill username / email ──────────────────────────────────
    let filledUsername = false;
    for (const sel of USERNAME_SELECTORS) {
      try {
        const field = page.locator(sel).first();
        if (await field.isVisible({ timeout: 500 })) {
          await field.fill(credentials.username);
          filledUsername = true;
          break;
        }
      } catch { /* selector not found */ }
    }

    if (!filledUsername) {
      await browser.close();
      return null;
    }

    // ── Step 2: Check if password field is visible now ─────────────────
    const passwordField = page.locator('input[type="password"]').first();
    let passwordVisible = false;
    try {
      passwordVisible = await passwordField.isVisible({ timeout: 500 });
    } catch { /* not visible yet */ }

    // Multi-step login: submit username first, wait for password field
    if (!passwordVisible) {
      // Click "Next" / "Continue" / submit to advance to password step
      let advanced = false;
      for (const sel of SUBMIT_SELECTORS) {
        try {
          const btn = page.locator(sel).first();
          if (await btn.isVisible({ timeout: 500 })) {
            await btn.click();
            advanced = true;
            break;
          }
        } catch { /* skip */ }
      }
      if (!advanced) {
        // Try pressing Enter on the username field
        for (const sel of USERNAME_SELECTORS) {
          try {
            const field = page.locator(sel).first();
            if (await field.isVisible({ timeout: 300 })) {
              await field.press('Enter');
              break;
            }
          } catch { /* skip */ }
        }
      }

      // Wait for password field to appear
      try {
        await page.locator('input[type="password"]').first().waitFor({ state: 'visible', timeout: 8000 });
      } catch {
        // Password field never appeared — cannot proceed
        await browser.close();
        return null;
      }
    }

    // ── Step 3: Fill password ─────────────────────────────────────────
    try {
      await page.locator('input[type="password"]').first().fill(credentials.password);
    } catch {
      await browser.close();
      return null;
    }

    // ── Step 4: Submit ────────────────────────────────────────────────
    let submitted = false;
    for (const sel of SUBMIT_SELECTORS) {
      try {
        const btn = page.locator(sel).first();
        if (await btn.isVisible({ timeout: 500 })) {
          await btn.click();
          submitted = true;
          break;
        }
      } catch { /* skip */ }
    }
    if (!submitted) {
      await page.locator('input[type="password"]').first().press('Enter');
    }

    // ── Step 5: Wait for navigation ───────────────────────────────────
    try {
      await page.waitForURL((url: URL) => !LOGIN_URL_PATTERNS.test(url.pathname), { timeout: 15000 });
    } catch {
      // Fallback: just wait a few seconds
      await page.waitForTimeout(4000);
    }
    await page.waitForTimeout(1500);

    // ── Step 6: Verify login succeeded ────────────────────────────────
    const finalUrl = page.url();
    const finalHtml = await page.content();
    if (detectLoginPage(finalHtml, finalUrl)) {
      // Still on login page → credentials likely wrong
      await browser.close();
      return null;
    }

    // ── Step 7: Capture storage state ─────────────────────────────────
    const storageState = await context.storageState() as StorageState;
    await browser.close();
    return storageState;
  } catch {
    await browser.close().catch(() => {});
    return null;
  }
}

// ── Cookie Extraction ────────────────────────────────────────────────────

/**
 * Build an HTTP `Cookie` header string from Playwright storage state,
 * filtered to cookies that match the target URL's domain.
 */
export function extractCookieHeader(storageState: StorageState | null, url: string): string {
  if (!storageState?.cookies?.length) return '';

  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    return '';
  }

  return storageState.cookies
    .filter(c => {
      const cookieDomain = c.domain.replace(/^\./, '');
      return hostname === cookieDomain || hostname.endsWith('.' + cookieDomain);
    })
    .map(c => `${c.name}=${c.value}`)
    .join('; ');
}

import * as readline from 'readline';
import chalk from 'chalk';
import { BROWSER_CONTEXT_OPTIONS, InteractiveSession } from './browser-target';

const LOAD_TIMEOUT_MS = 60000;
const CONFIRM_TIMEOUT_MS = 15 * 60 * 1000;

/**
 * Interactive mode: opens the site in a visible Chromium window, lets the user
 * prepare the page (consent, overlays, navigation), and waits for Enter in the
 * terminal. Nothing is clicked automatically.
 *
 * The returned session keeps the same browser context and tab for extraction.
 */
export async function prepareInteractiveSession(playwright: any, url: string): Promise<InteractiveSession> {
  const browser = await playwright.chromium.launch({ headless: false });
  let closed = false;
  browser.on('disconnected', () => {
    closed = true;
  });

  try {
    const context = await browser.newContext(BROWSER_CONTEXT_OPTIONS);
    const page = await context.newPage();

    const openedTabs = new Set<any>();
    const onNewTab = (tab: any) => {
      if (tab === page) return;
      openedTabs.add(tab);
      process.stdout.write(chalk.yellow('\n  ↳ The site opened a new tab. You will choose which tab to extract.\n'));
    };
    context.on('page', onNewTab);

    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: LOAD_TIMEOUT_MS });
    } catch (err: any) {
      if (closed) throw new Error('The browser was closed before the page loaded.');
      throw new Error(`Could not load ${url}: ${String(err.message).split('\n')[0]}`);
    }
    await page.waitForLoadState('load', { timeout: LOAD_TIMEOUT_MS }).catch(() => {});

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    let tab: any;
    try {
      printInstructions(url);
      await ask(rl, browser, '  Press Enter when the page is ready... ', CONFIRM_TIMEOUT_MS);
      tab = await chooseTab(rl, browser, context, page, openedTabs);
    } finally {
      rl.close();
      // Tabs that extraction opens later are not the user's doing, so stop announcing them
      context.off('page', onNewTab);
    }

    await tab.waitForLoadState('load', { timeout: LOAD_TIMEOUT_MS }).catch(() => {});
    const scrollY: number = await tab.evaluate(() => window.scrollY);

    return {
      browser,
      context,
      page: tab,
      scrollY,
      wasClosed: () => closed,
      close: () => browser.close().catch(() => {}),
    };
  } catch (err) {
    await browser.close().catch(() => {});
    throw err;
  }
}

function printInstructions(url: string): void {
  console.log('');
  console.log(chalk.bold('  Interactive mode'));
  console.log(chalk.dim(`  Chromium is open at ${url}`));
  console.log('');
  console.log('  Prepare the page in the browser window:');
  console.log('    · dismiss cookie banners, close overlays, accept consent you agree to');
  console.log('    · click continue buttons and open the content you want to analyze');
  console.log('    · open or close tabs as needed');
  console.log('');
  console.log(chalk.dim('  Nothing is clicked for you. Press Ctrl+C here to cancel.'));
  console.log('');
}

/** Lists the open tabs when there is more than one, and returns the one to extract. */
async function chooseTab(rl: readline.Interface, browser: any, context: any, original: any, openedTabs: Set<any>): Promise<any> {
  const tabs: any[] = context.pages().filter((tab: any) => !tab.isClosed());
  if (tabs.length === 0) throw new Error('No tabs are open, so there is nothing to extract.');
  if (tabs.length === 1) return tabs[0];

  const defaultIndex = Math.max(0, tabs.indexOf(original));
  console.log('\n  Open tabs:');
  for (const [i, tab] of tabs.entries()) {
    const title = (await tab.title().catch(() => '')) || '(untitled)';
    const note = tab === original ? 'original' : openedTabs.has(tab) ? 'opened during preparation' : '';
    console.log(`    [${i + 1}] ${title}  ${tab.url()}${note ? chalk.dim(` (${note})`) : ''}`);
  }

  for (;;) {
    const answer = (await ask(rl, browser, `  Extract which tab? [${defaultIndex + 1}] `, CONFIRM_TIMEOUT_MS)).trim();
    if (answer === '') return tabs[defaultIndex];
    const choice = Number(answer);
    if (Number.isInteger(choice) && choice >= 1 && choice <= tabs.length) return tabs[choice - 1];
    console.log(`  Enter a number from 1 to ${tabs.length}.`);
  }
}

/**
 * Asks one question. Gives up if the browser closes, Ctrl+C is pressed, the
 * terminal input ends, or no answer arrives within the timeout.
 */
function ask(rl: readline.Interface, browser: any, question: string, timeoutMs: number): Promise<string> {
  let timer: NodeJS.Timeout | undefined;
  let onDisconnect: () => void = () => {};
  let onSigint: () => void = () => {};
  let onClose: () => void = () => {};

  const abort = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`No response for ${timeoutMs / 60000} minutes. Extraction cancelled.`)),
      timeoutMs
    );
    onDisconnect = () => reject(new Error('The browser was closed before extraction started.'));
    onSigint = () => reject(new Error('Cancelled.'));
    onClose = () => reject(new Error('Terminal input ended before the page was confirmed.'));
    browser.once('disconnected', onDisconnect);
    rl.once('SIGINT', onSigint);
    rl.once('close', onClose);
  });

  const answer = new Promise<string>((resolve) => rl.question(question, resolve));

  return Promise.race([answer, abort]).finally(() => {
    clearTimeout(timer);
    browser.off('disconnected', onDisconnect);
    rl.off('SIGINT', onSigint);
    rl.off('close', onClose);
  });
}

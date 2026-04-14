import * as path from 'path';
import { execSync } from 'child_process';

/**
 * Loads playwright from any location it might be installed:
 * 1. Bundled with the CLI (peer dep)
 * 2. In the user's cwd node_modules (local project install)
 * 3. In the global npm prefix (npm install -g playwright)
 *
 * Returns the playwright module or null if not found anywhere.
 */
export function loadPlaywright(): any | null {
  // 1. Try standard require (works when playwright is in same node_modules tree)
  try {
    return require('playwright');
  } catch { /* fall through */ }

  // 2. Try from cwd (user ran: npm install playwright in their project)
  try {
    const cwdPath = path.join(process.cwd(), 'node_modules', 'playwright');
    return require(cwdPath);
  } catch { /* fall through */ }

  // 3. Try from global npm prefix (npm install -g playwright)
  try {
    const globalRoot = execSync('npm root -g', {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000,
    }).trim();
    return require(path.join(globalRoot, 'playwright'));
  } catch { /* fall through */ }

  return null;
}

import * as path from 'path';
import * as fs from 'fs';
import * as tmp from 'tmp';
import { runDirMode } from './dir';
import { DesignProfile } from '../types';

/**
 * REPO mode: clone a git repo into a temp directory, then run dir mode.
 */
export async function runRepoMode(repoUrl: string, nameOverride?: string): Promise<DesignProfile> {
  // Import simple-git
  const { simpleGit } = await import('simple-git');
  const git = simpleGit();

  // Create temp directory
  const tmpDir = tmp.dirSync({ unsafeCleanup: true, prefix: 'skillui-' });
  const cloneDir = tmpDir.name;

  try {
    process.stdout.write('  Cloning...');
    await git.clone(repoUrl, cloneDir, ['--depth', '1', '--single-branch']);
    console.log(' \u2713');

    // Derive project name from repo URL if not overridden
    const derivedName = nameOverride || deriveRepoName(repoUrl);

    // Run dir mode on the cloned repo
    const profile = await runDirMode(cloneDir, derivedName);

    return profile;
  } finally {
    // Cleanup temp directory
    try {
      tmpDir.removeCallback();
    } catch {
      // Best effort cleanup
    }
  }
}

function deriveRepoName(url: string): string {
  // Handle GitHub URLs: https://github.com/org/repo or git@github.com:org/repo.git
  const match = url.match(/\/([^\/]+?)(?:\.git)?$/);
  if (match) return match[1];
  return 'project';
}

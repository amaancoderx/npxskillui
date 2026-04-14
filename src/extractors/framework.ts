import * as fs from 'fs';
import * as path from 'path';
import { Framework, FrameworkId } from '../types';

interface DepMapping {
  pkg: string;
  id: FrameworkId;
  name: string;
}

const DEP_MAP: DepMapping[] = [
  { pkg: 'tailwindcss', id: 'tailwind', name: 'Tailwind CSS' },
  { pkg: 'react', id: 'react', name: 'React' },
  { pkg: 'vue', id: 'vue', name: 'Vue' },
  { pkg: 'next', id: 'next', name: 'Next.js' },
  { pkg: 'nuxt', id: 'nuxt', name: 'Nuxt' },
  { pkg: 'svelte', id: 'svelte', name: 'Svelte' },
  { pkg: '@angular/core', id: 'angular', name: 'Angular' },
  { pkg: 'styled-components', id: 'css-in-js', name: 'CSS-in-JS (styled-components)' },
  { pkg: '@emotion/react', id: 'css-in-js', name: 'CSS-in-JS (Emotion)' },
  { pkg: '@emotion/styled', id: 'css-in-js', name: 'CSS-in-JS (Emotion)' },
];

export function detectFrameworks(projectDir: string): Framework[] {
  const frameworks: Framework[] = [];
  const seen = new Set<FrameworkId>();

  // Read package.json
  const pkgPath = path.join(projectDir, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      const allDeps: Record<string, string> = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
      };

      for (const mapping of DEP_MAP) {
        if (allDeps[mapping.pkg] && !seen.has(mapping.id)) {
          seen.add(mapping.id);
          frameworks.push({
            id: mapping.id,
            name: mapping.name,
            version: allDeps[mapping.pkg].replace(/[\^~>=<]/g, ''),
          });
        }
      }
    } catch {
      // Ignore malformed package.json
    }
  }

  // Check for CSS Modules
  if (!seen.has('css-modules')) {
    if (hasCSSModules(projectDir)) {
      seen.add('css-modules');
      frameworks.push({ id: 'css-modules', name: 'CSS Modules' });
    }
  }

  return frameworks;
}

function hasCSSModules(dir: string, depth = 0): boolean {
  if (depth > 4) return false;
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      if (entry.isFile() && /\.module\.(css|scss|less)$/.test(entry.name)) {
        return true;
      }
      if (entry.isDirectory() && depth < 4) {
        if (hasCSSModules(path.join(dir, entry.name), depth + 1)) return true;
      }
    }
  } catch {
    // Permission errors etc.
  }
  return false;
}

export function getProjectName(projectDir: string, overrideName?: string): string {
  if (overrideName) return overrideName;

  const pkgPath = path.join(projectDir, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      if (pkg.name) return pkg.name;
    } catch {
      // Ignore
    }
  }

  return path.basename(path.resolve(projectDir));
}

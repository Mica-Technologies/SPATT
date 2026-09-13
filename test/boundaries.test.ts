import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The timing engine must stay usable without a browser (CLI, workers, the server), so the pure
 * layers may not import React, MUI, Tauri or the UI/IO layers.
 */
const PURE_LAYERS = ['src/model', 'src/engine', 'src/profiles'];
const FORBIDDEN = [/^react(-dom)?(\/|$)/, /^@mui\//, /^@emotion\//, /^@tauri-apps\//, /\/ui\//, /\/io\//, /\/manager\//];

const root = join(import.meta.dirname, '..');

function sourceFiles(dir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  return entries.flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      return sourceFiles(path);
    }
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

const importPattern = /(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;

describe('layer boundaries', () => {
  for (const layer of PURE_LAYERS) {
    it(`${layer} imports nothing UI- or host-specific`, () => {
      const violations: string[] = [];
      for (const file of sourceFiles(join(root, layer))) {
        const text = readFileSync(file, 'utf8');
        for (const match of text.matchAll(importPattern)) {
          const specifier = match[1] ?? match[2] ?? '';
          if (FORBIDDEN.some((pattern) => pattern.test(specifier))) {
            violations.push(`${relative(root, file)} → ${specifier}`);
          }
        }
      }
      expect(violations).toEqual([]);
    });
  }
});

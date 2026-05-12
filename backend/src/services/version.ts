import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * The compiled backend lives at `<root>/backend/dist/services/version.js`, so
 * `package.json` sits two levels up. When running via `tsx watch` from
 * source, the same relative path resolves to `backend/package.json` — same
 * file, same number.
 *
 * Cached at first read because nothing else writes to it at runtime; a
 * version bump requires a redeploy anyway.
 */
let cached: string | null = null;

export function getBackendVersion(): string {
  if (cached) return cached;
  try {
    const pkg = JSON.parse(
      readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf8'),
    ) as { version?: string };
    cached = typeof pkg.version === 'string' ? pkg.version : '0.0.0';
  } catch {
    cached = '0.0.0';
  }
  return cached;
}

import { getBackendVersion } from './version.js';

const GITHUB_RELEASES_LATEST =
  'https://api.github.com/repos/faroke/zombadwin/releases/latest';
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const FETCH_TIMEOUT_MS = 8000;

export interface UpdateCheckResult {
  current: string;
  latest: string | null;
  newer: boolean;
  releaseUrl: string | null;
  releaseName: string | null;
  releaseNotes: string | null;
  publishedAt: string | null;
  cached: boolean;
  fetchedAt: number;
  error: string | null;
}

interface CacheEntry {
  result: UpdateCheckResult;
  expiresAt: number;
}

let cache: CacheEntry | null = null;

/**
 * Fetches the latest stable release from GitHub and compares its tag to the
 * version baked into this build. The GitHub `/releases/latest` endpoint
 * already skips prereleases (anything tagged `vX.Y.Z-rc1` etc. is filtered
 * out), so we don't have to track stable vs. unstable channels ourselves.
 *
 * Anonymous GitHub API: 60 requests/hour per IP. We cache one hour so a
 * single user can't burn the quota by reloading. `force=true` bypasses cache
 * for the explicit Refresh button on the UI.
 */
export async function checkForUpdates(opts: { force?: boolean } = {}): Promise<UpdateCheckResult> {
  if (!opts.force && cache && cache.expiresAt > Date.now()) {
    return { ...cache.result, cached: true };
  }
  const current = getBackendVersion();
  let result: UpdateCheckResult;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(GITHUB_RELEASES_LATEST, {
      signal: controller.signal,
      headers: {
        // Identify ourselves to the API per GitHub etiquette. No auth — public
        // repo, /releases/latest works anonymously.
        'User-Agent': `zombadwin/${current}`,
        Accept: 'application/vnd.github+json',
      },
    });
    clearTimeout(timer);
    if (!res.ok) {
      throw new Error(`GitHub API ${res.status}`);
    }
    const data = (await res.json()) as {
      tag_name?: string;
      html_url?: string;
      name?: string;
      body?: string;
      published_at?: string;
    };
    const latestTag = data.tag_name ?? '';
    const latest = stripV(latestTag);
    result = {
      current,
      latest: latest || null,
      newer: !!latest && compareSemver(latest, current) > 0,
      releaseUrl: data.html_url ?? null,
      releaseName: data.name ?? null,
      releaseNotes: data.body ?? null,
      publishedAt: data.published_at ?? null,
      cached: false,
      fetchedAt: Date.now(),
      error: null,
    };
  } catch (err) {
    result = {
      current,
      latest: null,
      newer: false,
      releaseUrl: null,
      releaseName: null,
      releaseNotes: null,
      publishedAt: null,
      cached: false,
      fetchedAt: Date.now(),
      error: (err as Error).message,
    };
  }
  cache = { result, expiresAt: Date.now() + CACHE_TTL_MS };
  return result;
}

function stripV(tag: string): string {
  return tag.replace(/^v/i, '').trim();
}

/**
 * Tiny semver compare — handles `X.Y.Z` and accepts shorter prefixes like
 * `X.Y`. Returns -1 / 0 / 1. We deliberately ignore pre-release suffixes
 * (`0.2.0-rc1`) because /releases/latest never returns one, but we still
 * tolerate them in `current` (e.g. when building from a tagged RC by hand).
 */
export function compareSemver(a: string, b: string): number {
  const partsA = a.split('-')[0]!.split('.').map((p) => Number(p) || 0);
  const partsB = b.split('-')[0]!.split('.').map((p) => Number(p) || 0);
  for (let i = 0; i < 3; i++) {
    const x = partsA[i] ?? 0;
    const y = partsB[i] ?? 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}

export function _resetCacheForTests(): void {
  cache = null;
}

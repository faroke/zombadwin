export interface WorkshopMetadata {
  workshopId: string;
  title: string;
  description: string;
  /** Mod IDs heuristically extracted from the description's "Mod ID:" lines */
  detectedModIds: string[];
  /** Map folder names heuristically extracted from "Map Folder:" lines */
  detectedMapFolders: string[];
  /**
   * Subset of detectedMapFolders that look like spawn-region modifiers rather
   * than actual playable maps (e.g. "Many Spawns Louisville",
   * "Anywhere But - Muldraugh", "Knox County Visitors"). PZ doesn't accept
   * these in the server INI `Map=` list; the UI defaults them to unchecked
   * so a user importing a collection doesn't accidentally fill `Map=` with
   * non-maps that would log warnings at boot.
   */
  suspectedSpawnRegions: string[];
  /** Steam timestamp (epoch seconds) of the last update, if available */
  timeUpdated: number | null;
  /** File size in bytes, if available */
  fileSize: number | null;
  /** True when Steam tagged this published file as a collection (file_type === 2) */
  isCollection: boolean;
}

export interface ResolvedWorkshopInput {
  /** All importable items. For a single mod URL this has length 1. For a
   *  collection URL this has one entry per child mod (nested collections are
   *  skipped — Steam allows them but PZ does not load collections directly). */
  items: WorkshopMetadata[];
  /** Set when the user pasted a collection URL — gives the UI a label and an
   *  identifier to display. The collection itself is NOT added to
   *  WorkshopItems because PZ wouldn't know what to do with it. */
  parentCollection: { workshopId: string; title: string } | null;
}

const STEAM_DETAILS_URL =
  'https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/';
const STEAM_COLLECTIONS_URL =
  'https://api.steampowered.com/ISteamRemoteStorage/GetCollectionDetails/v1/';

/**
 * Accepts either a bare numeric ID or any of the steamcommunity URLs:
 *   https://steamcommunity.com/sharedfiles/filedetails/?id=2545427742
 *   https://steamcommunity.com/workshop/filedetails/?id=2545427742
 * Returns the numeric id as a string, or null when no id is found.
 */
export function normalizeWorkshopInput(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (/^\d+$/.test(trimmed)) return trimmed;
  try {
    const url = new URL(trimmed);
    const id = url.searchParams.get('id');
    if (id && /^\d+$/.test(id)) return id;
  } catch {
    /* fall through */
  }
  const m = trimmed.match(/\b(\d{7,12})\b/);
  return m?.[1] ?? null;
}

export async function fetchWorkshopMetadata(workshopId: string): Promise<WorkshopMetadata> {
  const [meta] = await fetchManyWorkshopMetadata([workshopId]);
  if (!meta) throw new Error('Workshop item not found in response');
  return meta;
}

/** Batch variant — Steam's API accepts up to ~50 IDs per call. */
export async function fetchManyWorkshopMetadata(ids: string[]): Promise<WorkshopMetadata[]> {
  if (ids.length === 0) return [];
  const body = new URLSearchParams();
  body.set('itemcount', String(ids.length));
  ids.forEach((id, i) => body.set(`publishedfileids[${i}]`, id));
  const res = await fetch(STEAM_DETAILS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) throw new Error(`Steam Workshop API returned HTTP ${res.status}`);
  const json = (await res.json()) as SteamDetailsResponse;
  const out: WorkshopMetadata[] = [];
  for (const item of json?.response?.publishedfiledetails ?? []) {
    if (item.result !== 1 || !item.publishedfileid) continue;
    const description = item.description ?? '';
    const mapFolders = extractMapFolders(description);
    out.push({
      workshopId: item.publishedfileid,
      title: item.title || '(untitled)',
      description,
      detectedModIds: extractModIds(description),
      detectedMapFolders: mapFolders,
      suspectedSpawnRegions: mapFolders.filter(looksLikeSpawnRegion),
      timeUpdated: typeof item.time_updated === 'number' ? item.time_updated : null,
      fileSize:
        typeof item.file_size === 'number'
          ? item.file_size
          : typeof item.file_size === 'string'
            ? Number(item.file_size)
            : null,
      isCollection: item.file_type === 2,
    });
  }
  return out;
}

/** Returns the IDs of every mod-typed child of a Steam Workshop collection. */
export async function fetchCollectionChildren(collectionId: string): Promise<string[]> {
  const body = new URLSearchParams();
  body.set('collectioncount', '1');
  body.set('publishedfileids[0]', collectionId);
  const res = await fetch(STEAM_COLLECTIONS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) throw new Error(`Steam Collection API returned HTTP ${res.status}`);
  const json = (await res.json()) as SteamCollectionResponse;
  const details = json?.response?.collectiondetails?.[0];
  if (!details) throw new Error('Collection not found in response');
  if (details.result !== 1) {
    throw new Error(`Steam returned result=${details.result} for collection ${collectionId}`);
  }
  // file_type 0 = community file (mod). Skip nested collections (file_type 2)
  // and asset types we don't care about (screenshots, videos, …).
  return (details.children ?? [])
    .filter((c) => c.filetype === 0)
    .sort((a, b) => (a.sortorder ?? 0) - (b.sortorder ?? 0))
    .map((c) => c.publishedfileid);
}

/**
 * Resolves user input (workshop URL or numeric ID) into a list of importable
 * mods. Handles both single-mod URLs and collection URLs transparently.
 */
export async function resolveWorkshopInput(input: string): Promise<ResolvedWorkshopInput> {
  const id = normalizeWorkshopInput(input);
  if (!id) throw new Error('No numeric ID detected in the input.');

  const primary = await fetchWorkshopMetadata(id);
  if (!primary.isCollection) {
    return { items: [primary], parentCollection: null };
  }

  const childIds = await fetchCollectionChildren(id);
  if (childIds.length === 0) {
    return {
      items: [],
      parentCollection: { workshopId: id, title: primary.title },
    };
  }
  const items = await fetchManyWorkshopMetadata(childIds);
  return {
    items,
    parentCollection: { workshopId: id, title: primary.title },
  };
}

function extractModIds(description: string): string[] {
  const out = new Set<string>();
  for (const m of description.matchAll(/Mod\s*ID\s*:?\s*([A-Za-z0-9_\-.]+)/gi)) {
    if (m[1]) out.add(m[1]);
  }
  return [...out];
}

function extractMapFolders(description: string): string[] {
  const out = new Set<string>();
  // Map folders may contain spaces ("Muldraugh, KY") so allow a broader char set
  // but stop at line breaks.
  for (const m of description.matchAll(/Map\s*Folder\s*:?\s*([^\r\n]+)/gi)) {
    if (m[1]) out.add(m[1].trim());
  }
  return [...out];
}

/**
 * Recognises folder names that mods declare as "Map Folder:" in their
 * description but that are actually spawn-region payloads, not playable map
 * tiles. Listing them in `Map=` makes PZ log "Unknown map" warnings at boot
 * and serves no purpose — the spawn data is picked up automatically when the
 * mod is in `Mods=`.
 *
 * Heuristic only: a few mod authors put real maps behind names that match
 * these prefixes, so the UI still shows them — it just defaults them
 * unchecked. Misses are fine; false positives just mean an extra click.
 */
export function looksLikeSpawnRegion(name: string): boolean {
  const n = name.trim();
  if (/^many\s+spawns\b/i.test(n)) return true;
  if (/^anywhere\s+but\b/i.test(n)) return true;
  if (/^knox\s+county\b/i.test(n)) return true;
  if (/^one\s+per\b/i.test(n)) return true;
  if (/^by\s+profession\b/i.test(n)) return true;
  if (/\bspawn(s|ing|er|points?|regions?)?\b/i.test(n)) return true;
  return false;
}

interface SteamDetailsResponse {
  response?: {
    publishedfiledetails?: Array<{
      publishedfileid?: string;
      result?: number;
      title?: string;
      description?: string;
      time_updated?: number;
      file_size?: number | string;
      file_type?: number;
    }>;
  };
}

interface SteamCollectionResponse {
  response?: {
    collectiondetails?: Array<{
      publishedfileid?: string;
      result?: number;
      children?: Array<{
        publishedfileid: string;
        sortorder?: number;
        filetype?: number;
      }>;
    }>;
  };
}

// -- INI helpers -------------------------------------------------------------

/** Split a semicolon-separated INI value into trimmed non-empty parts. */
export function splitList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(';')
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

export function joinList(parts: string[]): string {
  return parts.map((p) => p.trim()).filter((p) => p.length > 0).join(';');
}

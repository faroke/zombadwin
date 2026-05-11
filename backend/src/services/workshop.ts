export interface WorkshopMetadata {
  workshopId: string;
  title: string;
  description: string;
  /** Mod IDs heuristically extracted from the description's "Mod ID:" lines */
  detectedModIds: string[];
  /** Map folder names heuristically extracted from "Map Folder:" lines */
  detectedMapFolders: string[];
  /** Steam timestamp (epoch seconds) of the last update, if available */
  timeUpdated: number | null;
  /** File size in bytes, if available */
  fileSize: number | null;
}

const STEAM_DETAILS_URL =
  'https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/';

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
  const body = new URLSearchParams();
  body.set('itemcount', '1');
  body.set('publishedfileids[0]', workshopId);
  const res = await fetch(STEAM_DETAILS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) {
    throw new Error(`Steam Workshop API returned HTTP ${res.status}`);
  }
  const json = (await res.json()) as SteamDetailsResponse;
  const item = json?.response?.publishedfiledetails?.[0];
  if (!item) throw new Error('Workshop item not found in response');
  if (item.result !== 1) {
    throw new Error(`Steam returned result=${item.result} (item probably missing or hidden)`);
  }
  const description = item.description ?? '';
  return {
    workshopId,
    title: item.title || '(untitled)',
    description,
    detectedModIds: extractModIds(description),
    detectedMapFolders: extractMapFolders(description),
    timeUpdated: typeof item.time_updated === 'number' ? item.time_updated : null,
    fileSize:
      typeof item.file_size === 'number'
        ? item.file_size
        : typeof item.file_size === 'string'
          ? Number(item.file_size)
          : null,
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

interface SteamDetailsResponse {
  response?: {
    publishedfiledetails?: Array<{
      publishedfileid?: string;
      result?: number;
      title?: string;
      description?: string;
      time_updated?: number;
      file_size?: number | string;
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

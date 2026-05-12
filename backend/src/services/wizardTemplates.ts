import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** What a wizard template looks like once loaded. The JSON shape on disk
 * mirrors this 1:1 — additional unknown fields are passed through so we don't
 * have to rev the loader when adding a new pre-fill knob. */
export interface WizardTemplate {
  /** Stable identifier (filename stem, e.g. "vanilla-coop"). */
  id: string;
  /** Short display name shown in the wizard's chooser. */
  label: string;
  /** One-sentence description shown next to the label. */
  description: string;
  /** Steam beta branch to pre-select in the Build step. Empty = default branch. */
  branch: string;
  /** Sandbox preset name (e.g. "Apocalypse") to pre-select in Difficulty. */
  difficultyPreset: string;
  /** Optional Workshop URL pre-filled in the Mods step. null = vanilla. */
  collectionUrl: string | null;
  /** INI field overrides applied as defaults in the Network step. */
  ini: Record<string, string>;
}

function templatesDir(): string {
  // When running compiled JS, __dirname is backend/dist/services. The templates
  // ship alongside the source under backend/templates/wizard. Resolve relative
  // to the package root in both dev (tsx) and prod (node dist) layouts.
  const candidates = [
    resolve(__dirname, '..', '..', 'templates', 'wizard'),
    resolve(__dirname, '..', '..', '..', 'templates', 'wizard'),
  ];
  return candidates.find((p) => existsSync(p)) ?? candidates[0]!;
}

/** Reads every *.json in the templates dir. Bad files are skipped and logged
 * to stderr — one corrupt template should not 500 the whole endpoint. */
export function listWizardTemplates(): WizardTemplate[] {
  const dir = templatesDir();
  if (!existsSync(dir)) return [];
  const out: WizardTemplate[] = [];
  for (const entry of readdirSync(dir)) {
    if (extname(entry).toLowerCase() !== '.json') continue;
    try {
      const raw = readFileSync(join(dir, entry), 'utf8');
      const parsed = JSON.parse(raw) as Partial<WizardTemplate>;
      if (
        typeof parsed.id !== 'string' ||
        typeof parsed.label !== 'string' ||
        typeof parsed.difficultyPreset !== 'string'
      ) {
        continue;
      }
      out.push({
        id: parsed.id,
        label: parsed.label,
        description: parsed.description ?? '',
        branch: parsed.branch ?? '',
        difficultyPreset: parsed.difficultyPreset,
        collectionUrl: parsed.collectionUrl ?? null,
        ini: parsed.ini ?? {},
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`failed to load wizard template ${entry}: ${(err as Error).message}`);
    }
  }
  return out.sort((a, b) => a.label.localeCompare(b.label));
}

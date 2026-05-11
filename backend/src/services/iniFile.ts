import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface IniFile {
  /** Ordered list of keys as they appear in the file (excluding comments/blank lines) */
  order: string[];
  /** Key → string value */
  values: Record<string, string>;
  /** Raw lines (comments/blank) interleaved with key markers, to preserve formatting on write */
  raw: Array<{ kind: 'kv'; key: string } | { kind: 'literal'; text: string }>;
}

export function serverIniPath(userDir: string, serverName: string): string {
  return join(userDir, 'Server', `${serverName}.ini`);
}

export function readIniFile(path: string): IniFile {
  if (!existsSync(path)) {
    throw new Error(`INI file not found at ${path}`);
  }
  const text = readFileSync(path, 'utf8');
  return parseIni(text);
}

export function parseIni(text: string): IniFile {
  const file: IniFile = { order: [], values: {}, raw: [] };
  // PZ uses CRLF on Windows; handle both.
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#') || trimmed.startsWith(';')) {
      file.raw.push({ kind: 'literal', text: line });
      continue;
    }
    const eq = line.indexOf('=');
    if (eq === -1) {
      file.raw.push({ kind: 'literal', text: line });
      continue;
    }
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1);
    if (!key) {
      file.raw.push({ kind: 'literal', text: line });
      continue;
    }
    if (!(key in file.values)) file.order.push(key);
    file.values[key] = value;
    file.raw.push({ kind: 'kv', key });
  }
  return file;
}

/**
 * Returns the serialized INI text using `file.raw` to preserve original ordering,
 * comments and blank lines. New keys (present in `file.values` but not in `file.raw`)
 * are appended at the end in `order` insertion order.
 */
export function serializeIni(file: IniFile): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of file.raw) {
    if (item.kind === 'literal') {
      out.push(item.text);
    } else {
      const v = file.values[item.key];
      if (v === undefined) {
        // Key was removed — skip the line entirely.
        continue;
      }
      out.push(`${item.key}=${v}`);
      seen.add(item.key);
    }
  }
  for (const key of file.order) {
    if (!seen.has(key)) {
      out.push(`${key}=${file.values[key] ?? ''}`);
    }
  }
  return out.join('\n');
}

export function writeIniFile(path: string, file: IniFile): void {
  writeFileSync(path, serializeIni(file), 'utf8');
}

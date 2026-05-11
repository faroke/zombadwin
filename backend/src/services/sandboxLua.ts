import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Sandbox values are Lua primitives: number, boolean, string. Nested tables can
 * also appear (ZombieLore, ZombieConfig), so values may themselves be records of
 * primitives.
 */
export type SandboxPrimitive = number | boolean | string;
export type SandboxValue = SandboxPrimitive | SandboxRecord;
export interface SandboxRecord {
  [key: string]: SandboxValue;
}

export function sandboxPath(userDir: string, serverName: string): string {
  return join(userDir, 'Server', `${serverName}_SandboxVars.lua`);
}

export function readSandbox(path: string): SandboxRecord {
  if (!existsSync(path)) throw new Error(`SandboxVars file not found at ${path}`);
  const text = readFileSync(path, 'utf8');
  return parseSandbox(text);
}

export function writeSandbox(path: string, record: SandboxRecord): void {
  writeFileSync(path, serializeSandbox(record), 'utf8');
}

// -- Parser ------------------------------------------------------------------

class Cursor {
  pos = 0;
  constructor(public readonly src: string) {}

  peek(offset = 0): string {
    return this.src[this.pos + offset] ?? '';
  }

  eof(): boolean {
    return this.pos >= this.src.length;
  }

  skipWhitespaceAndComments(): void {
    for (;;) {
      while (!this.eof() && /\s/.test(this.peek())) this.pos++;
      // Lua line comment: -- ... \n
      if (this.peek() === '-' && this.peek(1) === '-') {
        // long comment: --[[ ... ]]
        if (this.peek(2) === '[' && this.peek(3) === '[') {
          const end = this.src.indexOf(']]', this.pos + 4);
          this.pos = end === -1 ? this.src.length : end + 2;
          continue;
        }
        const nl = this.src.indexOf('\n', this.pos);
        this.pos = nl === -1 ? this.src.length : nl + 1;
        continue;
      }
      break;
    }
  }

  expect(ch: string): void {
    if (this.peek() !== ch) {
      throw new Error(
        `expected '${ch}' at position ${this.pos}, got '${this.peek()}' near: ${this.src.slice(this.pos, this.pos + 30)}`,
      );
    }
    this.pos++;
  }

  readIdent(): string {
    let s = '';
    while (!this.eof() && /[A-Za-z0-9_]/.test(this.peek())) {
      s += this.peek();
      this.pos++;
    }
    if (s === '') {
      throw new Error(`expected identifier at position ${this.pos}`);
    }
    return s;
  }
}

export function parseSandbox(src: string): SandboxRecord {
  const c = new Cursor(src);
  c.skipWhitespaceAndComments();

  // Allow "SandboxVars = { ... }" OR a bare "{ ... }"; or "return { ... }".
  if (c.peek() === '{') {
    return parseTable(c);
  }
  // SandboxVars or return
  const head = c.readIdent();
  c.skipWhitespaceAndComments();
  if (head !== 'return') {
    c.expect('=');
  }
  c.skipWhitespaceAndComments();
  return parseTable(c);
}

function parseTable(c: Cursor): SandboxRecord {
  c.expect('{');
  const out: SandboxRecord = {};
  for (;;) {
    c.skipWhitespaceAndComments();
    if (c.peek() === '}') {
      c.pos++;
      return out;
    }
    const key = c.readIdent();
    c.skipWhitespaceAndComments();
    c.expect('=');
    c.skipWhitespaceAndComments();
    const value = parseValue(c);
    out[key] = value;
    c.skipWhitespaceAndComments();
    if (c.peek() === ',' || c.peek() === ';') c.pos++;
  }
}

function parseValue(c: Cursor): SandboxValue {
  c.skipWhitespaceAndComments();
  const ch = c.peek();

  if (ch === '{') return parseTable(c);
  if (ch === '"' || ch === "'") return parseString(c);
  if (ch === '-' || ch === '+' || /[0-9.]/.test(ch)) return parseNumber(c);
  // identifier: true, false, or named value (we treat anything else as identifier string)
  const ident = c.readIdent();
  if (ident === 'true') return true;
  if (ident === 'false') return false;
  // Rare in SandboxVars, but treat unknown identifiers as strings.
  return ident;
}

function parseString(c: Cursor): string {
  const quote = c.peek();
  c.pos++;
  let s = '';
  while (!c.eof() && c.peek() !== quote) {
    if (c.peek() === '\\') {
      c.pos++;
      const escape = c.peek();
      c.pos++;
      if (escape === 'n') s += '\n';
      else if (escape === 't') s += '\t';
      else if (escape === 'r') s += '\r';
      else s += escape;
    } else {
      s += c.peek();
      c.pos++;
    }
  }
  c.expect(quote);
  return s;
}

function parseNumber(c: Cursor): number {
  let s = '';
  while (!c.eof() && /[-+0-9.eE]/.test(c.peek())) {
    s += c.peek();
    c.pos++;
  }
  const n = Number(s);
  if (Number.isNaN(n)) throw new Error(`invalid number '${s}'`);
  return n;
}

// -- Serializer --------------------------------------------------------------

export function serializeSandbox(record: SandboxRecord, indent = 0): string {
  const lines: string[] = [];
  lines.push('SandboxVars = {');
  for (const [key, value] of Object.entries(record)) {
    lines.push(`${pad(1)}${key} = ${formatValue(value, 1)},`);
  }
  lines.push('}');
  void indent;
  return lines.join('\n') + '\n';
}

function formatValue(value: SandboxValue, indentLevel: number): string {
  if (typeof value === 'number') return formatNumber(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'string') return `"${value.replace(/"/g, '\\"')}"`;
  // Nested table
  const lines: string[] = ['{'];
  for (const [k, v] of Object.entries(value)) {
    lines.push(`${pad(indentLevel + 1)}${k} = ${formatValue(v, indentLevel + 1)},`);
  }
  lines.push(`${pad(indentLevel)}}`);
  return lines.join('\n');
}

function formatNumber(n: number): string {
  // Preserve floats vs ints. Lua usually formats whole-floats like 1.0 (PZ does), so
  // we follow that convention: if the number has no decimal part but is "known to be"
  // a float, we'd need extra signal — without it, default to integer formatting for
  // whole numbers. The schema can hint via type to force a decimal.
  if (Number.isInteger(n)) return String(n);
  return String(n);
}

function pad(level: number): string {
  return ' '.repeat(level * 4);
}

/** Patch a parsed sandbox record with a flat or nested patch object. */
export function mergeSandbox(base: SandboxRecord, patch: SandboxRecord): SandboxRecord {
  const out: SandboxRecord = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    const existing = out[k];
    if (
      v !== null &&
      typeof v === 'object' &&
      existing !== undefined &&
      typeof existing === 'object'
    ) {
      out[k] = mergeSandbox(existing as SandboxRecord, v as SandboxRecord);
    } else {
      out[k] = v;
    }
  }
  return out;
}

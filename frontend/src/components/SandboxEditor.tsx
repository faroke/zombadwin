import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, Save } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';

type SandboxType = 'int' | 'float' | 'bool' | 'enum';

interface SandboxOption {
  value: number;
  label: string;
}

interface SandboxSettingDef {
  path: string;
  type: SandboxType;
  label: string;
  description: string;
  category: string;
  options?: SandboxOption[];
  min?: number;
  max?: number;
  isFloat?: boolean;
}

type SandboxPrimitive = number | boolean | string;
type SandboxValue = SandboxPrimitive | SandboxRecord;
interface SandboxRecord {
  [key: string]: SandboxValue;
}

interface SandboxResponse {
  path: string;
  serverName: string;
  values: SandboxRecord;
  schema: SandboxSettingDef[];
  categories: string[];
}

interface SandboxNotFound {
  error: 'sandbox_not_found';
  message: string;
  path: string;
  serverName: string;
  schema: SandboxSettingDef[];
  categories: string[];
}

function getByPath(obj: SandboxRecord, path: string): SandboxValue | undefined {
  const parts = path.split('.');
  let cur: SandboxValue | undefined = obj;
  for (const p of parts) {
    if (cur === undefined || cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as SandboxRecord)[p];
  }
  return cur;
}

function setByPath(obj: SandboxRecord, path: string, value: SandboxValue): SandboxRecord {
  const parts = path.split('.');
  const out: SandboxRecord = { ...obj };
  let cur: SandboxRecord = out;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i] as string;
    const next = cur[key];
    cur[key] = { ...(typeof next === 'object' && next !== null ? (next as SandboxRecord) : {}) };
    cur = cur[key] as SandboxRecord;
  }
  cur[parts[parts.length - 1] as string] = value;
  return out;
}

function buildPatch(
  draft: SandboxRecord,
  baseline: SandboxRecord,
  dirtyPaths: string[],
): SandboxRecord {
  let patch: SandboxRecord = {};
  for (const p of dirtyPaths) {
    const v = getByPath(draft, p);
    if (v !== undefined) patch = setByPath(patch, p, v);
  }
  void baseline;
  return patch;
}

export function SandboxEditor(): JSX.Element {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ['config-sandbox'],
    queryFn: () => api<SandboxResponse>('/api/config/sandbox'),
    retry: false,
  });

  const [draft, setDraft] = useState<SandboxRecord>({});
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (query.data?.values) setDraft(structuredClone(query.data.values));
  }, [query.data?.values]);

  const save = useMutation({
    mutationFn: (values: SandboxRecord) =>
      api('/api/config/sandbox', { method: 'PUT', body: JSON.stringify({ values }) }),
    onSuccess: () => {
      setFeedback({ ok: true, text: 'Saved.' });
      void qc.invalidateQueries({ queryKey: ['config-sandbox'] });
    },
    onError: (err: Error) => {
      setFeedback({
        ok: false,
        text: err instanceof ApiError ? `Save failed (HTTP ${err.status})` : err.message,
      });
    },
  });

  const notFound = useMemo<SandboxNotFound | null>(() => {
    if (!query.error || !(query.error instanceof ApiError) || query.error.status !== 404) {
      return null;
    }
    return query.error.body as SandboxNotFound;
  }, [query.error]);

  const data = query.data ?? null;
  const schema = data?.schema ?? notFound?.schema ?? [];
  const categories = data?.categories ?? notFound?.categories ?? [];

  const schemaByCategory = useMemo(() => {
    const map = new Map<string, SandboxSettingDef[]>();
    for (const s of schema) {
      if (!map.has(s.category)) map.set(s.category, []);
      map.get(s.category)?.push(s);
    }
    return map;
  }, [schema]);

  const dirtyPaths = useMemo(() => {
    if (!data) return [];
    const out: string[] = [];
    for (const s of schema) {
      const draftVal = getByPath(draft, s.path);
      const origVal = getByPath(data.values, s.path);
      if (draftVal !== origVal && draftVal !== undefined) {
        out.push(s.path);
      }
    }
    return out;
  }, [draft, data, schema]);

  useEffect(() => {
    if (!activeCategory && categories.length > 0) setActiveCategory(categories[0] ?? null);
  }, [activeCategory, categories]);

  function update(path: string, value: SandboxValue): void {
    setDraft((d) => setByPath(d, path, value));
    setFeedback(null);
  }

  function discard(): void {
    if (data) setDraft(structuredClone(data.values));
    setFeedback(null);
  }

  function submit(): void {
    if (!data) return;
    const patch = buildPatch(draft, data.values, dirtyPaths);
    save.mutate(patch);
  }

  if (query.isLoading) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }

  if (notFound) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">SandboxVars file not found</CardTitle>
          <CardDescription>{notFound.path}</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Start the server once from the Console page — Project Zomboid will generate the default
            sandbox file on first run. Then reload this page.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (query.error || !data) {
    return (
      <p className="text-sm text-destructive">
        Error loading sandbox: {(query.error as Error | null)?.message ?? 'unknown'}
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <header className="flex items-start justify-between gap-4">
        <p className="text-xs text-muted-foreground">
          Editing <code>{data.path}</code>
        </p>
        <div className="flex items-center gap-2">
          {dirtyPaths.length > 0 && (
            <span className="text-xs text-muted-foreground">
              {dirtyPaths.length} unsaved change{dirtyPaths.length > 1 ? 's' : ''}
            </span>
          )}
          <Button variant="outline" size="sm" onClick={discard} disabled={dirtyPaths.length === 0}>
            Discard
          </Button>
          <Button size="sm" onClick={submit} disabled={dirtyPaths.length === 0 || save.isPending}>
            <Save className="mr-2 h-4 w-4" />
            {save.isPending ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </header>

      {feedback && (
        <div
          className={cn(
            'rounded-md border px-3 py-2 text-sm',
            feedback.ok
              ? 'border-primary/40 bg-primary/10 text-primary'
              : 'border-destructive/40 bg-destructive/10 text-destructive',
          )}
        >
          {feedback.text}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-[200px_1fr]">
        <aside className="space-y-1">
          {categories.map((cat) => {
            const settings = schemaByCategory.get(cat) ?? [];
            if (settings.length === 0) return null;
            const dirtyInCat = settings.filter((s) => dirtyPaths.includes(s.path)).length;
            return (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className={cn(
                  'flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm transition-colors',
                  activeCategory === cat
                    ? 'bg-accent text-accent-foreground'
                    : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
                )}
              >
                <span>{cat}</span>
                {dirtyInCat > 0 && (
                  <span className="rounded-full bg-primary/30 px-1.5 py-0.5 text-xs">
                    {dirtyInCat}
                  </span>
                )}
              </button>
            );
          })}
        </aside>

        <section className="space-y-3">
          {(schemaByCategory.get(activeCategory ?? '') ?? []).map((s) => (
            <SandboxRow
              key={s.path}
              def={s}
              draftValue={getByPath(draft, s.path)}
              originalValue={getByPath(data.values, s.path)}
              onChange={(v) => update(s.path, v)}
            />
          ))}
        </section>
      </div>
    </div>
  );
}

function SandboxRow({
  def,
  draftValue,
  originalValue,
  onChange,
}: {
  def: SandboxSettingDef;
  draftValue: SandboxValue | undefined;
  originalValue: SandboxValue | undefined;
  onChange: (v: SandboxValue) => void;
}): JSX.Element {
  const dirty = originalValue !== undefined && draftValue !== originalValue;
  const missing = originalValue === undefined;
  return (
    <Card className={cn(dirty && 'border-primary/50')}>
      <CardContent className="space-y-2 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <label className="text-sm font-medium">{def.label}</label>
            <p className="text-xs text-muted-foreground">{def.description}</p>
            <p className="mt-0.5 font-mono text-[10px] text-muted-foreground/70">{def.path}</p>
          </div>
          {missing && (
            <span className="inline-flex items-center text-[10px] text-amber-400">
              <AlertCircle className="mr-1 h-3 w-3" />
              Not in current file
            </span>
          )}
        </div>
        <SandboxControl def={def} value={draftValue} onChange={onChange} />
      </CardContent>
    </Card>
  );
}

function SandboxControl({
  def,
  value,
  onChange,
}: {
  def: SandboxSettingDef;
  value: SandboxValue | undefined;
  onChange: (v: SandboxValue) => void;
}): JSX.Element {
  if (def.type === 'bool') {
    const checked = value === true;
    return (
      <label className="inline-flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="h-4 w-4 rounded border-input bg-background accent-primary"
        />
        <span className="text-muted-foreground">{String(value ?? '(unset)')}</span>
      </label>
    );
  }
  if (def.type === 'enum' && def.options) {
    const numericValue = typeof value === 'number' ? value : Number(value ?? '');
    return (
      <select
        value={Number.isNaN(numericValue) ? '' : String(numericValue)}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-9 rounded-md border border-input bg-background px-2 text-sm"
      >
        {def.options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.value} — {o.label}
          </option>
        ))}
      </select>
    );
  }
  // int / float
  const stringValue = value === undefined ? '' : String(value);
  return (
    <Input
      type="number"
      step={def.type === 'float' ? '0.01' : '1'}
      min={def.min}
      max={def.max}
      value={stringValue}
      onChange={(e) => {
        const v = e.target.value;
        if (v === '') return;
        const n = Number(v);
        if (!Number.isNaN(n)) onChange(n);
      }}
    />
  );
}

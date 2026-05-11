import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, Save } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';

type IniValueType = 'bool' | 'int' | 'float' | 'string' | 'enum';

interface IniSettingDef {
  key: string;
  type: IniValueType;
  label: string;
  description: string;
  category: string;
  default?: string;
  options?: string[];
  min?: number;
  max?: number;
}

interface IniResponse {
  path: string;
  serverName: string;
  values: Record<string, string>;
  order: string[];
  schema: IniSettingDef[];
  categories: string[];
}

interface IniNotFound {
  error: 'ini_not_found';
  message: string;
  path: string;
  serverName: string;
  schema: IniSettingDef[];
  categories: string[];
}

function fetchIni(): Promise<IniResponse> {
  return api<IniResponse>('/api/config/ini');
}

export function Config(): JSX.Element {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ['config-ini'],
    queryFn: fetchIni,
    retry: false,
  });

  const [draft, setDraft] = useState<Record<string, string>>({});
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (query.data?.values) setDraft({ ...query.data.values });
  }, [query.data?.values]);

  const save = useMutation({
    mutationFn: (values: Record<string, string>) =>
      api('/api/config/ini', { method: 'PUT', body: JSON.stringify({ values }) }),
    onSuccess: () => {
      setFeedback({ ok: true, text: 'Saved.' });
      void qc.invalidateQueries({ queryKey: ['config-ini'] });
    },
    onError: (err: Error) => {
      setFeedback({
        ok: false,
        text: err instanceof ApiError ? `Save failed (HTTP ${err.status})` : err.message,
      });
    },
  });

  // Handle 404 "ini not found" specifically — backend still returns the schema.
  const notFound = useMemo<IniNotFound | null>(() => {
    if (!query.error || !(query.error instanceof ApiError) || query.error.status !== 404) {
      return null;
    }
    return query.error.body as IniNotFound;
  }, [query.error]);

  const data = query.data ?? null;
  const schema = data?.schema ?? notFound?.schema ?? [];
  const categories = data?.categories ?? notFound?.categories ?? [];

  const schemaByCategory = useMemo(() => {
    const map = new Map<string, IniSettingDef[]>();
    for (const s of schema) {
      if (!map.has(s.category)) map.set(s.category, []);
      map.get(s.category)?.push(s);
    }
    return map;
  }, [schema]);

  const schemaKeySet = useMemo(() => new Set(schema.map((s) => s.key)), [schema]);
  const unknownKeys = useMemo(
    () => (data ? data.order.filter((k) => !schemaKeySet.has(k)) : []),
    [data, schemaKeySet],
  );

  const dirtyKeys = useMemo(() => {
    if (!data) return [];
    const out: string[] = [];
    for (const k of Object.keys(draft)) {
      if (draft[k] !== data.values[k]) out.push(k);
    }
    return out;
  }, [draft, data]);

  useEffect(() => {
    if (!activeCategory && categories.length > 0) setActiveCategory(categories[0] ?? null);
  }, [activeCategory, categories]);

  function update(key: string, value: string): void {
    setDraft((d) => ({ ...d, [key]: value }));
    setFeedback(null);
  }

  function discard(): void {
    if (data) setDraft({ ...data.values });
    setFeedback(null);
  }

  function submit(): void {
    if (!data) return;
    const patch: Record<string, string> = {};
    for (const k of dirtyKeys) patch[k] = draft[k] ?? '';
    save.mutate(patch);
  }

  if (query.isLoading) {
    return <div className="container mx-auto p-6 text-sm text-muted-foreground">Loading…</div>;
  }

  if (notFound) {
    return (
      <div className="container mx-auto p-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Configuration file not found</CardTitle>
            <CardDescription>{notFound.path}</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Start the server once from the Console page — Project Zomboid will generate a default{' '}
              <code>{notFound.serverName}.ini</code> on first run. Then reload this page.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (query.error || !data) {
    return (
      <div className="container mx-auto p-6 text-sm text-destructive">
        Error loading config: {(query.error as Error | null)?.message ?? 'unknown'}
      </div>
    );
  }

  return (
    <div className="container mx-auto space-y-4 p-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Server config</h1>
          <p className="text-sm text-muted-foreground">
            Editing <code className="text-xs">{data.path}</code>
          </p>
        </div>
        <div className="flex items-center gap-2">
          {dirtyKeys.length > 0 && (
            <span className="text-xs text-muted-foreground">
              {dirtyKeys.length} unsaved change{dirtyKeys.length > 1 ? 's' : ''}
            </span>
          )}
          <Button variant="outline" onClick={discard} disabled={dirtyKeys.length === 0}>
            Discard
          </Button>
          <Button onClick={submit} disabled={dirtyKeys.length === 0 || save.isPending}>
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
            const dirtyInCat = settings.filter((s) => dirtyKeys.includes(s.key)).length;
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
          <button
            onClick={() => setActiveCategory('__other__')}
            className={cn(
              'flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm transition-colors',
              activeCategory === '__other__'
                ? 'bg-accent text-accent-foreground'
                : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
            )}
          >
            <span>Other ({unknownKeys.length})</span>
          </button>
        </aside>

        <section className="space-y-3">
          {activeCategory === '__other__' ? (
            <OtherCategory
              keys={unknownKeys}
              values={draft}
              originalValues={data.values}
              onChange={update}
            />
          ) : (
            (schemaByCategory.get(activeCategory ?? '') ?? []).map((s) => (
              <SettingRow
                key={s.key}
                def={s}
                value={draft[s.key] ?? ''}
                originalValue={data.values[s.key]}
                onChange={(v) => update(s.key, v)}
              />
            ))
          )}
        </section>
      </div>
    </div>
  );
}

function SettingRow({
  def,
  value,
  originalValue,
  onChange,
}: {
  def: IniSettingDef;
  value: string;
  originalValue: string | undefined;
  onChange: (v: string) => void;
}): JSX.Element {
  const dirty = originalValue !== undefined && value !== originalValue;
  const missing = originalValue === undefined;

  return (
    <Card className={cn(dirty && 'border-primary/50')}>
      <CardContent className="space-y-2 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <label htmlFor={def.key} className="text-sm font-medium">
              {def.label}
            </label>
            <p className="text-xs text-muted-foreground">{def.description}</p>
            <p className="mt-0.5 font-mono text-[10px] text-muted-foreground/70">{def.key}</p>
          </div>
          {missing && (
            <span className="inline-flex items-center text-[10px] text-amber-400">
              <AlertCircle className="mr-1 h-3 w-3" />
              Not in current file
            </span>
          )}
        </div>
        <div>{renderControl(def, value, onChange)}</div>
      </CardContent>
    </Card>
  );
}

function renderControl(
  def: IniSettingDef,
  value: string,
  onChange: (v: string) => void,
): JSX.Element {
  if (def.type === 'bool') {
    const checked = value.toLowerCase() === 'true';
    return (
      <label className="inline-flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked ? 'true' : 'false')}
          className="h-4 w-4 rounded border-input bg-background accent-primary"
        />
        <span className="text-muted-foreground">{value || '(unset)'}</span>
      </label>
    );
  }
  if (def.type === 'enum' && def.options) {
    return (
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 rounded-md border border-input bg-background px-2 text-sm"
      >
        {def.options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    );
  }
  if (def.type === 'int' || def.type === 'float') {
    return (
      <Input
        id={def.key}
        type="number"
        step={def.type === 'float' ? '0.01' : '1'}
        min={def.min}
        max={def.max}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }
  return (
    <Input
      id={def.key}
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="font-mono"
    />
  );
}

function OtherCategory({
  keys,
  values,
  originalValues,
  onChange,
}: {
  keys: string[];
  values: Record<string, string>;
  originalValues: Record<string, string>;
  onChange: (k: string, v: string) => void;
}): JSX.Element {
  if (keys.length === 0) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-muted-foreground">
          No additional keys outside the curated schema. Everything in your INI is already covered
          by the categorized editor.
        </CardContent>
      </Card>
    );
  }
  return (
    <>
      {keys.map((k) => (
        <Card key={k} className={cn(values[k] !== originalValues[k] && 'border-primary/50')}>
          <CardContent className="space-y-2 p-4">
            <label htmlFor={k} className="font-mono text-sm font-medium">
              {k}
            </label>
            <Input
              id={k}
              type="text"
              value={values[k] ?? ''}
              onChange={(e) => onChange(k, e.target.value)}
              className="font-mono"
            />
          </CardContent>
        </Card>
      ))}
    </>
  );
}

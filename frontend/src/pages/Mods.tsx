import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowDown,
  ArrowUp,
  Loader2,
  Map as MapIcon,
  Package,
  Plus,
  Save,
  Search,
  Trash2,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';

interface ModsResponse {
  path: string;
  serverName: string;
  workshopItems: string[];
  mods: string[];
  map: string[];
}

interface WorkshopMetadata {
  workshopId: string;
  title: string;
  description: string;
  detectedModIds: string[];
  detectedMapFolders: string[];
  timeUpdated: number | null;
  fileSize: number | null;
}

interface ResolveResponse {
  ok: true;
  metadata: WorkshopMetadata;
}

export function Mods(): JSX.Element {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ['mods'],
    queryFn: () => api<ModsResponse>('/api/mods'),
    retry: false,
  });

  const [workshopItems, setWorkshopItems] = useState<string[]>([]);
  const [mods, setMods] = useState<string[]>([]);
  const [map, setMap] = useState<string[]>([]);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [metadataCache, setMetadataCache] = useState<Record<string, WorkshopMetadata>>({});

  // Sync local state when the server data lands.
  useEffect(() => {
    if (query.data) {
      setWorkshopItems(query.data.workshopItems);
      setMods(query.data.mods);
      setMap(query.data.map);
    }
  }, [query.data]);

  function notify(ok: boolean, text: string, ttl = 4000): void {
    setFeedback({ ok, text });
    setTimeout(() => setFeedback(null), ttl);
  }

  const dirty = useMemo(() => {
    if (!query.data) return false;
    return (
      JSON.stringify(workshopItems) !== JSON.stringify(query.data.workshopItems) ||
      JSON.stringify(mods) !== JSON.stringify(query.data.mods) ||
      JSON.stringify(map) !== JSON.stringify(query.data.map)
    );
  }, [workshopItems, mods, map, query.data]);

  const resolve = useMutation({
    mutationFn: (input: string) =>
      api<ResolveResponse>('/api/mods/resolve', {
        method: 'POST',
        body: JSON.stringify({ input }),
      }),
  });

  const save = useMutation({
    mutationFn: () =>
      api('/api/mods', {
        method: 'PUT',
        body: JSON.stringify({ workshopItems, mods, map }),
      }),
    onSuccess: () => {
      notify(true, 'Saved.');
      void qc.invalidateQueries({ queryKey: ['mods'] });
    },
    onError: (err: Error) =>
      notify(false, err instanceof ApiError ? `Save failed (${err.status})` : err.message),
  });

  function discard(): void {
    if (!query.data) return;
    setWorkshopItems(query.data.workshopItems);
    setMods(query.data.mods);
    setMap(query.data.map);
    setFeedback(null);
  }

  function addWorkshopItem(meta: WorkshopMetadata, chosenModIds: string[], chosenMaps: string[]): void {
    if (workshopItems.includes(meta.workshopId)) {
      notify(false, `Workshop ${meta.workshopId} already in list.`);
      return;
    }
    setWorkshopItems((w) => [...w, meta.workshopId]);
    setMods((m) => {
      const next = [...m];
      for (const id of chosenModIds) if (!next.includes(id)) next.push(id);
      return next;
    });
    setMap((mp) => {
      const next = [...mp];
      // Make sure the base map stays at the bottom — insert maps just before it if present.
      const baseIdx = next.length > 0 ? next.length - 1 : -1;
      for (const m of chosenMaps) {
        if (next.includes(m)) continue;
        if (baseIdx === -1) next.push(m);
        else next.splice(baseIdx, 0, m);
      }
      return next;
    });
    setMetadataCache((c) => ({ ...c, [meta.workshopId]: meta }));
    notify(true, `Added ${meta.title}.`);
  }

  function moveItem<T>(list: T[], idx: number, dir: -1 | 1): T[] {
    const next = [...list];
    const j = idx + dir;
    if (j < 0 || j >= next.length) return next;
    const tmp = next[idx] as T;
    next[idx] = next[j] as T;
    next[j] = tmp;
    return next;
  }

  if (query.isLoading) {
    return <div className="container mx-auto p-6 text-sm text-muted-foreground">Loading…</div>;
  }

  if (query.error instanceof ApiError && query.error.status === 404) {
    return (
      <div className="container mx-auto p-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Configuration file not found</CardTitle>
            <CardDescription>{(query.error.body as { path: string }).path}</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Start the server once from the Console page so PZ creates the default INI, then come
              back here.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (query.error || !query.data) {
    return (
      <div className="container mx-auto p-6 text-sm text-destructive">
        Error: {(query.error as Error | null)?.message ?? 'unknown'}
      </div>
    );
  }

  return (
    <div className="container mx-auto space-y-4 p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Workshop mods</h1>
          <p className="text-sm text-muted-foreground">
            Writes <code>WorkshopItems</code>, <code>Mods</code>, and <code>Map</code> in your{' '}
            <code>{query.data.path.split(/[\\/]/).pop()}</code>.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {dirty && <span className="text-xs text-muted-foreground">Unsaved changes</span>}
          <Button variant="outline" size="sm" onClick={discard} disabled={!dirty}>
            Discard
          </Button>
          <Button size="sm" onClick={() => save.mutate()} disabled={!dirty || save.isPending}>
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

      <AddModForm
        resolveState={{
          run: (i) => resolve.mutateAsync(i),
          isPending: resolve.isPending,
        }}
        onAdd={addWorkshopItem}
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Package className="h-4 w-4" />
            Workshop subscriptions ({workshopItems.length})
          </CardTitle>
          <CardDescription>
            Steam Workshop items downloaded by the server. Their mod IDs need to also appear in the
            "Loaded mods" list below.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {workshopItems.length === 0 ? (
            <p className="text-sm text-muted-foreground">No workshop subscriptions.</p>
          ) : (
            workshopItems.map((id, idx) => (
              <ListRow
                key={id}
                primary={
                  <span className="font-mono">
                    {id}{' '}
                    {metadataCache[id] && (
                      <span className="font-sans font-medium text-foreground">
                        — {metadataCache[id]!.title}
                      </span>
                    )}
                  </span>
                }
                onUp={() => setWorkshopItems((w) => moveItem(w, idx, -1))}
                onDown={() => setWorkshopItems((w) => moveItem(w, idx, +1))}
                onDelete={() => setWorkshopItems((w) => w.filter((_, i) => i !== idx))}
              />
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Package className="h-4 w-4" />
            Loaded mods ({mods.length})
          </CardTitle>
          <CardDescription>
            Mod folder IDs — the order is the load order. Dependencies (libraries) should come
            before mods that need them.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {mods.length === 0 ? (
            <p className="text-sm text-muted-foreground">No mods loaded.</p>
          ) : (
            mods.map((id, idx) => (
              <ListRow
                key={`${id}-${idx}`}
                primary={<span className="font-mono">{id}</span>}
                onUp={() => setMods((m) => moveItem(m, idx, -1))}
                onDown={() => setMods((m) => moveItem(m, idx, +1))}
                onDelete={() => setMods((m) => m.filter((_, i) => i !== idx))}
              />
            ))
          )}
          <AddRowForm
            placeholder="Mod folder ID (e.g. tsarslib)"
            onAdd={(v) => setMods((m) => (m.includes(v) ? m : [...m, v]))}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <MapIcon className="h-4 w-4" />
            Map list ({map.length})
          </CardTitle>
          <CardDescription>
            Loaded in order — the last entry should be the base map (e.g. "Muldraugh, KY").
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {map.length === 0 ? (
            <p className="text-sm text-muted-foreground">No maps configured.</p>
          ) : (
            map.map((name, idx) => (
              <ListRow
                key={`${name}-${idx}`}
                primary={<span className="font-mono">{name}</span>}
                onUp={() => setMap((m) => moveItem(m, idx, -1))}
                onDown={() => setMap((m) => moveItem(m, idx, +1))}
                onDelete={() => setMap((m) => m.filter((_, i) => i !== idx))}
              />
            ))
          )}
          <AddRowForm
            placeholder='Map folder (e.g. "Muldraugh, KY")'
            onAdd={(v) => setMap((m) => (m.includes(v) ? m : [...m, v]))}
          />
        </CardContent>
      </Card>
    </div>
  );
}

function ListRow({
  primary,
  onUp,
  onDown,
  onDelete,
}: {
  primary: React.ReactNode;
  onUp: () => void;
  onDown: () => void;
  onDelete: () => void;
}): JSX.Element {
  return (
    <div className="flex items-center justify-between gap-2 rounded-md border border-border bg-card p-2 text-sm">
      <div className="min-w-0 flex-1 truncate">{primary}</div>
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="icon" onClick={onUp} title="Move up">
          <ArrowUp className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" onClick={onDown} title="Move down">
          <ArrowDown className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" onClick={onDelete} title="Remove">
          <Trash2 className="h-4 w-4 text-destructive" />
        </Button>
      </div>
    </div>
  );
}

function AddRowForm({
  placeholder,
  onAdd,
}: {
  placeholder: string;
  onAdd: (v: string) => void;
}): JSX.Element {
  const [draft, setDraft] = useState('');
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const v = draft.trim();
        if (!v) return;
        onAdd(v);
        setDraft('');
      }}
      className="flex items-center gap-2 pt-2"
    >
      <Input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={placeholder} />
      <Button type="submit" disabled={!draft.trim()}>
        <Plus className="mr-1 h-4 w-4" />
        Add
      </Button>
    </form>
  );
}

function AddModForm({
  resolveState,
  onAdd,
}: {
  resolveState: { run: (input: string) => Promise<ResolveResponse>; isPending: boolean };
  onAdd: (meta: WorkshopMetadata, chosenModIds: string[], chosenMaps: string[]) => void;
}): JSX.Element {
  const [input, setInput] = useState('');
  const [metadata, setMetadata] = useState<WorkshopMetadata | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chosenModIds, setChosenModIds] = useState<string[]>([]);
  const [chosenMaps, setChosenMaps] = useState<string[]>([]);
  const [extraModInput, setExtraModInput] = useState('');

  async function doResolve(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    try {
      const res = await resolveState.run(input.trim());
      setMetadata(res.metadata);
      setChosenModIds(res.metadata.detectedModIds);
      setChosenMaps(res.metadata.detectedMapFolders);
      setExtraModInput('');
    } catch (err) {
      setMetadata(null);
      setError(err instanceof ApiError ? `Resolve failed (${err.status})` : (err as Error).message);
    }
  }

  function toggleModId(id: string): void {
    setChosenModIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  }
  function toggleMap(name: string): void {
    setChosenMaps((m) => (m.includes(name) ? m.filter((x) => x !== name) : [...m, name]));
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Plus className="h-4 w-4" />
          Add a Workshop mod
        </CardTitle>
        <CardDescription>
          Paste a Workshop URL or numeric ID. We&apos;ll fetch its title and try to extract the mod
          / map IDs from the description — you can adjust the picks before adding.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <form onSubmit={doResolve} className="flex items-center gap-2">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="https://steamcommunity.com/sharedfiles/filedetails/?id=…"
            className="font-mono"
          />
          <Button type="submit" disabled={!input.trim() || resolveState.isPending}>
            {resolveState.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Search className="mr-2 h-4 w-4" />
            )}
            Resolve
          </Button>
        </form>
        {error && <p className="text-sm text-destructive">{error}</p>}
        {metadata && (
          <div className="space-y-3 rounded-md border border-border bg-card p-3">
            <div>
              <div className="text-sm font-medium">{metadata.title}</div>
              <div className="font-mono text-xs text-muted-foreground">
                ID {metadata.workshopId}
                {metadata.fileSize ? ` · ${(metadata.fileSize / 1024 / 1024).toFixed(1)} MB` : ''}
              </div>
            </div>

            <div>
              <div className="mb-1 text-xs font-medium text-muted-foreground">
                Detected mod IDs (toggle to include)
              </div>
              {metadata.detectedModIds.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  None detected. Add them manually below or in the Loaded mods section.
                </p>
              ) : (
                <div className="flex flex-wrap gap-1">
                  {metadata.detectedModIds.map((id) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => toggleModId(id)}
                      className={cn(
                        'rounded-md border px-2 py-0.5 font-mono text-xs',
                        chosenModIds.includes(id)
                          ? 'border-primary bg-primary/15 text-primary'
                          : 'border-input text-muted-foreground hover:text-foreground',
                      )}
                    >
                      {id}
                    </button>
                  ))}
                </div>
              )}
              <div className="mt-2 flex items-center gap-2">
                <Input
                  value={extraModInput}
                  onChange={(e) => setExtraModInput(e.target.value)}
                  placeholder="Additional mod folder ID"
                  className="font-mono"
                />
                <Button
                  type="button"
                  variant="outline"
                  disabled={!extraModInput.trim()}
                  onClick={() => {
                    const v = extraModInput.trim();
                    if (v && !chosenModIds.includes(v)) setChosenModIds((ids) => [...ids, v]);
                    setExtraModInput('');
                  }}
                >
                  Add
                </Button>
              </div>
            </div>

            {metadata.detectedMapFolders.length > 0 && (
              <div>
                <div className="mb-1 text-xs font-medium text-muted-foreground">
                  Detected map folders (toggle to include)
                </div>
                <div className="flex flex-wrap gap-1">
                  {metadata.detectedMapFolders.map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => toggleMap(m)}
                      className={cn(
                        'rounded-md border px-2 py-0.5 font-mono text-xs',
                        chosenMaps.includes(m)
                          ? 'border-primary bg-primary/15 text-primary'
                          : 'border-input text-muted-foreground hover:text-foreground',
                      )}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <Button
              onClick={() => {
                onAdd(metadata, chosenModIds, chosenMaps);
                setMetadata(null);
                setInput('');
              }}
            >
              <Plus className="mr-2 h-4 w-4" />
              Add to server
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

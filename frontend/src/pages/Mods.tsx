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
  isCollection: boolean;
}

interface ResolveResponse {
  ok: true;
  items: WorkshopMetadata[];
  parentCollection: { workshopId: string; title: string } | null;
}

interface PendingAdd {
  meta: WorkshopMetadata;
  modIds: string[];
  maps: string[];
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

  function addWorkshopItems(pending: PendingAdd[]): void {
    if (pending.length === 0) return;
    const nextWs = [...workshopItems];
    const nextMods = [...mods];
    const nextMap = [...map];
    const cacheAdd: Record<string, WorkshopMetadata> = {};
    const skipped: string[] = [];

    for (const { meta, modIds, maps } of pending) {
      if (nextWs.includes(meta.workshopId)) {
        skipped.push(meta.title || meta.workshopId);
        continue;
      }
      nextWs.push(meta.workshopId);
      for (const id of modIds) if (!nextMods.includes(id)) nextMods.push(id);
      // Keep the base map (e.g. Muldraugh, KY) at the bottom of the load order.
      const baseIdx = nextMap.length > 0 ? nextMap.length - 1 : -1;
      for (const m of maps) {
        if (nextMap.includes(m)) continue;
        if (baseIdx === -1) nextMap.push(m);
        else nextMap.splice(baseIdx, 0, m);
      }
      cacheAdd[meta.workshopId] = meta;
    }

    setWorkshopItems(nextWs);
    setMods(nextMods);
    setMap(nextMap);
    setMetadataCache((c) => ({ ...c, ...cacheAdd }));

    const added = pending.length - skipped.length;
    if (added > 0 && skipped.length > 0) {
      notify(true, `Added ${added}; skipped ${skipped.length} already present.`);
    } else if (added > 0) {
      notify(true, added === 1 ? `Added ${pending[0]?.meta.title ?? ''}` : `Added ${added} mods.`);
    } else if (skipped.length > 0) {
      notify(false, `All ${skipped.length} already in the list.`);
    }
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
        onAdd={addWorkshopItems}
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
  onAdd: (pending: PendingAdd[]) => void;
}): JSX.Element {
  const [input, setInput] = useState('');
  const [resolved, setResolved] = useState<ResolveResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Per-item user selection: included + chosen mod IDs + chosen maps + extra mods.
  // Keyed by workshopId.
  const [selection, setSelection] = useState<
    Record<string, { included: boolean; modIds: string[]; maps: string[] }>
  >({});
  const [extraModInputs, setExtraModInputs] = useState<Record<string, string>>({});

  function reset(): void {
    setResolved(null);
    setSelection({});
    setExtraModInputs({});
    setInput('');
  }

  async function doResolve(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    try {
      const res = await resolveState.run(input.trim());
      setResolved(res);
      const next: Record<string, { included: boolean; modIds: string[]; maps: string[] }> = {};
      for (const item of res.items) {
        next[item.workshopId] = {
          included: true,
          modIds: [...item.detectedModIds],
          maps: [...item.detectedMapFolders],
        };
      }
      setSelection(next);
      setExtraModInputs({});
    } catch (err) {
      setResolved(null);
      setError(err instanceof ApiError ? `Resolve failed (${err.status})` : (err as Error).message);
    }
  }

  function toggleInclude(id: string): void {
    setSelection((s) => ({ ...s, [id]: { ...s[id]!, included: !s[id]?.included } }));
  }
  function toggleModId(itemId: string, modId: string): void {
    setSelection((s) => {
      const cur = s[itemId]!;
      const has = cur.modIds.includes(modId);
      return {
        ...s,
        [itemId]: {
          ...cur,
          modIds: has ? cur.modIds.filter((x) => x !== modId) : [...cur.modIds, modId],
        },
      };
    });
  }
  function toggleMap(itemId: string, mapName: string): void {
    setSelection((s) => {
      const cur = s[itemId]!;
      const has = cur.maps.includes(mapName);
      return {
        ...s,
        [itemId]: {
          ...cur,
          maps: has ? cur.maps.filter((x) => x !== mapName) : [...cur.maps, mapName],
        },
      };
    });
  }
  function appendExtraMod(itemId: string): void {
    const v = (extraModInputs[itemId] ?? '').trim();
    if (!v) return;
    setSelection((s) => {
      const cur = s[itemId]!;
      if (cur.modIds.includes(v)) return s;
      return { ...s, [itemId]: { ...cur, modIds: [...cur.modIds, v] } };
    });
    setExtraModInputs((e) => ({ ...e, [itemId]: '' }));
  }

  function commit(): void {
    if (!resolved) return;
    const pending: PendingAdd[] = [];
    for (const item of resolved.items) {
      const sel = selection[item.workshopId];
      if (!sel?.included) continue;
      pending.push({ meta: item, modIds: sel.modIds, maps: sel.maps });
    }
    onAdd(pending);
    reset();
  }

  const isCollection = resolved?.parentCollection != null;
  const includedCount = resolved
    ? resolved.items.filter((i) => selection[i.workshopId]?.included).length
    : 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Plus className="h-4 w-4" />
          Add a Workshop mod or collection
        </CardTitle>
        <CardDescription>
          Paste a Workshop URL or numeric ID. Single mods and Workshop collections are both
          accepted — collections expand into all their mods so you can pick which ones to add.
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

        {resolved && (
          <div className="space-y-3 rounded-md border border-border bg-card p-3">
            {isCollection && resolved.parentCollection && (
              <div className="rounded border border-primary/40 bg-primary/10 p-2 text-sm">
                <div className="font-medium">
                  Collection: {resolved.parentCollection.title}
                </div>
                <div className="font-mono text-xs text-muted-foreground">
                  ID {resolved.parentCollection.workshopId} · {resolved.items.length} mod
                  {resolved.items.length > 1 ? 's' : ''} inside
                </div>
              </div>
            )}

            {resolved.items.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {isCollection
                  ? 'This collection has no mod-type items (only screenshots/videos/nested collections).'
                  : 'No items resolved.'}
              </p>
            ) : (
              <div className="space-y-2">
                {resolved.items.map((item) => {
                  const sel = selection[item.workshopId];
                  if (!sel) return null;
                  return (
                    <ResolvedItemRow
                      key={item.workshopId}
                      item={item}
                      sel={sel}
                      extraInput={extraModInputs[item.workshopId] ?? ''}
                      onExtraInputChange={(v) =>
                        setExtraModInputs((e) => ({ ...e, [item.workshopId]: v }))
                      }
                      onCommitExtra={() => appendExtraMod(item.workshopId)}
                      onToggleInclude={() => toggleInclude(item.workshopId)}
                      onToggleModId={(mid) => toggleModId(item.workshopId, mid)}
                      onToggleMap={(m) => toggleMap(item.workshopId, m)}
                      showIncludeToggle={isCollection}
                    />
                  );
                })}
              </div>
            )}

            {resolved.items.length > 0 && (
              <Button onClick={commit} disabled={includedCount === 0}>
                <Plus className="mr-2 h-4 w-4" />
                {isCollection
                  ? `Add ${includedCount} selected mod${includedCount > 1 ? 's' : ''} to server`
                  : 'Add to server'}
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ResolvedItemRow({
  item,
  sel,
  extraInput,
  onExtraInputChange,
  onCommitExtra,
  onToggleInclude,
  onToggleModId,
  onToggleMap,
  showIncludeToggle,
}: {
  item: WorkshopMetadata;
  sel: { included: boolean; modIds: string[]; maps: string[] };
  extraInput: string;
  onExtraInputChange: (v: string) => void;
  onCommitExtra: () => void;
  onToggleInclude: () => void;
  onToggleModId: (id: string) => void;
  onToggleMap: (name: string) => void;
  showIncludeToggle: boolean;
}): JSX.Element {
  return (
    <div
      className={cn(
        'rounded border bg-card p-3 text-sm',
        showIncludeToggle && !sel.included && 'opacity-50',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="font-medium">{item.title}</div>
          <div className="font-mono text-xs text-muted-foreground">
            ID {item.workshopId}
            {item.fileSize ? ` · ${(item.fileSize / 1024 / 1024).toFixed(1)} MB` : ''}
          </div>
        </div>
        {showIncludeToggle && (
          <label className="inline-flex items-center gap-1 text-xs">
            <input
              type="checkbox"
              checked={sel.included}
              onChange={onToggleInclude}
              className="h-4 w-4 rounded border-input accent-primary"
            />
            Include
          </label>
        )}
      </div>

      <div className="mt-2 space-y-2">
        <div>
          <div className="mb-1 text-xs font-medium text-muted-foreground">
            Detected mod IDs ({item.detectedModIds.length})
          </div>
          {item.detectedModIds.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              None detected — add manually below.
            </p>
          ) : (
            <div className="flex flex-wrap gap-1">
              {item.detectedModIds.map((id) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => onToggleModId(id)}
                  className={cn(
                    'rounded-md border px-2 py-0.5 font-mono text-xs',
                    sel.modIds.includes(id)
                      ? 'border-primary bg-primary/15 text-primary'
                      : 'border-input text-muted-foreground hover:text-foreground',
                  )}
                >
                  {id}
                </button>
              ))}
            </div>
          )}
          <div className="mt-1 flex items-center gap-1">
            <Input
              value={extraInput}
              onChange={(e) => onExtraInputChange(e.target.value)}
              placeholder="Additional mod folder ID"
              className="h-7 font-mono text-xs"
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={!extraInput.trim()}
              onClick={onCommitExtra}
            >
              Add
            </Button>
          </div>
        </div>

        {item.detectedMapFolders.length > 0 && (
          <div>
            <div className="mb-1 text-xs font-medium text-muted-foreground">
              Detected map folders
            </div>
            <div className="flex flex-wrap gap-1">
              {item.detectedMapFolders.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => onToggleMap(m)}
                  className={cn(
                    'rounded-md border px-2 py-0.5 font-mono text-xs',
                    sel.maps.includes(m)
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
      </div>
    </div>
  );
}

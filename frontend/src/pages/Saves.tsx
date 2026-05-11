import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, Clock, Download, History, RotateCcw, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';

interface SaveInfo {
  profileName: string;
  path: string;
  exists: boolean;
  sizeBytes: number;
  modifiedAt: number | null;
  fileCount: number;
}

interface BackupFile {
  filename: string;
  path: string;
  sizeBytes: number;
  createdAt: number;
  isAuto: boolean;
}

interface SavesResponse {
  profile: string;
  save: SaveInfo;
  backups: BackupFile[];
}

function humanBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

function relativeTime(ms: number): string {
  const diff = (Date.now() - ms) / 1000;
  if (diff < 60) return `${Math.round(diff)}s ago`;
  if (diff < 3600) return `${Math.round(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.round(diff / 3600)}h ago`;
  return `${Math.round(diff / 86400)}d ago`;
}

export function Saves(): JSX.Element {
  const qc = useQueryClient();
  const data = useQuery({
    queryKey: ['saves'],
    queryFn: () => api<SavesResponse>('/api/saves'),
  });

  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  function notify(ok: boolean, text: string): void {
    setFeedback({ ok, text });
    setTimeout(() => setFeedback(null), 4000);
  }

  const backup = useMutation({
    mutationFn: () => api<{ ok: true; backup: BackupFile }>('/api/saves/backup', { method: 'POST' }),
    onSuccess: (res) => {
      notify(true, `Backup created (${humanBytes(res.backup.sizeBytes)})`);
      void qc.invalidateQueries({ queryKey: ['saves'] });
    },
    onError: (err: Error) =>
      notify(false, err instanceof ApiError ? `Backup failed (${err.status})` : err.message),
  });

  const restore = useMutation({
    mutationFn: (filename: string) =>
      api('/api/saves/restore', { method: 'POST', body: JSON.stringify({ filename }) }),
    onSuccess: (_, filename) => {
      notify(true, `Restored from ${filename}`);
      void qc.invalidateQueries({ queryKey: ['saves'] });
    },
    onError: (err: Error) =>
      notify(false, err instanceof ApiError ? `Restore failed (${err.status})` : err.message),
  });

  const removeBackup = useMutation({
    mutationFn: (filename: string) =>
      api('/api/saves/backups', { method: 'DELETE', body: JSON.stringify({ filename }) }),
    onSuccess: () => {
      notify(true, 'Backup deleted');
      void qc.invalidateQueries({ queryKey: ['saves'] });
    },
    onError: (err: Error) =>
      notify(false, err instanceof ApiError ? `Delete failed (${err.status})` : err.message),
  });

  const removeSave = useMutation({
    mutationFn: () => api('/api/saves', { method: 'DELETE' }),
    onSuccess: () => {
      notify(true, 'Save deleted');
      void qc.invalidateQueries({ queryKey: ['saves'] });
    },
    onError: (err: Error) =>
      notify(false, err instanceof ApiError ? `Delete failed (${err.status})` : err.message),
  });

  return (
    <div className="container mx-auto space-y-4 p-6">
      <header>
        <h1 className="text-2xl font-bold">Saves & backups</h1>
        <p className="text-sm text-muted-foreground">
          For the active profile <code>{data.data?.profile ?? '—'}</code>. Backups are stored
          alongside the backend as <code>.tar.gz</code> archives.
        </p>
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

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Archive className="h-4 w-4" />
            Current save
          </CardTitle>
          {data.data?.save && (
            <CardDescription className="font-mono text-xs">{data.data.save.path}</CardDescription>
          )}
        </CardHeader>
        <CardContent className="space-y-3">
          {data.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : !data.data?.save.exists ? (
            <p className="text-sm text-muted-foreground">
              No save yet — start the server once to generate the world.
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
              <Stat label="Size" value={humanBytes(data.data.save.sizeBytes)} />
              <Stat label="Files" value={String(data.data.save.fileCount)} />
              <Stat
                label="Last write"
                value={
                  data.data.save.modifiedAt ? relativeTime(data.data.save.modifiedAt) : '—'
                }
              />
              <Stat label="Profile" value={data.data.save.profileName} mono />
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => backup.mutate()}
              disabled={!data.data?.save.exists || backup.isPending}
            >
              <Download className="mr-2 h-4 w-4" />
              {backup.isPending ? 'Archiving…' : 'Create backup now'}
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (
                  window.confirm(
                    `Delete the current save for "${data.data?.profile}"? This cannot be undone. Backups are kept.`,
                  )
                ) {
                  removeSave.mutate();
                }
              }}
              disabled={!data.data?.save.exists || removeSave.isPending}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Delete save
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <History className="h-4 w-4" />
            Backups ({data.data?.backups.length ?? 0})
          </CardTitle>
          <CardDescription>
            Newest first. Restoring wipes the current save and replaces it with the archive's
            contents — stop the server first.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {data.data?.backups.length === 0 ? (
            <p className="text-sm text-muted-foreground">No backups yet.</p>
          ) : (
            data.data?.backups.map((b) => (
              <div
                key={b.filename}
                className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-card p-3 text-sm"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate font-mono text-xs">{b.filename}</div>
                  <div className="mt-0.5 flex items-center gap-3 text-xs text-muted-foreground">
                    <span>{humanBytes(b.sizeBytes)}</span>
                    <span className="inline-flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {relativeTime(b.createdAt)}
                    </span>
                    {b.isAuto && (
                      <span className="rounded-full border border-primary/40 bg-primary/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-primary">
                        auto
                      </span>
                    )}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    if (
                      window.confirm(
                        `Restore "${b.filename}"? The current save will be replaced.`,
                      )
                    ) {
                      restore.mutate(b.filename);
                    }
                  }}
                  disabled={restore.isPending}
                >
                  <RotateCcw className="mr-1 h-3.5 w-3.5" />
                  Restore
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    if (window.confirm(`Delete backup "${b.filename}"?`)) {
                      removeBackup.mutate(b.filename);
                    }
                  }}
                  disabled={removeBackup.isPending}
                >
                  <Trash2 className="h-3.5 w-3.5 text-destructive" />
                </Button>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value, mono }: { label: string; value: string; mono?: boolean }): JSX.Element {
  return (
    <div className="rounded-md border border-border bg-card p-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={cn('mt-0.5 text-sm font-medium', mono && 'font-mono')}>{value}</div>
    </div>
  );
}

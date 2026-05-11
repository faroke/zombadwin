import type { ServerState } from '@/lib/ws';
import { cn } from '@/lib/utils';

interface StatusBadgeProps {
  state: ServerState;
}

const styles: Record<ServerState, string> = {
  stopped: 'bg-muted text-muted-foreground',
  starting: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/40',
  running: 'bg-primary/20 text-primary border-primary/40',
  stopping: 'bg-orange-500/20 text-orange-400 border-orange-500/40',
};

export function StatusBadge({ state }: StatusBadgeProps): JSX.Element {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border border-transparent px-2.5 py-0.5 text-xs font-medium uppercase tracking-wider',
        styles[state],
      )}
    >
      <span
        className={cn(
          'mr-1.5 inline-block h-1.5 w-1.5 rounded-full',
          state === 'running' && 'animate-pulse bg-primary',
          state === 'starting' && 'animate-pulse bg-yellow-400',
          state === 'stopping' && 'animate-pulse bg-orange-400',
          state === 'stopped' && 'bg-muted-foreground',
        )}
      />
      {state}
    </span>
  );
}

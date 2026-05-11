import type { FastifyInstance } from 'fastify';
import type { AppConfig } from '../config.js';
import {
  getInstallService,
  type InstallLogLine,
  type InstallSnapshot,
} from '../services/steamcmd.js';

interface Envelope {
  type: 'snapshot' | 'log' | 'state' | 'error';
  snapshot?: InstallSnapshot;
  logs?: InstallLogLine[];
  log?: InstallLogLine;
  state?: InstallSnapshot;
  message?: string;
}

export async function registerInstallSocket(
  app: FastifyInstance,
  config: AppConfig,
): Promise<void> {
  app.get('/ws/install', { websocket: true }, (socket, req) => {
    const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
    // See ws/logs.ts: trim mirrors the HTTP path so a token copied with
    // surrounding whitespace doesn't silently fail only on WebSocket auth.
    if (url.searchParams.get('token')?.trim() !== config.authToken) {
      socket.send(JSON.stringify({ type: 'error', message: 'unauthorized' } satisfies Envelope));
      socket.close(1008, 'unauthorized');
      return;
    }
    const svc = getInstallService();
    const snapshot: Envelope = {
      type: 'snapshot',
      snapshot: svc.getSnapshot(),
      logs: svc.getRecentLogs(),
    };
    socket.send(JSON.stringify(snapshot));

    const onLog = (line: InstallLogLine): void => {
      try {
        socket.send(JSON.stringify({ type: 'log', log: line } satisfies Envelope));
      } catch {
        /* socket closing */
      }
    };
    const onState = (s: InstallSnapshot): void => {
      try {
        socket.send(JSON.stringify({ type: 'state', state: s } satisfies Envelope));
      } catch {
        /* socket closing */
      }
    };

    svc.on('log', onLog);
    svc.on('state', onState);

    socket.on('close', () => {
      svc.off('log', onLog);
      svc.off('state', onState);
    });
  });
}

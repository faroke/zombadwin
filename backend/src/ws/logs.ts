import type { FastifyInstance } from 'fastify';
import type { AppConfig } from '../config.js';
import { getPzProcess, type LogLine, type StatusSnapshot } from '../services/pzProcess.js';

interface Envelope {
  type: 'log' | 'status' | 'snapshot' | 'error';
  log?: LogLine;
  status?: StatusSnapshot;
  logs?: LogLine[];
  message?: string;
}

export async function registerLogsSocket(app: FastifyInstance, config: AppConfig): Promise<void> {
  app.get('/ws/logs', { websocket: true }, (socket, req) => {
    // Browsers cannot send Authorization headers on the WebSocket handshake,
    // so we authenticate via a ?token=... query string parameter.
    const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
    const token = url.searchParams.get('token');
    if (token !== config.authToken) {
      const err: Envelope = { type: 'error', message: 'unauthorized' };
      socket.send(JSON.stringify(err));
      socket.close(1008, 'unauthorized');
      return;
    }

    const pz = getPzProcess();

    // Replay recent buffer + current status so a fresh client gets context.
    const snapshot: Envelope = {
      type: 'snapshot',
      logs: pz.getRecentLogs(),
      status: pz.getStatus(),
    };
    socket.send(JSON.stringify(snapshot));

    const onLog = (log: LogLine): void => {
      const env: Envelope = { type: 'log', log };
      try {
        socket.send(JSON.stringify(env));
      } catch {
        /* socket already closing */
      }
    };
    const onStatus = (status: StatusSnapshot): void => {
      const env: Envelope = { type: 'status', status };
      try {
        socket.send(JSON.stringify(env));
      } catch {
        /* socket already closing */
      }
    };

    pz.on('log', onLog);
    pz.on('status', onStatus);

    socket.on('close', () => {
      pz.off('log', onLog);
      pz.off('status', onStatus);
    });
  });
}

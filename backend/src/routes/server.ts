import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getPzProcess } from '../services/pzProcess.js';

const CommandBody = z.object({ command: z.string().min(1).max(2000) });

export async function registerServerRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/server/status', async () => getPzProcess().getStatus());

  app.get('/api/server/logs', async (req) => {
    const limit = Number((req.query as { limit?: string }).limit ?? 500);
    return { logs: getPzProcess().getRecentLogs(Math.min(Math.max(limit, 1), 2000)) };
  });

  app.post('/api/server/start', async (_req, reply) => {
    try {
      return await getPzProcess().start();
    } catch (err) {
      reply.code(409);
      return { error: 'start_failed', message: (err as Error).message };
    }
  });

  app.post('/api/server/stop', async () => getPzProcess().stop());

  app.post('/api/server/restart', async (_req, reply) => {
    try {
      await getPzProcess().restart();
      return getPzProcess().getStatus();
    } catch (err) {
      reply.code(500);
      return { error: 'restart_failed', message: (err as Error).message };
    }
  });

  app.post('/api/server/command', async (req, reply) => {
    const parse = CommandBody.safeParse(req.body);
    if (!parse.success) {
      reply.code(400);
      return { error: 'invalid_body', issues: parse.error.issues };
    }
    try {
      await getPzProcess().sendCommand(parse.data.command);
      return { ok: true };
    } catch (err) {
      reply.code(409);
      return { error: 'command_failed', message: (err as Error).message };
    }
  });
}

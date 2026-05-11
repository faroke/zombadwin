import type { FastifyInstance } from 'fastify';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { getInstallService } from '../services/steamcmd.js';

const StartBody = z.object({
  targetDir: z.string().min(2).max(500),
});

function suggestedDefaultDir(): string {
  return platform() === 'win32'
    ? join(homedir(), 'pz-dedicated-server')
    : join(homedir(), 'pz-dedicated-server');
}

export async function registerInstallRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/install/status', async () => ({
    ...getInstallService().getSnapshot(),
    suggestedDir: suggestedDefaultDir(),
  }));

  app.get('/api/install/logs', async (req) => {
    const limit = Number((req.query as { limit?: string }).limit ?? 500);
    return {
      logs: getInstallService().getRecentLogs(Math.min(Math.max(limit, 1), 2000)),
    };
  });

  app.post('/api/install/start', async (req, reply) => {
    const parse = StartBody.safeParse(req.body);
    if (!parse.success) {
      reply.code(400);
      return { error: 'invalid_body', issues: parse.error.issues };
    }
    try {
      return await getInstallService().start(parse.data.targetDir);
    } catch (err) {
      reply.code(409);
      return { error: 'install_failed', message: (err as Error).message };
    }
  });

  app.post('/api/install/cancel', async () => getInstallService().cancel());
}

import type { FastifyInstance } from 'fastify';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { loadConfig } from '../config.js';
import { getInstallService } from '../services/steamcmd.js';

const StartBody = z.object({
  targetDir: z.string().min(2).max(500),
  branch: z
    .string()
    .max(64)
    .regex(/^[A-Za-z0-9._-]*$/, 'branch must be alphanumeric, ., -, _ only')
    .optional()
    .nullable(),
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
    // Expose the persisted branch so the UI can pre-fill the dropdown with
    // whichever branch the user picked last time (or null = stable default).
    persistedBranch: loadConfig().pzBranch,
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
      return await getInstallService().start(parse.data.targetDir, parse.data.branch ?? null);
    } catch (err) {
      reply.code(409);
      return { error: 'install_failed', message: (err as Error).message };
    }
  });

  app.post('/api/install/cancel', async () => getInstallService().cancel());
}

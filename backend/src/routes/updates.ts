import type { FastifyInstance } from 'fastify';
import { checkForUpdates } from '../services/updates.js';

export async function registerUpdateRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/updates/check', async (req) => {
    const force = (req.query as { force?: string }).force === '1';
    return checkForUpdates({ force });
  });
}

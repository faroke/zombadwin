import type { FastifyInstance } from 'fastify';
import { getBackendVersion } from '../services/version.js';

export async function registerHealthRoute(app: FastifyInstance): Promise<void> {
  app.get('/api/health', async () => ({
    ok: true,
    name: 'zombadwin-backend',
    version: getBackendVersion(),
    time: new Date().toISOString(),
  }));
}

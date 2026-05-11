import type { FastifyInstance } from 'fastify';

export async function registerHealthRoute(app: FastifyInstance): Promise<void> {
  app.get('/api/health', async () => ({
    ok: true,
    name: 'zombadwin-backend',
    version: '0.1.0',
    time: new Date().toISOString(),
  }));
}

import type { FastifyInstance } from 'fastify';
import { getMonitoringService } from '../services/monitoring.js';

export async function registerMonitoringRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/monitoring/snapshot', async (_req, reply) => {
    try {
      return await getMonitoringService().snapshot();
    } catch (err) {
      reply.code(500);
      return { error: 'snapshot_failed', message: (err as Error).message };
    }
  });
}

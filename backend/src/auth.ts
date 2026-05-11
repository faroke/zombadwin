import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AppConfig } from './config.js';

export function registerAuth(app: FastifyInstance, config: AppConfig): void {
  app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
    // Public endpoints — no auth required.
    if (req.url === '/api/health' || !req.url.startsWith('/api/')) {
      return;
    }

    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      reply.code(401).send({ error: 'missing_bearer_token' });
      return reply;
    }

    const token = header.slice('Bearer '.length).trim();
    if (token !== config.authToken) {
      reply.code(401).send({ error: 'invalid_token' });
      return reply;
    }
  });
}

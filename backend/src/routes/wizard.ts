import type { FastifyInstance } from 'fastify';
import { listWizardTemplates } from '../services/wizardTemplates.js';

export async function registerWizardRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/wizard/templates', async () => ({ templates: listWizardTemplates() }));
}

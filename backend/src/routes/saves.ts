import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getAutoBackup, updateAutoBackupConfig } from '../services/autoBackup.js';
import { getActiveServerName } from '../services/profiles.js';
import { getPzProcess } from '../services/pzProcess.js';
import {
  createBackup,
  deleteBackup,
  deleteSave,
  getSaveInfo,
  listBackups,
  restoreBackup,
} from '../services/saves.js';

const FilenameBody = z.object({
  filename: z.string().regex(/^[A-Za-z0-9._-]+\.tar\.gz$/, 'invalid filename'),
});

const AutoBackupBody = z.object({
  enabled: z.boolean(),
  intervalMinutes: z.number().int().min(1).max(1440),
  keepLast: z.number().int().min(0).max(1000),
});

function isRunning(): boolean {
  return getPzProcess().getStatus().state !== 'stopped';
}

export async function registerSaveRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/saves', async () => {
    const profile = getActiveServerName();
    return {
      profile,
      save: getSaveInfo(profile),
      backups: listBackups(profile),
    };
  });

  app.post('/api/saves/backup', async (_req, reply) => {
    try {
      const backup = await createBackup(getActiveServerName(), 'manual');
      return { ok: true, backup };
    } catch (err) {
      reply.code(409);
      return { error: 'backup_failed', message: (err as Error).message };
    }
  });

  app.post('/api/saves/restore', async (req, reply) => {
    const parse = FilenameBody.safeParse(req.body);
    if (!parse.success) {
      reply.code(400);
      return { error: 'invalid_body', issues: parse.error.issues };
    }
    try {
      await restoreBackup(getActiveServerName(), parse.data.filename, () => isRunning());
      return { ok: true };
    } catch (err) {
      reply.code(409);
      return { error: 'restore_failed', message: (err as Error).message };
    }
  });

  app.delete('/api/saves', async (_req, reply) => {
    try {
      deleteSave(getActiveServerName(), () => isRunning());
      return { ok: true };
    } catch (err) {
      reply.code(409);
      return { error: 'delete_failed', message: (err as Error).message };
    }
  });

  app.delete('/api/saves/backups', async (req, reply) => {
    const parse = FilenameBody.safeParse(req.body);
    if (!parse.success) {
      reply.code(400);
      return { error: 'invalid_body', issues: parse.error.issues };
    }
    try {
      deleteBackup(getActiveServerName(), parse.data.filename);
      return { ok: true };
    } catch (err) {
      reply.code(409);
      return { error: 'delete_failed', message: (err as Error).message };
    }
  });

  app.get('/api/saves/auto-backup', async () => getAutoBackup().getStatus());

  app.put('/api/saves/auto-backup', async (req, reply) => {
    const parse = AutoBackupBody.safeParse(req.body);
    if (!parse.success) {
      reply.code(400);
      return { error: 'invalid_body', issues: parse.error.issues };
    }
    return updateAutoBackupConfig(parse.data);
  });
}

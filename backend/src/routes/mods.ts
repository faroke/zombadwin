import type { FastifyInstance } from 'fastify';
import { existsSync } from 'node:fs';
import { z } from 'zod';
import { loadConfig } from '../config.js';
import { defaultUserDir } from '../services/paths.js';
import { getActiveServerName } from '../services/profiles.js';
import { readIniFile, serverIniPath, writeIniFile } from '../services/iniFile.js';
import {
  fetchWorkshopMetadata,
  joinList,
  normalizeWorkshopInput,
  splitList,
} from '../services/workshop.js';

const ResolveBody = z.object({
  input: z.string().min(1).max(500),
});

const PutBody = z.object({
  workshopItems: z.array(z.string().min(1).max(64)).max(500),
  mods: z.array(z.string().min(1).max(128)).max(500),
  map: z.array(z.string().min(1).max(128)).max(50),
});

function currentIni(): { path: string; serverName: string } {
  const cfg = loadConfig();
  const userDir = cfg.pzUserDir ?? defaultUserDir();
  const serverName = getActiveServerName();
  return { path: serverIniPath(userDir, serverName), serverName };
}

export async function registerModRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/mods', async (_req, reply) => {
    const { path, serverName } = currentIni();
    if (!existsSync(path)) {
      reply.code(404);
      return {
        error: 'ini_not_found',
        message: `${path} does not exist. Start the server once to generate the default config.`,
        path,
        serverName,
      };
    }
    const file = readIniFile(path);
    return {
      path,
      serverName,
      workshopItems: splitList(file.values.WorkshopItems),
      mods: splitList(file.values.Mods),
      map: splitList(file.values.Map),
    };
  });

  app.post('/api/mods/resolve', async (req, reply) => {
    const parse = ResolveBody.safeParse(req.body);
    if (!parse.success) {
      reply.code(400);
      return { error: 'invalid_body', issues: parse.error.issues };
    }
    const id = normalizeWorkshopInput(parse.data.input);
    if (!id) {
      reply.code(400);
      return { error: 'invalid_workshop_id', message: 'No numeric ID detected in the input.' };
    }
    try {
      const metadata = await fetchWorkshopMetadata(id);
      return { ok: true, metadata };
    } catch (err) {
      reply.code(502);
      return { error: 'workshop_fetch_failed', message: (err as Error).message };
    }
  });

  app.put('/api/mods', async (req, reply) => {
    const parse = PutBody.safeParse(req.body);
    if (!parse.success) {
      reply.code(400);
      return { error: 'invalid_body', issues: parse.error.issues };
    }
    const { path } = currentIni();
    if (!existsSync(path)) {
      reply.code(404);
      return { error: 'ini_not_found', path };
    }
    const file = readIniFile(path);
    const setKey = (k: string, v: string): void => {
      if (!(k in file.values)) file.order.push(k);
      file.values[k] = v;
    };
    setKey('WorkshopItems', joinList(parse.data.workshopItems));
    setKey('Mods', joinList(parse.data.mods));
    setKey('Map', joinList(parse.data.map));
    writeIniFile(path, file);
    return {
      ok: true,
      path,
      counts: {
        workshopItems: parse.data.workshopItems.length,
        mods: parse.data.mods.length,
        map: parse.data.map.length,
      },
    };
  });
}

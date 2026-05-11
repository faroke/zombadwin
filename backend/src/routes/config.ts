import type { FastifyInstance } from 'fastify';
import { existsSync } from 'node:fs';
import { z } from 'zod';
import { loadConfig } from '../config.js';
import { defaultUserDir } from '../services/paths.js';
import { getPzProcess } from '../services/pzProcess.js';
import {
  readIniFile,
  serverIniPath,
  writeIniFile,
  type IniFile,
} from '../services/iniFile.js';
import { INI_CATEGORIES, INI_SCHEMA_DEDUPED } from '../services/iniSchema.js';

const PutBody = z.object({
  values: z.record(z.string(), z.string()),
});

function currentIniPath(): { path: string; serverName: string } {
  const cfg = loadConfig();
  const userDir = cfg.pzUserDir ?? defaultUserDir();
  const serverName = getPzProcess().getStatus().serverName || 'servertest';
  return { path: serverIniPath(userDir, serverName), serverName };
}

export async function registerConfigRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/config/ini', async (_req, reply) => {
    const { path, serverName } = currentIniPath();
    if (!existsSync(path)) {
      reply.code(404);
      return {
        error: 'ini_not_found',
        message: `${path} does not exist. Start the server once to generate the default config.`,
        path,
        serverName,
        schema: INI_SCHEMA_DEDUPED,
        categories: INI_CATEGORIES,
      };
    }
    const file = readIniFile(path);
    return {
      path,
      serverName,
      values: file.values,
      order: file.order,
      schema: INI_SCHEMA_DEDUPED,
      categories: INI_CATEGORIES,
    };
  });

  app.put('/api/config/ini', async (req, reply) => {
    const parse = PutBody.safeParse(req.body);
    if (!parse.success) {
      reply.code(400);
      return { error: 'invalid_body', issues: parse.error.issues };
    }
    const { path } = currentIniPath();
    if (!existsSync(path)) {
      reply.code(404);
      return { error: 'ini_not_found', path };
    }
    const existing: IniFile = readIniFile(path);
    // Merge: keep keys not provided in the request, overwrite the rest.
    for (const [k, v] of Object.entries(parse.data.values)) {
      if (!(k in existing.values)) existing.order.push(k);
      existing.values[k] = v;
    }
    writeIniFile(path, existing);
    return { ok: true, path, count: Object.keys(parse.data.values).length };
  });
}

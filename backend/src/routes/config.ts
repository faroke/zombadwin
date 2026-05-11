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
import {
  mergeSandbox,
  readSandbox,
  sandboxPath,
  writeSandbox,
  type SandboxRecord,
  type SandboxValue,
} from '../services/sandboxLua.js';
import { SANDBOX_CATEGORIES, SANDBOX_SCHEMA } from '../services/sandboxSchema.js';

const PutIniBody = z.object({
  values: z.record(z.string(), z.string()),
});

const SandboxLeaf: z.ZodType<SandboxValue> = z.lazy(() =>
  z.union([z.number(), z.boolean(), z.string(), z.record(z.string(), SandboxLeaf)]),
);
const PutSandboxBody = z.object({
  values: z.record(z.string(), SandboxLeaf),
});

function currentServerName(): string {
  return getPzProcess().getStatus().serverName || 'servertest';
}

function currentUserDir(): string {
  const cfg = loadConfig();
  return cfg.pzUserDir ?? defaultUserDir();
}

export async function registerConfigRoutes(app: FastifyInstance): Promise<void> {
  // -- INI -----------------------------------------------------------------
  app.get('/api/config/ini', async (_req, reply) => {
    const userDir = currentUserDir();
    const serverName = currentServerName();
    const path = serverIniPath(userDir, serverName);
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
    const parse = PutIniBody.safeParse(req.body);
    if (!parse.success) {
      reply.code(400);
      return { error: 'invalid_body', issues: parse.error.issues };
    }
    const userDir = currentUserDir();
    const path = serverIniPath(userDir, currentServerName());
    if (!existsSync(path)) {
      reply.code(404);
      return { error: 'ini_not_found', path };
    }
    const existing: IniFile = readIniFile(path);
    for (const [k, v] of Object.entries(parse.data.values)) {
      if (!(k in existing.values)) existing.order.push(k);
      existing.values[k] = v;
    }
    writeIniFile(path, existing);
    return { ok: true, path, count: Object.keys(parse.data.values).length };
  });

  // -- Sandbox -------------------------------------------------------------
  app.get('/api/config/sandbox', async (_req, reply) => {
    const userDir = currentUserDir();
    const serverName = currentServerName();
    const path = sandboxPath(userDir, serverName);
    if (!existsSync(path)) {
      reply.code(404);
      return {
        error: 'sandbox_not_found',
        message: `${path} does not exist. Start the server once to generate the default SandboxVars.`,
        path,
        serverName,
        schema: SANDBOX_SCHEMA,
        categories: SANDBOX_CATEGORIES,
      };
    }
    const values = readSandbox(path);
    return {
      path,
      serverName,
      values,
      schema: SANDBOX_SCHEMA,
      categories: SANDBOX_CATEGORIES,
    };
  });

  app.put('/api/config/sandbox', async (req, reply) => {
    const parse = PutSandboxBody.safeParse(req.body);
    if (!parse.success) {
      reply.code(400);
      return { error: 'invalid_body', issues: parse.error.issues };
    }
    const userDir = currentUserDir();
    const path = sandboxPath(userDir, currentServerName());
    if (!existsSync(path)) {
      reply.code(404);
      return { error: 'sandbox_not_found', path };
    }
    const existing = readSandbox(path);
    const merged: SandboxRecord = mergeSandbox(existing, parse.data.values as SandboxRecord);
    writeSandbox(path, merged);
    return { ok: true, path };
  });
}

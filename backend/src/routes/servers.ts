import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  createProfile,
  deleteProfile,
  listProfiles,
  ProfileError,
  renameProfile,
  setActiveProfile,
} from '../services/profiles.js';
import { getPzProcess } from '../services/pzProcess.js';
import { loadConfig } from '../config.js';

const NameBody = z.object({
  name: z.string().min(1).max(32).regex(/^[A-Za-z0-9_-]+$/),
});

const RenameBody = z.object({
  newName: z.string().min(1).max(32).regex(/^[A-Za-z0-9_-]+$/),
});

function isRunning(): boolean {
  return getPzProcess().getStatus().state !== 'stopped';
}

function handleProfileError(reply: import('fastify').FastifyReply, err: unknown): unknown {
  if (err instanceof ProfileError) {
    const code =
      err.code === 'invalid_name' || err.code === 'name_in_use'
        ? 400
        : err.code === 'not_found'
          ? 404
          : 409;
    reply.code(code);
    return { error: err.code, message: err.message };
  }
  reply.code(500);
  return { error: 'internal', message: (err as Error).message };
}

export async function registerServerProfileRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/servers', async () => {
    const cfg = loadConfig();
    return {
      activeServer: cfg.activeServer,
      profiles: listProfiles(),
    };
  });

  app.post('/api/servers', async (req, reply) => {
    const parse = NameBody.safeParse(req.body);
    if (!parse.success) {
      reply.code(400);
      return { error: 'invalid_body', issues: parse.error.issues };
    }
    try {
      return { ok: true, profile: createProfile(parse.data.name) };
    } catch (err) {
      return handleProfileError(reply, err);
    }
  });

  app.post('/api/servers/active', async (req, reply) => {
    const parse = NameBody.safeParse(req.body);
    if (!parse.success) {
      reply.code(400);
      return { error: 'invalid_body', issues: parse.error.issues };
    }
    try {
      setActiveProfile(parse.data.name, () => isRunning());
      return { ok: true, activeServer: parse.data.name };
    } catch (err) {
      return handleProfileError(reply, err);
    }
  });

  app.delete<{ Params: { name: string } }>('/api/servers/:name', async (req, reply) => {
    try {
      deleteProfile(req.params.name, (name) => getPzProcess().isRunningAs(name));
      return { ok: true };
    } catch (err) {
      return handleProfileError(reply, err);
    }
  });

  app.post<{ Params: { name: string } }>('/api/servers/:name/rename', async (req, reply) => {
    const parse = RenameBody.safeParse(req.body);
    if (!parse.success) {
      reply.code(400);
      return { error: 'invalid_body', issues: parse.error.issues };
    }
    try {
      renameProfile(req.params.name, parse.data.newName, (name) =>
        getPzProcess().isRunningAs(name),
      );
      return { ok: true, name: parse.data.newName };
    } catch (err) {
      return handleProfileError(reply, err);
    }
  });
}

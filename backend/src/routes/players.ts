import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getPzProcess } from '../services/pzProcess.js';

const ACCESS_LEVELS = ['admin', 'moderator', 'overseer', 'gm', 'observer', 'none'] as const;
type AccessLevel = (typeof ACCESS_LEVELS)[number];

// Disallow newline / carriage-return in any string that ends up on the server's
// stdin — otherwise an attacker who can hit /api/* could inject extra commands.
const noNewlines = /^[^\r\n]*$/;

const UserBody = z.object({
  username: z.string().min(1).max(64).regex(noNewlines, 'newlines are not allowed'),
});

const KickBody = UserBody.extend({
  reason: z.string().max(200).regex(noNewlines, 'newlines are not allowed').optional(),
});

const BanBody = KickBody.extend({
  byIp: z.boolean().optional().default(false),
});

const AccessBody = UserBody.extend({
  level: z.enum(ACCESS_LEVELS),
});

const WhitelistBody = UserBody.extend({
  add: z.boolean(),
});

const MessageBody = z.object({
  message: z.string().min(1).max(500).regex(noNewlines, 'newlines are not allowed'),
});

const TimeoutMs = 8000;

function quote(s: string): string {
  // PZ command parser handles double-quoted strings. Escape inner quotes.
  return `"${s.replace(/"/g, '\\"')}"`;
}

async function sendAndRespond(reply: import('fastify').FastifyReply, cmd: string): Promise<unknown> {
  try {
    await getPzProcess().sendCommand(cmd);
    return { ok: true, command: cmd };
  } catch (err) {
    reply.code(409);
    return { error: 'command_failed', message: (err as Error).message };
  }
}

export async function registerPlayerRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/players', async (_req, reply) => {
    try {
      const players = await getPzProcess().queryPlayers(TimeoutMs);
      return { ok: true, players, queriedAt: Date.now() };
    } catch (err) {
      reply.code(409);
      return { error: 'query_failed', message: (err as Error).message };
    }
  });

  app.post('/api/players/kick', async (req, reply) => {
    const parse = KickBody.safeParse(req.body);
    if (!parse.success) {
      reply.code(400);
      return { error: 'invalid_body', issues: parse.error.issues };
    }
    const { username, reason } = parse.data;
    const cmd = reason
      ? `kickuser ${quote(username)} -r ${quote(reason)}`
      : `kickuser ${quote(username)}`;
    return sendAndRespond(reply, cmd);
  });

  app.post('/api/players/ban', async (req, reply) => {
    const parse = BanBody.safeParse(req.body);
    if (!parse.success) {
      reply.code(400);
      return { error: 'invalid_body', issues: parse.error.issues };
    }
    const { username, reason, byIp } = parse.data;
    const parts = [`banuser ${quote(username)}`];
    if (byIp) parts.push('-ip');
    if (reason) parts.push(`-r ${quote(reason)}`);
    return sendAndRespond(reply, parts.join(' '));
  });

  app.post('/api/players/unban', async (req, reply) => {
    const parse = UserBody.safeParse(req.body);
    if (!parse.success) {
      reply.code(400);
      return { error: 'invalid_body', issues: parse.error.issues };
    }
    return sendAndRespond(reply, `unbanuser ${quote(parse.data.username)}`);
  });

  app.post('/api/players/access', async (req, reply) => {
    const parse = AccessBody.safeParse(req.body);
    if (!parse.success) {
      reply.code(400);
      return { error: 'invalid_body', issues: parse.error.issues };
    }
    const { username, level } = parse.data;
    return sendAndRespond(reply, `setaccesslevel ${quote(username)} ${quote(level as AccessLevel)}`);
  });

  app.post('/api/players/whitelist', async (req, reply) => {
    const parse = WhitelistBody.safeParse(req.body);
    if (!parse.success) {
      reply.code(400);
      return { error: 'invalid_body', issues: parse.error.issues };
    }
    const { username, add } = parse.data;
    const cmd = add
      ? `addusertowhitelist ${quote(username)}`
      : `removeuserfromwhitelist ${quote(username)}`;
    return sendAndRespond(reply, cmd);
  });

  app.post('/api/players/message', async (req, reply) => {
    const parse = MessageBody.safeParse(req.body);
    if (!parse.success) {
      reply.code(400);
      return { error: 'invalid_body', issues: parse.error.issues };
    }
    return sendAndRespond(reply, `servermsg ${quote(parse.data.message)}`);
  });

  app.post('/api/players/save', async (_req, reply) => sendAndRespond(reply, 'save'));
}

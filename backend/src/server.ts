import cors from '@fastify/cors';
import staticPlugin from '@fastify/static';
import websocket from '@fastify/websocket';
import Fastify from 'fastify';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerAuth } from './auth.js';
import { loadConfig } from './config.js';
import { registerConfigRoutes } from './routes/config.js';
import { registerHealthRoute } from './routes/health.js';
import { registerInstallRoutes } from './routes/install.js';
import { registerModRoutes } from './routes/mods.js';
import { registerPlayerRoutes } from './routes/players.js';
import { registerServerRoutes } from './routes/server.js';
import { registerServerProfileRoutes } from './routes/servers.js';
import { initPzProcess } from './services/pzProcess.js';
import { initInstallService } from './services/steamcmd.js';
import { registerInstallSocket } from './ws/install.js';
import { registerLogsSocket } from './ws/logs.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function resolveFrontendDir(): string | null {
  const fromEnv = process.env.ZOMBADWIN_FRONTEND_DIR;
  if (fromEnv) {
    const abs = resolve(fromEnv);
    return existsSync(abs) ? abs : null;
  }
  // When running compiled JS, __dirname is backend/dist. Frontend build is
  // emitted to frontend/dist (peer directory at the workspace root).
  const candidates = [
    join(__dirname, '..', '..', 'frontend', 'dist'),
    join(__dirname, '..', '..', '..', 'frontend', 'dist'),
  ];
  return candidates.find((p) => existsSync(p)) ?? null;
}

async function main(): Promise<void> {
  const config = loadConfig();

  const app = Fastify({
    logger: {
      transport: {
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'HH:MM:ss.l', ignore: 'pid,hostname' },
      },
    },
  });

  await app.register(cors, { origin: true, credentials: true });
  await app.register(websocket);

  registerAuth(app, config);
  initPzProcess(config);
  initInstallService(config);

  await registerHealthRoute(app);
  await registerServerRoutes(app);
  await registerInstallRoutes(app);
  await registerConfigRoutes(app);
  await registerPlayerRoutes(app);
  await registerModRoutes(app);
  await registerServerProfileRoutes(app);
  await registerLogsSocket(app, config);
  await registerInstallSocket(app, config);

  // Serve the built React app from the same port in production. The auth hook
  // only gates /api/*, so the static assets stay reachable and the SPA handles
  // its own login flow.
  const frontendDir = resolveFrontendDir();
  if (frontendDir) {
    await app.register(staticPlugin, { root: frontendDir });
    app.setNotFoundHandler(async (req, reply) => {
      if (req.url.startsWith('/api/') || req.url.startsWith('/ws/')) {
        reply.code(404);
        return { error: 'not_found' };
      }
      return reply.sendFile('index.html');
    });
    app.log.info(`serving frontend from ${frontendDir}`);
  } else {
    app.log.info('no frontend build found; run `npm run build` to enable single-port mode');
  }

  try {
    await app.listen({ port: config.port, host: config.host });
    app.log.info(
      `zombadwin backend ready — bearer token: ${config.authToken} ` +
        `(stored in ${config.dataDir}/config.json)`,
    );
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

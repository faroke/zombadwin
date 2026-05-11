import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import Fastify from 'fastify';
import { registerAuth } from './auth.js';
import { loadConfig } from './config.js';
import { registerHealthRoute } from './routes/health.js';
import { registerInstallRoutes } from './routes/install.js';
import { registerServerRoutes } from './routes/server.js';
import { initPzProcess } from './services/pzProcess.js';
import { initInstallService } from './services/steamcmd.js';
import { registerInstallSocket } from './ws/install.js';
import { registerLogsSocket } from './ws/logs.js';

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
  await registerLogsSocket(app, config);
  await registerInstallSocket(app, config);

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

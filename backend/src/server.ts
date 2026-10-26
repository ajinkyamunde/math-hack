import { createServer, type Server as HttpServer } from 'node:http';
import { createApp } from './app.js';
import { connectDatabase, disconnectDatabase } from './config/database.js';
import { getEnv } from './config/environment.js';
import { processDueCompetition } from './services/competitionService.js';
import { setDueHandler, startTimers, stopTimers } from './services/timerService.js';
import { createSocketServer } from './sockets/socketServer.js';
import { logger } from './utils/logger.js';

export interface RunningServer {
  httpServer: HttpServer;
  port: number;
  stop: () => Promise<void>;
}

/** Boots the full backend: database, HTTP API, Socket.IO and timer recovery. */
export async function startServer(options: { port?: number; mongoUri?: string } = {}): Promise<RunningServer> {
  const env = getEnv();
  await connectDatabase(options.mongoUri);
  const app = createApp();
  const httpServer = createServer(app);
  const sockets = await createSocketServer(httpServer);
  setDueHandler(processDueCompetition);
  await startTimers();

  await new Promise<void>((resolve) => httpServer.listen(options.port ?? env.PORT, resolve));
  const address = httpServer.address();
  const port = typeof address === 'object' && address ? address.port : env.PORT;
  logger.info('MathHack backend listening', { port, environment: env.NODE_ENV });

  return {
    httpServer,
    port,
    stop: async () => {
      stopTimers();
      await sockets.close();
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
      await disconnectDatabase();
    },
  };
}

const isEntryPoint = import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('server.ts') || process.argv[1]?.endsWith('server.js');

if (isEntryPoint && process.env.NODE_ENV !== 'test') {
  startServer()
    .then((server) => {
      const shutdown = (signal: string) => {
        logger.info('Shutting down', { signal });
        server.stop().then(
          () => process.exit(0),
          () => process.exit(1),
        );
      };
      process.on('SIGINT', () => shutdown('SIGINT'));
      process.on('SIGTERM', () => shutdown('SIGTERM'));
    })
    .catch((error: unknown) => {
      logger.error('Backend failed to start', { error });
      process.exit(1);
    });
}

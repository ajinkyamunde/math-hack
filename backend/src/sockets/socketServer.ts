import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { createClient } from 'redis';
import { allowedOrigins } from '../config/cors.js';
import { getEnv } from '../config/environment.js';
import { Participant } from '../models/Participant.js';
import { logger } from '../utils/logger.js';
import { registerCompetitionEvents } from './competitionEvents.js';
import { rooms, setBroadcaster } from './broadcaster.js';
import { socketAuth, type SocketData } from './socketAuth.js';

export async function createSocketServer(httpServer: HttpServer): Promise<{ io: Server; close: () => Promise<void> }> {
  const io = new Server(httpServer, {
    cors: { origin: allowedOrigins(), credentials: true },
    maxHttpBufferSize: 16 * 1024,
    pingInterval: 20000,
    pingTimeout: 20000,
    connectionStateRecovery: { maxDisconnectionDuration: 2 * 60 * 1000, skipMiddlewares: false },
  });

  const redisClients: ReturnType<typeof createClient>[] = [];
  const redisUrl = getEnv().REDIS_URL;
  if (redisUrl) {
    // Shares rooms and broadcasts across backend instances.
    const pub = createClient({ url: redisUrl });
    const sub = pub.duplicate();
    await Promise.all([pub.connect(), sub.connect()]);
    redisClients.push(pub, sub);
    io.adapter(createAdapter(pub, sub));
    logger.info('Socket.IO Redis adapter enabled');
  } else {
    // Single instance: nobody can be connected after a restart, so reset stale presence.
    await Participant.updateMany({ connectionStatus: 'ONLINE' }, { $set: { connectionStatus: 'OFFLINE', activeConnections: 0 } });
  }

  io.use((socket, next) => void socketAuth(socket, next));
  io.on('connection', (socket) => {
    const { user } = socket.data as SocketData;
    if (user.role === 'student') void socket.join(rooms.student(user.id));
    registerCompetitionEvents(io, socket);
  });

  setBroadcaster({
    toCompetition: (id, event, payload) => io.to(rooms.competition(id)).emit(event, payload),
    toHosts: (id, event, payload) => io.to(rooms.hosts(id)).emit(event, payload),
    toStudent: (id, event, payload) => io.to(rooms.student(id)).emit(event, payload),
    connectedStudentIds: async (id) => {
      const sockets = await io.in(rooms.competition(id)).fetchSockets();
      return [...new Set(sockets.map((s) => (s.data as SocketData).user?.id).filter((v): v is string => Boolean(v)))];
    },
  });

  return {
    io,
    close: async () => {
      setBroadcaster(undefined);
      await io.close();
      await Promise.all(redisClients.map((client) => client.quit().catch(() => undefined)));
    },
  };
}

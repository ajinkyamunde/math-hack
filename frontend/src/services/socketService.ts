import { io, type Socket } from 'socket.io-client';
import { API_BASE_URL } from './apiClient';

let socket: Socket | null = null;

export type Ack<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } };

/** One shared, cookie-authenticated connection per tab. Socket.IO reconnects automatically with backoff. */
export function getSocket(): Socket {
  if (!socket) {
    socket = io(API_BASE_URL || undefined, {
      withCredentials: true,
      transports: ['websocket', 'polling'],
      reconnectionDelay: 1000,
      reconnectionDelayMax: 8000,
    });
  }
  return socket;
}

export function disconnectSocket(): void {
  socket?.disconnect();
  socket = null;
}

export function emitWithAck<T>(event: string, payload: object, timeoutMs = 8000): Promise<T> {
  return new Promise((resolve, reject) => {
    getSocket()
      .timeout(timeoutMs)
      .emit(event, payload, (error: Error | null, response: Ack<T>) => {
        if (error) reject(new Error('The server did not respond in time.'));
        else if (response.ok) resolve(response.data);
        else reject(Object.assign(new Error(response.error.message), { code: response.error.code }));
      });
  });
}

import { parse as parseCookie } from 'cookie';
import type { Socket } from 'socket.io';
import { isAllowedOrigin } from '../config/cors.js';
import { SESSION_COOKIE, loadActiveAccount, verifySessionToken } from '../services/authService.js';
import type { AuthUser } from '../types/domain.js';

export interface SocketData {
  user: AuthUser;
  joined: Set<string>;
}

/**
 * Authenticates the handshake with the same HTTP-only session cookie as the REST API.
 * The Origin check blocks cross-site WebSocket hijacking; identity never comes from client payloads.
 */
export async function socketAuth(socket: Socket, next: (error?: Error) => void): Promise<void> {
  try {
    const origin = socket.handshake.headers.origin;
    if (!isAllowedOrigin(origin)) return next(new Error('ORIGIN_NOT_ALLOWED'));
    const cookies = parseCookie(socket.handshake.headers.cookie ?? '');
    const token = cookies[SESSION_COOKIE];
    if (!token) return next(new Error('UNAUTHENTICATED'));
    const session = verifySessionToken(token);
    await loadActiveAccount(session);
    (socket.data as SocketData).user = { id: session.id, role: session.role };
    (socket.data as SocketData).joined = new Set();
    next();
  } catch {
    next(new Error('UNAUTHENTICATED'));
  }
}

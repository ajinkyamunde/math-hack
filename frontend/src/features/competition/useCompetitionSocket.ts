import { useEffect, useRef, useState } from 'react';
import { emitWithAck, getSocket } from '../../services/socketService';

export type ConnectionState = 'connecting' | 'online' | 'offline';

/**
 * Keeps this tab joined to a competition room. On every (re)connect it re-joins, and the server
 * replies with the authoritative state, which restores the current question and remaining time.
 */
export function useCompetitionSocket<TState>(
  competitionId: string | undefined,
  enabled: boolean,
  handlers: Record<string, (payload: never) => void>,
  onJoined: (state: TState) => void,
  onJoinError?: (error: Error) => void,
): ConnectionState {
  const [connection, setConnection] = useState<ConnectionState>('connecting');
  const handlersRef = useRef(handlers);
  const joinedRef = useRef(onJoined);
  const errorRef = useRef(onJoinError);
  handlersRef.current = handlers;
  joinedRef.current = onJoined;
  errorRef.current = onJoinError;

  useEffect(() => {
    if (!competitionId || !enabled) return undefined;
    const socket = getSocket();
    const join = () => {
      setConnection('online');
      emitWithAck<TState>('competition:join', { competitionId })
        .then((state) => joinedRef.current(state))
        .catch((error: Error) => errorRef.current?.(error));
    };
    const offline = () => setConnection('offline');
    const listeners = Object.keys(handlersRef.current).map((event) => {
      const listener = (payload: unknown) => handlersRef.current[event]?.(payload as never);
      socket.on(event, listener);
      return [event, listener] as const;
    });
    socket.on('connect', join);
    socket.on('disconnect', offline);
    socket.on('connect_error', offline);
    if (socket.connected) join();
    else socket.connect();
    return () => {
      socket.off('connect', join);
      socket.off('disconnect', offline);
      socket.off('connect_error', offline);
      listeners.forEach(([event, listener]) => socket.off(event, listener));
      if (socket.connected) socket.emit('competition:leave', { competitionId });
    };
  }, [competitionId, enabled]);

  return connection;
}

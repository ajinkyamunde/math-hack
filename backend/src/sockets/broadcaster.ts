/**
 * Thin seam between domain services and Socket.IO. Services publish events through this module,
 * so they stay testable without a socket server and never reach into socket internals.
 */
export interface Broadcaster {
  toCompetition(competitionId: string, event: string, payload: unknown): void;
  toHosts(competitionId: string, event: string, payload: unknown): void;
  toStudent(studentId: string, event: string, payload: unknown): void;
  connectedStudentIds(competitionId: string): Promise<string[]>;
}

const noop: Broadcaster = {
  toCompetition: () => undefined,
  toHosts: () => undefined,
  toStudent: () => undefined,
  connectedStudentIds: async () => [],
};

let current: Broadcaster = noop;

export const rooms = {
  competition: (id: string) => `competition:${id}`,
  hosts: (id: string) => `competition:${id}:hosts`,
  student: (id: string) => `student:${id}`,
};

export function setBroadcaster(broadcaster: Broadcaster | undefined): void {
  current = broadcaster ?? noop;
}

export function broadcaster(): Broadcaster {
  return current;
}

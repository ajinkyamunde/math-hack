import type { CompetitionStatus } from '../types/domain.js';

/** Every allowed lifecycle transition. Anything not listed is rejected by the server. */
const TRANSITIONS: Record<string, { from: CompetitionStatus[]; to: CompetitionStatus }> = {
  openRegistration: { from: ['DRAFT'], to: 'WAITING' },
  start: { from: ['WAITING'], to: 'RUNNING' },
  pause: { from: ['RUNNING'], to: 'PAUSED' },
  resume: { from: ['PAUSED'], to: 'RUNNING' },
  end: { from: ['RUNNING', 'PAUSED'], to: 'COMPLETED' },
  cancel: { from: ['DRAFT', 'WAITING', 'RUNNING', 'PAUSED'], to: 'CANCELLED' },
};

export type LifecycleAction = keyof typeof TRANSITIONS;

const MESSAGES: Partial<Record<CompetitionStatus, string>> = {
  DRAFT: 'the competition is still a draft',
  WAITING: 'the competition has not started yet',
  RUNNING: 'the competition is already running',
  PAUSED: 'the competition is paused',
  COMPLETED: 'the competition has already ended',
  CANCELLED: 'the competition was cancelled',
};

export function canTransition(action: LifecycleAction, from: CompetitionStatus): boolean {
  return TRANSITIONS[action]!.from.includes(from);
}

export function transitionError(action: string, from: CompetitionStatus): string {
  return `Cannot ${action.replace(/([A-Z])/g, ' $1').toLowerCase()}: ${MESSAGES[from] ?? `status is ${from}`}.`;
}

export function targetStatus(action: LifecycleAction): CompetitionStatus {
  return TRANSITIONS[action]!.to;
}

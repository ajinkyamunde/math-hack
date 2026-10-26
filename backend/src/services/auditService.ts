import { AuditLog } from '../models/AuditLog.js';
import { logger } from '../utils/logger.js';

interface AuditEntry {
  actorId?: string;
  actorRole: 'host' | 'student' | 'system';
  action: string;
  competitionId?: string;
  details?: Record<string, unknown>;
}

/** Audit writes never block or fail the action being audited. */
export async function recordAudit(entry: AuditEntry): Promise<void> {
  try {
    await AuditLog.create(entry);
  } catch (error) {
    logger.error('Failed to write audit log', { action: entry.action, error });
  }
}

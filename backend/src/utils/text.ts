import { createHash } from 'node:crypto';

export const normalizePrn = (prn: string): string => prn.trim().toUpperCase().replace(/\s+/g, '');
export const normalizeEmail = (email: string): string => email.trim().toLowerCase();

/** Lower-cased, whitespace-collapsed, punctuation-light form used for duplicate detection. */
export function normalizeQuestionText(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\u00a0]+/g, ' ')
    .replace(/[?.!,;:]+$/g, '')
    .trim();
}

export const questionFingerprint = (text: string): string =>
  createHash('sha256').update(normalizeQuestionText(text)).digest('hex');

export const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Builds a filesystem- and header-safe filename fragment. */
export const safeFilenamePart = (value: string): string =>
  value.normalize('NFKD').replace(/[^a-zA-Z0-9-_]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'competition';

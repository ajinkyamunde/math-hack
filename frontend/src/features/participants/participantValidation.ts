/** Mirrors the server rules so the host gets instant feedback; the server still validates everything. */
export const PARTICIPANT_PASSWORD_PATTERN = /^[A-Za-z0-9]{4}$/;
export const PARTICIPANT_PASSWORD_HINT = 'Exactly 4 letters or numbers (A–Z, a–z, 0–9). No spaces or symbols.';

export interface NewParticipantInput {
  name: string;
  email: string;
  prn: string;
  department: string;
  academicYear: string;
  competitionId: string;
  password: string;
}

export function validateParticipantPassword(password: string): string | undefined {
  if (!password) return 'Enter a password.';
  if (!PARTICIPANT_PASSWORD_PATTERN.test(password)) return `Password must be exactly 4 letters or numbers. ${password.length !== 4 ? `You entered ${password.length}.` : 'Spaces and symbols are not allowed.'}`;
  return undefined;
}

export function validateNewParticipant(form: NewParticipantInput): Record<string, string> {
  const errors: Record<string, string> = {};
  if (form.name.trim().length < 2) errors.name = "Enter the participant's full name.";
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email.trim())) errors.email = 'Enter a valid email address.';
  const prn = form.prn.replace(/\s+/g, '');
  if (prn && !/^[A-Za-z0-9]{6,20}$/.test(prn)) errors.prn = 'PRN must be 6–20 letters or digits, or leave it blank.';
  if (form.department.trim().length < 2) errors.department = 'Enter a department or branch.';
  if (!form.academicYear) errors.academicYear = 'Choose a year of study.';
  const password = validateParticipantPassword(form.password);
  if (password) errors.password = password;
  return errors;
}

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';

/** Random 4-character password without look-alike characters (0/O, 1/l/I), using the browser's CSPRNG. */
export function generateParticipantPassword(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  return [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join('');
}

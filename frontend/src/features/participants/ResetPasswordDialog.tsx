import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Alert, ErrorAlert } from '../../components/common/Alert';
import { TextField } from '../../components/forms/Fields';
import { toApiError, type ApiError } from '../../services/apiClient';
import { participantService } from '../../services/participantService';
import { PARTICIPANT_PASSWORD_HINT, generateParticipantPassword, validateParticipantPassword } from './participantValidation';

interface Target {
  studentId: string;
  name: string;
  email: string;
}

/**
 * Lets the host set a new 4-character password. The current password is never shown (the server only stores a hash).
 * Saving signs the participant out of existing sessions and clears any sign-in lock.
 */
export function ResetPasswordDialog({ competitionId, target, onClose }: { competitionId: string; target: Target | null; onClose: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [serverError, setServerError] = useState<ApiError | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setPassword('');
    setError(undefined);
    setServerError(null);
    setDone(false);
    if (!target) return undefined;
    inputRef.current?.querySelector('input')?.focus();
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [target, onClose]);

  if (!target) return null;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const problem = validateParticipantPassword(password);
    setError(problem);
    setServerError(null);
    if (problem) return;
    setBusy(true);
    try {
      await participantService.resetPassword(competitionId, target!.studentId, password);
      setDone(true);
    } catch (err) {
      const apiError = toApiError(err);
      setServerError(apiError);
      setError(apiError.fieldErrors.password);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="panel panel--holo dialog" role="dialog" aria-modal="true" aria-labelledby="reset-title" onClick={(e) => e.stopPropagation()}>
        <h2 id="reset-title">Reset password</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          {target.name} · <span className="participant-email">{target.email}</span>
        </p>
        {done ? (
          <div className="stack">
            <Alert tone="success" title="Password reset">
              The new password works now and the old one no longer does. {target.name} has been signed out on other devices. Give them the new password.
            </Alert>
            <div className="form-actions">
              <button type="button" className="btn btn--primary" onClick={onClose}>Done</button>
            </div>
          </div>
        ) : (
          <form className="stack" onSubmit={onSubmit} noValidate>
            {serverError && !serverError.fieldErrors.password && <ErrorAlert error={serverError} title="Password not changed" />}
            <div ref={inputRef}>
              <TextField
                label="New password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                error={error}
                hint={PARTICIPANT_PASSWORD_HINT}
                maxLength={4}
                autoComplete="new-password"
                spellCheck={false}
                className="mono"
              />
            </div>
            <div className="form-actions">
              <button type="button" className="btn" onClick={onClose}>Cancel</button>
              <button type="button" className="btn btn--small" onClick={() => setPassword(generateParticipantPassword())}>Generate</button>
              <button type="submit" className="btn btn--gold" disabled={busy}>{busy ? 'Saving…' : 'Set new password'}</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

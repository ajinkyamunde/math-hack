import { useEffect, useState, type FormEvent } from 'react';
import { Alert, ErrorAlert } from '../../components/common/Alert';
import { Panel } from '../../components/common/Panel';
import { SelectField, TextField } from '../../components/forms/Fields';
import { useAsync } from '../../hooks/useAsync';
import { toApiError, type ApiError } from '../../services/apiClient';
import { participantService } from '../../services/participantService';
import { ACADEMIC_YEARS, type CreatedParticipant } from '../../types';
import { titleCase } from '../../utils/format';
import {
  PARTICIPANT_PASSWORD_HINT,
  generateParticipantPassword,
  validateNewParticipant,
  type NewParticipantInput,
} from './participantValidation';

const empty = (competitionId: string): NewParticipantInput => ({
  name: '',
  email: '',
  prn: '',
  department: '',
  academicYear: '',
  competitionId,
  password: '',
});

/**
 * Host form for creating a participant account directly (no self-registration, no email verification).
 * The competition list only contains the host's own open competitions; the server enforces the same rule.
 */
export function AddParticipantForm({ defaultCompetitionId, onCreated, onClose }: { defaultCompetitionId: string; onCreated: () => void; onClose: () => void }) {
  const competitions = useAsync(() => participantService.assignableCompetitions(), []);
  const [form, setForm] = useState<NewParticipantInput>(() => empty(defaultCompetitionId));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<ApiError | null>(null);
  const [created, setCreated] = useState<CreatedParticipant | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const set = (key: keyof NewParticipantInput) => (event: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: event.target.value }));
  const fieldError = (key: string) =>
    errors[key] ?? serverError?.fieldErrors[key] ?? ((serverError?.details as { field?: string } | undefined)?.field === key ? serverError?.message : undefined);

  const assignable = competitions.data ?? [];

  // A finished competition cannot take new participants, so don't preselect it.
  useEffect(() => {
    if (competitions.data && form.competitionId && !competitions.data.some((c) => c.id === form.competitionId)) {
      setForm((f) => ({ ...f, competitionId: '' }));
    }
  }, [competitions.data, form.competitionId]);
  const competitionOptions = [
    { value: '', label: 'No competition yet' },
    ...assignable.map((c) => ({ value: c.id, label: `${c.name} (${titleCase(c.status)})` })),
  ];

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const found = validateNewParticipant(form);
    setErrors(found);
    setServerError(null);
    setCreated(null);
    if (Object.keys(found).length) return;
    setSubmitting(true);
    try {
      const result = await participantService.create(form);
      setCreated(result);
      setForm(empty(form.competitionId));
      onCreated();
    } catch (err) {
      setServerError(toApiError(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Panel title="Add participant" actions={<button type="button" className="btn btn--small" onClick={onClose}>Close</button>}>
      <form className="stack" onSubmit={onSubmit} noValidate aria-label="Add participant">
        {created && (
          <Alert tone="success" title="Participant account created">
            {created.participant.name} can now sign in with <strong>{created.participant.email}</strong>
            {created.generatedPrn ? <> or PRN <strong className="mono">{created.participant.prn}</strong></> : null} and the password you set.
            {created.competition ? <> They are already in <strong>{created.competition.name}</strong>.</> : ' They are not in a competition yet.'}{' '}
            Give them the password now: it cannot be shown again, only reset.
          </Alert>
        )}
        {serverError && !Object.keys(serverError.fieldErrors).length && !(serverError.details as { field?: string } | undefined)?.field && (
          <ErrorAlert error={serverError} title="Could not create the participant" />
        )}
        <div className="form-grid">
          <TextField label="Participant name" value={form.name} onChange={set('name')} error={fieldError('name')} autoComplete="off" required />
          <TextField label="Email address" type="email" value={form.email} onChange={set('email')} error={fieldError('email')} autoComplete="off" required />
          <TextField label="Department / branch" value={form.department} onChange={set('department')} error={fieldError('department')} required />
          <SelectField
            label="Year of study"
            value={form.academicYear}
            onChange={set('academicYear')}
            error={fieldError('academicYear')}
            options={[{ value: '', label: 'Choose…' }, ...ACADEMIC_YEARS.map((y) => ({ value: y, label: y }))]}
          />
          <TextField label="PRN (optional)" value={form.prn} onChange={set('prn')} error={fieldError('prn')} hint="Leave blank to generate one." autoComplete="off" />
          <SelectField
            label="Competition"
            value={form.competitionId}
            onChange={set('competitionId')}
            error={fieldError('competitionId')}
            options={competitionOptions}
            hint={competitions.error ? 'Could not load your competitions.' : 'Only your own competitions that have not ended.'}
          />
          <div className="stack" style={{ gap: 6 }}>
            <TextField
              label="Initial password"
              value={form.password}
              onChange={set('password')}
              error={fieldError('password')}
              hint={PARTICIPANT_PASSWORD_HINT}
              maxLength={4}
              autoComplete="new-password"
              spellCheck={false}
              className="mono"
              required
            />
            <button type="button" className="btn btn--small" style={{ alignSelf: 'flex-start' }} onClick={() => setForm((f) => ({ ...f, password: generateParticipantPassword() }))}>
              Generate password
            </button>
          </div>
        </div>
        <div className="form-actions">
          <button type="submit" className="btn btn--gold" disabled={submitting}>
            {submitting ? 'Creating…' : 'Create participant'}
          </button>
        </div>
      </form>
    </Panel>
  );
}

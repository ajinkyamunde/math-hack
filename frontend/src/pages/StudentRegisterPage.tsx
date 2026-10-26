import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ErrorAlert } from '../components/common/Alert';
import { SelectField, TextField } from '../components/forms/Fields';
import { useAuth } from '../features/authentication/useAuth';
import { toApiError, type ApiError } from '../services/apiClient';
import type { RegisterInput } from '../services/authService';
import { ACADEMIC_YEARS } from '../types';

const EMPTY: RegisterInput = { name: '', prn: '', email: '', department: '', academicYear: 'FE', password: '', confirmPassword: '' };

/** Mirrors the server rules for instant feedback. The server re-validates every field. */
export function validateRegistration(form: RegisterInput): Record<string, string> {
  const errors: Record<string, string> = {};
  if (form.name.trim().length < 2) errors.name = 'Enter your full name.';
  if (!/^[A-Za-z0-9]{6,20}$/.test(form.prn.replace(/\s+/g, ''))) errors.prn = 'PRN must be 6–20 letters or digits.';
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email.trim())) errors.email = 'Enter a valid email address.';
  if (form.department.trim().length < 2) errors.department = 'Enter your department.';
  if (form.password.length < 10) errors.password = 'Password must be at least 10 characters.';
  else if (!/[a-z]/.test(form.password) || !/[A-Z]/.test(form.password) || !/\d/.test(form.password)) errors.password = 'Include upper-case, lower-case and a number.';
  if (form.confirmPassword !== form.password) errors.confirmPassword = 'Passwords do not match.';
  return errors;
}

export function StudentRegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState<RegisterInput>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<ApiError | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const set = (key: keyof RegisterInput) => (event: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: event.target.value }));
  const fieldError = (key: string) => errors[key] ?? serverError?.fieldErrors[key] ?? (serverError?.details && (serverError.details as { field?: string }).field === key ? serverError.message : undefined);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const found = validateRegistration(form);
    setErrors(found);
    if (Object.keys(found).length) return;
    setSubmitting(true);
    setServerError(null);
    try {
      await register(form);
      navigate('/student', { replace: true });
    } catch (err) {
      setServerError(toApiError(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-card auth-card--wide">
      <form className="panel panel--holo stack mh-animate-in" onSubmit={onSubmit} noValidate aria-labelledby="register-title">
        <div>
          <div className="eyebrow">Join the roster</div>
          <h1 id="register-title">Student registration</h1>
          <p className="muted">Use your official PRN and college email. Each PRN and email can register only once.</p>
        </div>
        <ErrorAlert error={serverError && !serverError.fieldErrors.prn ? serverError : null} title="Registration failed" />
        <div className="form-grid">
          <TextField label="Full name" autoComplete="name" value={form.name} onChange={set('name')} error={fieldError('name')} required />
          <TextField label="PRN" autoComplete="username" value={form.prn} onChange={set('prn')} error={fieldError('prn')} required hint="As printed on your college ID" />
          <TextField label="College email" type="email" autoComplete="email" value={form.email} onChange={set('email')} error={fieldError('email')} required />
          <TextField label="Department" value={form.department} onChange={set('department')} error={fieldError('department')} required />
          <SelectField label="Academic year" value={form.academicYear} onChange={set('academicYear')} options={ACADEMIC_YEARS.map((y) => ({ value: y, label: y }))} error={fieldError('academicYear')} />
        </div>
        <div className="form-grid">
          <TextField label="Password" type="password" autoComplete="new-password" value={form.password} onChange={set('password')} error={fieldError('password')} hint="10+ characters with upper-case, lower-case and a number" required />
          <TextField label="Confirm password" type="password" autoComplete="new-password" value={form.confirmPassword} onChange={set('confirmPassword')} error={fieldError('confirmPassword')} required />
        </div>
        <button type="submit" className="btn btn--gold btn--block" disabled={submitting}>{submitting ? 'Creating account…' : 'Create account'}</button>
        <p className="muted small" style={{ margin: 0 }}>Already registered? <Link to="/login">Log in</Link></p>
      </form>
    </div>
  );
}

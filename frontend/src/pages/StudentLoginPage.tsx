import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ErrorAlert } from '../components/common/Alert';
import { TextField } from '../components/forms/Fields';
import { useAuth } from '../features/authentication/useAuth';
import { toApiError, type ApiError } from '../services/apiClient';

export function StudentLoginPage() {
  const { loginStudent } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<ApiError | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await loginStudent(identifier, password);
      const from = (location.state as { from?: string } | null)?.from;
      navigate(from?.startsWith('/student') ? from : '/student', { replace: true });
    } catch (err) {
      setError(toApiError(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-card">
      <form className="panel panel--holo stack mh-animate-in" onSubmit={onSubmit} aria-labelledby="login-title">
        <div>
          <div className="eyebrow">Students</div>
          <h1 id="login-title">Log in</h1>
        </div>
        <ErrorAlert error={error} />
        <TextField label="PRN or college email" autoComplete="username" value={identifier} onChange={(e) => setIdentifier(e.target.value)} required />
        <TextField label="Password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        <button type="submit" className="btn btn--primary btn--block" disabled={submitting || !identifier || !password}>{submitting ? 'Signing in…' : 'Log in'}</button>
        <p className="muted small" style={{ margin: 0 }}>New here? <Link to="/register">Register with your PRN</Link></p>
      </form>
    </div>
  );
}

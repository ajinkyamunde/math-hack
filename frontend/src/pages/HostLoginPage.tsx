import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { ErrorAlert } from '../components/common/Alert';
import { TextField } from '../components/forms/Fields';
import { useAuth } from '../features/authentication/useAuth';
import { toApiError, type ApiError } from '../services/apiClient';

export function HostLoginPage() {
  const { loginHost } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<ApiError | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await loginHost(email, password);
      navigate('/host', { replace: true });
    } catch (err) {
      setError(toApiError(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-card">
      <form className="panel panel--holo stack mh-animate-in" onSubmit={onSubmit} aria-labelledby="host-login-title">
        <div>
          <div className="eyebrow">Command center</div>
          <h1 id="host-login-title">Host login</h1>
          <p className="muted small">Host accounts are created by an administrator with the createHost script. There is no public sign-up.</p>
        </div>
        <ErrorAlert error={error} />
        <TextField label="Email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <TextField label="Password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        <button type="submit" className="btn btn--gold btn--block" disabled={submitting || !email || !password}>{submitting ? 'Authenticating…' : 'Enter command center'}</button>
      </form>
    </div>
  );
}

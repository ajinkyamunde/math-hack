import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Alert } from '../components/common/Alert';
import { Loading } from '../components/common/Loading';
import { authService } from '../services/authService';
import { toApiError } from '../services/apiClient';
import { useAuth } from '../features/authentication/useAuth';

export function VerifyEmailPage() {
  const [params] = useSearchParams();
  const { refresh } = useAuth();
  const token = params.get('token');
  const [status, setStatus] = useState<'working' | 'done' | 'failed'>(token ? 'working' : 'failed');
  const [message, setMessage] = useState(token ? '' : 'This verification link is incomplete.');

  useEffect(() => {
    if (!token) return;
    authService
      .verifyEmail(token)
      .then(() => {
        setStatus('done');
        void refresh();
      })
      .catch((err) => {
        setStatus('failed');
        setMessage(toApiError(err).message);
      });
  }, [token, refresh]);

  return (
    <div className="auth-card panel panel--holo stack">
      <h1>Email verification</h1>
      {status === 'working' && <Loading label="Verifying…" />}
      {status === 'done' && <Alert tone="success" title="Your email is verified.">You can now join competitions.</Alert>}
      {status === 'failed' && <Alert tone="error" title="Verification failed">{message}</Alert>}
      <Link to="/student" className="btn">Go to dashboard</Link>
    </div>
  );
}

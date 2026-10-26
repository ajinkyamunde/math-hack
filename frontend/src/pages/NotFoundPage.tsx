import { Link } from 'react-router-dom';

export function NotFoundPage() {
  return (
    <div className="auth-card panel panel--holo empty">
      <h1>Lost in the quantum realm</h1>
      <p>This page does not exist.</p>
      <Link className="btn" to="/">Return home</Link>
    </div>
  );
}

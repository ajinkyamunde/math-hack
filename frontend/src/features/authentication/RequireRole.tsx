import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { Loading } from '../../components/common/Loading';
import type { Role } from '../../types';
import { useAuth } from './useAuth';

/** UI-level guard for navigation. Real enforcement happens on the server for every request. */
export function RequireRole({ role, children }: { role: Role; children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <Loading label="Checking your session…" />;
  if (!user) return <Navigate to={role === 'host' ? '/host/login' : '/login'} replace state={{ from: location.pathname }} />;
  if (user.role !== role) return <Navigate to={user.role === 'host' ? '/host' : '/student'} replace />;
  return <>{children}</>;
}

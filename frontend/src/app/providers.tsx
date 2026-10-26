import type { ReactNode } from 'react';
import { AuthProvider } from '../features/authentication/AuthContext';

export function Providers({ children }: { children: ReactNode }) {
  return <AuthProvider>{children}</AuthProvider>;
}

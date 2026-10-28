import { apiClient, setCsrfToken, toApiError } from './apiClient';
import type { SessionResponse } from '../types';

export interface RegisterInput {
  name: string;
  prn: string;
  email: string;
  department: string;
  academicYear: string;
  password: string;
  confirmPassword: string;
}

async function call<T>(promise: Promise<{ data: T }>): Promise<T> {
  try {
    return (await promise).data;
  } catch (error) {
    throw toApiError(error);
  }
}

function remember(session: SessionResponse): SessionResponse {
  setCsrfToken(session.csrfToken);
  return session;
}

export const authService = {
  register: async (input: RegisterInput) => remember(await call(apiClient.post<SessionResponse>('/auth/register', input))),
  loginStudent: async (identifier: string, password: string) =>
    remember(await call(apiClient.post<SessionResponse>('/auth/login', { role: 'student', identifier, password }))),
  loginHost: async (email: string, password: string) => remember(await call(apiClient.post<SessionResponse>('/auth/login', { role: 'host', email, password }))),
  me: async () => remember(await call(apiClient.get<SessionResponse>('/auth/me'))),
  logout: async () => {
    await call(apiClient.post('/auth/logout'));
    setCsrfToken(null);
  },
};

export { call };

import axios, { AxiosError } from 'axios';

/** Empty in development (Vite proxies /api), or the backend origin in production builds. */
export const API_BASE_URL = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? '';

let csrfToken: string | null = null;

/** The CSRF token lives only in memory; the session itself is an HTTP-only cookie the page cannot read. */
export function setCsrfToken(token: string | null): void {
  csrfToken = token;
}

export const apiClient = axios.create({
  baseURL: `${API_BASE_URL}/api`,
  withCredentials: true,
  timeout: 60000,
});

apiClient.interceptors.request.use((config) => {
  const method = (config.method ?? 'get').toUpperCase();
  if (csrfToken && !['GET', 'HEAD', 'OPTIONS'].includes(method)) config.headers.set('X-CSRF-Token', csrfToken);
  return config;
});

export interface FieldIssue {
  field: string;
  message: string;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }

  /** Field-level validation messages keyed by field path. */
  get fieldErrors(): Record<string, string> {
    if (!Array.isArray(this.details)) return {};
    return Object.fromEntries((this.details as FieldIssue[]).filter((d) => d?.field).map((d) => [d.field, d.message]));
  }
}

export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (error instanceof AxiosError) {
    const body = error.response?.data as { error?: { message?: string; code?: string; details?: unknown } } | undefined;
    if (body?.error) return new ApiError(body.error.message ?? 'Request failed.', error.response!.status, body.error.code ?? 'ERROR', body.error.details);
    if (!error.response) return new ApiError('Cannot reach the MathHack server. Check your connection and try again.', 0, 'NETWORK_ERROR');
    return new ApiError(`Request failed (${error.response.status}).`, error.response.status, 'ERROR');
  }
  return new ApiError('Something went wrong.', 0, 'UNKNOWN');
}

/** Downloads a protected file through the authenticated client and saves it with the server's filename. */
export async function downloadFile(path: string, fallbackName: string): Promise<void> {
  try {
    const response = await apiClient.get<Blob>(path, { responseType: 'blob' });
    const disposition = String(response.headers['content-disposition'] ?? '');
    const match = /filename="?([^";]+)"?/i.exec(disposition);
    const url = URL.createObjectURL(response.data);
    const link = document.createElement('a');
    link.href = url;
    link.download = match?.[1] ?? fallbackName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (error) {
    // Blob error bodies need decoding to show the server's message.
    if (error instanceof AxiosError && error.response?.data instanceof Blob) {
      try {
        const parsed = JSON.parse(await error.response.data.text()) as { error?: { message?: string; code?: string } };
        throw new ApiError(parsed.error?.message ?? 'Download failed.', error.response.status, parsed.error?.code ?? 'ERROR');
      } catch (inner) {
        if (inner instanceof ApiError) throw inner;
      }
    }
    throw toApiError(error);
  }
}

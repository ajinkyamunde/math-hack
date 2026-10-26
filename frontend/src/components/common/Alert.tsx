import type { ReactNode } from 'react';

type Tone = 'error' | 'success' | 'info' | 'warning';

export function Alert({ tone = 'info', title, children }: { tone?: Tone; title?: string; children?: ReactNode }) {
  return (
    <div className={`alert alert--${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      <div>
        {title && <strong>{title}</strong>}
        {children && <div>{children}</div>}
      </div>
    </div>
  );
}

/** Shows an API error with any field-level details the server returned. */
export function ErrorAlert({ error, title }: { error: { message: string; details?: unknown } | null | undefined; title?: string }) {
  if (!error) return null;
  const details = Array.isArray(error.details) ? (error.details as { field?: string; message?: string }[]) : [];
  return (
    <Alert tone="error" title={title}>
      <p style={{ margin: 0 }}>{error.message}</p>
      {details.length > 0 && (
        <ul>
          {details.slice(0, 8).map((d, i) => (
            <li key={i}>{d.message}</li>
          ))}
        </ul>
      )}
    </Alert>
  );
}

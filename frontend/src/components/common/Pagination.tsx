export function Pagination({ page, pageSize, total, onChange }: { page: number; pageSize: number; total: number; onChange: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  return (
    <nav className="pagination" aria-label="Pagination">
      <button type="button" className="btn btn--small" onClick={() => onChange(page - 1)} disabled={page <= 1}>Previous</button>
      <span className="muted small mono">Page {page} of {pages}</span>
      <button type="button" className="btn btn--small" onClick={() => onChange(page + 1)} disabled={page >= pages}>Next</button>
    </nav>
  );
}

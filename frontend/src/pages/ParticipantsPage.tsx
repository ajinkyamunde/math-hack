import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ErrorAlert } from '../components/common/Alert';
import { ParticipantStatusBadge, StatusBadge } from '../components/common/Badges';
import { EmptyState } from '../components/common/EmptyState';
import { Loading } from '../components/common/Loading';
import { Pagination } from '../components/common/Pagination';
import { Panel } from '../components/common/Panel';
import { StatCard } from '../components/common/StatCard';
import { SelectField, TextField } from '../components/forms/Fields';
import { PageHeader } from '../components/layout/PageHeader';
import { AddParticipantForm } from '../features/participants/AddParticipantForm';
import { ResetPasswordDialog } from '../features/participants/ResetPasswordDialog';
import { useAsync } from '../hooks/useAsync';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { toApiError, type ApiError } from '../services/apiClient';
import { participantService } from '../services/participantService';
import { ACADEMIC_YEARS, PARTICIPANT_STATUSES, type ParticipantFilters, type ParticipantRow, type ParticipantStatus } from '../types';
import { formatDateTime, formatPercent, titleCase } from '../utils/format';

const PAGE_SIZE = 50;
const AUTO_REFRESH_MS = 10_000;
const LIVE = ['WAITING', 'RUNNING', 'PAUSED'];
const SHORT_DATE = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
/** Compact "28 Oct, 1:02 pm" so table rows stay one line high; the export keeps full timestamps. */
const shortDate = (value: string | null) => (value ? SHORT_DATE.format(new Date(value)) : '—');

/**
 * Host-only participant dashboard. The route is wrapped in RequireRole("host"), but the real protection is on the
 * server: the API rejects students and any host who did not create this competition.
 */
export function ParticipantsPage() {
  const { id } = useParams();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<ParticipantStatus | ''>('');
  const [department, setDepartment] = useState('');
  const [academicYear, setAcademicYear] = useState('');
  const [includeRegistered, setIncludeRegistered] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [page, setPage] = useState(1);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<ApiError | null>(null);
  const [adding, setAdding] = useState(false);
  const [resetTarget, setResetTarget] = useState<ParticipantRow | null>(null);
  const closeReset = useCallback(() => setResetTarget(null), []);
  const debouncedSearch = useDebouncedValue(search, 300);

  const filters = useMemo<ParticipantFilters>(
    () => ({
      search: debouncedSearch || undefined,
      status: status || undefined,
      department: department || undefined,
      academicYear: academicYear || undefined,
      includeRegistered,
    }),
    [debouncedSearch, status, department, academicYear, includeRegistered],
  );

  const view = useAsync(() => participantService.list(id!, filters), [id, filters]);
  const competitionStatus = view.data?.competition.status;
  const live = competitionStatus !== undefined && LIVE.includes(competitionStatus);

  useEffect(() => setPage(1), [filters]);

  // Poll while the competition is live so connection status stays current; pause while the tab is hidden.
  const { reload } = view;
  useEffect(() => {
    if (!autoRefresh || !live) return;
    const timer = window.setInterval(() => {
      if (!document.hidden) void reload();
    }, AUTO_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [autoRefresh, live, reload]);

  async function exportExcel() {
    setExporting(true);
    setExportError(null);
    try {
      await participantService.exportXlsx(id!, filters);
    } catch (err) {
      setExportError(toApiError(err));
    } finally {
      setExporting(false);
    }
  }

  if (view.loading && !view.data && !view.error) return <Loading label="Loading participants…" />;
  if (!view.data) {
    return (
      <div className="stack">
        <ErrorAlert error={view.error} title="Participants unavailable" />
        <div className="row">
          <Link className="btn" to="/host/competitions">Back to competitions</Link>
        </div>
      </div>
    );
  }

  const { competition, rows, counts, departments } = view.data;
  const visible = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const filtered = Boolean(filters.search || filters.status || filters.department || filters.academicYear);
  const statusOptions = [
    { value: '', label: 'All statuses' },
    ...PARTICIPANT_STATUSES.filter((s) => s !== 'REGISTERED' || includeRegistered).map((s) => ({ value: s, label: titleCase(s) })),
  ];

  return (
    <div className="stack">
      <PageHeader
        eyebrow="Participants"
        title={competition.name}
        description={`${competition.questionCount} questions · updated ${formatDateTime(view.data.generatedAt)}${view.loading ? ' · refreshing…' : ''}`}
        actions={
          <>
            <StatusBadge status={competition.status} />
            <Link className="btn" to={`/host/competitions/${competition.id}`}>Control room</Link>
            <button type="button" className="btn" disabled={view.loading} onClick={() => void view.reload()}>
              Refresh
            </button>
            <button type="button" className="btn btn--primary" aria-expanded={adding} onClick={() => setAdding((open) => !open)}>
              Add participant
            </button>
            <button type="button" className="btn btn--gold" disabled={exporting || rows.length === 0} onClick={() => void exportExcel()}>
              {exporting ? 'Preparing…' : 'Export to Excel'}
            </button>
          </>
        }
      />
      <ErrorAlert error={exportError} title="Export failed" />
      {adding && <AddParticipantForm defaultCompetitionId={competition.id} onCreated={() => void view.reload()} onClose={() => setAdding(false)} />}
      {view.error && <ErrorAlert error={view.error} title="Refresh failed. Showing the last loaded list." />}

      <div className="grid grid--stats">
        <StatCard label="Joined" value={counts.total - counts.REGISTERED} />
        {live && <StatCard label="Playing now" value={counts.PLAYING} />}
        {live && <StatCard label="Disconnected" value={counts.DISCONNECTED} />}
        {competition.status === 'COMPLETED' && <StatCard label="Completed" value={counts.COMPLETED} />}
        {includeRegistered && <StatCard label="Registered, not joined" value={counts.REGISTERED} />}
      </div>

      <Panel title="Participant list">
        <div className="toolbar">
          <TextField label="Search" type="search" placeholder="Name, email, PRN or department" value={search} onChange={(e) => setSearch(e.target.value)} />
          <SelectField label="Status" value={status} onChange={(e) => setStatus(e.target.value as ParticipantStatus | '')} options={statusOptions} />
          <SelectField
            label="Department"
            value={department}
            onChange={(e) => setDepartment(e.target.value)}
            options={[{ value: '', label: 'All departments' }, ...departments.map((d) => ({ value: d, label: d }))]}
          />
          <SelectField
            label="Year of study"
            value={academicYear}
            onChange={(e) => setAcademicYear(e.target.value)}
            options={[{ value: '', label: 'All years' }, ...ACADEMIC_YEARS.map((y) => ({ value: y, label: y }))]}
          />
        </div>
        <div className="row" style={{ marginBottom: 'var(--space-4)' }}>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={includeRegistered}
              onChange={(e) => {
                setIncludeRegistered(e.target.checked);
                if (!e.target.checked && status === 'REGISTERED') setStatus('');
              }}
            />
            <span>Include registered students who haven't joined</span>
          </label>
          {live && (
            <label className="checkbox">
              <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} />
              <span>Auto-refresh every 10 s</span>
            </label>
          )}
          <span className="muted small">
            {rows.length} shown{filtered ? ' (filtered)' : ''}. Export includes exactly this list.
          </span>
        </div>

        {rows.length === 0 ? (
          <EmptyState title={filtered ? 'No participants match these filters' : 'No participants yet'}>
            {filtered ? 'Clear a filter to see more.' : 'Students appear here as soon as they join from their dashboard.'}
          </EmptyState>
        ) : (
          <>
            <div className="table-wrap">
              <table className="table participant-table">
                <thead>
                  <tr>
                    <th className="num">Rank</th>
                    <th>Participant</th>
                    <th>PRN</th>
                    <th>Department</th>
                    <th>Year</th>
                    <th>Status</th>
                    <th className="num">Score</th>
                    <th className="num">Accuracy</th>
                    <th>Joined</th>
                    <th>Completed</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((row) => (
                    <tr key={row.studentId}>
                      <td className="num">{row.rank ? `#${row.rank}` : '—'}</td>
                      <td>
                        <div title={row.name}>{row.name}</div>
                        <div className="muted small participant-email" title={row.email}>{row.email}</div>
                      </td>
                      <td className="mono">{row.prn}</td>
                      <td>{row.department}</td>
                      <td>{row.academicYear}</td>
                      <td><ParticipantStatusBadge status={row.status} /></td>
                      <td className="num">{row.totalPoints ?? '—'}</td>
                      <td className="num">{row.answered ? formatPercent(row.accuracy) : '—'}</td>
                      <td title={formatDateTime(row.joinedAt)}>{shortDate(row.joinedAt)}</td>
                      <td title={formatDateTime(row.completedAt)}>{shortDate(row.completedAt)}</td>
                      <td>
                        {row.status !== 'REGISTERED' && (
                          <button type="button" className="btn btn--small" onClick={() => setResetTarget(row)} aria-label={`Reset password for ${row.name}`}>
                            Reset password
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={page} pageSize={PAGE_SIZE} total={rows.length} onChange={setPage} />
          </>
        )}
      </Panel>
      <ResetPasswordDialog competitionId={competition.id} target={resetTarget} onClose={closeReset} />
    </div>
  );
}

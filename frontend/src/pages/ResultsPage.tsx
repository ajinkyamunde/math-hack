import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { ErrorAlert } from '../components/common/Alert';
import { DifficultyBadge } from '../components/common/Badges';
import { EmptyState } from '../components/common/EmptyState';
import { Loading } from '../components/common/Loading';
import { Panel } from '../components/common/Panel';
import { StatCard } from '../components/common/StatCard';
import { SelectField } from '../components/forms/Fields';
import { PageHeader } from '../components/layout/PageHeader';
import { DifficultyChart } from '../features/analytics/DifficultyChart';
import { QuestionAccuracyChart } from '../features/analytics/QuestionAccuracyChart';
import { useAsync } from '../hooks/useAsync';
import { resultService, type CsvExportType } from '../services/resultService';
import { toApiError, type ApiError } from '../services/apiClient';
import { formatPercent, formatSeconds } from '../utils/format';

const CSV_TYPES: { value: CsvExportType; label: string }[] = [
  { value: 'results', label: 'Complete results (leaderboard)' },
  { value: 'students', label: 'Student-wise results' },
  { value: 'questions', label: 'Question-wise statistics' },
  { value: 'difficulty', label: 'Difficulty-wise analytics' },
  { value: 'attempts', label: 'All attempts' },
];

export function ResultsPage() {
  const { id } = useParams();
  const results = useAsync(() => resultService.hostResults(id!), [id]);
  const analytics = useAsync(() => resultService.analytics(id!), [id]);
  const [csvType, setCsvType] = useState<CsvExportType>('results');
  const [downloading, setDownloading] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  async function download(label: string, action: () => Promise<void>) {
    setDownloading(label);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(toApiError(err));
    } finally {
      setDownloading(null);
    }
  }

  if ((results.loading && !results.data) || (analytics.loading && !analytics.data)) return <Loading label="Crunching results…" />;
  if (results.error) return <ErrorAlert error={results.error} />;
  const summary = results.data!.summary;
  const students = results.data!.students;

  return (
    <div className="stack">
      <PageHeader
        eyebrow="Debrief"
        title={`Results: ${summary.name}`}
        actions={
          <button type="button" className="btn btn--gold" disabled={downloading !== null} onClick={() => void download('xlsx', () => resultService.exportXlsx(id!))}>
            {downloading === 'xlsx' ? 'Preparing…' : 'Export Excel workbook'}
          </button>
        }
      />
      <ErrorAlert error={error} title="Export failed" />
      <div className="grid grid--stats">
        <StatCard label="Participants" value={summary.participants} />
        <StatCard label="Questions published" value={summary.questionsPublished} />
        <StatCard label="Submissions" value={summary.totalSubmissions} />
        <StatCard label="Average score" value={summary.averageScore === null ? 'N/A' : summary.averageScore.toFixed(1)} />
        <StatCard label="Highest score" value={summary.highestScore ?? 'N/A'} />
      </div>

      <Panel title="CSV exports">
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <div style={{ minWidth: 260, flex: 1 }}>
            <SelectField label="Report" value={csvType} onChange={(e) => setCsvType(e.target.value as CsvExportType)} options={CSV_TYPES} />
          </div>
          <button type="button" className="btn" disabled={downloading !== null} onClick={() => void download('csv', () => resultService.exportCsv(id!, csvType))}>
            {downloading === 'csv' ? 'Preparing…' : 'Download CSV'}
          </button>
        </div>
      </Panel>

      {analytics.data && analytics.data.questions.length > 0 && (
        <div className="grid grid--2">
          <Panel title="Answers by difficulty"><DifficultyChart data={analytics.data.difficulty} /></Panel>
          <Panel title="Accuracy by question"><QuestionAccuracyChart questions={analytics.data.questions} /></Panel>
        </div>
      )}

      <Panel title="Final ranking">
        {students.length === 0 ? (
          <EmptyState title="No participants">Nobody joined this competition.</EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th className="num">Rank</th><th>PRN</th><th>Name</th><th>Department</th><th className="num">Score</th><th className="num">Attempted</th>
                  <th className="num">Correct</th><th className="num">Wrong</th><th className="num">Unanswered</th><th className="num">Accuracy</th>
                  <th className="num">Easy avg</th><th className="num">Medium avg</th><th className="num">Hard avg</th><th className="num">Correct avg</th><th />
                </tr>
              </thead>
              <tbody>
                {students.map((s) => (
                  <tr key={s.studentId}>
                    <td className="num">#{s.rank}</td><td className="mono">{s.prn}</td><td>{s.name}</td><td>{s.department}</td>
                    <td className="num">{s.totalPoints}</td><td className="num">{s.attempted}</td><td className="num">{s.correct}</td><td className="num">{s.incorrect}</td>
                    <td className="num">{s.unanswered}</td><td className="num">{formatPercent(s.accuracy)}</td>
                    <td className="num">{formatSeconds(s.byDifficulty.EASY.avgResponseMs)}</td>
                    <td className="num">{formatSeconds(s.byDifficulty.MEDIUM.avgResponseMs)}</td>
                    <td className="num">{formatSeconds(s.byDifficulty.HARD.avgResponseMs)}</td>
                    <td className="num">{formatSeconds(s.avgCorrectResponseMs)}</td>
                    <td><button type="button" className="btn btn--small" onClick={() => void download(s.studentId, () => resultService.studentReport(id!, s.studentId))} aria-label={`Download report for ${s.name}`}>Report</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {analytics.data && (
        <Panel title="Question statistics">
          {analytics.data.questions.length === 0 ? (
            <EmptyState title="No questions were published" />
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th className="num">#</th><th>Question</th><th>Difficulty</th><th>Answer</th><th className="num">Submissions</th><th className="num">Correct</th><th className="num">Wrong</th><th className="num">Timeouts</th><th className="num">Accuracy</th><th className="num">Avg time</th></tr></thead>
                <tbody>
                  {analytics.data.questions.map((q) => (
                    <tr key={q.questionId}>
                      <td className="num">{q.position}</td><td style={{ minWidth: 200 }}>{q.questionText}</td><td><DifficultyBadge difficulty={q.difficulty} /></td><td>{q.correctOption}</td>
                      <td className="num">{q.submissions}</td><td className="num">{q.correct}</td><td className="num">{q.incorrect}</td><td className="num">{q.timeouts}</td>
                      <td className="num">{formatPercent(q.accuracy)}</td><td className="num">{formatSeconds(q.avgResponseMs)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      )}
    </div>
  );
}

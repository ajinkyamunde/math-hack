import { useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Alert, ErrorAlert } from '../components/common/Alert';
import { DifficultyBadge } from '../components/common/Badges';
import { Panel } from '../components/common/Panel';
import { StatCard } from '../components/common/StatCard';
import { PageHeader } from '../components/layout/PageHeader';
import { questionService } from '../services/questionService';
import { ApiError, toApiError } from '../services/apiClient';
import type { ImportPreview, QuestionStatus } from '../types';

const MAX_BYTES = 2 * 1024 * 1024;

export function ImportQuestionsPage() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState<'preview' | 'confirm' | null>(null);
  const [includeDuplicates, setIncludeDuplicates] = useState(false);
  const [status, setStatus] = useState<QuestionStatus>('ACTIVE');
  const [done, setDone] = useState<{ insertedCount: number; skippedInvalid: number; skippedDuplicates: number } | null>(null);

  async function upload(event: FormEvent) {
    event.preventDefault();
    if (!file) return;
    setError(null);
    setDone(null);
    if (!/\.(csv|xlsx)$/i.test(file.name)) {
      setError(new ApiError('Choose a .xlsx or .csv file.', 400, 'VALIDATION_ERROR'));
      return;
    }
    if (file.size > MAX_BYTES) {
      setError(new ApiError('Files must be 2 MB or smaller.', 413, 'PAYLOAD_TOO_LARGE'));
      return;
    }
    setBusy('preview');
    try {
      setPreview(await questionService.previewImport(file));
    } catch (err) {
      setError(toApiError(err));
      setPreview(null);
    } finally {
      setBusy(null);
    }
  }

  async function confirm() {
    if (!preview) return;
    setBusy('confirm');
    setError(null);
    try {
      setDone(await questionService.confirmImport(preview.batchId, includeDuplicates, status));
      setPreview(null);
      setFile(null);
      if (fileRef.current) fileRef.current.value = '';
    } catch (err) {
      setError(toApiError(err));
    } finally {
      setBusy(null);
    }
  }

  const toImport = preview ? preview.validCount + (includeDuplicates ? preview.duplicateCount : 0) : 0;

  return (
    <div className="stack">
      <PageHeader eyebrow="Question bank" title="Bulk import" description="Upload the MathHack template. Nothing is saved until you review the preview and confirm." />
      <div className="grid grid--2">
        <Panel title="1. Download a template">
          <p className="muted small">Columns: Question, Option A–D, Correct Answer, Difficulty, Time Limit Seconds, Points, Topic, Explanation.</p>
          <div className="row">
            <button type="button" className="btn" onClick={() => questionService.downloadTemplate('xlsx').catch((e) => setError(toApiError(e)))}>Excel template (.xlsx)</button>
            <button type="button" className="btn" onClick={() => questionService.downloadTemplate('csv').catch((e) => setError(toApiError(e)))}>CSV template</button>
          </div>
        </Panel>
        <Panel title="2. Upload your file">
          <form className="stack" onSubmit={upload}>
            <div className="field">
              <label className="field__label" htmlFor="import-file">Spreadsheet (.xlsx or .csv, up to 2 MB and 1000 rows)</label>
              <input
                ref={fileRef}
                id="import-file"
                className="input"
                type="file"
                accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
                onChange={(e) => {
                  setFile(e.target.files?.[0] ?? null);
                  setPreview(null);
                }}
              />
            </div>
            <button type="submit" className="btn btn--primary" disabled={!file || busy !== null}>{busy === 'preview' ? 'Validating…' : 'Validate and preview'}</button>
          </form>
        </Panel>
      </div>

      <ErrorAlert error={error} title="Import problem" />
      {done && (
        <Alert tone="success" title={`${done.insertedCount} question${done.insertedCount === 1 ? '' : 's'} imported`}>
          {done.skippedInvalid} invalid and {done.skippedDuplicates} duplicate row(s) were not imported. <Link to="/host/questions">Open the question bank</Link>
        </Alert>
      )}

      {preview && (
        <>
          <div className="grid grid--stats">
            <StatCard label="Rows read" value={preview.totalRows} />
            <StatCard label="Valid" value={preview.validCount} />
            <StatCard label="Invalid" value={preview.invalidCount} />
            <StatCard label="Likely duplicates" value={preview.duplicateCount} />
          </div>

          {preview.invalidRows.length > 0 && (
            <Panel title="Rows with errors" actions={<button type="button" className="btn btn--small" onClick={() => questionService.downloadErrorReport(preview.batchId).catch((e) => setError(toApiError(e)))}>Download error report</button>}>
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th className="num">Row</th><th>Question</th><th>Problems</th></tr></thead>
                  <tbody>
                    {preview.invalidRows.map((row) => (
                      <tr key={row.rowNumber}>
                        <td className="num">{row.rowNumber}</td>
                        <td>{row.questionText || <span className="muted">(empty)</span>}</td>
                        <td><ul style={{ margin: 0, paddingLeft: 18 }}>{row.errors.map((e, i) => <li key={i}><strong>{e.field}:</strong> {e.message}</li>)}</ul></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          )}

          {preview.duplicateRows.length > 0 && (
            <Panel title="Likely duplicates">
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th className="num">Row</th><th>Question</th><th>Reason</th></tr></thead>
                  <tbody>
                    {preview.duplicateRows.map((row) => (
                      <tr key={row.rowNumber}><td className="num">{row.rowNumber}</td><td>{row.question.questionText}</td><td className="muted">{row.reason}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <label className="checkbox" style={{ marginTop: 12 }}>
                <input type="checkbox" checked={includeDuplicates} onChange={(e) => setIncludeDuplicates(e.target.checked)} /> Import duplicates anyway
              </label>
            </Panel>
          )}

          {preview.validRows.length > 0 && (
            <Panel title="Valid questions">
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th className="num">Row</th><th>Question</th><th>Answer</th><th>Difficulty</th><th className="num">Time</th><th className="num">Pts</th></tr></thead>
                  <tbody>
                    {preview.validRows.map(({ rowNumber, question }) => (
                      <tr key={rowNumber}>
                        <td className="num">{rowNumber}</td>
                        <td>{question.questionText}</td>
                        <td>{question.correctOption}: {question.options['ABCD'.indexOf(question.correctOption)]}</td>
                        <td><DifficultyBadge difficulty={question.difficulty} /></td>
                        <td className="num">{question.timeLimitSeconds}s</td>
                        <td className="num">{question.points}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          )}

          <Panel title="3. Confirm">
            <div className="row">
              <label className="checkbox"><input type="radio" name="status" checked={status === 'ACTIVE'} onChange={() => setStatus('ACTIVE')} /> Save as active</label>
              <label className="checkbox"><input type="radio" name="status" checked={status === 'DRAFT'} onChange={() => setStatus('DRAFT')} /> Save as drafts</label>
            </div>
            <div className="form-actions">
              <button type="button" className="btn btn--gold" disabled={toImport === 0 || busy !== null} onClick={() => void confirm()}>
                {busy === 'confirm' ? 'Importing…' : `Import ${toImport} question${toImport === 1 ? '' : 's'}`}
              </button>
              <button type="button" className="btn btn--ghost" onClick={() => setPreview(null)}>Discard</button>
            </div>
          </Panel>
        </>
      )}
    </div>
  );
}

import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { Question } from '../src/models/Question.js';
import { IMPORT_COLUMNS } from '../src/services/templateService.js';
import { loginHost, questionPayload, useTestDatabase, type Client } from './helpers.js';

const getApp = useTestDatabase();
const HEADER = IMPORT_COLUMNS.join(',');

const csv = (...rows: string[]) => Buffer.from([HEADER, ...rows].join('\n'));

async function xlsx(rows: (string | number | { formula: string })[][]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Questions');
  sheet.addRow([...IMPORT_COLUMNS]);
  rows.forEach((row) => sheet.addRow(row));
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

const upload = (host: Client, buffer: Buffer, filename: string) =>
  host.agent.post('/api/questions/import/preview').set('Origin', 'http://localhost:5173').set('X-CSRF-Token', host.csrf).attach('file', buffer, filename);

describe('question templates', () => {
  it('serves a CSV template with the required columns', async () => {
    const host = await loginHost(getApp());
    const res = await host.get('/api/questions/template.csv');
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toContain('mathhack-question-template.csv');
    expect(res.text.replace(/^\uFEFF/, '').split('\r\n')[0]).toBe(HEADER);
    expect(res.text).toContain('What is 25% of 240?,40,50,60,80,C,EASY,25,10,Percentage,25% of 240 is 60.');
  });

  it('serves an Excel template that parses back to the same columns', async () => {
    const host = await loginHost(getApp());
    const res = await host.get('/api/questions/template.xlsx').buffer(true).parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on('data', (c: Buffer) => chunks.push(c));
      r.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(res.status).toBe(200);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(res.body as ArrayBuffer);
    const header = (workbook.getWorksheet('Questions')!.getRow(1).values as string[]).slice(1);
    expect(header).toEqual([...IMPORT_COLUMNS]);
  });
});

describe('CSV import', () => {
  it('previews valid and invalid rows with row-specific errors, then commits only after confirmation', async () => {
    const host = await loginHost(getApp());
    const file = csv(
      '"What is 25% of 240?",40,50,60,80,C,EASY,25,10,Percentage,"25% of 240 is 60."',
      '"Bad answer key",1,2,3,4,E,EASY,25,10,,',
      '"Bad timer",1,2,3,4,A,HARD,100,30,,',
      '"Missing option",1,2,,4,A,EASY,,,,',
      '"Medium default timer",1,2,3,4,B,medium,,,Algebra,',
    );
    const preview = await upload(host, file, 'questions.csv');
    expect(preview.status).toBe(200);
    expect(preview.body).toMatchObject({ totalRows: 5, validCount: 2, invalidCount: 3, duplicateCount: 0 });
    const errors = Object.fromEntries(preview.body.invalidRows.map((r: { rowNumber: number; errors: { field: string }[] }) => [r.rowNumber, r.errors.map((e) => e.field)]));
    expect(errors[3]).toContain('Correct Answer');
    expect(errors[4]).toContain('Time Limit Seconds');
    expect(errors[5]).toContain('Option C');
    expect(await Question.countDocuments()).toBe(0); // nothing saved before confirmation

    const report = await host.get(`/api/questions/import/${preview.body.batchId}/errors.csv`);
    expect(report.status).toBe(200);
    expect(report.text).toContain('Correct Answer');

    const confirm = await host.post('/api/questions/import/confirm', { batchId: preview.body.batchId });
    expect(confirm.status).toBe(201);
    expect(confirm.body).toMatchObject({ insertedCount: 2, skippedInvalid: 3 });
    const saved = await Question.find().select('+correctOption').lean();
    expect(saved.map((q) => q.timeLimitSeconds).sort((a, b) => a - b)).toEqual([25, 300]);
    expect(saved.every((q) => q.importedBy && q.importedAt && q.importBatchId)).toBe(true);

    const again = await host.post('/api/questions/import/confirm', { batchId: preview.body.batchId });
    expect(again.status).toBe(409);
  });

  it('detects duplicates within the file and against the question bank', async () => {
    const host = await loginHost(getApp());
    await host.post('/api/questions', questionPayload({ questionText: 'Existing question?' }));
    const preview = await upload(
      host,
      csv('"existing  QUESTION",1,2,3,4,A,EASY,25,10,,', '"New one",1,2,3,4,A,EASY,25,10,,', '"new one?",1,2,3,4,B,EASY,25,10,,'),
      'q.csv',
    );
    expect(preview.body).toMatchObject({ validCount: 1, duplicateCount: 2 });
    expect(preview.body.duplicateRows[0].reason).toMatch(/already exists/);
    expect(preview.body.duplicateRows[1].reason).toMatch(/row 3/);
    const confirm = await host.post('/api/questions/import/confirm', { batchId: preview.body.batchId });
    expect(confirm.body).toMatchObject({ insertedCount: 1, skippedDuplicates: 2 });
  });

  it('rejects wrong file types, missing columns and empty files', async () => {
    const host = await loginHost(getApp());
    expect((await upload(host, Buffer.from('hello'), 'notes.txt')).status).toBe(400);
    expect((await upload(host, Buffer.from('a,b\n1,2'), 'q.csv')).body.error.message).toMatch(/missing required column/);
    expect((await upload(host, Buffer.from(HEADER), 'q.csv')).body.error.message).toMatch(/no questions/);
    expect((await upload(host, Buffer.from('PK\u0003\u0004junk'), 'q.csv')).status).toBe(400);
    expect((await upload(host, Buffer.from('not a zip'), 'q.xlsx')).status).toBe(400);
    expect((await upload(host, Buffer.from('x'), 'q.xls')).body.error.message).toMatch(/Legacy .xls/);
  });

  it('rejects files over the size limit', async () => {
    const host = await loginHost(getApp());
    const res = await upload(host, Buffer.alloc(2 * 1024 * 1024 + 10, 'a'), 'big.csv');
    expect(res.status).toBe(413);
  });

  it('rejects files with too many rows', async () => {
    const host = await loginHost(getApp());
    const rows = Array.from({ length: 1001 }, (_, i) => `"Q${i}",1,2,3,4,A,EASY,25,10,,`);
    const res = await upload(host, csv(...rows), 'many.csv');
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/at most 1000/);
  });
});

describe('Excel import', () => {
  it('imports valid rows and rejects formulas without evaluating them', async () => {
    const host = await loginHost(getApp());
    const file = await xlsx([
      ['What is 2 + 2?', 1, 2, 4, 8, 'C', 'EASY', 25, 10, 'Arithmetic', 'Two plus two.'],
      [{ formula: 'HYPERLINK("http://evil","click")' }, 1, 2, 3, 4, 'A', 'EASY', 25, 10, '', ''],
      ['Hard one', 'a', 'b', 'c', 'd', 'D', 'HARD', 720, 30, 'Calculus', ''],
      ['Bad difficulty', 'a', 'b', 'c', 'd', 'D', 'EXTREME', 25, 10, '', ''],
    ]);
    const preview = await upload(host, file, 'questions.xlsx');
    expect(preview.status).toBe(200);
    expect(preview.body).toMatchObject({ fileType: 'xlsx', totalRows: 4, validCount: 2, invalidCount: 2 });
    const formulaRow = preview.body.invalidRows.find((r: { rowNumber: number }) => r.rowNumber === 3);
    expect(formulaRow.errors[0].message).toMatch(/Formulas are not allowed/);
    const confirm = await host.post('/api/questions/import/confirm', { batchId: preview.body.batchId, status: 'DRAFT' });
    expect(confirm.body.insertedCount).toBe(2);
    expect(await Question.countDocuments({ status: 'DRAFT' })).toBe(2);
  });
});

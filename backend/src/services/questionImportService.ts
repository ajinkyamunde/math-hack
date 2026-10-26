import ExcelJS from 'exceljs';
import { parse } from 'csv-parse/sync';
import { Question } from '../models/Question.js';
import { ImportBatch } from '../models/ImportBatch.js';
import { AppError, badRequest, conflict, notFound } from '../utils/errors.js';
import { questionFingerprint } from '../utils/text.js';
import { toCsv } from '../utils/spreadsheetSafety.js';
import { questionInputSchema, type QuestionInput } from '../validation/questionSchemas.js';
import { formatZodIssues } from '../middleware/validateRequest.js';
import { IMPORT_COLUMNS } from './templateService.js';

export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
export const MAX_IMPORT_ROWS = 1000;
const INSERT_BATCH_SIZE = 200;
const PREVIEW_TTL_MS = 60 * 60 * 1000;

/** One data row keyed by template column, plus the spreadsheet line it came from. */
export interface RawRow {
  line: number;
  values: Record<string, string>;
  formulaCells?: string[];
}

interface MatrixRow {
  line: number;
  cells: string[];
  formulaCells?: string[];
}
type FileType = 'csv' | 'xlsx';

const REQUIRED_COLUMNS = IMPORT_COLUMNS.filter((column) => column !== 'Topic' && column !== 'Explanation');
const canonical = (header: string): string => header.trim().toLowerCase().replace(/\s+/g, ' ');

export function detectFileType(filename: string, mimetype: string, buffer: Buffer): FileType {
  const extension = filename.toLowerCase().split('.').pop();
  const isZip = buffer.length > 4 && buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04;
  if (extension === 'xlsx') {
    if (!isZip) throw badRequest('This file has an .xlsx extension but is not a valid Excel workbook.');
    return 'xlsx';
  }
  if (extension === 'csv') {
    if (isZip || buffer.includes(0)) throw badRequest('This file has a .csv extension but does not contain plain text.');
    return 'csv';
  }
  if (extension === 'xls') throw badRequest('Legacy .xls files are not supported. Save the file as .xlsx or .csv and try again.');
  throw badRequest(`Unsupported file type (${mimetype || 'unknown'}). Upload a .xlsx or .csv file.`);
}

function mapHeaders(headers: string[]): Map<number, string> {
  const known = new Map(IMPORT_COLUMNS.map((column) => [canonical(column), column] as const));
  const mapping = new Map<number, string>();
  headers.forEach((header, index) => {
    const column = known.get(canonical(header ?? ''));
    if (column) mapping.set(index, column);
  });
  const present = new Set(mapping.values());
  const missing = REQUIRED_COLUMNS.filter((column) => !present.has(column));
  if (missing.length) throw badRequest(`The file is missing required column(s): ${missing.join(', ')}. Use the MathHack template.`);
  return mapping;
}

function rowsFromMatrix(matrix: MatrixRow[]): RawRow[] {
  const [header, ...body] = matrix;
  if (!header) throw badRequest('The file is empty.');
  const mapping = mapHeaders(header.cells);
  return body
    .filter((row) => row.formulaCells?.length || row.cells.some((cell) => cell.trim() !== ''))
    .map((row) => {
      const values: Record<string, string> = {};
      mapping.forEach((column, index) => {
        values[column] = (row.cells[index] ?? '').trim();
      });
      return { line: row.line, values, formulaCells: row.formulaCells };
    });
}

export function parseCsv(buffer: Buffer): RawRow[] {
  let records: string[][];
  try {
    records = parse(buffer, {
      bom: true,
      skip_empty_lines: true,
      relax_column_count: true,
      max_record_size: 10_000,
      to_line: MAX_IMPORT_ROWS + 2,
    }) as string[][];
  } catch (error) {
    throw badRequest(`The CSV file could not be read: ${(error as Error).message}`);
  }
  return rowsFromMatrix(records.map((cells, index) => ({ line: index + 1, cells })));
}

/** Converts a cell to plain text. Formulas are rejected outright: imported spreadsheets are data, never code. */
function cellText(cell: ExcelJS.Cell, formulaCells: string[]): string {
  const value = cell.value;
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') {
    if ('formula' in value || 'sharedFormula' in value) {
      formulaCells.push(cell.address);
      return '';
    }
    if ('richText' in value) return value.richText.map((part) => part.text).join('');
    if ('text' in value) return String(value.text);
    if (value instanceof Date) return value.toISOString().slice(0, 10);
    if ('error' in value) return '';
  }
  return String(value);
}

export async function parseXlsx(buffer: Buffer): Promise<RawRow[]> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch {
    throw badRequest('The Excel file could not be read. Make sure it is a valid .xlsx workbook.');
  }
  const sheet = workbook.worksheets.find((ws) => ws.name.toLowerCase() === 'questions') ?? workbook.worksheets[0];
  if (!sheet) throw badRequest('The workbook has no worksheets.');
  if (sheet.actualRowCount > MAX_IMPORT_ROWS + 1) throw badRequest(`A file can contain at most ${MAX_IMPORT_ROWS} questions.`);

  const matrix: MatrixRow[] = [];
  const width = Math.min(sheet.actualColumnCount || IMPORT_COLUMNS.length, 30);
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    const formulas: string[] = [];
    const cells: string[] = [];
    for (let col = 1; col <= width; col += 1) cells.push(cellText(row.getCell(col), formulas));
    matrix.push({ line: rowNumber, cells, formulaCells: formulas.length ? formulas : undefined });
  });
  return rowsFromMatrix(matrix);
}

interface RowError {
  rowNumber: number;
  questionText: string;
  errors: { field: string; message: string }[];
}

interface DuplicateRow {
  rowNumber: number;
  question: QuestionInput;
  reason: string;
}

interface ValidRow {
  rowNumber: number;
  question: QuestionInput;
}

const FIELD_COLUMN: Record<string, string> = {
  questionText: 'Question',
  options: 'Options',
  'options.0': 'Option A',
  'options.1': 'Option B',
  'options.2': 'Option C',
  'options.3': 'Option D',
  correctOption: 'Correct Answer',
  difficulty: 'Difficulty',
  timeLimitSeconds: 'Time Limit Seconds',
  points: 'Points',
  topic: 'Topic',
  explanation: 'Explanation',
};

export function validateRows(rawRows: RawRow[]) {
  const valid: ValidRow[] = [];
  const invalid: RowError[] = [];
  rawRows.forEach(({ line: rowNumber, values: row, formulaCells: formulas }) => {
    if (formulas?.length) {
      invalid.push({
        rowNumber,
        questionText: row.Question ?? '',
        errors: [{ field: 'Row', message: `Formulas are not allowed (cells ${formulas.join(', ')}). Enter plain values.` }],
      });
      return;
    }
    const candidate = {
      questionText: row.Question ?? '',
      options: [row['Option A'], row['Option B'], row['Option C'], row['Option D']].map((option) => option ?? ''),
      correctOption: (row['Correct Answer'] ?? '').toUpperCase(),
      difficulty: (row.Difficulty ?? '').toUpperCase(),
      timeLimitSeconds: row['Time Limit Seconds'] ? row['Time Limit Seconds'] : undefined,
      points: row.Points ? row.Points : undefined,
      topic: row.Topic ?? '',
      explanation: row.Explanation ?? '',
      status: 'ACTIVE',
    };
    const result = questionInputSchema.safeParse(candidate);
    if (result.success) valid.push({ rowNumber, question: result.data });
    else {
      invalid.push({
        rowNumber,
        questionText: candidate.questionText,
        errors: formatZodIssues(result.error).map((issue) => ({ field: FIELD_COLUMN[issue.field] ?? issue.field, message: issue.message })),
      });
    }
  });
  return { valid, invalid };
}

async function splitDuplicates(valid: ValidRow[]): Promise<{ unique: ValidRow[]; duplicates: DuplicateRow[] }> {
  const fingerprints = valid.map((row) => questionFingerprint(row.question.questionText));
  const existing = new Set<string>();
  for (let i = 0; i < fingerprints.length; i += 500) {
    const found = await Question.find({ fingerprint: { $in: fingerprints.slice(i, i + 500) } }).select('fingerprint').lean();
    found.forEach((doc) => existing.add(doc.fingerprint));
  }
  const firstSeen = new Map<string, number>();
  const unique: ValidRow[] = [];
  const duplicates: DuplicateRow[] = [];
  valid.forEach((row, index) => {
    const fingerprint = fingerprints[index]!;
    if (existing.has(fingerprint)) duplicates.push({ ...row, reason: 'A question with the same text already exists in the question bank.' });
    else if (firstSeen.has(fingerprint)) duplicates.push({ ...row, reason: `Repeats the question on row ${firstSeen.get(fingerprint)}.` });
    else {
      firstSeen.set(fingerprint, row.rowNumber);
      unique.push(row);
    }
  });
  return { unique, duplicates };
}

export async function previewImport(file: { originalname: string; mimetype: string; buffer: Buffer; size: number }, hostId: string) {
  if (file.size > MAX_IMPORT_BYTES) throw new AppError(413, 'PAYLOAD_TOO_LARGE', 'Files must be 2 MB or smaller.');
  const fileType = detectFileType(file.originalname, file.mimetype, file.buffer);
  const rows = fileType === 'csv' ? parseCsv(file.buffer) : await parseXlsx(file.buffer);
  if (rows.length === 0) throw badRequest('The file has a header row but no questions.');
  if (rows.length > MAX_IMPORT_ROWS) throw badRequest(`A file can contain at most ${MAX_IMPORT_ROWS} questions.`);

  const { valid, invalid } = validateRows(rows);
  const { unique, duplicates } = await splitDuplicates(valid);

  const batch = await ImportBatch.create({
    createdBy: hostId,
    originalFilename: file.originalname.replace(/[^\w.\- ]+/g, '_').slice(0, 255),
    fileType,
    totalRows: rows.length,
    validRows: unique,
    invalidRows: invalid,
    duplicateRows: duplicates,
    expiresAt: new Date(Date.now() + PREVIEW_TTL_MS),
  });

  return {
    batchId: batch.id as string,
    fileType,
    totalRows: rows.length,
    validCount: unique.length,
    invalidCount: invalid.length,
    duplicateCount: duplicates.length,
    validRows: unique,
    invalidRows: invalid,
    duplicateRows: duplicates,
    expiresAt: batch.expiresAt,
  };
}

export async function confirmImport(batchId: string, hostId: string, options: { includeDuplicates: boolean; status: 'DRAFT' | 'ACTIVE' }) {
  // Atomic claim: a second confirm for the same batch finds no PREVIEW batch and is rejected.
  const batch = await ImportBatch.findOneAndUpdate(
    { _id: batchId, createdBy: hostId, status: 'PREVIEW', expiresAt: { $gt: new Date() } },
    { $set: { status: 'COMMITTING' } },
    { new: true },
  ).lean();
  if (!batch) {
    const exists = await ImportBatch.exists({ _id: batchId, createdBy: hostId });
    if (exists) throw conflict('This import has already been confirmed or is being processed.');
    throw notFound('Import preview (it may have expired; upload the file again)');
  }

  const rows = [...(batch.validRows as ValidRow[]), ...(options.includeDuplicates ? (batch.duplicateRows as DuplicateRow[]) : [])];
  const importedAt = new Date();
  let inserted = 0;
  for (let i = 0; i < rows.length; i += INSERT_BATCH_SIZE) {
    const docs = rows.slice(i, i + INSERT_BATCH_SIZE).map(({ question }) => ({
      ...question,
      status: options.status,
      fingerprint: questionFingerprint(question.questionText),
      createdBy: hostId,
      importBatchId: batch._id,
      importedBy: hostId,
      importedAt,
    }));
    const result = await Question.insertMany(docs, { ordered: true });
    inserted += result.length;
  }

  await ImportBatch.updateOne(
    { _id: batch._id },
    { $set: { status: 'COMMITTED', insertedCount: inserted, committedAt: importedAt, validRows: [], duplicateRows: [] } },
  );
  return { insertedCount: inserted, skippedInvalid: batch.invalidRows.length, skippedDuplicates: options.includeDuplicates ? 0 : batch.duplicateRows.length };
}

export async function errorReportCsv(batchId: string, hostId: string): Promise<string> {
  const batch = await ImportBatch.findOne({ _id: batchId, createdBy: hostId }).select('invalidRows duplicateRows').lean();
  if (!batch) throw notFound('Import preview');
  const rows: (string | number)[][] = [];
  for (const row of batch.invalidRows as RowError[]) {
    for (const error of row.errors) rows.push([row.rowNumber, 'INVALID', error.field, error.message, row.questionText]);
  }
  for (const row of batch.duplicateRows as DuplicateRow[]) {
    rows.push([row.rowNumber, 'DUPLICATE', 'Question', row.reason, row.question.questionText]);
  }
  rows.sort((a, b) => Number(a[0]) - Number(b[0]));
  return toCsv(['Row', 'Type', 'Field', 'Message', 'Question'], rows);
}

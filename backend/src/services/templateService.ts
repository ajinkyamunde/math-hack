import ExcelJS from 'exceljs';
import { toCsv } from '../utils/spreadsheetSafety.js';

export const IMPORT_COLUMNS = [
  'Question',
  'Option A',
  'Option B',
  'Option C',
  'Option D',
  'Correct Answer',
  'Difficulty',
  'Time Limit Seconds',
  'Points',
  'Topic',
  'Explanation',
] as const;

export const TEMPLATE_EXAMPLES: (string | number)[][] = [
  ['What is 25% of 240?', 40, 50, 60, 80, 'C', 'EASY', 25, 10, 'Percentage', '25% of 240 is 60.'],
  ['If 3x + 7 = 22, what is x?', 3, 4, 5, 6, 'C', 'EASY', 20, 10, 'Algebra', '3x = 15, so x = 5.'],
];

export function buildCsvTemplate(): string {
  return toCsv([...IMPORT_COLUMNS], TEMPLATE_EXAMPLES);
}

export async function buildXlsxTemplate(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'MathHack';
  workbook.created = new Date('2026-01-01T00:00:00Z');
  const sheet = workbook.addWorksheet('Questions', { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.columns = IMPORT_COLUMNS.map((header) => ({ header, key: header, width: header === 'Question' || header === 'Explanation' ? 48 : 16 }));
  sheet.getRow(1).font = { bold: true };
  for (const example of TEMPLATE_EXAMPLES) sheet.addRow(example);

  // Dropdowns make valid values obvious and prevent typos while editing in Excel.
  for (let row = 2; row <= 1001; row += 1) {
    sheet.getCell(`F${row}`).dataValidation = { type: 'list', allowBlank: false, formulae: ['"A,B,C,D"'] };
    sheet.getCell(`G${row}`).dataValidation = { type: 'list', allowBlank: false, formulae: ['"EASY,MEDIUM,HARD"'] };
  }

  const guide = workbook.addWorksheet('Instructions');
  guide.columns = [{ width: 24 }, { width: 90 }];
  const rows: [string, string][] = [
    ['Column', 'Rule'],
    ['Question', 'Required. Up to 2000 characters.'],
    ['Option A–D', 'Required. Four different, non-empty options.'],
    ['Correct Answer', 'A, B, C or D.'],
    ['Difficulty', 'EASY, MEDIUM or HARD.'],
    ['Time Limit Seconds', 'Optional. EASY 20–30 (default 25), MEDIUM 300–360 (default 300), HARD 720–900 (default 900).'],
    ['Points', 'Optional positive whole number. Defaults: EASY 10, MEDIUM 20, HARD 30.'],
    ['Topic', 'Optional. Up to 100 characters.'],
    ['Explanation', 'Optional. Shown after the question closes when answer reveal is enabled.'],
    ['Note', 'Type values only. Formulas are rejected during import. Maximum 1000 rows per file.'],
  ];
  rows.forEach((row) => guide.addRow(row));
  guide.getRow(1).font = { bold: true };

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

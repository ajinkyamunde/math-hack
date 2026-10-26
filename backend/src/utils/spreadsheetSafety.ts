/**
 * Spreadsheet applications treat cells starting with these characters as formulas.
 * Exported text is prefixed with an apostrophe so it is displayed, never evaluated (OWASP CSV injection guidance).
 */
const FORMULA_TRIGGER = /^[=+\-@\t\r\uFF1D\uFF0B\uFF0D\uFF20]/;

export function neutralizeFormula(value: string): string {
  return FORMULA_TRIGGER.test(value) ? `'${value}` : value;
}

export type CellValue = string | number | boolean | Date | null | undefined;

export function safeCell(value: CellValue): string | number | boolean | Date | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string') return neutralizeFormula(value);
  if (typeof value === 'number' && !Number.isFinite(value)) return null;
  return value;
}

function csvField(value: CellValue): string {
  const cell = safeCell(value);
  if (cell === null) return '';
  const text = cell instanceof Date ? cell.toISOString() : String(cell);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(headers: string[], rows: CellValue[][]): string {
  const lines = [headers.map(csvField).join(','), ...rows.map((row) => row.map(csvField).join(','))];
  // BOM so Excel opens UTF-8 names correctly.
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

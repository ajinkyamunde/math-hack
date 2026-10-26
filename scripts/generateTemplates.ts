/** Regenerates the downloadable question templates from the same code the API serves them with. */
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCsvTemplate, buildXlsxTemplate } from '../backend/src/services/templateService.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'question-files', 'templates');

await writeFile(path.join(dir, 'mathhack-question-template.csv'), buildCsvTemplate());
await writeFile(path.join(dir, 'mathhack-question-template.xlsx'), await buildXlsxTemplate());
console.log(`Templates written to ${path.relative(root, dir)}`);

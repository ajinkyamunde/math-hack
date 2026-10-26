import { expect, test, devices } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

// Loaded with require so Playwright's test transpiler does not rewrite exceljs' CommonJS internals.
const ExcelJS = createRequire(import.meta.url)('exceljs') as typeof import('exceljs');

const SHOTS = process.env.E2E_SCREENSHOT_DIR;
const HOST = { email: 'e2e-host@mathhack.test', password: 'E2eHostPassw0rd' };
const SAMPLE_CSV = new URL('../../../question-files/examples/sample-questions.csv', import.meta.url);

test('full competition: host setup, live question on a phone, scoring, results export', async ({ browser }) => {
  // 1. Host logs in.
  const hostContext = await browser.newContext({ acceptDownloads: true });
  const host = await hostContext.newPage();
  await host.goto('/host/login');
  await host.getByLabel('Email').fill(HOST.email);
  await host.getByLabel('Password').fill(HOST.password);
  await host.getByRole('button', { name: 'Enter command center' }).click();
  await expect(host.getByRole('heading', { name: 'Command Center' })).toBeVisible();

  // 2. Host creates an MCQ manually.
  await host.goto('/host/questions/new');
  await host.getByRole('textbox', { name: 'Question', exact: true }).fill('E2E: What is 6 × 7?');
  await host.getByRole('textbox', { name: 'Option A' }).fill('36');
  await host.getByRole('textbox', { name: 'Option B' }).fill('42');
  await host.getByRole('textbox', { name: 'Option C' }).fill('48');
  await host.getByRole('textbox', { name: 'Option D' }).fill('54');
  await host.getByRole('combobox', { name: 'Correct answer' }).selectOption('B');
  await host.getByRole('button', { name: 'Save as active' }).click();
  await expect(host.getByRole('heading', { name: 'Question Bank' })).toBeVisible();
  await expect(host.getByText('E2E: What is 6 × 7?')).toBeVisible();

  // 3. Host imports the sample CSV with preview and confirmation.
  await host.goto('/host/questions/import');
  await host.getByLabel(/Spreadsheet/).setInputFiles({ name: 'sample.csv', mimeType: 'text/csv', buffer: await readFile(SAMPLE_CSV) });
  await host.getByRole('button', { name: 'Validate and preview' }).click();
  await expect(host.getByText('Valid questions')).toBeVisible();
  await host.getByRole('button', { name: /Import 15 questions/ }).click();
  await expect(host.getByText('15 questions imported')).toBeVisible();

  // 4. Host creates a manual-progression competition with two questions and opens registration.
  await host.goto('/host/competitions');
  await host.getByRole('button', { name: 'New competition' }).click();
  await host.getByLabel('Name').fill('E2E Endgame Cup');
  await host.getByRole('combobox', { name: 'Question progression' }).selectOption('MANUAL');
  await host.getByLabel('Search the bank').fill('E2E: What is 6');
  await host.getByRole('button', { name: 'Add to queue: E2E: What is 6 × 7?' }).click();
  await host.getByLabel('Search the bank').fill('25% of 240');
  await host.getByRole('button', { name: 'Add to queue: What is 25% of 240?' }).click();
  await host.getByRole('button', { name: 'Create competition' }).click();
  await expect(host.getByRole('heading', { name: 'E2E Endgame Cup' })).toBeVisible();
  await host.getByRole('button', { name: 'Open registration' }).click();
  await expect(host.getByRole('button', { name: 'Start competition' })).toBeVisible();

  // 5. A student registers on a phone and joins.
  const phone = await browser.newContext({ ...devices['iPhone 13'] });
  const student = await phone.newPage();
  await student.goto('/register');
  await student.getByLabel('Full name').fill('Natasha Romanoff');
  await student.getByLabel('PRN').fill('E2E2026001');
  await student.getByLabel('College email').fill('natasha@college.test');
  await student.getByLabel('Department').fill('Mathematics');
  await student.getByRole('combobox', { name: 'Academic year' }).selectOption('TE');
  await student.getByLabel('Password', { exact: true }).fill('RedLedger1984');
  await student.getByLabel('Confirm password').fill('RedLedger1984');
  await student.getByRole('button', { name: 'Create account' }).click();
  await expect(student.getByRole('heading', { name: /Welcome, Natasha/ })).toBeVisible();
  await student.getByRole('button', { name: 'Join competition' }).click();
  await student.getByRole('link', { name: 'Enter arena' }).click();
  await expect(student.getByText('Assemble and stand by')).toBeVisible();

  // 6. Host starts and publishes; the question appears on the phone in real time.
  await host.getByRole('button', { name: 'Start competition' }).click();
  await host.getByRole('button', { name: 'Publish next question' }).click();
  await expect(student.getByText('E2E: What is 6 × 7?')).toBeVisible({ timeout: 10_000 });

  // 7. Student answers; the server records it and the selection locks.
  await student.locator('label.option', { hasText: '42' }).click();
  await student.getByRole('button', { name: 'Submit answer B' }).click();
  await expect(student.getByText('Answer received')).toBeVisible();
  if (SHOTS) await student.screenshot({ path: `${SHOTS}/phone-live.png`, fullPage: true });
  await expect(student.getByRole('radio').first()).toBeDisabled();

  // 8. Host sees the submission count and the leaderboard update.
  await expect(host.locator('.stat', { hasText: 'Answers this question' }).locator('.stat__value')).toHaveText('1', { timeout: 10_000 });
  await expect(host.getByRole('cell', { name: 'E2E2026001' })).toBeVisible({ timeout: 10_000 });

  if (SHOTS) await host.screenshot({ path: `${SHOTS}/host-live.png`, fullPage: true });

  // 9. Host ends the competition; the student is told it is complete.
  await host.getByRole('button', { name: 'End competition' }).click();
  await host.getByRole('alertdialog').getByRole('button', { name: 'End competition' }).click();
  await expect(student.getByText('Competition complete')).toBeVisible({ timeout: 10_000 });
  await student.getByRole('link', { name: 'See final results' }).click();
  await expect(student.locator('.stat', { hasText: 'Final rank' })).toContainText('#1');
  await expect(student.locator('.stat', { hasText: 'Score' }).first()).toContainText('10');

  // 10. Host opens results and exports the Excel workbook.
  await host.getByRole('link', { name: 'View results' }).click();
  await expect(host.getByRole('cell', { name: 'Natasha Romanoff' })).toBeVisible();
  if (SHOTS) await host.screenshot({ path: `${SHOTS}/host-results.png`, fullPage: true });
  const downloadPromise = host.waitForEvent('download');
  await host.getByRole('button', { name: 'Export Excel workbook' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^mathhack-E2E-Endgame-Cup-[a-f0-9]{6}-results-\d{4}-\d{2}-\d{2}\.xlsx$/);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(await download.path());
  expect(workbook.worksheets.map((w) => w.name)).toEqual(['Leaderboard', 'Easy Analytics', 'Medium Analytics', 'Hard Analytics', 'Question Statistics', 'All Attempts']);
  expect(workbook.getWorksheet('Leaderboard')!.getRow(2).getCell(2).value).toBe('E2E2026001');

  await phone.close();
  await hostContext.close();
});

test('students cannot open host pages and anonymous users are sent to login', async ({ page }) => {
  await page.goto('/host/questions');
  await expect(page).toHaveURL(/\/host\/login$/);
  await page.goto('/student');
  await expect(page).toHaveURL(/\/login$/);
});

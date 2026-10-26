# Question import

Host flow: **Question Bank → Import** (`/host/questions/import`).

1. Download the Excel or CSV template (`GET /api/questions/template.xlsx|csv`; also in `question-files/templates/`).
2. Fill one question per row. Keep the header row.
3. Upload. The server validates every row and returns a **preview**; nothing is saved yet.
4. Review valid, invalid and likely-duplicate rows. Download the error report if needed.
5. Choose ACTIVE or DRAFT and confirm. Only then are valid rows inserted (in batches of 200), stamped with the importing host and time.

## Columns

| Column | Required | Rule |
|---|---|---|
| Question | yes | 3–2000 characters |
| Option A, B, C, D | yes | non-empty, ≤500 characters, all different |
| Correct Answer | yes | `A`, `B`, `C` or `D` |
| Difficulty | yes | `EASY`, `MEDIUM`, `HARD` (case-insensitive) |
| Time Limit Seconds | no | EASY 20–30 (default 25) · MEDIUM 300–360 (300) · HARD 720–900 (900) |
| Points | no | whole number 1–1000 (defaults 10 / 20 / 30) |
| Topic | no | ≤100 characters |
| Explanation | no | ≤2000 characters |

Headers are matched case-insensitively; extra columns are ignored; missing required columns reject the whole file with a clear message. Fully blank rows are ignored. Row numbers in errors match the spreadsheet (header = row 1).

## Limits and safety

* Formats: `.xlsx` and `.csv`. Legacy `.xls` is rejected with instructions to re-save (no safe parser is bundled). The extension must match the content (ZIP signature for xlsx, plain text for csv).
* Size ≤ 2 MB, ≤ 1000 data rows per file, uploads held in memory only (never written to disk, client filenames never used as paths).
* Spreadsheet **formulas are rejected** row by row ("Formulas are not allowed (cells A3)…"); they are never evaluated. Macros and embedded objects are ignored because only cell values are read.
* Values that look like formulas in CSV are stored as plain text and neutralized (`'` prefix) whenever exported.
* Duplicates: question text is normalized (case, whitespace, trailing punctuation) and hashed. Rows matching an existing question or an earlier row are listed as likely duplicates and skipped unless the host ticks "Import duplicates anyway".
* Previews expire after one hour and can be confirmed exactly once.
* Correct answers from imported questions are subject to the same rules as manual ones: never sent to students before the question closes.

## Error report

`GET /api/questions/import/:batchId/errors.csv` → columns `Row, Type (INVALID|DUPLICATE), Field, Message, Question`, one line per problem.

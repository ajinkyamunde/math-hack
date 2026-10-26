# Result files

Results are **generated on demand** from MongoDB by the export endpoints; nothing here is the source of truth.

* `GET /api/competitions/:id/export.xlsx` — six-sheet workbook (Leaderboard, Easy/Medium/Hard Analytics, Question Statistics, All Attempts), streamed with bounded memory.
* `GET /api/competitions/:id/export.csv?type=results|students|questions|difficulty|attempts`
* `GET /api/competitions/:id/students/:studentId/report.csv` (host) and `GET /api/competitions/:id/my-report.csv` (the student, after completion).

All exports require a host session (students can fetch only their own report), and every text cell is protected against spreadsheet formula injection. Filenames follow `mathhack-<competition>-<id6>-<kind>-<YYYY-MM-DD>.<ext>`.

`exports/` exists only as a local scratch folder for development (its contents are git-ignored). In production do not persist exports on the server's disk; if archived copies are needed, store them in private object storage with access controls.

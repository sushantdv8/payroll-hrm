# Payroll Workspace

Private employee and attendance application based on the clearly visible workflows in the supplied reference video.

## Included

- Employee register: personal/work/payment details, photo and signature, search/filter/sort, Excel export, edits and removal.
- Manual monthly attendance: manual punches, two attendance halves, overtime/late values, direct leave entry, manually entered leave ledger and month totals.
- Holiday register: date, code, name, location and the visible Others category.
- Attendance reports: employee/month/day-range selection, filters, Excel export, printable monthly register.
- ChatGPT sign-in, owner-scoped D1 records and R2 images, revision conflict checks.

## Backup sample and saved history

- Source-specific department, designation, location, sub-company and bank suggestions retain free-text editing.
- The prepared sample import is authenticated and owner-scoped. It inserts all records in one D1 transaction, rejects duplicate paycodes, never replaces existing rows, and supports idempotent retries.
- Saved salary history presents historical component captions, gross earnings, deductions, net amount and payable days; Excel export retains recorded values. It does not calculate new payroll.
- Imported attendance is read-only. Both half-day codes, original rendered marks, shifts, saved work/late hours and monthly totals are preserved. Source totals may exceed calendar days; manual-entry limits still apply separately.
- Import version 1 is a single source dataset per workspace; employee active status starts as Not confirmed. It imports no personal ID numbers, bank accounts, photos or original punch times. Holiday type mapping remains unconfirmed, so holidays are not included in this sample.
- Prepared data stays outside the source repository and build assets. Use Backup sample to load an authorized private JSON file; no employee data is shipped with the application.

The initial sample maps five records from the 2026 source dataset to June–August 2026. Dated source punches and holidays corroborate the source year; monthly tables themselves only store month numbers. The three similarly named datasets must not be merged by company code.


## Intentionally awaiting clarification

Salary component/rate columns, automatic payable days and leave accrual rules, overtime/late deduction rules, PF/ESI calculation, biometric import or machine connection, custom staff roles, and statutory Form 12 formatting. The report only presents entered values; it does not calculate payroll.

## Development

Install dependencies and run `npm run dev`. The starter provides local sign-in for development only. Production uses platform sign-in. Generate schema changes with Drizzle and inspect the SQL before publishing. Never modify an applied migration.

The app uses D1 via `DB` and R2 via `BUCKET`. Local test records and images stay in ignored `.wrangler` state and are not deployed.

# Smart view of the reports

The report screens (Reports menu) show a report as printed pages (the original layout, with the group tree on the left). A report that is a table can also be shown as the **Smart view**: the same rows as a table that can be searched, sorted, filtered and grouped. The button is in the toolbar of the report ("Smart view"); the choice is remembered for each kind of report. Printing and the Excel export of the printed layout are not changed.

## What the Smart view does

* **Quick filters** (chips) with the number of rows each one matches, for example Present / Absent / Late / Mispunch in the daily reports; the figure next to a chip is the change against the day before.
* **Search** (the `/` key puts the cursor in it): every word has to be found somewhere in the row.
* **Sort**: click a column heading (ascending, descending, off). Times (8:05), dates and numbers sort by value, empty cells stay last.
* **Column filter**: the funnel in a heading lists the values (with their counts) to keep. **Group by** any column (collapsible groups with their row counts) and **Columns** to hide some.
* **Overview**: a bar for every group (for example every department: present, late, absent, leave, off) - a click shows only that group.
* **Detail panel**: a click on a row (arrow keys and Enter work too) opens that employee's day and month (daily reports): status, in / out, every punch, the marks of the month with its counts.
* **Excel / Print of what is on screen**: only the rows left by the filters, in the order on screen, without the hidden columns. The printed pages say which filters were on.
* The totals of the columns marked `num` (and of the columns a report names) are shown in the footer.

## Daily Reports (Time Attendence)

* A bar above the report: previous / next day, the date, Today, and the five reports of the screen (Daily Attendance, Present, Absent, Late Arrival, Multi Punch) - change the day or the report without going back to the selection.
* The Smart view opens by default there, grouped by department. The Present / Absent / Late Arrival reports open on the matching quick filter but list everybody, so one click turns one into another.
* Status of a day: Present, Absent, Half day (P/A), Leave (CL ...), Weekly off, Holiday, Mispunch (one punch missing), No entry; "Late" is added when the day has late hours.

## For developers

* `components/reports/report-parts.tsx` `tablePages(...)` puts the table (`page.table`) on every page it builds, so every report built with it has the Smart view without any change. Pass `smart: false` to switch it off. A table with group rows (`group`) has none.
* `smart: {...}` (type `SmartSpec` in `components/reports/smart-table.tsx`) tells the view what the report knows about its rows: `status[]`, `tone[]` (colours), `chips[]` (quick filters: `test(row)` and the count `before`), `groupBy`, `sums` (columns to add up), `detail(row)` (the panel) and `defaultView`. `smartRows` lets the Smart view list more rows than the printed report (the daily reports do: everybody).
* `components/reports/attendance-reports.tsx` `dailySmart` is the worked example; `components/reports/daily-detail.tsx` is its panel. `quick: true` in a `date` screen's config adds the bar of the daily reports.
* The pure parts (cell text, sort keys, column sums, how a day's marks are read) are in `lib/smart-report.ts`; `node --test scripts/test-smart-report.mjs` tests them.
* Tested end to end in a headless browser against the real data (1,552 employees on one day): the chips agree with the printed Present / Late Arrival reports row for row, and the view also opened for Combined Reports (1,552 rows), Late Coming (3,243), Attendance Detail (22,928) and the Salary Sheet.

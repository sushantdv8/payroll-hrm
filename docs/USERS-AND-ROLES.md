# Logins, roles and the activity log

Utilities › **Users & Roles** and Utilities › **Activity Log**.

## Who is who

| Role | How it is made | What it can do |
|---|---|---|
| **Super Admin** | The built-in login `admin01` (its password is kept by the sign-in program, not in the database). | Everything. Makes **Admins** and **Users**; reads **every** activity log. |
| **Admin** | Made only by the Super Admin, with the rights the Super Admin ticks. | Works in the screens ticked for it. Makes and manages **Users** (not other Admins) and can give them only the rights, companies and locations the Admin has. Reads the activity of **all Users** and its own. |
| **User** | Made by the Super Admin or an Admin. | Works only in the companies, locations and screens ticked for it, with the View / Add / Edit / Delete ticked for each screen. Reads its **own** activity - only when the **Activity Log** screen (Utilities) was ticked for it. |

A login is never deleted - it is made **inactive** (it cannot sign in at once, its log stays). The role of a login cannot be changed; make a new login instead.

An Admin manages (edit, new password, make inactive) only the Users whose rights, companies and locations it has itself. A User that was given more by the Super Admin
shows "Only the Super Admin can change this login" in the Admin's list - otherwise an Admin could take over a login that can do more than the Admin can.

## Rights

For every screen of the menu (Master Entry, Transaction, Reports, Specific Report, Utilities) a login can have **View** (open the screen), **Add**, **Edit**, **Delete**
(a screen only offers the rights it has - a report has only View). The HR Management screens keep their own rights (view, add, edit, approve, archive, reports).
Ticking Add, Edit or Delete also ticks View. A login is also limited to the **companies / years** and **locations** ticked for it.

* The menu shows only the menus and sub-menus a login may open: a menu or sub-menu that has no screen ticked for the login is **hidden** (not greyed out), and so is a menu group with nothing in it
  (a login with nothing ticked sees no menu and the page says "No screen assigned"). Until the program knows the login nothing is shown. The buttons inside a screen that lead to another screen
  (for example Time Updation › Times / Biometric Machine Setup) are shown only when the login may open that screen.
  A screen it may only view shows a "view only" note and its New / Modify / Delete buttons are disabled.
* **Users & Roles** is for the Super Admin and the Admins (no tick). The **Activity Log** is always there for the Super Admin and the Admins; a User has it only when its **View** is ticked
  (an Admin may give that tick even though it has none of its own: it always has the Activity Log). A User without it gets a refusal from the server too.
* The program also checks every request on the server, so a hand-made request cannot do more than the ticked rights. A refused attempt (wrong right, company or location) is written to the activity log.
  Reads made by hand-built requests are not logged (screen opens, prints and exports are reported by the browser).
* Screens build on each other, but only as far as their work needs:
  * Time Updation, Salary Preparation, Salary Deletion and the reports may read the attendance, salary rates and pay entries they work out from;
    a login that has only, say, Leave Updation or Manpower Entry cannot read the salary rates, loans, bonus or arrears tables.
  * The HR records those screens work out from (shifts, holidays, leave rules, loans, revisions ...) come with them; the other HR records (candidates, appraisals ...) need their own HR right.
  * Every login that has some screen can read the lists those screens show (departments, designations, banks, locations ...).
  * The personal details of employees (family, identity numbers, address, bank account, photo), the employee-detail tables, the HR personal-file report and the HR change history of employee profiles
    go only to Employee Entry, the reports, Salary Preparation / Deletion and the HR Employee Master; other screens get the names, codes and locations (the personal columns stay empty).
  * The employee salary settings (total salary, rates, PF / ESI numbers and limits) go to the same screens plus Time Updation.
  * The original passwords kept in Company Entry are shown only to a login that may change the company.
* Changing data always needs the Edit / Add / Delete right of the screen that owns it (a master table is changed through the screen it belongs to;
  the Salary rates, Employee salary settings and Salary rules tabs belong to Salary Preparation, the salary rates also to Employee Entry).
  Resignation sets only the leaving date and its remarks; PF KYC UPLOAD / Form 19 change only the KYC columns (and the PAN, Aadhaar and passport numbers) - nothing else of an employee.
* A login limited to some **locations** works only with the employees of those locations: the employee list, the records kept under their codes (salary rates, shift rows, extras, punches, original salary slips) and every change are limited to them,
  and a holiday that applies to "all locations" can be changed only by a login that has all locations.
* Functions that cover a whole company need a login with **All locations** (and, for Import Records, **All companies**): Monthly Salary Sheets, Biometric Machine Setup (machines and machine users), Import Records,
  the company HR & payroll rules, and every **set-up** table that is not a table of employees (departments, designations, shifts, earning / deduction heads, PF / ESI, holidays of the original software, salary rules ...).
  A location-limited login changes only the tables of its employees (Employee Entry, loans, leave, shifts, bonus ...). It gets only the biometric matches and punches of its own employees
  (a machine ID that an employee of another location also carries as card number or paycode is left out unless a saved match names the own employee).
* **Add** creates, **Edit** changes: Add never overwrites a saved row (an Employee Entry login with Edit may also add a side-table row an employee does not have yet), and for the salary of a month
  Add makes a new one and Edit changes a saved one. Joining a candidate (HR Recruitment) also needs the Employee Master Add and the salary structure Add rights, and an HR record of an employee
  follows the employee's location as it is now.
* The original source tables are for the Super Admin only.

## The activity log

Every login has one (it is kept for every login; a User can read its own only when the Activity Log was given to it, see Rights). It records: sign-in, failed sign-in and sign-out, every screen opened, every record added, changed or deleted, salary and attendance saved,
imports, report generated, print, Excel export, changes to logins, and refused attempts. Rows are only ever added; nobody can edit or delete them.
Filter by user, dates and type, search the text, and export to Excel.

Sign-ins and sign-outs are written by the sign-in program (Windows launcher, or the server sign-in layer with `PAYROLL_INTERNAL_KEY`, see `DEPLOYMENT-GUIDE.md` section 4.6).
In the Windows edition each workspace (the **original** copy and the **editable** copy) keeps its own logins and its own log. A login made in Utilities › Users & Roles belongs to the workspace it was made in:
it signs in on the normal sign-in page (the editable copy is asked first, then the original one) and opens that workspace; its sign-ins, sign-outs, failed sign-ins and screen activity are in that workspace's log.
(Users & Roles shows which workspace the logins belong to.) A request that arrives with `oai-authenticated-user-mode: original` (the server sign-in layer's read-only mode) is never written.

## For developers

* Rights are kept in `hr_users.data` as `permissions.modules[<menu item id or HR module>] = [rights]` next to `datasets`, `units`, `role`, `name`, `createdBy`.
  `lib/access.ts` holds the roles, the screen registry (built from `lib/menu.ts`) and every check; the server uses it in `lib/hr-store.ts` (`hrIdentity`, `restrictLegacy`) and `lib/guard.ts`.
  The menu (`components/app-sidebar.tsx`) is filtered with `itemAllowed` and is empty until the identity is loaded (never the whole menu); `firstScreen` is `''` when a login has no screen.
  A button that leads to another screen asks `useCanOpen()` (`components/access-context.tsx`).
  `lib/unit-scope.ts` limits what a location-limited login sees (`employeeScope`, `onlyCodes`).
* `restrictLegacy` lets a signed-in Admin / User reach only the routes listed there (and refuses a request whose path the sign-in program did not tell); each of them checks the rights of its own screens before it reads or writes.
* `/api/hr-login` answers only the sign-in program (a request with no login of its own, i.e. as the Super Admin) - a signed-in Admin / User cannot use it to test passwords.
* API: `GET/POST /api/users` (list, save, set-active, reset-password, change-password) and `GET/POST /api/activity`.
* Every API handler that takes a body (POST / DELETE) is exported as `drained(handler)` (`lib/server-store.ts`). Cloudflare Workers cannot answer a request whose body nobody read: the worker is restarted and every
  request in flight fails (seconds of stall). A refused POST (original workspace, inactive login, missing right ...) often answers before the body is read, so `drained` reads an unread body before the answer is sent.
  A new route that takes a body must be wrapped the same way.
* Test: `ACCESS_TEST_BASE=<a test copy> ACCESS_TEST_CONFIRM=yes node payroll-web/scripts/test-access-api.mjs` (makes `qa_*` logins and a few `QA ...` rows; see the header of the script).
* PostgreSQL: the table `activity_log` is in `db-gateway/schema.sql` (the gateway creates tables at start - restart it after an update).

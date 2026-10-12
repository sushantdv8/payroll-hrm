PAYROLL WORKSPACE 1.1.0 - WINDOWS SETUP
=====================================

INSTALL
1. Copy PayrollWorkspace_Setup.exe to the destination computer and double-click it.
2. Confirm Install. No administrator account, Node.js installation, npm commands,
   Cloudflare account, Excel installation or database configuration is required.
3. Choose Start now, or open the Payroll Workspace desktop / Start menu shortcut.
   Your default browser opens automatically. Keep the minimised Payroll Workspace
   window open while working; closing that window stops the local application.

Requires Windows 10 or 11, Intel/AMD 64-bit, and about 2 GB free disk space.
Uses the computer's existing default web browser. Application use is local/offline.
It listens only on this computer. Default address: http://localhost:5780/.
If that port is occupied, it selects and remembers another port automatically.
Always start using the shortcut, so the browser opens the correct address.

LOGIN AND DATA
Use the same admin01 login and the passwords already supplied by the owner.
The original password opens the original workspace. The editable password opens
a separate physical copy. Changes in that copy cannot overwrite original records.
Select the company and year on the sign-in page. Each restart requires sign-in.
Every sign-in opens its own window (its own address, such as http://localhost:5781/)
for the company chosen there, with its own session. To work in two companies at once,
open the sign-in address (the shortcut) again in a new tab and sign in to the other
company: the two sessions never mix. Exit in a window signs out of that window only.
The Biometric Attendance app (downloads the punches of machines KE1, KE2, b4) is part
of this setup and starts together with Payroll Workspace: no second setup is needed.
Install on a PC that is on the machines' network (192.168.11.x). Its data is kept in
%LOCALAPPDATA%\BiometricAttendance (the same place as the old separate setup).
Set PAYROLL_NO_BIOMETRIC=1 to prevent it from starting.

This installer includes the owner's current company/employee records, attendance,
salary data, uploaded files and the existing editable workspace with Excel samples.
Give this data-containing installer only to people authorised to use those records.
It does not contain browser cookies, cloud credentials or the owner's source tools.

MONTHLY EXCEL REPORTS
Reports > Monthly Salary Sheets > Application records > Available months.
Select the month, format and employee group, then generate the Excel workbook.
Each month's attendance, salary/rates and applicable inputs must exist in the app.
Imported Excel sheets remain available separately as reference samples.
The provided formats and original sample workbooks are included.
UNIT3 / subsidy employees whose source data is missing still need their records
and company mapping; the setup does not invent attendance or salary amounts.

STORAGE / UPDATE / BACKUP
Program: %LOCALAPPDATA%\Programs\PayrollWorkspace
Data:    %LOCALAPPDATA%\PayrollWorkspace
         state = original workspace; editable-state = separate editable copy
Logs:    %LOCALAPPDATA%\PayrollWorkspace\logs\server.log
Port:    %LOCALAPPDATA%\PayrollWorkspace\config\desktop.json

Running Setup again updates the program and keeps BOTH existing data folders.
Close Payroll Workspace and copy the WHOLE data folder to back up both workspaces.
To restore on a different computer, install, close the app, then restore that whole
data folder to the same location. Never copy only a live SQLite file.
Uninstall through Windows Settings > Apps > Payroll Workspace.
Data is kept by default unless you explicitly choose to delete it.

No data is synced between different computers automatically.
Each installed copy has its own local database and changes.

RUNTIME NOTICES
Node.js: https://nodejs.org/en/about/previous-releases
Wrangler / workerd / dependent package licences are included under app/node_modules.
The bundled Windows runtime components allow the local server to start without a
separate Visual C++ runtime installer. Windows PowerShell and .NET Framework are
used by Setup and are standard components of supported Windows installations.

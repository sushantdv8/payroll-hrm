# Biometric Attendance

Local web app that downloads **users and punch logs** from eSSL / ZKTeco biometric machines over the network
(port 4370, the same connection the "Attendance Management Program" uses). It only reads: it never clears logs,
changes users, sets the time or disables the machine.

## Requirements

- Run it on a PC that is **on the same network as the machines**. For KE1 (192.168.11.180), KE2 (192.168.11.183)
  and b4 (192.168.11.184), that means a PC with a 192.168.11.x address. This is the PC where the Attendance
  Management Program can connect.
- Node.js 22.13 or newer. `Start Biometric.cmd` uses, in order: `node\node.exe` next to this file, the Node bundled
  with Payroll Workspace (`%LOCALAPPDATA%\Programs\PayrollWorkspace\node`), or `node` on PATH.

## Start

Double-click **Start Biometric.cmd**. The browser opens <http://127.0.0.1:5180>; keep the black window open while
using the app.

1. **Machines** tab: click **Test** on a machine to check the connection, then **Download** (or **Download from all
   machines**). Downloading again is safe: punches already saved are skipped.
2. **Punch logs**: every punch, filtered by date, machine and user ID/name. **Export CSV** saves the list.
3. **Daily in / out**: first and last punch per person per day across all machines, with hours.
4. **Employees**: users read from each machine (ID, name, admin/user, card number).
5. **Auto download** (top right) repeats the download every 15 min to 2 hours while the app is running. It is on
   (every 15 minutes) from the first start, and the app also downloads once about 5 seconds after it starts, so the
   punches of KE1, KE2 and b4 are collected without anyone pressing Download. Change or switch it off here; that
   choice is kept. (Start with `--no-auto` to skip the download at start.)

This app is also bundled inside `PayrollWorkspace_Setup.exe`: Payroll Workspace starts it by itself (same data folder
`%LOCALAPPDATA%\BiometricAttendance`), so one setup is enough and Biometric Fetch in Time Updation always finds it.
Set `PAYROLL_NO_BIOMETRIC=1` to stop that. The separate `BiometricAttendance_Setup.exe` is no longer needed.

## If a machine does not connect

- Ping the machine from this PC: `ping 192.168.11.180`. If that fails, this PC is not on the machine's network.
- Disconnect the machine in the Attendance Management Program first; most machines accept one connection at a time.
- If a **Comm Key** is set on the machine (Menu > Comm), enter the same number with **Edit**.
- Port is normally 4370. Connection "Auto" tries TCP, then UDP (older firmware).

## Payroll import

Both CSV exports (Punch logs and Daily in / out) can be loaded with **Machine Data Copy** in Payroll Workspace's Time
Office screen. Employees are matched when their **card number or paycode equals the machine User ID**.

## Data

Everything is saved in `data\biometric.sqlite`. Back up this file; punches stay there even if a machine's memory is
cleared later.

## Windows setup

`powershell -ExecutionPolicy Bypass -File installer\build-setup.ps1` runs the protocol tests and writes
`BiometricAttendance_Setup.exe` (about 33 MB, Node.js included) to the folder above `work_copy`. It installs per user
without admin rights: program in `%LOCALAPPDATA%\Programs\BiometricAttendance`, data and `biometric.log` in
`%LOCALAPPDATA%\BiometricAttendance` (kept on update). Set `BIOMETRIC_SETUP_TEST_ROOT=<folder>` before running the setup
to install into that folder without dialogs, shortcuts or registry entries.

## Without hardware

- `node --no-warnings tools/demo.mjs`: the app on port 5181 with two simulated machines (separate demo data).
- `node tools/zk-test.mjs`: protocol tests against simulated machines (TCP, UDP, all record formats, Comm Key).

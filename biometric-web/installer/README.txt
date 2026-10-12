Biometric Attendance
====================

Downloads users and punch logs from the eSSL / ZKTeco attendance machines (port 4370).
It only reads from the machines: it never clears logs, changes users or sets the time.

Where     : install it on a PC that is on the same network as the machines
            (KE1 192.168.11.180, KE2 192.168.11.183, b4 192.168.11.184).
Start     : double-click "Biometric Attendance" on the desktop (or in the Start menu).
            It opens in the web browser at http://127.0.0.1:5180
            A small window "Biometric Attendance" stays open (minimised) while it runs.
Stop      : close the "Biometric Attendance" window.
First use : Machines tab > Test on each machine, then Download.
            Close (Disconnect) the machine in the Attendance Management Program first:
            most machines accept only one connection at a time.
Comm Key  : if the machine has a Comm Key (Menu > Comm), enter it with Edit.
Data      : %LOCALAPPDATA%\BiometricAttendance\biometric.sqlite
            Copy this folder to back up the downloaded punches (close the program first).
Log       : %LOCALAPPDATA%\BiometricAttendance\biometric.log
            Every connection attempt is written here; send this file if a machine does not work.
Uninstall : Settings > Apps > Biometric Attendance > Uninstall (you can keep or delete the data).

The program only accepts connections from this computer. No internet connection is needed.
Needs Windows 10 or 11 (64-bit).

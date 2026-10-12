// Biometric Attendance Setup.exe: unpacks the installer payload appended to this file and runs install.ps1.
// Layout of the finished Setup.exe: [this program][payload.zip bytes][8-byte marker "BASETUP1"][8-byte payload length].
using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Text;
using System.Windows.Forms;

static class Setup {
  const string Title = "Biometric Attendance Setup";
  [STAThread]
  static int Main() {
    Application.EnableVisualStyles();
    string work = Path.Combine(Path.GetTempPath(), "BiometricAttendanceSetup_" + Guid.NewGuid().ToString("N"));
    Form wait = null;
    try {
      wait = new Form { Text = Title, Width = 420, Height = 130, StartPosition = FormStartPosition.CenterScreen, FormBorderStyle = FormBorderStyle.FixedDialog, ControlBox = false, TopMost = true };
      wait.Controls.Add(new Label { Text = "Preparing Biometric Attendance setup, please wait...", Dock = DockStyle.Fill, TextAlign = System.Drawing.ContentAlignment.MiddleCenter, Font = new System.Drawing.Font("Segoe UI", 10) });
      wait.Show(); Application.DoEvents();

      Directory.CreateDirectory(work);
      string self = Assembly.GetExecutingAssembly().Location;
      using (var fs = new FileStream(self, FileMode.Open, FileAccess.Read, FileShare.Read)) {
        var tail = new byte[16];
        fs.Seek(-16, SeekOrigin.End); fs.Read(tail, 0, 16);
        if (Encoding.ASCII.GetString(tail, 0, 8) != "BASETUP1") throw new Exception("This setup file is damaged. Please copy it again.");
        long length = BitConverter.ToInt64(tail, 8);
        fs.Seek(-16 - length, SeekOrigin.End);
        using (var outFile = File.Create(Path.Combine(work, "payload.zip"))) {
          var buffer = new byte[1 << 20]; long left = length;
          while (left > 0) { int n = fs.Read(buffer, 0, (int)Math.Min(buffer.Length, left)); if (n <= 0) throw new Exception("This setup file is incomplete. Please copy it again."); outFile.Write(buffer, 0, n); left -= n; }
        }
      }
      using (var script = Assembly.GetExecutingAssembly().GetManifestResourceStream("install.ps1"))
      using (var outFile = File.Create(Path.Combine(work, "install.ps1"))) script.CopyTo(outFile);
      wait.Close(); wait = null;

      string powershell = Path.Combine(Environment.SystemDirectory, @"WindowsPowerShell\v1.0\powershell.exe");
      if (!File.Exists(powershell)) throw new Exception("Windows PowerShell was not found on this computer.");
      // BIOMETRIC_SETUP_TEST_ROOT installs into that folder without dialogs, shortcuts or registry entries (used to check a built setup).
      string testRoot = Environment.GetEnvironmentVariable("BIOMETRIC_SETUP_TEST_ROOT");
      string extra = string.IsNullOrEmpty(testRoot) ? "" : " -Test -TestRoot \"" + testRoot + "\"";
      var start = new ProcessStartInfo(powershell, "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \"" + Path.Combine(work, "install.ps1") + "\"" + extra) { UseShellExecute = false, CreateNoWindow = true, WorkingDirectory = work };
      using (var p = Process.Start(start)) { p.WaitForExit(); return p.ExitCode; }
    } catch (Exception e) {
      if (wait != null) wait.Close();
      MessageBox.Show("Setup could not start:\n\n" + e.Message, Title, MessageBoxButtons.OK, MessageBoxIcon.Error);
      return 1;
    } finally {
      try { if (Directory.Exists(work)) Directory.Delete(work, true); } catch { }
    }
  }
}

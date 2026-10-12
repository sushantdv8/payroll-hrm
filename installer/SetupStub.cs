// Self-extracting Windows setup. Tail: marker(8), payload length(8), SHA256(32).
using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Windows.Forms;

static class Setup {
  const string Title = "Payroll Workspace Setup";
  [STAThread]
  static int Main() {
    Application.EnableVisualStyles();
    string testRoot = Environment.GetEnvironmentVariable("PAYROLL_SETUP_TEST_ROOT");
    bool testing = !string.IsNullOrEmpty(testRoot);
    string work = Path.Combine(Path.GetTempPath(), "PayrollWorkspaceSetup_" + Guid.NewGuid().ToString("N"));
    Form wait = null;
    try {
      if (testing && (!Path.IsPathRooted(testRoot) || testRoot.Contains("\""))) throw new Exception("Invalid setup test directory.");
      if (!testing) {
        wait = new Form { Text = Title, Width = 420, Height = 130, StartPosition = FormStartPosition.CenterScreen, FormBorderStyle = FormBorderStyle.FixedDialog, ControlBox = false, TopMost = true };
        wait.Controls.Add(new Label { Text = "Preparing Payroll Workspace setup, please wait...", Dock = DockStyle.Fill, TextAlign = System.Drawing.ContentAlignment.MiddleCenter, Font = new System.Drawing.Font("Segoe UI", 10) });
        wait.Show(); Application.DoEvents();
      }
      Directory.CreateDirectory(work);
      using (var input = File.OpenRead(Assembly.GetExecutingAssembly().Location)) {
        if (input.Length < 48) throw new Exception("This setup file is incomplete. Please copy it again.");
        var tail = new byte[48]; input.Seek(-48, SeekOrigin.End);
        if (input.Read(tail, 0, tail.Length) != tail.Length || Encoding.ASCII.GetString(tail, 0, 8) != "PWSETUP2") throw new Exception("This setup file is damaged. Please copy it again.");
        long length = BitConverter.ToInt64(tail, 8);
        if (length <= 0 || length > input.Length - 48) throw new Exception("Invalid setup payload length.");
        input.Seek(-48 - length, SeekOrigin.End);
        using (var hash = SHA256.Create())
        using (var output = File.Create(Path.Combine(work, "payload.zip"))) {
          var buffer = new byte[1 << 20]; long left = length;
          while (left > 0) {
            int n = input.Read(buffer, 0, (int)Math.Min(buffer.Length, left));
            if (n <= 0) throw new Exception("This setup file is incomplete. Please copy it again.");
            output.Write(buffer, 0, n); hash.TransformBlock(buffer, 0, n, buffer, 0); left -= n;
          }
          hash.TransformFinalBlock(new byte[0], 0, 0);
          for (int i = 0; i < 32; i++) if (hash.Hash[i] != tail[16 + i]) throw new Exception("Setup integrity check failed. Please copy the setup file again.");
        }
      }
      using (var script = Assembly.GetExecutingAssembly().GetManifestResourceStream("install.ps1"))
      using (var output = File.Create(Path.Combine(work, "install.ps1"))) script.CopyTo(output);
      if (wait != null) { wait.Close(); wait = null; }
      string powershell = Path.Combine(Environment.SystemDirectory, @"WindowsPowerShell\v1.0\powershell.exe");
      if (!File.Exists(powershell)) throw new Exception("Windows PowerShell was not found on this computer.");
      string extra = testing ? " -Test -TestRoot \"" + testRoot.TrimEnd('\\') + "\"" : "";
      var start = new ProcessStartInfo(powershell, "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \"" + Path.Combine(work, "install.ps1") + "\"" + extra) { UseShellExecute = false, CreateNoWindow = true, WorkingDirectory = work, RedirectStandardOutput = testing, RedirectStandardError = testing };
      using (var process = Process.Start(start)) {
        string stdout = "", stderr = "";
        if (testing) { stdout = process.StandardOutput.ReadToEnd(); stderr = process.StandardError.ReadToEnd(); }
        process.WaitForExit();
        if (testing) { Directory.CreateDirectory(testRoot); File.WriteAllText(Path.Combine(testRoot, "setup.log"), stdout + "\n" + stderr); }
        return process.ExitCode;
      }
    } catch (Exception error) {
      if (wait != null) wait.Close();
      if (testing) { Directory.CreateDirectory(testRoot); File.WriteAllText(Path.Combine(testRoot, "setup-error.log"), error.Message); }
      else MessageBox.Show("Setup could not start:\n\n" + error.Message, Title, MessageBoxButtons.OK, MessageBoxIcon.Error);
      return 1;
    } finally {
      try { if (Directory.Exists(work) && Path.GetFullPath(work).StartsWith(Path.GetFullPath(Path.GetTempPath()), StringComparison.OrdinalIgnoreCase)) Directory.Delete(work, true); } catch { }
    }
  }
}

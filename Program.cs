using System;
using System.IO;
using System.Reflection;
using System.Runtime.CompilerServices;
using System.Windows.Forms;

namespace WMSApp
{
    internal static class Program
    {
        /// <summary>
        ///  The main entry point for the application.
        /// </summary>
        [STAThread]
        static void Main()
        {
            // Global exception handlers for debugging startup issues
            Application.SetUnhandledExceptionMode(UnhandledExceptionMode.CatchException);
            Application.ThreadException += (sender, e) =>
            {
                System.Diagnostics.Debug.WriteLine($"[THREAD EXCEPTION] {e.Exception.Message}");
                System.Diagnostics.Debug.WriteLine($"[THREAD EXCEPTION] Stack: {e.Exception.StackTrace}");
                MessageBox.Show($"Thread Exception: {e.Exception.Message}\n\n{e.Exception.StackTrace}",
                    "Application Error", MessageBoxButtons.OK, MessageBoxIcon.Error);
            };
            AppDomain.CurrentDomain.UnhandledException += (sender, e) =>
            {
                var ex = e.ExceptionObject as Exception;
                System.Diagnostics.Debug.WriteLine($"[UNHANDLED EXCEPTION] {ex?.Message}");
                System.Diagnostics.Debug.WriteLine($"[UNHANDLED EXCEPTION] Stack: {ex?.StackTrace}");
                MessageBox.Show($"Unhandled Exception: {ex?.Message}\n\n{ex?.StackTrace}",
                    "Application Error", MessageBoxButtons.OK, MessageBoxIcon.Error);
            };

            try
            {
                ApplicationConfiguration.Initialize();
                if (!InstallLooksHealthy()) return;
                Application.Run(new Form1());
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"[STARTUP CRASH] {ex.Message}");
                System.Diagnostics.Debug.WriteLine($"[STARTUP CRASH] Stack: {ex.StackTrace}");
                MessageBox.Show($"Application failed to start: {DescribeException(ex)}\n\n{ex.StackTrace}",
                    "Startup Error", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }

        /// <summary>
        /// Loads the assemblies the app depends on before any window opens. A partly updated
        /// install (e.g. an old System.Text.Json.dll or a stale GraysWMS.deps.json left in dist\)
        /// otherwise surfaces much later as "The type initializer for 'WMSApp.Form1' threw an exception".
        /// </summary>
        private static bool InstallLooksHealthy()
        {
            string problem = null;
            try { ProbeDependencies(); }
            catch (Exception ex) { problem = DescribeException(ex); }
            if (problem == null) return true;

            System.Diagnostics.Debug.WriteLine("[STARTUP CHECK] " + problem);
            var answer = MessageBox.Show(
                "This installation of Gray's WMS is incomplete or mixed with files from an older version.\n\n" +
                problem + "\n\n" +
                "Fix: close the app, delete the folder\n  " + AppContext.BaseDirectory + "\n" +
                "and install the full release package again (do not copy over an old dist folder).\n\n" +
                "Start anyway?",
                "Gray's WMS - installation problem", MessageBoxButtons.YesNo, MessageBoxIcon.Error, MessageBoxDefaultButton.Button2);
            return answer == DialogResult.Yes;
        }

        [MethodImpl(MethodImplOptions.NoInlining)]
        private static void ProbeDependencies()
        {
            // System.Text.Json must be the version GraysWMS was built against (10.x, required by the Anthropic SDK)
            var stj = typeof(System.Text.Json.JsonSerializer).Assembly;
            _ = new System.Text.Json.JsonSerializerOptions { PropertyNamingPolicy = System.Text.Json.JsonNamingPolicy.CamelCase };
            var expected = typeof(Program).Assembly.GetReferencedAssemblies();
            foreach (var name in expected)
            {
                if (name.Name == "System.Text.Json" && stj.GetName().Version < name.Version)
                    throw new FileLoadException($"System.Text.Json {stj.GetName().Version} is loaded from {stj.Location}, but GraysWMS needs {name.Version}.");
            }
            // Packages used by the Fusion SQL module
            Assembly.Load("Anthropic");
            Assembly.Load("Microsoft.Data.Sqlite");
            Assembly.Load("System.Security.Cryptography.ProtectedData");
        }

        /// <summary>Message of an exception and all of its inner exceptions, with the file that failed to load.</summary>
        internal static string DescribeException(Exception ex)
        {
            var sb = new System.Text.StringBuilder();
            for (var e = ex; e != null; e = e.InnerException)
            {
                if (sb.Length > 0) sb.Append("\n  -> ");
                sb.Append(e.GetType().Name).Append(": ").Append(e.Message);
                if (e is FileNotFoundException fnf && !string.IsNullOrEmpty(fnf.FileName) && !e.Message.Contains(fnf.FileName)) sb.Append(" [").Append(fnf.FileName).Append(']');
                if (e is FileLoadException fle && !string.IsNullOrEmpty(fle.FileName) && !e.Message.Contains(fle.FileName)) sb.Append(" [").Append(fle.FileName).Append(']');
            }
            return sb.ToString();
        }
    }
}

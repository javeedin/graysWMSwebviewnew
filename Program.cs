using System;
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
                Application.Run(new Form1());
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"[STARTUP CRASH] {ex.Message}");
                System.Diagnostics.Debug.WriteLine($"[STARTUP CRASH] Stack: {ex.StackTrace}");
                MessageBox.Show($"Application failed to start: {ex.Message}\n\n{ex.StackTrace}",
                    "Startup Error", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }
    }
}

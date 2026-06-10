using System;
using System.Threading;
using System.Windows.Forms;

namespace FusionUpdater
{
    internal static class Program
    {
        private static Mutex? _mutex;

        [STAThread]
        static void Main()
        {
            // Single instance enforcement
            _mutex = new Mutex(true, "FusionUpdater_SingleInstance", out bool createdNew);
            if (!createdNew)
            {
                MessageBox.Show("FusionUpdater is already running in the system tray.",
                    "Already Running", MessageBoxButtons.OK, MessageBoxIcon.Information);
                return;
            }

            ApplicationConfiguration.Initialize();
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            using var form = new UpdaterForm();
            Application.Run(form);
        }
    }
}

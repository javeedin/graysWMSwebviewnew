// The Windows Desktop SDK generates ApplicationConfiguration.Initialize() for WinForms apps; this check builds with
// the plain SDK, so it stands in for the generated class. Not part of the app.
namespace WMSApp
{
    internal static class ApplicationConfiguration
    {
        public static void Initialize() { }
    }
}

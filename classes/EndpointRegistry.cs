using System.Collections.Generic;

namespace WMSApp
{
    /// <summary>
    /// Registry that maps modules and pages to their REST endpoints
    /// </summary>
    public static class EndpointRegistry
    {
        private static readonly Dictionary<string, Dictionary<string, string>> _endpoints = new Dictionary<string, Dictionary<string, string>>
        {
            // Warehouse Management (WMS)
            {
                "WMS", new Dictionary<string, string>
                {
                    { "GETTRIPDETAILS", "https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/WAREHOUSEMANAGEMENT/GETTRIPDETAILS" },
                    { "GETPRINTERCONFIG", "https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/wms/v1/printers/all" }
                }
            },
            // General Ledger (GL)
            {
                "GL", new Dictionary<string, string>
                {
                    { "GETCHARTOFACCOUNTS", "https://your-gl-endpoint.com/..." },
                    { "GETLEDGERENTRIES", "https://your-gl-endpoint.com/..." }
                }
            },
            // Accounts Receivable (AR)
            {
                "AR", new Dictionary<string, string>
                {
                    { "GETCUSTOMERS", "https://your-ar-endpoint.com/..." },
                    { "GETINVOICES", "https://your-ar-endpoint.com/..." }
                }
            },
            // Accounts Payable (AP)
            {
                "AP", new Dictionary<string, string>
                {
                    { "GETSUPPLIERS", "https://your-ap-endpoint.com/..." },
                    { "GETPAYMENTS", "https://your-ap-endpoint.com/..." }
                }
            },
            // Add more modules as needed
        };

        /// <summary>
        /// Gets the full endpoint URL for a module and endpoint name
        /// </summary>
        public static string GetEndpointUrl(string moduleCode, string endpointName)
        {
            if (_endpoints.TryGetValue(moduleCode, out var moduleEndpoints))
            {
                if (moduleEndpoints.TryGetValue(endpointName, out string url))
                {
                    return url;
                }
            }
            return null;
        }

        /// <summary>
        /// Checks if a module exists in the registry
        /// </summary>
        public static bool ModuleExists(string moduleCode)
        {
            return _endpoints.ContainsKey(moduleCode);
        }

        /// <summary>
        /// Gets all endpoint names for a module
        /// </summary>
        public static string[] GetEndpointNames(string moduleCode)
        {
            if (_endpoints.TryGetValue(moduleCode, out var moduleEndpoints))
            {
                var names = new string[moduleEndpoints.Count];
                moduleEndpoints.Keys.CopyTo(names, 0);
                return names;
            }
            return new string[0];
        }
    }
}
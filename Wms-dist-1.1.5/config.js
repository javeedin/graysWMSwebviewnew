// ============================================================================
// API CONFIGURATION
// ============================================================================
// Update this file with your actual APEX REST API URL

const API_CONFIG = {
    // Your APEX REST API Base URL
    // Example: 'https://apex.oracle.com/pls/apex/workspace_name/wms/v1'
    APEX_BASE_URL: 'https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/TRIPMANAGEMENT',

    // Enable/disable console logging
    DEBUG: true,

    // API timeout in milliseconds
    TIMEOUT: 30000
};

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = API_CONFIG;
}

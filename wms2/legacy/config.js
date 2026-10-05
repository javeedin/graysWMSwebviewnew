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

    // API timeout in milliseconds (5 minutes)
    TIMEOUT: 300000,

    // Oracle Fusion Pick Transactions API (Direct Oracle Cloud)
    ORACLE_FUSION_PICK_API: {
        TEST: 'https://efmh-test.fa.em3.oraclecloud.com/fscmRestApi/resources/11.13.18.05/pickTransactions',
        PROD: 'https://efmh.fa.em3.oraclecloud.com/fscmRestApi/resources/11.13.18.05/pickTransactions'
    }
};

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = API_CONFIG;
}

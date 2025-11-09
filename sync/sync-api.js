/**
 * Oracle Fusion API Wrapper
 * Handles all communication with Oracle Fusion Cloud REST APIs
 */

class FusionAPI {
    constructor(instanceUrl, username, password, authType = 'basic') {
        this.instanceUrl = instanceUrl.endsWith('/') ? instanceUrl.slice(0, -1) : instanceUrl;
        this.username = username;
        this.password = password;
        this.authType = authType;
        this.baseApiPath = '/fscmRestApi/resources/11.13.18.05/';
        this.authToken = null;
    }

    /**
     * Get authentication headers
     */
    getAuthHeaders() {
        const headers = {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        };

        if (this.authType === 'basic') {
            const credentials = btoa(`${this.username}:${this.password}`);
            headers['Authorization'] = `Basic ${credentials}`;
        } else if (this.authType === 'oauth' && this.authToken) {
            headers['Authorization'] = `Bearer ${this.authToken}`;
        }

        return headers;
    }

    /**
     * Test connection to Fusion
     */
    async testConnection() {
        try {
            // Try to fetch a simple resource to test connection
            const url = `${this.instanceUrl}${this.baseApiPath}ledgers?limit=1`;

            const response = await fetch(url, {
                method: 'GET',
                headers: this.getAuthHeaders()
            });

            if (response.ok) {
                return {
                    success: true,
                    message: 'Connection successful',
                    statusCode: response.status
                };
            } else {
                return {
                    success: false,
                    error: `HTTP ${response.status}: ${response.statusText}`,
                    statusCode: response.status
                };
            }
        } catch (error) {
            return {
                success: false,
                error: error.message,
                statusCode: 0
            };
        }
    }

    /**
     * Fetch journal batches from Fusion
     */
    async getJournalBatches(params = {}) {
        const {
            dateFrom = null,
            dateTo = null,
            ledgerId = null,
            status = null,
            limit = 1000,
            offset = 0
        } = params;

        try {
            // Build query parameters
            let queryParams = `?limit=${limit}&offset=${offset}`;

            if (dateFrom) {
                queryParams += `&q=CreationDate>='${dateFrom}'`;
            }
            if (dateTo) {
                queryParams += `;CreationDate<='${dateTo}'`;
            }
            if (ledgerId) {
                queryParams += `;LedgerId=${ledgerId}`;
            }
            if (status) {
                queryParams += `;Status='${status}'`;
            }

            const url = `${this.instanceUrl}${this.baseApiPath}journalBatches${queryParams}`;

            const response = await fetch(url, {
                method: 'GET',
                headers: this.getAuthHeaders()
            });

            if (response.ok) {
                const data = await response.json();
                return {
                    success: true,
                    data: data.items || [],
                    count: data.count || 0,
                    hasMore: data.hasMore || false
                };
            } else {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
        } catch (error) {
            return {
                success: false,
                error: error.message,
                data: []
            };
        }
    }

    /**
     * Fetch journal headers from Fusion
     */
    async getJournalHeaders(batchId = null, params = {}) {
        try {
            const { limit = 1000, offset = 0 } = params;
            let queryParams = `?limit=${limit}&offset=${offset}`;

            if (batchId) {
                queryParams += `&q=JeBatchId=${batchId}`;
            }

            const url = `${this.instanceUrl}${this.baseApiPath}journalHeaders${queryParams}`;

            const response = await fetch(url, {
                method: 'GET',
                headers: this.getAuthHeaders()
            });

            if (response.ok) {
                const data = await response.json();
                return {
                    success: true,
                    data: data.items || [],
                    count: data.count || 0
                };
            } else {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
        } catch (error) {
            return {
                success: false,
                error: error.message,
                data: []
            };
        }
    }

    /**
     * Fetch journal lines from Fusion
     */
    async getJournalLines(headerId = null, params = {}) {
        try {
            const { limit = 5000, offset = 0 } = params;
            let queryParams = `?limit=${limit}&offset=${offset}`;

            if (headerId) {
                queryParams += `&q=JeHeaderId=${headerId}`;
            }

            const url = `${this.instanceUrl}${this.baseApiPath}journalLines${queryParams}`;

            const response = await fetch(url, {
                method: 'GET',
                headers: this.getAuthHeaders()
            });

            if (response.ok) {
                const data = await response.json();
                return {
                    success: true,
                    data: data.items || [],
                    count: data.count || 0
                };
            } else {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
        } catch (error) {
            return {
                success: false,
                error: error.message,
                data: []
            };
        }
    }

    /**
     * Fetch Chart of Accounts from Fusion
     */
    async getChartOfAccounts(params = {}) {
        try {
            const { limit = 1000, offset = 0 } = params;
            const queryParams = `?limit=${limit}&offset=${offset}`;

            const url = `${this.instanceUrl}${this.baseApiPath}chartOfAccounts${queryParams}`;

            const response = await fetch(url, {
                method: 'GET',
                headers: this.getAuthHeaders()
            });

            if (response.ok) {
                const data = await response.json();
                return {
                    success: true,
                    data: data.items || [],
                    count: data.count || 0
                };
            } else {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
        } catch (error) {
            return {
                success: false,
                error: error.message,
                data: []
            };
        }
    }

    /**
     * Fetch Ledgers from Fusion
     */
    async getLedgers(params = {}) {
        try {
            const { limit = 100, offset = 0 } = params;
            const queryParams = `?limit=${limit}&offset=${offset}`;

            const url = `${this.instanceUrl}${this.baseApiPath}ledgers${queryParams}`;

            const response = await fetch(url, {
                method: 'GET',
                headers: this.getAuthHeaders()
            });

            if (response.ok) {
                const data = await response.json();
                return {
                    success: true,
                    data: data.items || [],
                    count: data.count || 0
                };
            } else {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
        } catch (error) {
            return {
                success: false,
                error: error.message,
                data: []
            };
        }
    }

    /**
     * Post journal to Fusion (for future two-way sync)
     */
    async postJournal(journalData) {
        try {
            const url = `${this.instanceUrl}${this.baseApiPath}journalBatches`;

            const response = await fetch(url, {
                method: 'POST',
                headers: this.getAuthHeaders(),
                body: JSON.stringify(journalData)
            });

            if (response.ok) {
                const data = await response.json();
                return {
                    success: true,
                    data: data
                };
            } else {
                const errorData = await response.json();
                throw new Error(errorData.detail || `HTTP ${response.status}`);
            }
        } catch (error) {
            return {
                success: false,
                error: error.message
            };
        }
    }
}

/**
 * APEX API Wrapper
 * Handles all communication with APEX REST APIs
 */

class ApexAPI {
    constructor(baseUrl, workspace = 'GRAYS_WMS') {
        this.baseUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
        this.workspace = workspace;
    }

    /**
     * Get common headers for APEX REST calls
     */
    getHeaders() {
        return {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        };
    }

    /**
     * Save journal batches to APEX
     */
    async saveJournalBatches(batches) {
        try {
            const url = `${this.baseUrl}/api/sync/gl/batches`;

            const response = await fetch(url, {
                method: 'POST',
                headers: this.getHeaders(),
                body: JSON.stringify({ batches })
            });

            if (response.ok) {
                const data = await response.json();
                return {
                    success: true,
                    inserted: data.inserted || 0,
                    updated: data.updated || 0,
                    failed: data.failed || 0
                };
            } else {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
        } catch (error) {
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Save journal headers to APEX
     */
    async saveJournalHeaders(headers) {
        try {
            const url = `${this.baseUrl}/api/sync/gl/headers`;

            const response = await fetch(url, {
                method: 'POST',
                headers: this.getHeaders(),
                body: JSON.stringify({ headers })
            });

            if (response.ok) {
                const data = await response.json();
                return {
                    success: true,
                    inserted: data.inserted || 0,
                    updated: data.updated || 0
                };
            } else {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
        } catch (error) {
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Save journal lines to APEX
     */
    async saveJournalLines(lines) {
        try {
            const url = `${this.baseUrl}/api/sync/gl/lines`;

            const response = await fetch(url, {
                method: 'POST',
                headers: this.getHeaders(),
                body: JSON.stringify({ lines })
            });

            if (response.ok) {
                const data = await response.json();
                return {
                    success: true,
                    inserted: data.inserted || 0,
                    updated: data.updated || 0
                };
            } else {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
        } catch (error) {
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Log sync job to APEX
     */
    async logSyncJob(jobData) {
        try {
            const url = `${this.baseUrl}/api/sync/logs`;

            const response = await fetch(url, {
                method: 'POST',
                headers: this.getHeaders(),
                body: JSON.stringify(jobData)
            });

            if (response.ok) {
                const data = await response.json();
                return {
                    success: true,
                    jobId: data.jobId
                };
            } else {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
        } catch (error) {
            return {
                success: false,
                error: error.message
            };
        }
    }
}

/**
 * Data Transformation Utilities
 * Transform Fusion data format to APEX format
 */

class DataTransformer {
    /**
     * Transform Fusion batch to APEX format
     */
    static transformBatch(fusionBatch) {
        return {
            FUSION_BATCH_ID: fusionBatch.JeBatchId,
            NAME: fusionBatch.Name,
            LEDGER_ID: fusionBatch.LedgerId,
            STATUS: fusionBatch.Status === 'POSTED' ? 'P' : 'U',
            DEFAULT_PERIOD_NAME: fusionBatch.AccountingPeriod,
            DESCRIPTION: fusionBatch.Description,
            SYNC_STATUS: 'SYNCED',
            SYNC_SOURCE: 'FUSION',
            LAST_SYNC_DATE: new Date().toISOString()
        };
    }

    /**
     * Transform Fusion header to APEX format
     */
    static transformHeader(fusionHeader) {
        return {
            FUSION_HEADER_ID: fusionHeader.JeHeaderId,
            FUSION_BATCH_ID: fusionHeader.JeBatchId,
            NAME: fusionHeader.Name,
            PERIOD_NAME: fusionHeader.Period,
            STATUS: fusionHeader.Status === 'POSTED' ? 'P' : 'U',
            JE_SOURCE: fusionHeader.JeSource,
            JE_CATEGORY: fusionHeader.JeCategory,
            CURRENCY_CODE: fusionHeader.CurrencyCode,
            DESCRIPTION: fusionHeader.Description,
            SYNC_STATUS: 'SYNCED',
            SYNC_SOURCE: 'FUSION',
            LAST_SYNC_DATE: new Date().toISOString()
        };
    }

    /**
     * Transform Fusion line to APEX format
     */
    static transformLine(fusionLine) {
        return {
            FUSION_LINE_ID: fusionLine.JeLineId,
            FUSION_HEADER_ID: fusionLine.JeHeaderId,
            JE_LINE_NUM: fusionLine.LineNumber,
            CODE_COMBINATION_ID: fusionLine.CodeCombinationId,
            PERIOD_NAME: fusionLine.Period,
            ENTERED_DR: fusionLine.EnteredDr,
            ENTERED_CR: fusionLine.EnteredCr,
            ACCOUNTED_DR: fusionLine.AccountedDr,
            ACCOUNTED_CR: fusionLine.AccountedCr,
            DESCRIPTION: fusionLine.Description,
            SYNC_STATUS: 'SYNCED',
            SYNC_SOURCE: 'FUSION',
            LAST_SYNC_DATE: new Date().toISOString()
        };
    }
}

// Make classes globally available
window.FusionAPI = FusionAPI;
window.ApexAPI = ApexAPI;
window.DataTransformer = DataTransformer;

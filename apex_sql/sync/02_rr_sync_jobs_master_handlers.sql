-- =====================================================
-- RR SYNC JOBS MASTER - REST API Handlers
-- Part of Sync Module
-- =====================================================
-- Purpose: Create POST and GET handlers for Sync Jobs Master
-- Author: Claude Code
-- Date: 2025-11-10
-- =====================================================

-- =====================================================
-- 1. CREATE OR UPDATE SYNC JOB MASTER
-- =====================================================

CREATE OR REPLACE PROCEDURE RR_SYNC_JOBS_MASTER_UPSERT (
    p_job_master_id         IN NUMBER DEFAULT NULL,
    p_module                IN VARCHAR2,
    p_job_name              IN VARCHAR2,
    p_job_code              IN VARCHAR2,
    p_source_endpoint       IN VARCHAR2,
    p_destination_endpoint  IN VARCHAR2 DEFAULT NULL,
    p_api_type              IN VARCHAR2 DEFAULT 'REST',
    p_http_method           IN VARCHAR2 DEFAULT 'GET',
    p_destination_procedure IN VARCHAR2 DEFAULT NULL,
    p_default_parameters    IN CLOB DEFAULT NULL,
    p_authentication_type   IN VARCHAR2 DEFAULT 'BASIC',
    p_description           IN VARCHAR2 DEFAULT NULL,
    p_is_active             IN VARCHAR2 DEFAULT 'Y',
    p_field_mapping         IN CLOB DEFAULT NULL,
    p_sort_order            IN NUMBER DEFAULT 100
) AS
    v_job_master_id NUMBER;
    v_exists NUMBER;
BEGIN
    -- Check if updating existing record
    IF p_job_master_id IS NOT NULL THEN
        SELECT COUNT(*) INTO v_exists
        FROM RR_SYNC_JOBS_MASTER
        WHERE JOB_MASTER_ID = p_job_master_id;

        IF v_exists > 0 THEN
            -- Update existing record
            UPDATE RR_SYNC_JOBS_MASTER
            SET MODULE = p_module,
                JOB_NAME = p_job_name,
                JOB_CODE = p_job_code,
                SOURCE_ENDPOINT = p_source_endpoint,
                DESTINATION_ENDPOINT = p_destination_endpoint,
                API_TYPE = p_api_type,
                HTTP_METHOD = p_http_method,
                DESTINATION_PROCEDURE = p_destination_procedure,
                DEFAULT_PARAMETERS = p_default_parameters,
                AUTHENTICATION_TYPE = p_authentication_type,
                DESCRIPTION = p_description,
                IS_ACTIVE = p_is_active,
                FIELD_MAPPING = p_field_mapping,
                SORT_ORDER = p_sort_order,
                UPDATED_DATE = SYSTIMESTAMP,
                UPDATED_BY = USER
            WHERE JOB_MASTER_ID = p_job_master_id;

            v_job_master_id := p_job_master_id;

            HTP.print('{"status": "SUCCESS", "message": "Sync job master updated successfully", "jobMasterId": ' || v_job_master_id || '}');
            RETURN;
        END IF;
    END IF;

    -- Insert new record
    v_job_master_id := RR_SYNC_JOBS_MASTER_SEQ.NEXTVAL;

    INSERT INTO RR_SYNC_JOBS_MASTER (
        JOB_MASTER_ID,
        MODULE,
        JOB_NAME,
        JOB_CODE,
        SOURCE_ENDPOINT,
        DESTINATION_ENDPOINT,
        API_TYPE,
        HTTP_METHOD,
        DESTINATION_PROCEDURE,
        DEFAULT_PARAMETERS,
        AUTHENTICATION_TYPE,
        DESCRIPTION,
        IS_ACTIVE,
        FIELD_MAPPING,
        SORT_ORDER,
        CREATED_DATE,
        CREATED_BY
    ) VALUES (
        v_job_master_id,
        p_module,
        p_job_name,
        p_job_code,
        p_source_endpoint,
        p_destination_endpoint,
        p_api_type,
        p_http_method,
        p_destination_procedure,
        p_default_parameters,
        p_authentication_type,
        p_description,
        p_is_active,
        p_field_mapping,
        p_sort_order,
        SYSTIMESTAMP,
        USER
    );

    COMMIT;

    HTP.print('{"status": "SUCCESS", "message": "Sync job master created successfully", "jobMasterId": ' || v_job_master_id || '}');

EXCEPTION
    WHEN DUP_VAL_ON_INDEX THEN
        ROLLBACK;
        HTP.print('{"status": "ERROR", "message": "Job code already exists. Please use a unique job code."}');
    WHEN OTHERS THEN
        ROLLBACK;
        HTP.print('{"status": "ERROR", "message": "Error creating sync job master: ' || REPLACE(SQLERRM, '"', '\"') || '"}');
END RR_SYNC_JOBS_MASTER_UPSERT;
/

-- =====================================================
-- 2. DEFINE POST HANDLER
-- =====================================================

BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'rr',
        p_pattern        => 'sync/jobs/master',
        p_method         => 'POST',
        p_source_type    => ORDS.source_type_plsql,
        p_source         =>
'DECLARE
    v_body CLOB;
BEGIN
    v_body := :body_text;

    RR_SYNC_JOBS_MASTER_UPSERT(
        p_job_master_id         => JSON_VALUE(v_body, ''$.jobMasterId''),
        p_module                => JSON_VALUE(v_body, ''$.module''),
        p_job_name              => JSON_VALUE(v_body, ''$.jobName''),
        p_job_code              => JSON_VALUE(v_body, ''$.jobCode''),
        p_source_endpoint       => JSON_VALUE(v_body, ''$.sourceEndpoint''),
        p_destination_endpoint  => JSON_VALUE(v_body, ''$.destinationEndpoint''),
        p_api_type              => JSON_VALUE(v_body, ''$.apiType''),
        p_http_method           => JSON_VALUE(v_body, ''$.httpMethod''),
        p_destination_procedure => JSON_VALUE(v_body, ''$.destinationProcedure''),
        p_default_parameters    => JSON_VALUE(v_body, ''$.defaultParameters''),
        p_authentication_type   => JSON_VALUE(v_body, ''$.authenticationType''),
        p_description           => JSON_VALUE(v_body, ''$.description''),
        p_is_active             => JSON_VALUE(v_body, ''$.isActive''),
        p_field_mapping         => JSON_VALUE(v_body, ''$.fieldMapping''),
        p_sort_order            => JSON_VALUE(v_body, ''$.sortOrder'')
    );
END;'
    );
    COMMIT;
END;
/

-- =====================================================
-- 3. GET ALL SYNC JOB MASTERS (with filters)
-- =====================================================

BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'rr',
        p_pattern        => 'sync/jobs/master',
        p_method         => 'GET',
        p_source_type    => ORDS.source_type_query,
        p_source         =>
'SELECT
    JOB_MASTER_ID as "jobMasterId",
    MODULE as "module",
    JOB_NAME as "jobName",
    JOB_CODE as "jobCode",
    SOURCE_ENDPOINT as "sourceEndpoint",
    DESTINATION_ENDPOINT as "destinationEndpoint",
    API_TYPE as "apiType",
    HTTP_METHOD as "httpMethod",
    DESTINATION_PROCEDURE as "destinationProcedure",
    DEFAULT_PARAMETERS as "defaultParameters",
    AUTHENTICATION_TYPE as "authenticationType",
    DESCRIPTION as "description",
    IS_ACTIVE as "isActive",
    FIELD_MAPPING as "fieldMapping",
    SORT_ORDER as "sortOrder",
    TO_CHAR(CREATED_DATE, ''YYYY-MM-DD"T"HH24:MI:SS'') as "createdDate",
    CREATED_BY as "createdBy",
    TO_CHAR(UPDATED_DATE, ''YYYY-MM-DD"T"HH24:MI:SS'') as "updatedDate",
    UPDATED_BY as "updatedBy"
FROM RR_SYNC_JOBS_MASTER
WHERE 1=1
    AND (:module IS NULL OR MODULE = :module)
    AND (:is_active IS NULL OR IS_ACTIVE = :is_active)
    AND (:search IS NULL OR
         UPPER(JOB_NAME) LIKE UPPER(''%'' || :search || ''%'') OR
         UPPER(JOB_CODE) LIKE UPPER(''%'' || :search || ''%'') OR
         UPPER(DESCRIPTION) LIKE UPPER(''%'' || :search || ''%''))
ORDER BY SORT_ORDER, MODULE, JOB_NAME
OFFSET NVL(:offset, 0) ROWS
FETCH NEXT NVL(:limit, 100) ROWS ONLY'
    );
    COMMIT;
END;
/

-- =====================================================
-- 4. GET SYNC JOB MASTER BY ID
-- =====================================================

BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name    => 'rr',
        p_pattern        => 'sync/jobs/master/:id'
    );

    ORDS.DEFINE_HANDLER(
        p_module_name    => 'rr',
        p_pattern        => 'sync/jobs/master/:id',
        p_method         => 'GET',
        p_source_type    => ORDS.source_type_query,
        p_source         =>
'SELECT
    JOB_MASTER_ID as "jobMasterId",
    MODULE as "module",
    JOB_NAME as "jobName",
    JOB_CODE as "jobCode",
    SOURCE_ENDPOINT as "sourceEndpoint",
    DESTINATION_ENDPOINT as "destinationEndpoint",
    API_TYPE as "apiType",
    HTTP_METHOD as "httpMethod",
    DESTINATION_PROCEDURE as "destinationProcedure",
    DEFAULT_PARAMETERS as "defaultParameters",
    AUTHENTICATION_TYPE as "authenticationType",
    DESCRIPTION as "description",
    IS_ACTIVE as "isActive",
    FIELD_MAPPING as "fieldMapping",
    SORT_ORDER as "sortOrder",
    TO_CHAR(CREATED_DATE, ''YYYY-MM-DD"T"HH24:MI:SS'') as "createdDate",
    CREATED_BY as "createdBy",
    TO_CHAR(UPDATED_DATE, ''YYYY-MM-DD"T"HH24:MI:SS'') as "updatedDate",
    UPDATED_BY as "updatedBy"
FROM RR_SYNC_JOBS_MASTER
WHERE JOB_MASTER_ID = :id'
    );
    COMMIT;
END;
/

-- =====================================================
-- 5. GET ACTIVE JOBS BY MODULE
-- =====================================================

BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'rr',
        p_pattern        => 'sync/jobs/master/active',
        p_method         => 'GET',
        p_source_type    => ORDS.source_type_query,
        p_source         =>
'SELECT
    JOB_MASTER_ID as "jobMasterId",
    MODULE as "module",
    JOB_NAME as "jobName",
    JOB_CODE as "jobCode",
    SOURCE_ENDPOINT as "sourceEndpoint",
    DESCRIPTION as "description"
FROM RR_SYNC_JOBS_MASTER
WHERE IS_ACTIVE = ''Y''
    AND (:module IS NULL OR MODULE = :module)
ORDER BY SORT_ORDER, MODULE, JOB_NAME'
    );
    COMMIT;
END;
/

PROMPT
PROMPT =====================================================
PROMPT RR Sync Jobs Master Handlers Created Successfully!
PROMPT =====================================================
PROMPT
PROMPT Available Endpoints:
PROMPT POST   /ords/r/wksp_graysapp/rr/sync/jobs/master
PROMPT GET    /ords/r/wksp_graysapp/rr/sync/jobs/master?module=GL&is_active=Y&limit=100
PROMPT GET    /ords/r/wksp_graysapp/rr/sync/jobs/master/:id
PROMPT GET    /ords/r/wksp_graysapp/rr/sync/jobs/master/active?module=GL
PROMPT
PROMPT Test POST Request:
PROMPT {
PROMPT   "module": "AP",
PROMPT   "jobName": "AP Invoices",
PROMPT   "jobCode": "AP_INVOICES",
PROMPT   "sourceEndpoint": "/fscmRestApi/resources/11.13.18.05/invoices",
PROMPT   "apiType": "REST",
PROMPT   "httpMethod": "GET",
PROMPT   "description": "Sync AP Invoices from Oracle Fusion",
PROMPT   "isActive": "Y"
PROMPT }
PROMPT =====================================================

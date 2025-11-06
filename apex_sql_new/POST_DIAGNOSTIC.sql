-- DIAGNOSTIC: Find out exactly where the error occurs
-- This will tell us if the issue is BLOB->CLOB or JSON parsing

DECLARE
    v_body_blob BLOB;
    v_body_clob CLOB;
    v_dest_offset INTEGER := 1;
    v_src_offset INTEGER := 1;
    v_lang_context INTEGER := DBMS_LOB.DEFAULT_LANG_CTX;
    v_warning INTEGER;
    v_step VARCHAR2(100) := 'START';
    v_error_msg VARCHAR2(4000);
BEGIN
    -- STEP 1: Read BLOB
    BEGIN
        v_step := 'Reading :body BLOB';
        v_body_blob := :body;
        v_step := 'BLOB read OK - length: ' || DBMS_LOB.GETLENGTH(v_body_blob);
    EXCEPTION WHEN OTHERS THEN
        HTP.p('{"error":"' || v_step || ' - ' || SQLERRM || '"}');
        RETURN;
    END;

    -- STEP 2: Create temp CLOB
    BEGIN
        v_step := 'Creating temporary CLOB';
        DBMS_LOB.CREATETEMPORARY(v_body_clob, TRUE);
        v_step := 'Temporary CLOB created OK';
    EXCEPTION WHEN OTHERS THEN
        HTP.p('{"error":"' || v_step || ' - ' || SQLERRM || '"}');
        RETURN;
    END;

    -- STEP 3: Convert BLOB to CLOB
    BEGIN
        v_step := 'Converting BLOB to CLOB';
        DBMS_LOB.CONVERTTOCLOB(
            dest_lob => v_body_clob,
            src_blob => v_body_blob,
            amount => DBMS_LOB.LOBMAXSIZE,
            dest_offset => v_dest_offset,
            src_offset => v_src_offset,
            blob_csid => DBMS_LOB.DEFAULT_CSID,
            lang_context => v_lang_context,
            warning => v_warning
        );
        v_step := 'BLOB->CLOB OK - CLOB length: ' || DBMS_LOB.GETLENGTH(v_body_clob) || ', warning: ' || v_warning;
    EXCEPTION WHEN OTHERS THEN
        HTP.p('{"error":"' || v_step || ' - ' || SQLERRM || '"}');
        DBMS_LOB.FREETEMPORARY(v_body_clob);
        RETURN;
    END;

    -- STEP 4: Try APEX_JSON.parse
    BEGIN
        v_step := 'Parsing with APEX_JSON';
        APEX_JSON.parse(v_body_clob);
        v_step := 'APEX_JSON.parse OK';
    EXCEPTION WHEN OTHERS THEN
        v_error_msg := SQLERRM;
        -- Don't return yet, try JSON_OBJECT_T
    END;

    -- STEP 5: Try JSON_OBJECT_T if APEX_JSON failed
    IF v_step = 'Parsing with APEX_JSON' THEN
        BEGIN
            v_step := 'Parsing with JSON_OBJECT_T';
            DECLARE
                v_json_obj JSON_OBJECT_T;
            BEGIN
                v_json_obj := JSON_OBJECT_T.parse(v_body_clob);
                v_step := 'JSON_OBJECT_T.parse OK';
            END;
        EXCEPTION WHEN OTHERS THEN
            -- Both failed
            DBMS_LOB.FREETEMPORARY(v_body_clob);
            HTP.p('{"error":"APEX_JSON failed: ' || v_error_msg || ', JSON_OBJECT_T failed: ' || SQLERRM || '"}');
            RETURN;
        END;
    END IF;

    -- STEP 6: Try APEX_UTIL.BLOB_TO_CLOB
    DECLARE
        v_apex_util_clob CLOB;
    BEGIN
        v_step := 'Testing APEX_UTIL.BLOB_TO_CLOB';
        v_apex_util_clob := APEX_UTIL.BLOB_TO_CLOB(v_body_blob);
        v_step := 'APEX_UTIL.BLOB_TO_CLOB OK - length: ' || LENGTH(v_apex_util_clob);
    EXCEPTION WHEN OTHERS THEN
        v_step := 'APEX_UTIL.BLOB_TO_CLOB FAILED: ' || SQLERRM;
    END;

    -- Clean up
    DBMS_LOB.FREETEMPORARY(v_body_clob);

    -- Return diagnostic results
    HTP.p('{');
    HTP.p('"success":true,');
    HTP.p('"diagnostic":"All conversion steps completed",');
    HTP.p('"lastStep":"' || v_step || '",');
    HTP.p('"blobLength":' || DBMS_LOB.GETLENGTH(v_body_blob) || ',');
    HTP.p('"conversionWarning":' || v_warning);
    HTP.p('}');

EXCEPTION
    WHEN OTHERS THEN
        HTP.p('{"error":"Unexpected error at step: ' || v_step || ' - ' || SQLERRM || '"}');
END;

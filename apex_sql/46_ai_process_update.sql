-- ============================================================
-- WMS AI PROCESSES - UPDATE WEBSERVICE
-- ============================================================
-- Dedicated endpoint to update one field of a trained process
-- (e.g. append a new validation) without composing SQL.
--
-- STEP 1: run the procedure below (SQL Workshop > SQL Commands).
-- STEP 2: create the REST handler:
--   Module:        WAREHOUSEMANAGEMENT
--   URI Template:  ai/process/update
--   Method:        POST
--   Source Type:   PL/SQL
--   Source:        BEGIN wms_ai_process_update(:body_text); END;
--
-- Request body:
-- {
--   "processKey": "order.creation",
--   "field":      "validations",     -- one of: name, trigger_phrases,
--                                    -- pipeline_stages, data_sources,
--                                    -- validations, interfaces, steps,
--                                    -- lookups, active
--   "mode":       "append",          -- append (new line) | replace
--   "text":       "Discount above 15% requires manager approval.",
--   "updatedBy":  "JAVEED"
-- }
--
-- Response: { success, processKey, field, mode, newLength } or
--           { success:false, error }
-- ============================================================

CREATE OR REPLACE PROCEDURE wms_ai_process_update (
    p_body IN CLOB
) IS
    v_key     VARCHAR2(100);
    v_field   VARCHAR2(30);
    v_mode    VARCHAR2(10);
    v_text    CLOB;
    v_by      VARCHAR2(100);
    v_len     NUMBER;
    v_count   NUMBER;

    PROCEDURE respond_error (p_msg IN VARCHAR2) IS
    BEGIN
        APEX_JSON.open_object;
        APEX_JSON.write('success', FALSE);
        APEX_JSON.write('error',   p_msg);
        APEX_JSON.close_object;
    END respond_error;
BEGIN
    APEX_JSON.parse(p_body);
    v_key   := APEX_JSON.get_varchar2('processKey');
    v_field := LOWER(NVL(APEX_JSON.get_varchar2('field'), ''));
    v_mode  := LOWER(NVL(APEX_JSON.get_varchar2('mode'), 'append'));
    v_text  := APEX_JSON.get_clob('text');
    v_by    := NVL(APEX_JSON.get_varchar2('updatedBy'), 'API');

    IF v_key IS NULL THEN respond_error('processKey is required'); RETURN; END IF;
    IF v_text IS NULL OR DBMS_LOB.GETLENGTH(v_text) = 0 THEN respond_error('text is required'); RETURN; END IF;
    IF v_mode NOT IN ('append', 'replace') THEN respond_error('mode must be append or replace'); RETURN; END IF;
    IF v_field NOT IN ('name','trigger_phrases','pipeline_stages','data_sources',
                       'validations','interfaces','steps','lookups','active') THEN
        respond_error('field must be one of: name, trigger_phrases, pipeline_stages, data_sources, validations, interfaces, steps, lookups, active');
        RETURN;
    END IF;

    SELECT COUNT(*) INTO v_count FROM wms_ai_processes WHERE process_key = v_key;
    IF v_count = 0 THEN respond_error('No process with process_key = ' || v_key); RETURN; END IF;

    -- field name comes from the whitelist above, never from raw input
    IF v_mode = 'replace' THEN
        EXECUTE IMMEDIATE
            'UPDATE wms_ai_processes SET ' || v_field || ' = :t, updated_by = :b, updated_on = SYSDATE WHERE process_key = :k'
            USING v_text, v_by, v_key;
    ELSE
        EXECUTE IMMEDIATE
            'UPDATE wms_ai_processes SET ' || v_field ||
            ' = CASE WHEN ' || v_field || ' IS NULL THEN :t ELSE ' || v_field || ' || CHR(10) || :t2 END, ' ||
            'updated_by = :b, updated_on = SYSDATE WHERE process_key = :k'
            USING v_text, v_text, v_by, v_key;
    END IF;

    EXECUTE IMMEDIATE
        'SELECT NVL(DBMS_LOB.GETLENGTH(TO_CLOB(' || v_field || ')), 0) FROM wms_ai_processes WHERE process_key = :k'
        INTO v_len USING v_key;

    COMMIT;

    APEX_JSON.open_object;
    APEX_JSON.write('success',    TRUE);
    APEX_JSON.write('processKey', v_key);
    APEX_JSON.write('field',      v_field);
    APEX_JSON.write('mode',       v_mode);
    APEX_JSON.write('newLength',  v_len);
    APEX_JSON.close_object;
EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        respond_error(SQLERRM);
END wms_ai_process_update;
/

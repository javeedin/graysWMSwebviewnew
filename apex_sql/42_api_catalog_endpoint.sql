-- ============================================================
-- WMS API CATALOG - APEX REST HANDLER (for AI Digital Employee)
-- ============================================================
-- Lists EVERY ORDS REST API defined in this workspace schema:
--   module, method, URI template, full URL, source type,
--   URI parameters, declared parameters, query-string binds,
--   and the JSON body fields a POST/PUT handler reads.
-- The AI Digital Employee fetches this catalog once and uses it
-- as its API registry, so new endpoints are picked up with no
-- code change.
--
-- Data comes from the ORDS metadata views owned by the parsing
-- schema: user_ords_modules, user_ords_templates,
-- user_ords_handlers, user_ords_parameters.
--
-- In APEX RESTful Services:
--   Module:        ARMODULE            (or any existing module)
--   URI Template:  ai/apicatalog
--   Method:        GET
--   Source Type:   PL/SQL
--
-- Optional query-string parameters:
--   ?p_module=TRIPMANAGEMENT   only that module
--   ?p_source=Y                include handler source (first 4000 chars)
--
-- Test:
--   GET https://<host>/ords/WKSP_GRAYSAPP/ARMODULE/ai/apicatalog
-- ============================================================

DECLARE
    v_base_url      VARCHAR2(200) := 'https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/';
    v_filter_module VARCHAR2(100) := UPPER(:p_module);
    v_with_source   VARCHAR2(1)   := NVL(UPPER(:p_source), 'N');

    v_src           VARCHAR2(32767);
    v_bind          VARCHAR2(200);
    v_i             PLS_INTEGER;
    v_count         PLS_INTEGER := 0;

    TYPE t_seen IS TABLE OF BOOLEAN INDEX BY VARCHAR2(200);
    v_seen          t_seen;

    -- Binds that are ORDS implicit parameters, not caller inputs
    FUNCTION is_reserved(p_name VARCHAR2) RETURN BOOLEAN IS
    BEGIN
        RETURN UPPER(p_name) IN ('BODY', 'BODY_TEXT', 'CONTENT_TYPE', 'STATUS_CODE',
                                 'FORWARD_LOCATION', 'CURRENT_USER', 'FETCH_OFFSET',
                                 'FETCH_SIZE', 'PAGE_OFFSET', 'PAGE_SIZE', 'ROW_COUNT');
    END;
BEGIN
    OWA_UTIL.mime_header('application/json', TRUE);

    APEX_JSON.open_object;
    APEX_JSON.write('baseUrl', v_base_url);
    APEX_JSON.write('generatedAt', TO_CHAR(SYSTIMESTAMP, 'YYYY-MM-DD"T"HH24:MI:SS'));
    APEX_JSON.open_array('items');

    FOR m IN (
        SELECT id, name, uri_prefix
          FROM user_ords_modules
         WHERE v_filter_module IS NULL OR UPPER(name) = v_filter_module
         ORDER BY name
    ) LOOP
        FOR t IN (
            SELECT id, uri_template
              FROM user_ords_templates
             WHERE module_id = m.id
             ORDER BY uri_template
        ) LOOP
            FOR h IN (
                SELECT id, method, source_type, source
                  FROM user_ords_handlers
                 WHERE template_id = t.id
                 ORDER BY method
            ) LOOP
                v_count := v_count + 1;
                v_src   := DBMS_LOB.substr(h.source, 32000, 1);

                APEX_JSON.open_object;
                APEX_JSON.write('module',      m.name);
                APEX_JSON.write('method',      h.method);
                APEX_JSON.write('uriTemplate', m.uri_prefix || t.uri_template);
                APEX_JSON.write('fullUrl',     v_base_url || m.uri_prefix || t.uri_template);
                APEX_JSON.write('sourceType',  h.source_type);

                -- URI parameters (":xxx" segments of the template)
                APEX_JSON.open_array('uriParameters');
                v_i := 1;
                LOOP
                    v_bind := REGEXP_SUBSTR(t.uri_template, ':([A-Za-z_][A-Za-z0-9_]*)', 1, v_i, NULL, 1);
                    EXIT WHEN v_bind IS NULL;
                    APEX_JSON.write(v_bind);
                    v_i := v_i + 1;
                END LOOP;
                APEX_JSON.close_array;

                -- Parameters declared on the handler in ORDS
                APEX_JSON.open_array('declaredParameters');
                FOR p IN (
                    SELECT name, bind_variable_name, source_type, param_type, access_method
                      FROM user_ords_parameters
                     WHERE handler_id = h.id
                     ORDER BY name
                ) LOOP
                    APEX_JSON.open_object;
                    APEX_JSON.write('name',         p.name);
                    APEX_JSON.write('bindVariable', p.bind_variable_name);
                    APEX_JSON.write('in',           p.source_type);   -- URI / HEADER / RESPONSE
                    APEX_JSON.write('dataType',     p.param_type);
                    APEX_JSON.write('direction',    p.access_method); -- IN / OUT / INOUT
                    APEX_JSON.close_object;
                END LOOP;
                APEX_JSON.close_array;

                -- Bind variables referenced in the handler source that are not
                -- URI parameters: for GET these are query-string parameters,
                -- for POST/PUT they usually come from the parsed body
                APEX_JSON.open_array('sourceBinds');
                v_seen.DELETE;
                v_i := 1;
                LOOP
                    v_bind := REGEXP_SUBSTR(v_src, ':([A-Za-z_][A-Za-z0-9_]*)', 1, v_i, NULL, 1);
                    EXIT WHEN v_bind IS NULL;
                    IF NOT v_seen.EXISTS(UPPER(v_bind))
                       AND NOT is_reserved(v_bind)
                       AND INSTR(':' || LOWER(t.uri_template) || '/', ':' || LOWER(v_bind) || '/') = 0
                    THEN
                        v_seen(UPPER(v_bind)) := TRUE;
                        APEX_JSON.write(v_bind);
                    END IF;
                    v_i := v_i + 1;
                END LOOP;
                APEX_JSON.close_array;

                -- JSON body fields a PL/SQL handler reads via APEX_JSON.get_*('field')
                APEX_JSON.open_array('jsonBodyFields');
                v_seen.DELETE;
                v_i := 1;
                LOOP
                    v_bind := REGEXP_SUBSTR(v_src,
                        'APEX_JSON\.get_[A-Za-z0-9_]+\s*\(\s*(p_path\s*=>\s*)?''([^'']+)''',
                        1, v_i, 'i', 2);
                    EXIT WHEN v_bind IS NULL;
                    IF NOT v_seen.EXISTS(v_bind) THEN
                        v_seen(v_bind) := TRUE;
                        APEX_JSON.write(v_bind);
                    END IF;
                    v_i := v_i + 1;
                END LOOP;
                APEX_JSON.close_array;

                APEX_JSON.write('readsBody',
                    CASE WHEN REGEXP_LIKE(v_src, ':body(_text)?', 'i') THEN 'Y' ELSE 'N' END);

                IF v_with_source = 'Y' THEN
                    APEX_JSON.write('source', SUBSTR(v_src, 1, 4000));
                END IF;

                APEX_JSON.close_object;
            END LOOP;
        END LOOP;
    END LOOP;

    APEX_JSON.close_array;
    APEX_JSON.write('count', v_count);
    APEX_JSON.close_object;
EXCEPTION
    WHEN OTHERS THEN
        APEX_JSON.open_object;
        APEX_JSON.write('error', SQLERRM);
        APEX_JSON.close_object;
END;

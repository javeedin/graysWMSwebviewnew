-- MINIMAL TEST: Just read and echo back the request body
-- This will confirm we can at least read the :body parameter

DECLARE
    v_body_blob BLOB;
    v_body_clob CLOB;
    v_dest_offset INTEGER := 1;
    v_src_offset INTEGER := 1;
    v_lang_context INTEGER := DBMS_LOB.DEFAULT_LANG_CTX;
    v_warning INTEGER;
    v_first_500_chars VARCHAR2(500);
BEGIN
    -- Read the BLOB
    v_body_blob := :body;

    -- Convert to CLOB
    DBMS_LOB.CREATETEMPORARY(v_body_clob, TRUE);
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

    -- Get first 500 characters
    v_first_500_chars := DBMS_LOB.SUBSTR(v_body_clob, 500, 1);

    -- Clean up
    DBMS_LOB.FREETEMPORARY(v_body_clob);

    -- Return what we received
    HTP.p('{');
    HTP.p('"success":true,');
    HTP.p('"message":"Body received successfully",');
    HTP.p('"bodyLength":' || DBMS_LOB.GETLENGTH(v_body_blob) || ',');
    HTP.p('"first500chars":"' || REPLACE(REPLACE(v_first_500_chars, '"', '\"'), CHR(10), '\n') || '"');
    HTP.p('}');

EXCEPTION
    WHEN OTHERS THEN
        HTP.p('{"success":false,"error":"' || REPLACE(SQLERRM, '"', '\"') || '"}');
END;

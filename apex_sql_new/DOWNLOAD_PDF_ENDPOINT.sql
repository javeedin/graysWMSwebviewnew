-- GET /monitor-printing/download-pdf?detailId=XXX&orderNumber=YYY
-- Downloads/retrieves PDF for a specific order

DECLARE
    v_detail_id NUMBER;
    v_order_number VARCHAR2(200);
    v_pdf_url VARCHAR2(4000);
    v_pdf_path VARCHAR2(1000);
    v_pdf_status VARCHAR2(50);
BEGIN
    -- Get parameters
    v_detail_id := TO_NUMBER(:detailId);
    v_order_number := :orderNumber;

    -- Validate parameters
    IF v_detail_id IS NULL OR v_order_number IS NULL THEN
        HTP.p('{"success":false,"error":"detailId and orderNumber parameters are required"}');
        RETURN;
    END IF;

    DBMS_OUTPUT.PUT_LINE('Download PDF for detailId: ' || v_detail_id || ', orderNumber: ' || v_order_number);

    -- Check current status
    BEGIN
        SELECT pdf_status, pdf_path
        INTO v_pdf_status, v_pdf_path
        FROM wms_monitor_printing_details
        WHERE detail_id = v_detail_id;

    EXCEPTION WHEN NO_DATA_FOUND THEN
        HTP.p('{"success":false,"error":"Order not found"}');
        RETURN;
    END;

    -- If PDF already downloaded, return existing path
    IF v_pdf_status = 'DOWNLOADED' AND v_pdf_path IS NOT NULL THEN
        v_pdf_url := v_pdf_path; -- Or construct full URL if needed
        HTP.p('{');
        HTP.p('"success":true,');
        HTP.p('"message":"PDF already downloaded",');
        HTP.p('"pdfUrl":"' || v_pdf_url || '",');
        HTP.p('"pdfPath":"' || v_pdf_path || '"');
        HTP.p('}');
        RETURN;
    END IF;

    -- Generate/download PDF
    -- THIS IS WHERE YOU CALL YOUR PDF GENERATION LOGIC
    -- Example: Call a procedure that generates the PDF or retrieves it from external system
    BEGIN
        -- Option 1: Generate PDF URL from order data
        -- v_pdf_url := 'https://your-pdf-server.com/pdfs/' || v_order_number || '.pdf';
        -- v_pdf_path := '/pdfs/' || v_order_number || '.pdf';

        -- Option 2: Call existing PDF generation procedure
        -- wms_generate_order_pdf(v_order_number, v_pdf_url, v_pdf_path);

        -- Option 3: Retrieve from APEX Reports or Jasper/Crystal Reports
        -- v_pdf_url := apex_util.get_print_document(...);

        -- TEMPORARY: Return a placeholder for testing
        v_pdf_url := 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf';
        v_pdf_path := '/temp/pdfs/' || v_order_number || '.pdf';

        -- Update status in database
        UPDATE wms_monitor_printing_details
        SET
            pdf_status = 'DOWNLOADED',
            pdf_path = v_pdf_path,
            download_attempts = NVL(download_attempts, 0) + 1,
            last_updated = SYSDATE
        WHERE detail_id = v_detail_id;

        COMMIT;

        -- Return success response
        HTP.p('{');
        HTP.p('"success":true,');
        HTP.p('"message":"PDF downloaded successfully",');
        HTP.p('"pdfUrl":"' || v_pdf_url || '",');
        HTP.p('"pdfPath":"' || v_pdf_path || '"');
        HTP.p('}');

    EXCEPTION WHEN OTHERS THEN
        -- Update error status
        UPDATE wms_monitor_printing_details
        SET
            pdf_status = 'FAILED',
            error_message = SUBSTR(SQLERRM, 1, 4000),
            download_attempts = NVL(download_attempts, 0) + 1,
            last_updated = SYSDATE
        WHERE detail_id = v_detail_id;

        COMMIT;

        HTP.p('{"success":false,"error":"PDF generation failed: ' || REPLACE(SQLERRM, '"', '\"') || '"}');
    END;

EXCEPTION
    WHEN OTHERS THEN
        HTP.p('{"success":false,"error":"Unexpected error: ' || REPLACE(SQLERRM, '"', '\"') || '"}');
END;

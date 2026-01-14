-- ========================================
-- NEW PROCEDURE: GET ALL PRINTERS
-- ========================================
-- This procedure returns ALL printer configurations
-- (not just the active one) for the printer management page

CREATE OR REPLACE PROCEDURE wms_get_all_printers (
    p_cursor OUT SYS_REFCURSOR
) AS
BEGIN
    OPEN p_cursor FOR
    SELECT
        config_id,
        printer_name,
        paper_size,
        orientation,
        fusion_instance,
        fusion_username,
        fusion_password,
        auto_download,
        auto_print,
        is_active,
        created_date,
        modified_date,
        created_by,
        modified_by
    FROM wms_printer_config
    ORDER BY
        CASE WHEN is_active = 'Y' THEN 0 ELSE 1 END,  -- Active printers first
        created_date DESC;
END wms_get_all_printers;
/


-- ========================================
-- NEW PROCEDURE: SET ACTIVE PRINTER
-- ========================================
-- This procedure sets a specific printer as active
-- and deactivates all others

CREATE OR REPLACE PROCEDURE wms_set_active_printer (
    p_config_id         IN NUMBER,
    p_result            OUT VARCHAR2
) AS
    v_count NUMBER;
BEGIN
    -- Check if printer exists
    SELECT COUNT(*) INTO v_count
    FROM wms_printer_config
    WHERE config_id = p_config_id;

    IF v_count = 0 THEN
        p_result := 'ERROR: Printer not found';
        RETURN;
    END IF;

    -- Deactivate all printers
    UPDATE wms_printer_config
    SET is_active = 'N',
        modified_by = USER,
        modified_date = SYSDATE
    WHERE is_active = 'Y';

    -- Activate the specified printer
    UPDATE wms_printer_config
    SET is_active = 'Y',
        modified_by = USER,
        modified_date = SYSDATE
    WHERE config_id = p_config_id;

    COMMIT;
    p_result := 'SUCCESS';

EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        p_result := 'ERROR: ' || SQLERRM;
END wms_set_active_printer;
/


-- ========================================
-- NEW PROCEDURE: DELETE PRINTER
-- ========================================
-- This procedure deletes a printer configuration

CREATE OR REPLACE PROCEDURE wms_delete_printer (
    p_config_id         IN NUMBER,
    p_result            OUT VARCHAR2
) AS
    v_count NUMBER;
    v_is_active VARCHAR2(1);
BEGIN
    -- Check if printer exists and get its status
    SELECT COUNT(*), MAX(is_active) INTO v_count, v_is_active
    FROM wms_printer_config
    WHERE config_id = p_config_id;

    IF v_count = 0 THEN
        p_result := 'ERROR: Printer not found';
        RETURN;
    END IF;

    -- Don't allow deleting the active printer
    IF v_is_active = 'Y' THEN
        p_result := 'ERROR: Cannot delete active printer. Please set another printer as active first.';
        RETURN;
    END IF;

    -- Delete the printer
    DELETE FROM wms_printer_config
    WHERE config_id = p_config_id;

    COMMIT;
    p_result := 'SUCCESS';

EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        p_result := 'ERROR: ' || SQLERRM;
END wms_delete_printer;
/


-- ========================================
-- SHOW COMPILATION ERRORS
-- ========================================
SHOW ERRORS;

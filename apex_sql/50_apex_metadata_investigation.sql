-- ============================================================
-- APEX METADATA INVESTIGATION - reverse-engineering study
-- ============================================================
-- Oracle APEX stores every app, page, region, item, LOV,
-- validation, process and dynamic action in DOCUMENTED read-only
-- dictionary views (APEX_*). This script walks them so we can:
--   1) mine APEX's model for ideas for the WMS Forms Designer
--   2) build an "Import from APEX page" feature that converts an
--      existing APEX page into a WMS_AI_FORMS definition draft
--
-- HOW TO RUN (SQL Workshop > SQL Commands):
--   - Run STEP 0..2 as-is.
--   - For STEP 3, first replace the two placeholders below with a
--     real application id and a form-heavy page id from step 2:
--         :APP_ID   -> e.g. 100
--         :PAGE_ID  -> e.g. 12
--     (SQL Commands prompts for binds; or edit the literals in.)
--   - Paste the result grids (or screenshots) back to Claude.
--
-- NOTE: we deliberately use only the supported APEX_* dictionary
-- views. The internal APEX_nnnnnn.WWV_FLOW_* tables are
-- undocumented and must not be touched. View names can shift
-- slightly between APEX versions - if one errors, find its exact
-- name in the STEP 0 output.
-- ============================================================

-- ── STEP 0: which APEX dictionary views exist here ──────────
SELECT DISTINCT apex_view_name
FROM apex_dictionary
ORDER BY 1;

-- ── STEP 1: your applications ───────────────────────────────
SELECT application_id, application_name, pages, application_group
FROM apex_applications
ORDER BY application_id;

-- ── STEP 2: pages of the app to study ───────────────────────
-- pick a form-heavy app from step 1
SELECT page_id, page_name, page_mode, page_function
FROM apex_application_pages
WHERE application_id = :APP_ID
ORDER BY page_id;

-- ============================================================
-- STEP 3: deep dive on ONE representative form page
-- ============================================================

-- 3a. Regions - the layout containers (our tabs/sections/grids)
SELECT region_name, source_type, display_sequence, parent_region_id,
       template, SUBSTR(region_source, 1, 200) AS region_source_snippet
FROM apex_application_page_regions
WHERE application_id = :APP_ID AND page_id = :PAGE_ID
ORDER BY display_sequence;

-- 3b. Items - the fields (the most important query)
SELECT item_name, display_as, label, display_sequence, region,
       is_required, item_default, format_mask,
       SUBSTR(lov_definition, 1, 200) AS lov_definition,
       lov_display_null, SUBSTR(source, 1, 120) AS source, source_type,
       read_only_condition_type, condition_type,
       SUBSTR(condition_expression1, 1, 120) AS condition_expr1
FROM apex_application_page_items
WHERE application_id = :APP_ID AND page_id = :PAGE_ID
ORDER BY display_sequence;

-- 3c. Buttons
SELECT button_name, label, button_position, button_action,
       display_sequence, condition_type,
       SUBSTR(condition_expression1, 1, 120) AS condition_expr1
FROM apex_application_page_buttons
WHERE application_id = :APP_ID AND page_id = :PAGE_ID
ORDER BY display_sequence;

-- 3d. Validations (our submitChecks)
SELECT validation_name, validation_type,
       SUBSTR(validation_expression1, 1, 200) AS expr1,
       error_message, associated_item
FROM apex_application_page_val
WHERE application_id = :APP_ID AND page_id = :PAGE_ID;

-- 3e. Processes - what Save actually executes (our actions)
SELECT process_name, process_type, process_point,
       SUBSTR(process_source, 1, 200) AS source_snippet
FROM apex_application_page_proc
WHERE application_id = :APP_ID AND page_id = :PAGE_ID
ORDER BY execution_sequence;

-- 3f. Dynamic actions - their showWhen / valueSql equivalent
SELECT da.dynamic_action_name, da.dynamic_action_event, da.when_element,
       act.action_name, act.affected_elements
FROM apex_application_page_da da
JOIN apex_application_page_da_acts act
  ON act.dynamic_action_id = da.dynamic_action_id
WHERE da.application_id = :APP_ID AND da.page_id = :PAGE_ID;

-- 3g. Shared LOVs - the reusable list library (worth copying)
SELECT list_of_values_name, source_type,
       SUBSTR(list_of_values_query, 1, 200) AS lov_query
FROM apex_application_lovs
WHERE application_id = :APP_ID;

-- 3h. Interactive Report columns (if the page has an IR)
SELECT report_label, column_alias, display_text_as, display_order
FROM apex_application_page_ir_col
WHERE application_id = :APP_ID AND page_id = :PAGE_ID
ORDER BY display_order;

-- 3i. Interactive Grid columns (if the page has an IG - the
--     master-detail grid, our "details" blocks)
SELECT name, heading, item_type, display_sequence, is_visible,
       is_query_only, source_expression
FROM apex_appl_page_ig_columns
WHERE application_id = :APP_ID AND page_id = :PAGE_ID
ORDER BY display_sequence;

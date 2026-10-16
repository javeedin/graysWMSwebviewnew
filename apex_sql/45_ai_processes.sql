-- ============================================================
-- WMS AI DIGITAL EMPLOYEE - TRAINED PROCESSES (knowledge base)
-- ============================================================
-- One row = one trained business process. The bot queries this
-- table at the start of any operational request (runtime lookup,
-- zero code changes per process) and follows the row's data
-- sources, validations, pipeline, steps and interfaces.
--
-- INTERFACES field - one per line, typed:
--   form:   <apiId>                the app form to open (e.g. order.create)
--   ords:   <METHOD> <path>        APEX ORDS endpoint (e.g. POST /ORDERCRATION/NEWORDER)
--   fusion: <METHOD> <path>        Oracle Fusion REST (approval-carded)
--   sql:    <what>                 direct DML/DDL via the guarded db_write flow
--
-- VALIDATIONS field - plain-language rules; a rule may attach a
-- deterministic check on its own line starting with CHECK_SQL:
-- (a SELECT that must return >= 1 row for the rule to PASS).
--
-- Run in SQL Workshop. Maintain rows via SQL (or the future
-- Train tab UI); changes take effect on the bot's next question.
-- ============================================================

CREATE TABLE wms_ai_processes (
    id              NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    process_key     VARCHAR2(100)  NOT NULL UNIQUE,
    name            VARCHAR2(200)  NOT NULL,
    process_type    VARCHAR2(20)   DEFAULT 'ACTION' NOT NULL,  -- FORM / REPORT / ACTION / PIPELINE
    trigger_phrases VARCHAR2(1000),
    pipeline_stages VARCHAR2(1000),
    data_sources    CLOB,
    validations     CLOB,
    interfaces      CLOB,
    steps           CLOB,
    lookups         CLOB,          -- pinned lookup SQL for forms (optional)
    active          VARCHAR2(1)    DEFAULT 'Y' NOT NULL,
    created_by      VARCHAR2(100)  DEFAULT USER,
    created_on      DATE           DEFAULT SYSDATE,
    updated_by      VARCHAR2(100),
    updated_on      DATE
);

-- ── Trained process #1: Sales order creation ────────────────
INSERT INTO wms_ai_processes (
    process_key, name, process_type, trigger_phrases, pipeline_stages,
    data_sources, validations, interfaces, steps, active
) VALUES (
    'order.creation',
    'Create Sales Order',
    'FORM',
    'create order, new order, sales order, order entry, book an order',
    'Find customer -> Validate -> Order entry form -> Create -> Verify',
    'customers = table GRFU_CUSTOMER (ACCOUNT_NAME, ACCOUNT_NUMBER, CITY, PRICE_LIST, STATUS, CUST_ACCOUNT_ID, PARTY_ID, BILL_TO_SITE_USE_ID, SHIP_TO_PARTY_SITE_ID). Never use the table named CUSTOMER.' || CHR(10) ||
    'items = the customer''s price list items (price list name from GRFU_CUSTOMER.PRICE_LIST).' || CHR(10) ||
    'salesreps / order types / warehouses / subinventories = distinct values from the order metadata tables in the schema catalog.',
    'Customer STATUS must be active - refuse with the reason if not.' || CHR(10) ||
    'CHECK_SQL: SELECT 1 FROM grfu_customer WHERE account_number = ''{customer_account}'' AND UPPER(NVL(status,''ACTIVE'')) LIKE ''A%''' || CHR(10) ||
    'Every line item must exist on the customer''s price list - list rejected items, never include them silently.' || CHR(10) ||
    'Quantity must be > 0 on every line.' || CHR(10) ||
    'Order date must not be in the past by more than 7 days.',
    'form:   order.create' || CHR(10) ||
    'ords:   POST /ORDERCRATION/NEWORDER            (option 1 - save to WMS DB, interfaced to Fusion later)' || CHR(10) ||
    'fusion: POST /fscmRestApi/resources/11.13.18.05/salesOrdersForOrderHub   (option 2 - direct, GRAYS payload from templates/fusion-order-template.json)',
    '1. Identify the customer (grid pick from GRFU_CUSTOMER when ambiguous; ask for a fragment when nothing given).' || CHR(10) ||
    '2. Run the validations above; stop and report any failure.' || CHR(10) ||
    '3. Open the order entry form (api_form order.create) prefilled with customer ids, price list, and any requested lines with prices.' || CHR(10) ||
    '4. The user completes the form and picks the route (Save to WMS DB / Direct Fusion) - respect their choice.' || CHR(10) ||
    '5. Verify the result and confirm with the order/reference number.',
    'Y'
);

COMMIT;

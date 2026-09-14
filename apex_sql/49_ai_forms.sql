-- ============================================================
-- WMS FORMS DESIGNER - DB-STORED FORM DEFINITIONS
-- ============================================================
-- One row = one form. The definition column holds the ENTIRE
-- form as one JSON document: header fields (with SQL lists,
-- dependent lists, search pickers), detail grids (master-detail,
-- computed columns, totals, line rules like BOGO), validations,
-- and buttons linked to actions (ords POST/GET, guarded sql
-- write, Save Local file, hand to AI chat, close).
--
-- Rendered by formsdesigner/form-engine.js (WMSFormEngine).
-- Designed in the Forms Designer module, or by the AI Digital
-- Employee ("build me a goods return form with...").
-- Changes take effect immediately - no app rebuild.
--
-- Run in SQL Workshop > SQL Commands.
-- ============================================================

CREATE TABLE wms_ai_forms (
    id           NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    form_key     VARCHAR2(100)  NOT NULL UNIQUE,
    name         VARCHAR2(200)  NOT NULL,
    description  VARCHAR2(1000),
    definition   CLOB           NOT NULL,   -- the full form as JSON
    active       VARCHAR2(1)    DEFAULT 'Y' NOT NULL,
    created_by   VARCHAR2(100)  DEFAULT USER,
    created_on   DATE           DEFAULT SYSDATE,
    updated_by   VARCHAR2(100),
    updated_on   DATE
);

-- ── Demo form: works out of the box (uses only GRFU_CUSTOMER) ──
-- Master-detail with a customer search picker, a dependent
-- readonly field, an editable lines grid with a computed column
-- and totals, one SQL validation, and Save Local / Close buttons.
INSERT INTO wms_ai_forms (form_key, name, description, definition, active)
VALUES (
    'demo.customer.request',
    'Customer Request (demo)',
    'Demo master-detail form - customer picker, editable lines, computed totals, validation, Save Local button.',
    '{
  "title": "Customer Request",
  "icon": "clipboard-list",
  "width": 950,
  "header": {
    "columns": 4,
    "fields": [
      { "key": "request_date", "label": "Date", "type": "date", "default": "$TODAY", "required": true },
      { "key": "customer", "label": "Customer", "type": "picker", "required": true,
        "pickerSql": "SELECT ACCOUNT_NAME, ACCOUNT_NUMBER, CITY, PRICE_LIST FROM GRFU_CUSTOMER WHERE (UPPER(ACCOUNT_NAME) LIKE :SEARCH OR UPPER(ACCOUNT_NUMBER) LIKE :SEARCH) ORDER BY ACCOUNT_NAME FETCH FIRST 50 ROWS ONLY",
        "display": "ACCOUNT_NAME",
        "map": { "customer": "ACCOUNT_NAME", "account_number": "ACCOUNT_NUMBER", "city": "CITY", "pricelist": "PRICE_LIST" } },
      { "key": "account_number", "label": "Account #", "type": "readonly" },
      { "key": "city", "label": "City", "type": "readonly" },
      { "key": "pricelist", "label": "Price list", "type": "readonly" },
      { "key": "priority", "label": "Priority", "type": "select",
        "options": [ "LOW", "NORMAL", "HIGH", "URGENT" ], "default": "NORMAL" },
      { "key": "reference", "label": "Reference", "type": "text" },
      { "key": "notes", "label": "Notes", "type": "textarea", "span": 4 }
    ]
  },
  "details": [
    { "key": "items", "title": "Requested Items", "allowManualRow": true, "allowDelete": true,
      "qtyKey": "qty", "required": true,
      "columns": [
        { "key": "item", "label": "Item", "type": "text", "editable": true, "width": 140 },
        { "key": "description", "label": "Description", "type": "text", "editable": true, "width": 220 },
        { "key": "qty", "label": "Qty", "type": "number", "editable": true, "default": 1, "width": 70 },
        { "key": "price", "label": "Price", "type": "number", "editable": true, "width": 90 },
        { "key": "amount", "label": "Amount", "type": "computed", "formula": "qty * price" }
      ],
      "totals": [ "qty", "amount" ] }
  ],
  "rules": {
    "submitChecks": [
      { "sql": "SELECT 1 FROM GRFU_CUSTOMER WHERE ACCOUNT_NUMBER = :ACCOUNT_NUMBER AND UPPER(NVL(STATUS,''ACTIVE'')) LIKE ''A%''",
        "message": "The selected customer is not active.",
        "mode": "FAIL_IF_NO_ROWS" }
    ]
  },
  "actions": [
    { "key": "save_local", "label": "Save Local", "icon": "floppy-disk", "style": "primary",
      "type": "local_file", "validate": true,
      "folder": "forms", "fileName": "{FORM_KEY}_{account_number}_{TIMESTAMP}.json",
      "successMessage": "Request saved to C:\\fusion\\forms." },
    { "key": "close", "label": "Close", "type": "close", "style": "default" }
  ]
}',
    'Y'
);

COMMIT;

-- ============================================================
-- VERIFY:
--   1) Open the Forms Designer module - the demo form is listed.
--   2) Click Run - pick a customer, add lines, Save Local.
--   3) In AI chat: "open the customer request form" also works
--      once the exe carries prompt V38.
-- ============================================================

-- ============================================================
-- WMS AI CHAT - API OPERATION LOG
-- ============================================================
-- Every write API executed from the AI Analysis module (the APIs
-- tab or an api_form the chatbot opened) is logged here. The app
-- inserts rows directly through the existing ai/executewrite
-- endpoint (WMS_AI_EXECUTE_WRITE allows INSERT), so NO new
-- procedures or REST handlers are needed - just run this script.
--
-- Query it from the chatbot ("show my API runs today") or SQL:
--   SELECT * FROM wms_ai_api_log ORDER BY log_id DESC;
-- ============================================================

CREATE TABLE wms_ai_api_log (
    log_id        NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    api_id        VARCHAR2(100),                 -- catalog id, e.g. trips.create
    api_name      VARCHAR2(200),
    method        VARCHAR2(10),
    url           VARCHAR2(1000),
    request_body  VARCHAR2(4000),                -- truncated to fit
    http_status   NUMBER,
    success       CHAR(1) CHECK (success IN ('Y','N')),
    response_text VARCHAR2(4000),                -- truncated to fit
    instance      VARCHAR2(10),                  -- PROD / TEST
    source        VARCHAR2(20),                  -- CHAT / APIS_TAB
    invoked_by    VARCHAR2(100),
    created_date  DATE DEFAULT SYSDATE
);

COMMENT ON TABLE wms_ai_api_log IS 'Audit log of write webservice calls executed from the AI Analysis module (APIs tab and chatbot api_form). One row per run, including the request body sent and the response received.';
COMMENT ON COLUMN wms_ai_api_log.api_id IS 'Catalog id of the API, e.g. trips.create, trips.addorders';
COMMENT ON COLUMN wms_ai_api_log.source IS 'CHAT = run from a chatbot form, APIS_TAB = run manually from the APIs tab';

CREATE INDEX wms_ai_api_log_date_ix ON wms_ai_api_log (created_date);

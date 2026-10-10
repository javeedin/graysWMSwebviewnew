-- ============================================================
-- Finance Lens › Inter company — the APEX copy of the intercompany data (RR_IC_ tables)
-- ============================================================
-- The page (finance/fin-ic.js) creates these tables on first use through ai/executewrite and copies every month it
-- syncs from Oracle Fusion into them (DuckDB rr_ic_* on the PC → APEX, one month × kind at a time: DELETE, then
-- INSERT … SELECT … FROM dual UNION ALL). Run this script by hand only when the page cannot create them, or to start the
-- APEX copy afresh: step 1 DROPS the tables (their rows are gone — every PC still has its own copy in DuckDB, so the
-- board's "Copy n to APEX" fills them again), step 2 creates them with the current columns.
-- RR_IC_NOTES (notes people typed on unmatched items) is NOT dropped — remove the -- in front of it to drop it too.
--   RR_IC_SYNC      one row per pod × kind × month × scope (ledger, or *): rows read, total, query used, when / by whom, copied when
--   RR_IC_ENTITIES  legal entities (+ their companies = balancing segment values), business units, inventory organisations
--   RR_IC_FUN       Intercompany module transactions (initiator → recipient, AR / AP invoice numbers)
--   RR_IC_AR        receivables billed to a group company       RR_IC_AP   payables from a group company
--   RR_IC_INV       inventory transfers between legal entities RR_IC_GL   journal lines on intercompany accounts / segment
--   RR_IC_BAL       GL balances by company × account × counterparty per month (opening, debits, credits, closing)
--   RR_IC_XLA       subledger trace: the XLA accounting lines behind each intercompany GL line (task Subledger trace)
--   RR_IC_DOCS      subledger trace: one row per subledger document (AP invoice, AR transaction, receipt, cost event …)
--   RR_IC_LOG       every query each task ran (task, step, SQL, rows, ms, error)
--   RR_IC_NOTES     notes on unmatched items (OPEN / EXPLAINED / TO FIX), shared by every PC
-- pod = PROD / TEST / LOGGED-IN (the pod the app was logged in to). month = yyyymm (calendar month of the GL date).
-- ============================================================

-- ── 1 · drop (a table that does not exist is skipped) ──
BEGIN
    FOR t IN (SELECT table_name FROM user_tables
              WHERE table_name IN ('RR_IC_SYNC', 'RR_IC_ENTITIES', 'RR_IC_FUN', 'RR_IC_AR', 'RR_IC_AP', 'RR_IC_INV', 'RR_IC_GL',
                                   'RR_IC_BAL', 'RR_IC_XLA', 'RR_IC_DOCS', 'RR_IC_LOG'
                                   -- , 'RR_IC_NOTES'
                                   ))
    LOOP
        EXECUTE IMMEDIATE 'DROP TABLE ' || t.table_name || ' CASCADE CONSTRAINTS PURGE';
    END LOOP;
END;
/

-- ── 2 · create ──
CREATE TABLE rr_ic_sync (pod VARCHAR2(20) NOT NULL, kind VARCHAR2(10) NOT NULL, month NUMBER NOT NULL, scope VARCHAR2(40) NOT NULL, ok CHAR(1), rows_read NUMBER, total NUMBER, alt VARCHAR2(400), error VARCHAR2(4000), fetched_at DATE, fetched_by VARCHAR2(100), copied_at DATE DEFAULT SYSDATE, copied_by VARCHAR2(100), CONSTRAINT rr_ic_sync_pk PRIMARY KEY (pod, kind, month, scope));

CREATE TABLE rr_ic_entities (pod VARCHAR2(20), ent_type VARCHAR2(10), id VARCHAR2(40), code VARCHAR2(100), name VARCHAR2(400), le_id VARCHAR2(40), party_id VARCHAR2(40), ledger_id VARCHAR2(40), bu_id VARCHAR2(40), companies VARCHAR2(2000), fetched_at DATE);

CREATE TABLE rr_ic_fun (pod VARCHAR2(20), kind VARCHAR2(10), month NUMBER, scope VARCHAR2(40), src_id VARCHAR2(240), doc_number VARCHAR2(240), line_num NUMBER, doc_type VARCHAR2(240), doc_date VARCHAR2(240), gl_date VARCHAR2(240), status VARCHAR2(240), from_le VARCHAR2(240), from_bu VARCHAR2(240), from_org VARCHAR2(240), from_company VARCHAR2(240), to_le VARCHAR2(240), to_bu VARCHAR2(240), to_org VARCHAR2(240), to_company VARCHAR2(240), party_number VARCHAR2(240), party_name VARCHAR2(400), currency VARCHAR2(240), amount_entered NUMBER, amount NUMBER, account VARCHAR2(240), item VARCHAR2(400), quantity NUMBER, reference VARCHAR2(240), ref2 VARCHAR2(240), description VARCHAR2(1000), ledger_id VARCHAR2(240), fetched_at DATE);

CREATE TABLE rr_ic_ar (pod VARCHAR2(20), kind VARCHAR2(10), month NUMBER, scope VARCHAR2(40), src_id VARCHAR2(240), doc_number VARCHAR2(240), line_num NUMBER, doc_type VARCHAR2(240), doc_date VARCHAR2(240), gl_date VARCHAR2(240), status VARCHAR2(240), from_le VARCHAR2(240), from_bu VARCHAR2(240), from_org VARCHAR2(240), from_company VARCHAR2(240), to_le VARCHAR2(240), to_bu VARCHAR2(240), to_org VARCHAR2(240), to_company VARCHAR2(240), party_number VARCHAR2(240), party_name VARCHAR2(400), currency VARCHAR2(240), amount_entered NUMBER, amount NUMBER, account VARCHAR2(240), item VARCHAR2(400), quantity NUMBER, reference VARCHAR2(240), ref2 VARCHAR2(240), description VARCHAR2(1000), ledger_id VARCHAR2(240), fetched_at DATE);

CREATE TABLE rr_ic_ap (pod VARCHAR2(20), kind VARCHAR2(10), month NUMBER, scope VARCHAR2(40), src_id VARCHAR2(240), doc_number VARCHAR2(240), line_num NUMBER, doc_type VARCHAR2(240), doc_date VARCHAR2(240), gl_date VARCHAR2(240), status VARCHAR2(240), from_le VARCHAR2(240), from_bu VARCHAR2(240), from_org VARCHAR2(240), from_company VARCHAR2(240), to_le VARCHAR2(240), to_bu VARCHAR2(240), to_org VARCHAR2(240), to_company VARCHAR2(240), party_number VARCHAR2(240), party_name VARCHAR2(400), currency VARCHAR2(240), amount_entered NUMBER, amount NUMBER, account VARCHAR2(240), item VARCHAR2(400), quantity NUMBER, reference VARCHAR2(240), ref2 VARCHAR2(240), description VARCHAR2(1000), ledger_id VARCHAR2(240), fetched_at DATE);

CREATE TABLE rr_ic_inv (pod VARCHAR2(20), kind VARCHAR2(10), month NUMBER, scope VARCHAR2(40), src_id VARCHAR2(240), doc_number VARCHAR2(240), line_num NUMBER, doc_type VARCHAR2(240), doc_date VARCHAR2(240), gl_date VARCHAR2(240), status VARCHAR2(240), from_le VARCHAR2(240), from_bu VARCHAR2(240), from_org VARCHAR2(240), from_company VARCHAR2(240), to_le VARCHAR2(240), to_bu VARCHAR2(240), to_org VARCHAR2(240), to_company VARCHAR2(240), party_number VARCHAR2(240), party_name VARCHAR2(400), currency VARCHAR2(240), amount_entered NUMBER, amount NUMBER, account VARCHAR2(240), item VARCHAR2(400), quantity NUMBER, reference VARCHAR2(240), ref2 VARCHAR2(240), description VARCHAR2(1000), ledger_id VARCHAR2(240), fetched_at DATE);

CREATE TABLE rr_ic_gl (pod VARCHAR2(20), kind VARCHAR2(10), month NUMBER, scope VARCHAR2(40), src_id VARCHAR2(240), doc_number VARCHAR2(240), line_num NUMBER, doc_type VARCHAR2(240), doc_date VARCHAR2(240), gl_date VARCHAR2(240), status VARCHAR2(240), from_le VARCHAR2(240), from_bu VARCHAR2(240), from_org VARCHAR2(240), from_company VARCHAR2(240), to_le VARCHAR2(240), to_bu VARCHAR2(240), to_org VARCHAR2(240), to_company VARCHAR2(240), party_number VARCHAR2(240), party_name VARCHAR2(400), currency VARCHAR2(240), amount_entered NUMBER, amount NUMBER, account VARCHAR2(240), item VARCHAR2(400), quantity NUMBER, reference VARCHAR2(240), ref2 VARCHAR2(240), description VARCHAR2(1000), ledger_id VARCHAR2(240), fetched_at DATE);

CREATE TABLE rr_ic_bal (pod VARCHAR2(20), month NUMBER, scope VARCHAR2(40), ledger_id VARCHAR2(40), period_name VARCHAR2(30), company VARCHAR2(60), account VARCHAR2(60), ic_company VARCHAR2(60), currency VARCHAR2(15), opening NUMBER, dr NUMBER, cr NUMBER, closing NUMBER, fetched_at DATE);

CREATE TABLE rr_ic_xla (pod VARCHAR2(20), month NUMBER, scope VARCHAR2(40), gl_src_id VARCHAR2(240), link_id VARCHAR2(240), app_id VARCHAR2(240), ae_header_id VARCHAR2(240), ae_line_num VARCHAR2(240), event_id VARCHAR2(240), event_type VARCHAR2(240), entity_code VARCHAR2(240), source_id VARCHAR2(240), source_id2 VARCHAR2(240), transaction_number VARCHAR2(240), accounting_class VARCHAR2(240), party_type VARCHAR2(240), party_id VARCHAR2(240), currency VARCHAR2(240), entered NUMBER, accounted NUMBER, accounting_date VARCHAR2(240), description VARCHAR2(1000), from_company VARCHAR2(240), to_company VARCHAR2(240), account VARCHAR2(240), legal_entity_id VARCHAR2(240), je_category VARCHAR2(240), fetched_at DATE);

CREATE TABLE rr_ic_docs (pod VARCHAR2(20), month NUMBER, scope VARCHAR2(40), app_id VARCHAR2(240), app_name VARCHAR2(240), entity_code VARCHAR2(240), entity_name VARCHAR2(240), source_id VARCHAR2(240), doc_number VARCHAR2(240), doc_type VARCHAR2(240), doc_date VARCHAR2(240), party_number VARCHAR2(240), party_name VARCHAR2(400), currency VARCHAR2(240), doc_amount NUMBER, ic_amount NUMBER, from_company VARCHAR2(240), to_company VARCHAR2(240), org_id VARCHAR2(240), legal_entity_id VARCHAR2(240), status VARCHAR2(240), description VARCHAR2(1000), reference VARCHAR2(240), xla_lines NUMBER, detail VARCHAR2(240), fetched_at DATE);

CREATE TABLE rr_ic_log (pod VARCHAR2(20), run_id VARCHAR2(40), logged_at DATE, kind VARCHAR2(10), month NUMBER, scope VARCHAR2(40), step VARCHAR2(400), what VARCHAR2(400), sql VARCHAR2(4000), rows_read NUMBER, ms NUMBER, ok CHAR(1), error VARCHAR2(1000));

-- RR_IC_NOTES is kept: created only when it is not there yet
DECLARE n NUMBER;
BEGIN
    SELECT COUNT(*) INTO n FROM user_tables WHERE table_name = 'RR_IC_NOTES';
    IF n = 0 THEN
        EXECUTE IMMEDIATE 'CREATE TABLE rr_ic_notes (pod VARCHAR2(20) NOT NULL, kind VARCHAR2(10) NOT NULL, src_id VARCHAR2(100) NOT NULL, month NUMBER, status VARCHAR2(20), note VARCHAR2(2000), noted_by VARCHAR2(100), noted_at DATE DEFAULT SYSDATE, CONSTRAINT rr_ic_notes_pk PRIMARY KEY (pod, kind, src_id))';
    END IF;
END;
/

CREATE INDEX rr_ic_ar_m ON rr_ic_ar (pod, month);
CREATE INDEX rr_ic_ap_m ON rr_ic_ap (pod, month);
CREATE INDEX rr_ic_gl_m ON rr_ic_gl (pod, month);
CREATE INDEX rr_ic_bal_m ON rr_ic_bal (pod, month);
CREATE INDEX rr_ic_xla_m ON rr_ic_xla (pod, month);
CREATE INDEX rr_ic_docs_m ON rr_ic_docs (pod, month);
CREATE INDEX rr_ic_log_m ON rr_ic_log (pod, kind, month);

-- Check: what is in APEX per month
SELECT kind, month, COUNT(*) reads, SUM(rows_read) rows_read, MAX(copied_at) copied_at FROM rr_ic_sync GROUP BY kind, month ORDER BY month, kind;

-- Finance Lens: statement notes and the board pack archive.
-- The page creates these tables itself on first use (finance/fin-store.js, finance/fin-packarchive.js); run this by hand only to
-- create them up front. Reads through ai/executequery must not contain the refused words, so the text dates are VARCHAR2.

-- Notes on the statements: per period (scope PERIOD) or every period (GLOBAL), one statement or every statement ('*'), optional line.
-- A deleted note stays with removed = 'Y' so the deletion reaches every PC; rev says which copy is newer (this PC keeps fin_notes).
CREATE TABLE wms_fin_notes (
    note_id     VARCHAR2(60) NOT NULL,
    scope       VARCHAR2(10),
    period_seq  NUMBER,
    ledger_code VARCHAR2(100),
    company     VARCHAR2(150),
    template_id VARCHAR2(60),
    row_id      VARCHAR2(60),
    row_label   VARCHAR2(300),
    kind        VARCHAR2(20),
    title       VARCHAR2(300),
    body        CLOB,
    sort_no     NUMBER,
    rev         NUMBER,
    removed     CHAR(1) DEFAULT 'N',
    created_by  VARCHAR2(100),
    created_at  VARCHAR2(30),
    changed_by  VARCHAR2(100),
    changed_at  VARCHAR2(30),
    CONSTRAINT wms_fin_notes_pk PRIMARY KEY (note_id)
);

-- Board pack archive: the exact HTML the board received, its SHA-256, the headline figures and notes (model_json), the pack design,
-- status ISSUED / DRAFT / VOID, meeting date and comments. Records are never overwritten; an admin may void one with a reason.
CREATE TABLE wms_fin_pack_archive (
    archive_id   VARCHAR2(60) NOT NULL,
    pack_id      VARCHAR2(60),
    pack_name    VARCHAR2(200),
    title        VARCHAR2(300),
    company_name VARCHAR2(200),
    ledger_code  VARCHAR2(100),
    ledger_name  VARCHAR2(300),
    company      VARCHAR2(150),
    period_seq   NUMBER,
    period_name  VARCHAR2(30),
    filter_text  VARCHAR2(400),
    amounts_in   VARCHAR2(30),
    sha256       VARCHAR2(64),
    html_len     NUMBER,
    html         CLOB,
    model_json   CLOB,
    design_json  CLOB,
    status       VARCHAR2(10),
    meeting_date VARCHAR2(20),
    comments     VARCHAR2(4000),
    void_reason  VARCHAR2(1000),
    saved_by     VARCHAR2(100),
    saved_at     VARCHAR2(30),
    CONSTRAINT wms_fin_pack_archive_pk PRIMARY KEY (archive_id)
);

-- What happened to each archived pack: SAVED, DOWNLOADED, EMAILED (to whom, how), OPENED, VERIFIED, COMPARED, VOIDED.
CREATE TABLE wms_fin_pack_events (
    archive_id VARCHAR2(60) NOT NULL,
    event_at   VARCHAR2(30),
    event_by   VARCHAR2(100),
    event      VARCHAR2(20),
    detail     VARCHAR2(4000)
);
CREATE INDEX wms_fin_pack_events_ix ON wms_fin_pack_events (archive_id);

-- The seal (also installed by the page): once a pack's fingerprint is written (the last step of a save), its file, fingerprint and
-- figures cannot be changed and no pack can be deleted — an admin voids it instead (status / void_reason may change). Events are
-- append-only.
CREATE OR REPLACE TRIGGER wms_fin_pack_archive_seal
BEFORE UPDATE OR DELETE ON wms_fin_pack_archive FOR EACH ROW
BEGIN
    IF DELETING THEN
        RAISE_APPLICATION_ERROR(-20901, 'Archived board packs cannot be deleted - void them instead');
    END IF;
    IF :OLD.sha256 IS NOT NULL AND (UPDATING('HTML') OR UPDATING('SHA256') OR UPDATING('MODEL_JSON') OR UPDATING('DESIGN_JSON')
        OR UPDATING('SAVED_BY') OR UPDATING('SAVED_AT') OR UPDATING('PERIOD_SEQ') OR UPDATING('LEDGER_CODE')) THEN
        RAISE_APPLICATION_ERROR(-20902, 'This board pack is sealed: its file, fingerprint and figures cannot be changed');
    END IF;
END;
/
CREATE OR REPLACE TRIGGER wms_fin_pack_events_seal
BEFORE UPDATE OR DELETE ON wms_fin_pack_events FOR EACH ROW
BEGIN
    RAISE_APPLICATION_ERROR(-20903, 'Board pack events can only be added');
END;
/

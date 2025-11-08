-- ========================================
-- WMS TRIP MANAGEMENT - APEX DATABASE TABLES
-- ========================================
-- Created: 2025-11-05
-- Purpose: Store trip configurations and print jobs in APEX database
-- ========================================

-- ========================================
-- 1. PRINTER CONFIGURATION TABLE
-- ========================================
CREATE TABLE wms_printer_config (
    config_id           NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    printer_name        VARCHAR2(200),
    paper_size          VARCHAR2(50) DEFAULT 'A4',
    orientation         VARCHAR2(20) DEFAULT 'Portrait',
    fusion_instance     VARCHAR2(20) DEFAULT 'TEST',
    fusion_username     VARCHAR2(100),
    fusion_password     VARCHAR2(200), -- Consider encrypting in production
    auto_download       VARCHAR2(1) DEFAULT 'Y',
    auto_print          VARCHAR2(1) DEFAULT 'Y',
    is_active           VARCHAR2(1) DEFAULT 'Y',
    created_by          VARCHAR2(100) DEFAULT USER,
    created_date        DATE DEFAULT SYSDATE,
    modified_by         VARCHAR2(100),
    modified_date       DATE,
    CONSTRAINT chk_auto_download CHECK (auto_download IN ('Y', 'N')),
    CONSTRAINT chk_auto_print CHECK (auto_print IN ('Y', 'N')),
    CONSTRAINT chk_is_active CHECK (is_active IN ('Y', 'N'))
);

-- Create index for active config lookup
CREATE INDEX idx_printer_config_active ON wms_printer_config(is_active);

COMMENT ON TABLE wms_printer_config IS 'Stores printer configuration and Fusion credentials';
COMMENT ON COLUMN wms_printer_config.config_id IS 'Primary key - auto-generated';
COMMENT ON COLUMN wms_printer_config.printer_name IS 'Windows printer name';
COMMENT ON COLUMN wms_printer_config.fusion_instance IS 'TEST or PROD';
COMMENT ON COLUMN wms_printer_config.is_active IS 'Y=Active config, N=Inactive';


-- ========================================
-- 2. TRIP CONFIGURATION TABLE
-- ========================================
CREATE TABLE wms_trip_config (
    trip_config_id      NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    trip_id             VARCHAR2(50) NOT NULL,
    trip_date           DATE NOT NULL,
    auto_print_enabled  VARCHAR2(1) DEFAULT 'N',
    total_orders        NUMBER DEFAULT 0,
    downloaded_orders   NUMBER DEFAULT 0,
    printed_orders      NUMBER DEFAULT 0,
    failed_orders       NUMBER DEFAULT 0,
    enabled_by          VARCHAR2(100),
    enabled_date        DATE,
    disabled_by         VARCHAR2(100),
    disabled_date       DATE,
    created_by          VARCHAR2(100) DEFAULT USER,
    created_date        DATE DEFAULT SYSDATE,
    modified_by         VARCHAR2(100),
    modified_date       DATE,
    CONSTRAINT chk_auto_print_enabled CHECK (auto_print_enabled IN ('Y', 'N')),
    CONSTRAINT uk_trip_config UNIQUE (trip_id, trip_date)
);

-- Create indexes for efficient lookups
CREATE INDEX idx_trip_config_trip_id ON wms_trip_config(trip_id);
CREATE INDEX idx_trip_config_date ON wms_trip_config(trip_date);
CREATE INDEX idx_trip_config_enabled ON wms_trip_config(auto_print_enabled, trip_date);

COMMENT ON TABLE wms_trip_config IS 'Stores trip-level auto-print configuration';
COMMENT ON COLUMN wms_trip_config.trip_config_id IS 'Primary key - auto-generated';
COMMENT ON COLUMN wms_trip_config.trip_id IS 'Trip identifier from Fusion';
COMMENT ON COLUMN wms_trip_config.auto_print_enabled IS 'Y=Auto-print ON, N=Auto-print OFF';


-- ========================================
-- 3. PRINT JOBS TABLE
-- ========================================
CREATE TABLE wms_print_jobs (
    print_job_id        NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    trip_config_id      NUMBER NOT NULL,
    order_number        VARCHAR2(50) NOT NULL,
    trip_id             VARCHAR2(50) NOT NULL,
    trip_date           DATE NOT NULL,
    customer_name       VARCHAR2(200),
    account_number      VARCHAR2(50),
    order_date          DATE,

    -- Status fields
    download_status     VARCHAR2(20) DEFAULT 'Pending',
    print_status        VARCHAR2(20) DEFAULT 'Pending',
    overall_status      VARCHAR2(20) DEFAULT 'Pending',

    -- File information
    file_path           VARCHAR2(500),
    file_size_bytes     NUMBER,

    -- Error handling
    error_message       VARCHAR2(4000),
    retry_count         NUMBER DEFAULT 0,

    -- Timestamps
    download_started    DATE,
    download_completed  DATE,
    print_started       DATE,
    print_completed     DATE,

    -- Audit fields
    created_by          VARCHAR2(100) DEFAULT USER,
    created_date        DATE DEFAULT SYSDATE,
    modified_by         VARCHAR2(100),
    modified_date       DATE,

    CONSTRAINT fk_print_job_trip FOREIGN KEY (trip_config_id)
        REFERENCES wms_trip_config(trip_config_id) ON DELETE CASCADE,
    CONSTRAINT chk_download_status CHECK (download_status IN ('Pending', 'Downloading', 'Completed', 'Failed')),
    CONSTRAINT chk_print_status CHECK (print_status IN ('Pending', 'Printing', 'Printed', 'Failed')),
    CONSTRAINT chk_overall_status CHECK (overall_status IN ('Pending', 'Downloading', 'Downloaded', 'Printing', 'Completed', 'Failed'))
);

-- Create indexes for efficient queries
CREATE INDEX idx_print_jobs_trip_config ON wms_print_jobs(trip_config_id);
CREATE INDEX idx_print_jobs_order ON wms_print_jobs(order_number);
CREATE INDEX idx_print_jobs_trip ON wms_print_jobs(trip_id, trip_date);
CREATE INDEX idx_print_jobs_status ON wms_print_jobs(overall_status);
CREATE INDEX idx_print_jobs_created ON wms_print_jobs(created_date);

COMMENT ON TABLE wms_print_jobs IS 'Stores individual print job details for each order';
COMMENT ON COLUMN wms_print_jobs.print_job_id IS 'Primary key - auto-generated';
COMMENT ON COLUMN wms_print_jobs.download_status IS 'PDF download status';
COMMENT ON COLUMN wms_print_jobs.print_status IS 'Print job status';
COMMENT ON COLUMN wms_print_jobs.overall_status IS 'Combined overall status';


-- ========================================
-- 4. PRINT JOB HISTORY/AUDIT TABLE
-- ========================================
CREATE TABLE wms_print_job_history (
    history_id          NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    print_job_id        NUMBER NOT NULL,
    action_type         VARCHAR2(50) NOT NULL,
    old_status          VARCHAR2(20),
    new_status          VARCHAR2(20),
    message             VARCHAR2(4000),
    action_by           VARCHAR2(100) DEFAULT USER,
    action_date         DATE DEFAULT SYSDATE,
    CONSTRAINT fk_history_print_job FOREIGN KEY (print_job_id)
        REFERENCES wms_print_jobs(print_job_id) ON DELETE CASCADE
);

CREATE INDEX idx_history_job_id ON wms_print_job_history(print_job_id);
CREATE INDEX idx_history_date ON wms_print_job_history(action_date);

COMMENT ON TABLE wms_print_job_history IS 'Audit trail for print job status changes';


-- ========================================
-- 5. CREATE SEQUENCES (if using Oracle < 12c)
-- ========================================
-- Note: If you're using Oracle 12c+, IDENTITY columns are used above
-- If using older Oracle, uncomment these sequences:

/*
CREATE SEQUENCE wms_printer_config_seq START WITH 1 INCREMENT BY 1;
CREATE SEQUENCE wms_trip_config_seq START WITH 1 INCREMENT BY 1;
CREATE SEQUENCE wms_print_jobs_seq START WITH 1 INCREMENT BY 1;
CREATE SEQUENCE wms_print_job_history_seq START WITH 1 INCREMENT BY 1;
*/


-- ========================================
-- 6. GRANT PERMISSIONS (adjust as needed)
-- ========================================
-- GRANT SELECT, INSERT, UPDATE, DELETE ON wms_printer_config TO apex_user;
-- GRANT SELECT, INSERT, UPDATE, DELETE ON wms_trip_config TO apex_user;
-- GRANT SELECT, INSERT, UPDATE, DELETE ON wms_print_jobs TO apex_user;
-- GRANT SELECT, INSERT ON wms_print_job_history TO apex_user;


-- ========================================
-- 7. INITIAL DATA (Example)
-- ========================================
-- Insert default printer configuration
INSERT INTO wms_printer_config (
    printer_name, fusion_instance, fusion_username,
    fusion_password, auto_download, auto_print
) VALUES (
    'Microsoft Print to PDF', 'TEST', 'shaik',
    'fusion1234', 'Y', 'Y'
);

COMMIT;

-- ========================================
-- END OF TABLE CREATION
-- ========================================

-- ============================================================================
-- 81_pipeline_server.sql
-- Pipeline server (pipeline-server/, Python) - connections may now be DUCKDB files on the server.
-- The pipeline server and the Fusion SQL page both apply this on their own; run it only to do it by hand.
-- ============================================================================
ALTER TABLE wms_pipe_connections DROP CONSTRAINT wms_pipe_conn_type_ck;
ALTER TABLE wms_pipe_connections ADD CONSTRAINT wms_pipe_conn_type_ck2
    CHECK (conn_type IN ('ORACLE_EZ','ORACLE_TNS','ORACLE_WALLET','APEX_REST','MSSQL','MYSQL','POSTGRES','DUCKDB'));

-- What the server writes:
--   WMS_PIPE_SERVERS   its own row (registered by server_name), last_heartbeat every poll, status
--                      ONLINE | PAUSED | DRAINING | STOPPED | OFFLINE, last_test_msg = engine summary, public_key
--   WMS_PIPE_RUNS      claims QUEUED runs (status RUNNING + server_id), rows, cycle_no, error_text, ended_date
--   WMS_PIPE_TASK_RUNS one row per task per cycle (rows, watermark from / to)
--   WMS_PIPE_TASKS     last_watermark after every page that was written
--   WMS_PIPELINES      state, next_run_date (now + n seconds), last_run_*
--   WMS_PIPE_LOG       run log lines
-- Is it alive?
SELECT server_name, status, last_test_msg, last_heartbeat,
       ROUND((CAST(SYSTIMESTAMP AS DATE) - CAST(last_heartbeat AS DATE)) * 86400) AS seconds_ago
FROM   wms_pipe_servers ORDER BY server_name;

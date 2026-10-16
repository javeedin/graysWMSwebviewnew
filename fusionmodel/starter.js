/* Starter modules for the Fusion Model (fusionmodel/). Plain Oracle SQL per table; dates as ISO text
   (TO_CHAR(… 'YYYY-MM-DD"T"HH24:MI:SS')) so DuckDB stores real TIMESTAMP columns. Unquoted aliases come back
   upper-case (TRIP_ID). Change anything in the Modules tab; "Refresh" loads it. */
var FM_STARTERS = {
    wms: {
        module: { name: 'wms', title: "Gray's WMS", description: 'Trips, orders, print jobs, agent activity and shipment lines from the APEX tables (last 90 days).', schedule: { mode: 'HOURLY', time: '06:00' } },
        tables: [
            {
                name: 'trip_orders', description: 'Latest status of each order on each trip (Shipping Agent snapshots).', strategy: 'full', key: ['TRIP_ID', 'ORDER_NUMBER'],
                source: { kind: 'apex', sql:
                    "SELECT trip_id, order_number, instance_name, account_name AS customer, order_type, order_status,\n" +
                    "       total_lines, active_lines, staged_lines, interfaced_lines, cancelled_lines, backorder_lines,\n" +
                    "       total_qty, shipped_qty, print_total, print_printed,\n" +
                    "       TO_CHAR(last_fetched, 'YYYY-MM-DD\"T\"HH24:MI:SS') AS last_fetched\n" +
                    "  FROM (SELECT s.*, ROW_NUMBER() OVER (PARTITION BY trip_id, order_number ORDER BY last_fetched DESC) AS rk\n" +
                    "          FROM wms_shiping_agents_orders_status s WHERE created_date >= SYSDATE - 90)\n WHERE rk = 1" }
            },
            {
                name: 'print_jobs', description: 'Print jobs per order: download and print status, retries, errors.', strategy: 'full', key: [],
                source: { kind: 'apex', sql:
                    "SELECT trip_id, order_number, TO_CHAR(trip_date, 'YYYY-MM-DD\"T\"HH24:MI:SS') AS trip_date, customer_name AS customer,\n" +
                    "       download_status, print_status, overall_status, retry_count,\n" +
                    "       TO_CHAR(print_completed, 'YYYY-MM-DD\"T\"HH24:MI:SS') AS printed_at, SUBSTR(error_message, 1, 300) AS error_text\n" +
                    "  FROM wms_print_jobs WHERE trip_date >= TRUNC(SYSDATE) - 90" }
            },
            {
                name: 'agent_activity', description: 'Every Shipping Agent action (fetch, cancel, print) with its outcome.', strategy: 'full', key: [],
                source: { kind: 'apex', sql:
                    "SELECT trip_id, order_number, activity_type, status, duration_ms,\n" +
                    "       TO_CHAR(created_date, 'YYYY-MM-DD\"T\"HH24:MI:SS') AS created_at\n" +
                    "  FROM wms_agents_activity_log WHERE created_date >= SYSDATE - 30" }
            },
            {
                name: 'shipment_lines', description: 'Order lines with requested, shipped, cancelled and backordered quantities.', strategy: 'full', key: [],
                source: { kind: 'apex', sql:
                    "SELECT order_number, order_line, order_type, item, item_description, requested_quantity, shipped_quantity,\n" +
                    "       cancelled_quantity, backordered_quantity, selling_price, currency_code, line_status\n  FROM wms_order_shipment_lines" }
            }
        ]
    },
    fusion_ref: {
        module: { name: 'fusion_ref', title: 'Fusion reference data', description: 'Ledgers, business units and accounting periods from Oracle Fusion (through the Fusion SQL runner).', schedule: { mode: 'DAILY', time: '05:30' } },
        tables: [
            {
                name: 'ledgers', description: 'General ledgers: currency, calendar, chart of accounts.', strategy: 'full', key: ['LEDGER_ID'],
                source: { kind: 'fusion', sql: "SELECT ledger_id, name, short_name, currency_code, period_set_name, accounted_period_type, chart_of_accounts_id\n  FROM gl_ledgers" }
            },
            {
                name: 'business_units', description: 'Business units with their primary ledger and legal entity.', strategy: 'full', key: ['BU_ID'],
                source: { kind: 'fusion', sql: "SELECT bu_id, bu_name, primary_ledger_id, legal_entity_id, status\n  FROM fun_all_business_units_v" }
            },
            {
                name: 'periods', description: 'Accounting periods of every calendar (fiscal year, quarter, dates).', strategy: 'full', key: ['PERIOD_SET_NAME', 'PERIOD_NAME'],
                source: { kind: 'fusion', sql:
                    "SELECT period_set_name, period_name, period_year, period_num, quarter_num,\n" +
                    "       TO_CHAR(start_date, 'YYYY-MM-DD') AS start_date, TO_CHAR(end_date, 'YYYY-MM-DD') AS end_date, adjustment_period_flag\n  FROM gl_periods" }
            }
        ]
    }
};

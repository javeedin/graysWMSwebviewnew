/* Starter dataset "WMS Operations" for the Power BI module — built only from APEX tables this app creates
   (apex_sql/01, 28, 29, 30). Every table is plain SQL: change it in Datasets, or add tables (e.g. your trip /
   order masters, MRA results) — Detect columns reads the types. Dates are sent as ISO text
   (TO_CHAR(... 'YYYY-MM-DD"T"HH24:MI:SS')) so Power BI gets real DateTime columns. */
var PBI_STARTER = {
    key: 'wms_operations',
    name: 'WMS Operations',
    schedule: { mode: 'DAILY', time: '06:00' },
    tables: [
        {
            name: 'Trips', maxRows: 50000,
            sql: "SELECT trip_id AS \"TripId\", MAX(instance_name) AS \"Instance\", TO_CHAR(MIN(created_date), 'YYYY-MM-DD\"T\"HH24:MI:SS') AS \"FirstSeen\",\n" +
                 "       COUNT(DISTINCT order_number) AS \"OrderCount\"\n" +
                 "  FROM wms_shiping_agents_orders_status\n WHERE created_date >= SYSDATE - 90\n GROUP BY trip_id",
            columns: [{ name: 'TripId', dataType: 'String' }, { name: 'Instance', dataType: 'String' }, { name: 'FirstSeen', dataType: 'DateTime' }, { name: 'OrderCount', dataType: 'Int64' }],
            measures: [{ name: 'Trips', expression: 'DISTINCTCOUNT(Trips[TripId])', formatString: '#,0' }]
        },
        {
            name: 'TripOrders', maxRows: 200000,
            sql: "SELECT trip_id AS \"TripId\", order_number AS \"OrderNumber\", instance_name AS \"Instance\", account_name AS \"Customer\",\n" +
                 "       order_type AS \"OrderType\", order_status AS \"OrderStatus\", total_lines AS \"TotalLines\", active_lines AS \"ActiveLines\",\n" +
                 "       staged_lines AS \"StagedLines\", interfaced_lines AS \"InterfacedLines\", cancelled_lines AS \"CancelledLines\",\n" +
                 "       backorder_lines AS \"BackorderLines\", total_qty AS \"TotalQty\", shipped_qty AS \"ShippedQty\",\n" +
                 "       print_total AS \"PrintTotal\", print_printed AS \"PrintPrinted\", TO_CHAR(last_fetched, 'YYYY-MM-DD\"T\"HH24:MI:SS') AS \"LastFetched\"\n" +
                 "  FROM (SELECT s.*, ROW_NUMBER() OVER (PARTITION BY trip_id, order_number ORDER BY last_fetched DESC) AS rk\n" +
                 "          FROM wms_shiping_agents_orders_status s WHERE created_date >= SYSDATE - 90)\n WHERE rk = 1",
            columns: [
                { name: 'TripId', dataType: 'String' }, { name: 'OrderNumber', dataType: 'String' }, { name: 'Instance', dataType: 'String' },
                { name: 'Customer', dataType: 'String' }, { name: 'OrderType', dataType: 'String' }, { name: 'OrderStatus', dataType: 'String' },
                { name: 'TotalLines', dataType: 'Int64' }, { name: 'ActiveLines', dataType: 'Int64' }, { name: 'StagedLines', dataType: 'Int64' },
                { name: 'InterfacedLines', dataType: 'Int64' }, { name: 'CancelledLines', dataType: 'Int64' }, { name: 'BackorderLines', dataType: 'Int64' },
                { name: 'TotalQty', dataType: 'Double' }, { name: 'ShippedQty', dataType: 'Double' }, { name: 'PrintTotal', dataType: 'Int64' },
                { name: 'PrintPrinted', dataType: 'Int64' }, { name: 'LastFetched', dataType: 'DateTime' }
            ],
            measures: [
                { name: 'Orders', expression: 'DISTINCTCOUNT(TripOrders[OrderNumber])', formatString: '#,0' },
                { name: 'Order Lines', expression: 'SUM(TripOrders[TotalLines])', formatString: '#,0' },
                { name: 'Cancelled Lines', expression: 'SUM(TripOrders[CancelledLines])', formatString: '#,0' },
                { name: 'Cancelled %', expression: 'DIVIDE([Cancelled Lines], [Order Lines])', formatString: '0.0%' },
                { name: 'Backorder Lines', expression: 'SUM(TripOrders[BackorderLines])', formatString: '#,0' },
                { name: 'Qty Ordered', expression: 'SUM(TripOrders[TotalQty])', formatString: '#,0' },
                { name: 'Qty Shipped', expression: 'SUM(TripOrders[ShippedQty])', formatString: '#,0' },
                { name: 'Fill Rate %', expression: 'DIVIDE([Qty Shipped], [Qty Ordered])', formatString: '0.0%' },
                { name: 'Orders Fully Printed', expression: 'COUNTROWS(FILTER(TripOrders, TripOrders[PrintTotal] > 0 && TripOrders[PrintPrinted] >= TripOrders[PrintTotal]))', formatString: '#,0' }
            ]
        },
        {
            name: 'PrintJobs', maxRows: 200000,
            sql: "SELECT trip_id AS \"TripId\", order_number AS \"OrderNumber\", TO_CHAR(trip_date, 'YYYY-MM-DD\"T\"HH24:MI:SS') AS \"TripDate\",\n" +
                 "       customer_name AS \"Customer\", download_status AS \"DownloadStatus\", print_status AS \"PrintStatus\",\n" +
                 "       overall_status AS \"OverallStatus\", retry_count AS \"Retries\", TO_CHAR(print_completed, 'YYYY-MM-DD\"T\"HH24:MI:SS') AS \"PrintedAt\",\n" +
                 "       SUBSTR(error_message, 1, 300) AS \"Error\"\n  FROM wms_print_jobs\n WHERE trip_date >= TRUNC(SYSDATE) - 90",
            columns: [
                { name: 'TripId', dataType: 'String' }, { name: 'OrderNumber', dataType: 'String' }, { name: 'TripDate', dataType: 'DateTime' },
                { name: 'Customer', dataType: 'String' }, { name: 'DownloadStatus', dataType: 'String' }, { name: 'PrintStatus', dataType: 'String' },
                { name: 'OverallStatus', dataType: 'String' }, { name: 'Retries', dataType: 'Int64' }, { name: 'PrintedAt', dataType: 'DateTime' }, { name: 'Error', dataType: 'String' }
            ],
            measures: [
                { name: 'Print Jobs', expression: 'COUNTROWS(PrintJobs)', formatString: '#,0' },
                { name: 'Printed', expression: 'CALCULATE(COUNTROWS(PrintJobs), PrintJobs[PrintStatus] = "Printed")', formatString: '#,0' },
                { name: 'Printed %', expression: 'DIVIDE([Printed], [Print Jobs])', formatString: '0.0%' },
                { name: 'Print Failures', expression: 'CALCULATE(COUNTROWS(PrintJobs), PrintJobs[OverallStatus] = "Failed")', formatString: '#,0' }
            ]
        },
        {
            name: 'AgentActivity', maxRows: 300000,
            sql: "SELECT trip_id AS \"TripId\", order_number AS \"OrderNumber\", activity_type AS \"Activity\", status AS \"Status\",\n" +
                 "       duration_ms AS \"DurationMs\", TO_CHAR(created_date, 'YYYY-MM-DD\"T\"HH24:MI:SS') AS \"At\"\n" +
                 "  FROM wms_agents_activity_log\n WHERE created_date >= SYSDATE - 90",
            columns: [
                { name: 'TripId', dataType: 'String' }, { name: 'OrderNumber', dataType: 'String' }, { name: 'Activity', dataType: 'String' },
                { name: 'Status', dataType: 'String' }, { name: 'DurationMs', dataType: 'Int64' }, { name: 'At', dataType: 'DateTime' }
            ],
            measures: [
                { name: 'Agent Actions', expression: 'COUNTROWS(AgentActivity)', formatString: '#,0' },
                { name: 'Agent Failures', expression: 'CALCULATE(COUNTROWS(AgentActivity), AgentActivity[Status] = "FAILED")', formatString: '#,0' },
                { name: 'Agent Failure %', expression: 'DIVIDE([Agent Failures], [Agent Actions])', formatString: '0.0%' },
                { name: 'Cancellations Done', expression: 'CALCULATE(COUNTROWS(AgentActivity), AgentActivity[Activity] = "CANCEL_LINE", AgentActivity[Status] = "SUCCESS")', formatString: '#,0' }
            ]
        },
        {
            name: 'ShipmentLines', maxRows: 300000,
            sql: "SELECT order_number AS \"OrderNumber\", order_line AS \"OrderLine\", order_type AS \"OrderType\", item AS \"Item\",\n" +
                 "       item_description AS \"ItemDescription\", requested_quantity AS \"RequestedQty\", shipped_quantity AS \"ShippedQty\",\n" +
                 "       cancelled_quantity AS \"CancelledQty\", backordered_quantity AS \"BackorderedQty\", selling_price AS \"SellingPrice\",\n" +
                 "       currency_code AS \"Currency\", line_status AS \"LineStatus\"\n  FROM wms_order_shipment_lines",
            columns: [
                { name: 'OrderNumber', dataType: 'String' }, { name: 'OrderLine', dataType: 'String' }, { name: 'OrderType', dataType: 'String' },
                { name: 'Item', dataType: 'String' }, { name: 'ItemDescription', dataType: 'String' }, { name: 'RequestedQty', dataType: 'Double' },
                { name: 'ShippedQty', dataType: 'Double' }, { name: 'CancelledQty', dataType: 'Double' }, { name: 'BackorderedQty', dataType: 'Double' },
                { name: 'SellingPrice', dataType: 'Double' }, { name: 'Currency', dataType: 'String' }, { name: 'LineStatus', dataType: 'String' }
            ],
            measures: [
                { name: 'Shipped Value', expression: 'SUMX(ShipmentLines, ShipmentLines[ShippedQty] * ShipmentLines[SellingPrice])', formatString: '#,0.00' },
                { name: 'Cancelled Qty', expression: 'SUM(ShipmentLines[CancelledQty])', formatString: '#,0' },
                { name: 'Backordered Qty', expression: 'SUM(ShipmentLines[BackorderedQty])', formatString: '#,0' }
            ]
        }
    ],
    relationships: [
        { name: 'TripOrders_Trips', fromTable: 'TripOrders', fromColumn: 'TripId', toTable: 'Trips', toColumn: 'TripId', crossFilteringBehavior: 'OneDirection' },
        { name: 'PrintJobs_Trips', fromTable: 'PrintJobs', fromColumn: 'TripId', toTable: 'Trips', toColumn: 'TripId', crossFilteringBehavior: 'OneDirection' },
        { name: 'AgentActivity_Trips', fromTable: 'AgentActivity', fromColumn: 'TripId', toTable: 'Trips', toColumn: 'TripId', crossFilteringBehavior: 'OneDirection' }
    ]
};

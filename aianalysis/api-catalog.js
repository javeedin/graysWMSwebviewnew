// ============================================================
// WMS API CATALOG - write operations only (POST / PUT / DELETE)
// ============================================================
// All READS go through the guarded SQL gateway (the chatbot's
// action sql) - this catalog exists so writes can be run from
// interactive, confirmed, logged forms (APIs tab + api_form chat
// action). Keep the summary list in ClaudeCliService.cs's
// CLAUDE.md section in sync when editing.
//
// Entry shape:
//   id         stable id the AI uses in api_form
//   name/desc  display
//   module     ORDS module
//   method     HTTP method actually used by the app
//   url        full URL; {param} placeholders come from path fields
//   instanceIn where the current PROD/TEST instance is injected:
//              {in:'body'|'query', key:'p_instance_name'} or null
//   fields     [{key,label,type,in,required,def,rows}]
//              type: text|number|date|textarea|json|rows
//              in:   body (default) | query | path
//              def:  'today' | literal
//              rows: for type rows - {cols:[...]} array-of-objects body field
//   note       extra caution text shown on the form
// ============================================================

(function () {
    var ORDS = 'https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP';

    window.WMS_API_CATALOG = [

        // ---------------- Trips ----------------
        {
            id: 'trips.create', name: 'Create Trip', module: 'Trips', method: 'POST',
            url: ORDS + '/WAREHOUSEMANAGEMENT/trips/create',
            desc: 'Creates a new trip with vehicle, picker, priority and loading bay.',
            instanceIn: { in: 'body', key: 'p_instance_name' },
            fields: [
                { key: 'trip_date', label: 'Trip date', type: 'date', required: true, def: 'today' },
                { key: 'cost_date', label: 'Cost date', type: 'date', required: true, def: 'today' },
                { key: 'vehicle', label: 'Vehicle', type: 'text', required: true },
                { key: 'picker', label: 'Picker ID', type: 'number', required: true },
                { key: 'priority', label: 'Priority', type: 'number', def: 0 },
                { key: 'loading_bay', label: 'Loading bay', type: 'text', required: true },
                { key: 'notes', label: 'Notes', type: 'textarea' }
            ]
        },
        {
            id: 'trips.addorders', name: 'Add Orders to Trip', module: 'Trips', method: 'POST',
            url: ORDS + '/WAREHOUSEMANAGEMENT/trips/addorders',
            desc: 'Adds one or more pending orders to an existing trip.',
            instanceIn: null,   // instance travels inside each order row
            fields: [
                { key: 'trip_id', label: 'Trip ID', type: 'number', required: true },
                {
                    key: 'orders', label: 'Orders', type: 'rows', required: true,
                    rows: { cols: ['order_number', 'account_name', 'order_type', 'order_date'] }
                }
            ],
            note: 'Ask the chatbot to validate pasted order numbers against pending shipment lines first - it pre-ticks the valid ones.'
        },
        {
            id: 'trip.updatetrip', name: 'Update Trip Header', module: 'Trips', method: 'POST',
            url: ORDS + '/TRIPMANAGEMENT/trip/updatetrip',
            desc: 'Updates lorry, status, loading bay and priority of a trip.',
            instanceIn: { in: 'body', key: 'trip_instance' },
            fields: [
                { key: 'p_trip_id', label: 'Trip ID', type: 'number', required: true },
                { key: 'trip_lorry', label: 'Lorry', type: 'text' },
                { key: 'trip_status', label: 'Status', type: 'text' },
                { key: 'trip_loading_bay', label: 'Loading bay', type: 'text' },
                { key: 'trip_priority', label: 'Priority', type: 'number' }
            ]
        },
        {
            id: 'trip.deletetripline', name: 'Remove Order from Trip', module: 'Trips', method: 'GET',
            url: ORDS + '/TRIPMANAGEMENT/deletetripline',
            desc: 'Removes one order from its trip (destructive - the ORDS handler uses GET).',
            instanceIn: { in: 'query', key: 'P_INSTANCE_NAME' },
            fields: [
                { key: 'P_ORDER_NUMBER', label: 'Order number', type: 'text', in: 'query', required: true }
            ]
        },

        // ---------------- Pickers ----------------
        {
            id: 'trip.assignpicker', name: 'Assign Picker (one order)', module: 'Pickers', method: 'POST',
            url: ORDS + '/WAREHOUSEMANAGEMENT/trip/assignpicker',
            desc: 'Assigns a picker to a single order.',
            instanceIn: { in: 'body', key: 'p_instance_name' },
            fields: [
                { key: 'p_trx_number', label: 'Order number', type: 'text', required: true },
                { key: 'p_picker_id', label: 'Picker ID', type: 'number', required: true },
                { key: 'p_picker_name', label: 'Picker name', type: 'text', required: true }
            ]
        },
        {
            id: 'trip.pickerassignment', name: 'Picker Assignment (trip)', module: 'Pickers', method: 'POST',
            url: ORDS + '/WAREHOUSEMANAGEMENT/trip/pickerassignment',
            desc: 'Trip-level picker assignment. Raw JSON body.',
            instanceIn: null,
            fields: [{ key: '_body', label: 'Request body (JSON)', type: 'json', required: true, def: '{\n  "tripId": "",\n  "pickerId": "",\n  "pickerName": ""\n}' }]
        },

        // ---------------- Picking / releasing ----------------
        {
            id: 'trip.callpickwave', name: 'Call Pick Wave', module: 'Picking', method: 'POST',
            url: ORDS + '/TRIPMANAGEMENT/trip/callpickwave',
            desc: 'Launches a Fusion pick wave for one order.',
            instanceIn: { in: 'query', key: 'p_instance_name' },
            fields: [
                { key: 'warehouse', label: 'Warehouse', type: 'text', in: 'query', required: true },
                { key: 'order_number', label: 'Order number', type: 'text', in: 'query', required: true }
            ]
        },
        {
            id: 'trip.pickrelease.oneorder', name: 'Pick Release (one order)', module: 'Picking', method: 'POST',
            url: ORDS + '/TRIPMANAGEMENT/trip/pickrelease/oneorder/{order_number}',
            desc: 'Runs pick release for a single order.',
            instanceIn: { in: 'query', key: 'p_instance_name' },
            fields: [
                { key: 'order_number', label: 'Order number', type: 'text', in: 'path', required: true }
            ]
        },
        {
            id: 'trip.updatepickconfirmstatus', name: 'Update Pick Confirm Status', module: 'Picking', method: 'POST',
            url: ORDS + '/TRIPMANAGEMENT/trip/updatepickconfirmstatus',
            desc: 'Updates pick confirm status. Raw JSON body.',
            instanceIn: null,
            fields: [{ key: '_body', label: 'Request body (JSON)', type: 'json', required: true, def: '{\n\n}' }]
        },
        {
            id: 'trip.releasepick', name: 'Release Pick', module: 'Picking', method: 'POST',
            url: ORDS + '/WAREHOUSEMANAGEMENT/trip/releasepick',
            desc: 'Releases picks. Raw JSON body.',
            instanceIn: null,
            fields: [{ key: '_body', label: 'Request body (JSON)', type: 'json', required: true, def: '{\n\n}' }]
        },

        // ---------------- Order line cancellation ----------------
        {
            id: 'trip.cancelorderline', name: 'Cancel One Order Line', module: 'Cancelling', method: 'POST',
            url: ORDS + '/TRIPMANAGEMENT/trip/orders/cancelorderline/{order_number}/{line_id}',
            desc: 'Cancels a single order line.',
            instanceIn: { in: 'query', key: 'P_INSTANCE_NAME' },
            fields: [
                { key: 'order_number', label: 'Order number', type: 'text', in: 'path', required: true },
                { key: 'line_id', label: 'Line ID', type: 'text', in: 'path', required: true }
            ]
        },
        {
            id: 'trip.cancelnotpickedlines', name: 'Cancel Not-Picked Lines', module: 'Cancelling', method: 'POST',
            url: ORDS + '/TRIPMANAGEMENT/trip/orders/cancelnotpickedlines/{order_number}',
            desc: 'Cancels every not-picked line of an order.',
            instanceIn: { in: 'query', key: 'P_INSTANCE_NAME' },
            fields: [
                { key: 'order_number', label: 'Order number', type: 'text', in: 'path', required: true }
            ]
        },
        {
            id: 'trip.cancelscheduledlines', name: 'Cancel Scheduled Lines', module: 'Cancelling', method: 'POST',
            url: ORDS + '/TRIPMANAGEMENT/trip/orders/cancelscheduledlines/{order_number}',
            desc: 'Cancels the scheduled lines of an order.',
            instanceIn: { in: 'query', key: 'P_INSTANCE_NAME' },
            fields: [
                { key: 'order_number', label: 'Order number', type: 'text', in: 'path', required: true }
            ]
        },

        // ---------------- Store transactions / S2V ----------------
        {
            id: 'storetrans.process', name: 'Process Store Transactions', module: 'Store / S2V', method: 'POST',
            url: ORDS + '/WAREHOUSEMANAGEMENT/storetrans/process',
            desc: 'Processes store transactions. Raw JSON body.',
            instanceIn: null,
            fields: [{ key: '_body', label: 'Request body (JSON)', type: 'json', required: true, def: '{\n\n}' }]
        },
        {
            id: 'materialtrx.allocatelots', name: 'Allocate Lots', module: 'Store / S2V', method: 'POST',
            url: ORDS + '/WAREHOUSEMANAGEMENT/materialtrx/allocatelots',
            desc: 'Allocates lots for material transactions. Raw JSON body.',
            instanceIn: null,
            fields: [{ key: '_body', label: 'Request body (JSON)', type: 'json', required: true, def: '{\n\n}' }]
        },
        {
            id: 'trip.processs2v', name: 'Process S2V', module: 'Store / S2V', method: 'POST',
            url: ORDS + '/WAREHOUSEMANAGEMENT/trip/processs2v',
            desc: 'Processes store-to-van transactions. Raw JSON body.',
            instanceIn: null,
            fields: [{ key: '_body', label: 'Request body (JSON)', type: 'json', required: true, def: '{\n\n}' }]
        },
        {
            id: 'trip.sets2vdata', name: 'Set S2V Data', module: 'Store / S2V', method: 'POST',
            url: ORDS + '/TRIPMANAGEMENT/trip/sets2vdata',
            desc: 'Sets store-to-van data. Raw JSON body.',
            instanceIn: null,
            fields: [{ key: '_body', label: 'Request body (JSON)', type: 'json', required: true, def: '{\n\n}' }]
        },
        {
            id: 'trip.cancels2vline', name: 'Cancel S2V Line', module: 'Store / S2V', method: 'POST',
            url: ORDS + '/TRIPMANAGEMENT/trip/cancels2vline/{transaction_id}',
            desc: 'Cancels a staged S2V transaction line.',
            instanceIn: { in: 'query', key: 'p_instance_name' },
            fields: [
                { key: 'transaction_id', label: 'Transaction ID', type: 'text', in: 'path', required: true }
            ]
        },
        {
            id: 'trip.cancels2vlot', name: 'Cancel S2V Lot', module: 'Store / S2V', method: 'POST',
            url: ORDS + '/TRIPMANAGEMENT/trip/cancels2vlot/{lot_line_id}',
            desc: 'Cancels an S2V lot line.',
            instanceIn: { in: 'query', key: 'p_instance_name' },
            fields: [
                { key: 'lot_line_id', label: 'Lot line ID', type: 'text', in: 'path', required: true }
            ]
        }
    ];

    window.apiCatalogById = function (id) {
        for (var i = 0; i < window.WMS_API_CATALOG.length; i++)
            if (window.WMS_API_CATALOG[i].id === id) return window.WMS_API_CATALOG[i];
        return null;
    };

    // Builds {method, url, body} from an api entry + collected values.
    // values: { fieldKey: value, ... } ; rows fields: array of objects.
    // instance: 'PROD' | 'TEST'
    window.buildApiRequest = function (api, values, instance) {
        var url = api.url;
        var query = [];
        var body = null;
        var bodyObj = {};
        var hasBodyField = false;

        (api.fields || []).forEach(function (f) {
            var v = values[f.key];
            if (f.type === 'json') {
                body = (v === undefined || v === null || v === '') ? '{}' : String(v);
                return;
            }
            if (v === undefined || v === null || v === '') return;
            var where = f.in || 'body';
            if (where === 'path') {
                url = url.replace('{' + f.key + '}', encodeURIComponent(String(v)));
            } else if (where === 'query') {
                query.push(encodeURIComponent(f.key) + '=' + encodeURIComponent(String(v)));
            } else {
                bodyObj[f.key] = (f.type === 'number' && v !== '' && !isNaN(v)) ? Number(v) : v;
                hasBodyField = true;
            }
        });

        if (api.instanceIn) {
            if (api.instanceIn.in === 'query')
                query.push(encodeURIComponent(api.instanceIn.key) + '=' + encodeURIComponent(instance));
            else { bodyObj[api.instanceIn.key] = instance; hasBodyField = true; }
        }

        if (query.length) url += (url.indexOf('?') >= 0 ? '&' : '?') + query.join('&');
        if (body === null) body = hasBodyField ? JSON.stringify(bodyObj) : '{}';
        return { method: api.method, url: url, body: body };
    };

    // INSERT statement for WMS_AI_API_LOG, executed through ai/executewrite
    window.buildApiLogSql = function (api, req, status, ok, responseText, instance, source, user) {
        function q(s, max) {
            if (s === undefined || s === null) return 'NULL';
            s = String(s).replace(/'/g, "''").replace(/[\u0000-\u001f]/g, ' ');
            if (s.length > (max || 3500)) s = s.slice(0, max || 3500) + '...';
            return "'" + s + "'";
        }
        return "INSERT INTO wms_ai_api_log (api_id, api_name, method, url, request_body, http_status, success, response_text, instance, source, invoked_by) VALUES (" +
            q(api.id, 100) + ", " + q(api.name, 200) + ", " + q(req.method, 10) + ", " + q(req.url, 950) + ", " +
            q(req.body, 3500) + ", " + (status === undefined || status === null ? 'NULL' : Number(status)) + ", " +
            q(ok ? 'Y' : 'N', 1) + ", " + q(responseText, 3500) + ", " + q(instance, 10) + ", " +
            q(source, 20) + ", " + q(user || 'UNKNOWN', 100) + ")";
    };
})();

// ============================================================
// DISCOVERED APIs - live registry from APEX ai/apicatalog
// ============================================================
// The GET handler in apex_sql/35_api_catalog_endpoint.sql reads
// the ORDS metadata views and returns every module / method /
// URI template with its parameters and JSON body fields. This
// loader fetches it once at startup so new APEX endpoints are
// considered by the AI without touching the curated catalog.
(function () {
    var CATALOG_URL = 'https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/ARMODULE/ai/apicatalog';

    window.WMS_API_CATALOG_DISCOVERED = [];

    window.loadDiscoveredApiCatalog = function (cb) {
        if (typeof sendMessageToCSharp !== 'function') return;
        sendMessageToCSharp({ action: 'executeGet', fullUrl: CATALOG_URL }, function (err, data) {
            if (err) {
                console.warn('[ApiCatalog] discovery failed (is ai/apicatalog created in APEX?):', err);
                if (cb) cb(err, null);
                return;
            }
            try {
                var resp = typeof data === 'string' ? JSON.parse(data) : data;
                if (resp && resp.items && resp.items.length) {
                    window.WMS_API_CATALOG_DISCOVERED = resp.items;
                    console.log('[ApiCatalog] discovered ' + resp.items.length + ' ORDS handlers from APEX');
                    if (typeof renderApiList === 'function' && document.getElementById('api-list')) {
                        renderApiList();
                    }
                    if (cb) cb(null, resp.items);
                } else {
                    console.warn('[ApiCatalog] discovery returned no items');
                    if (cb) cb(null, []);
                }
            } catch (e) {
                console.warn('[ApiCatalog] discovery parse failed:', e);
                if (cb) cb(e, null);
            }
        });
    };

    // Fetch shortly after load (bridge listener must be registered first)
    setTimeout(function () {
        try { window.loadDiscoveredApiCatalog(); } catch (e) { }
    }, 1500);
})();

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

    // ============================================================
    // Pinned order-entry lookups - always win over model-supplied
    // SQL (see order-entry.js). Confirmed tenant sources:
    //   GRFU_CUSTOMER = customer master with the Fusion ids
    // Add itemsSql here once the price list items table is confirmed.
    // ============================================================
    window.WMS_ORDER_LOOKUPS = {
        customersSql:
            "SELECT ACCOUNT_NAME, ACCOUNT_NUMBER AS BILL_TO_CUSTOMER_NUMBER, CUST_ACCOUNT_ID, PARTY_ID, " +
            "BILL_TO_SITE_USE_ID AS SITE_USE_ID, SHIP_TO_PARTY_SITE_ID AS PARTY_SITE_ID, " +
            "PRICE_LIST AS PRICELIST, CITY AS LOCATION " +
            "FROM GRFU_CUSTOMER " +
            "WHERE (UPPER(ACCOUNT_NAME) LIKE :SEARCH OR UPPER(ACCOUNT_NUMBER) LIKE :SEARCH) " +
            "ORDER BY ACCOUNT_NAME FETCH FIRST 50 ROWS ONLY"
    };

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

        // ---------------- Orders ----------------
        {
            id: 'order.create', name: 'Create Sales Order (WMS DB)', module: 'Orders', method: 'POST',
            url: ORDS + '/ORDERCRATION/NEWORDER',
            desc: 'Saves a new sales order in the APEX DB (NEWORDER OrderHeader payload); a separate procedure interfaces it to Fusion. Header fields plus line rows from the customer\'s price list.',
            instanceIn: null,   // NEWORDER payload has no instance field; buildBody shapes the body
            fields: [
                { key: 'customer_name', label: 'Customer name', type: 'text', required: true },
                { key: 'bill_to_customer_number', label: 'Bill-to customer #', type: 'text', required: true },
                { key: 'cust_account_id', label: 'Cust account ID', type: 'text', required: true },
                { key: 'party_id', label: 'Party ID', type: 'text', required: true },
                { key: 'site_use_id', label: 'Site use ID', type: 'text', required: true },
                { key: 'party_site_id', label: 'Party site ID', type: 'text', required: true },
                { key: 'order_type', label: 'Order type', type: 'text', required: true },
                { key: 'order_date', label: 'Order date', type: 'date', required: true, def: 'today' },
                { key: 'po_number', label: 'PO number', type: 'text' },
                { key: 'salesrep_number', label: 'Salesrep number', type: 'text' },
                { key: 'agent_name', label: 'Agent name', type: 'text' },
                { key: 'location', label: 'Location', type: 'text' },
                { key: 'warehouse', label: 'Warehouse', type: 'text', required: true, def: 'SHOPS' },
                { key: 'subinventory', label: 'Subinventory', type: 'text', required: true },
                { key: 'pricelist', label: 'Price list', type: 'text', required: true, def: 'PUBLIC' },
                { key: 'currency_code', label: 'Currency', type: 'text', required: true, def: 'MUR' },
                { key: 'login_id', label: 'Login ID', type: 'text', required: true },
                { key: 'comments', label: 'Comments', type: 'textarea' },
                {
                    key: 'lines', label: 'Order Lines (from the customer\'s price list)', type: 'rows', required: true,
                    rows: { cols: ['item_code', 'item_description', 'quantity', 'uom', 'selling_price', 'tax_code', 'inventory_item_id'] }
                }
            ],
            // Wraps the reviewed form values into the exact NEWORDER OrderHeader payload
            buildBody: function (v, instance) {
                var nowIso = new Date().toISOString().slice(0, 19);
                var cartId = Number(String(Date.now()).slice(-10));
                var lines = (v.lines || []).map(function (r, i) {
                    var qty = Number(r.quantity) || 1;
                    var price = Number(r.selling_price) || 0;
                    return {
                        cartdetailsid: 0, cartid: 0,
                        LINE_NUM: String(i + 1),
                        CURRECY_CODE: v.currency_code || 'MUR',
                        LIST_PRICE: price, SELLING_PRICE: price,
                        TAX_AMOUNT: 0, NET: price * qty,
                        WAREHOUSE: v.warehouse || '', SUBINVENTORY: v.subinventory || '',
                        ITEM_CODE: r.item_code || '', ITEM_DESC: r.item_description || '',
                        TAX_CODE: r.tax_code || '', UOM_CODE: r.uom || 'UN',
                        LOT_NUMBER: String(cartId), LOT_EXPIRY: '',
                        ORIGINALITEM: r.item_code || '',
                        IsBogoItem: false, BogoItemReferenceNum: 0, BogoItemReferenceProductID: '',
                        IsFlatDiscount: false, DISCOUNT_PER: 0, ADD_DISCOUNT: 0, LINE_COMMENTS: '',
                        ORIGINAL_QTY: 0, LINE_TYPE: 'ORD', REFORDERNUMBER: null, MKT_DISCOUNT: 0, DISC_REFERENCE: '',
                        BARCODE: '', INVENTORY_ITEM_ID: r.inventory_item_id || '',
                        TOTAL_TAX: 0, TOTAL_NET: price * qty, TOTAL_GROSS: price * qty,
                        QOH: 0, SFUTURE1: null, SFUTURE2: null, DFUTURE1: 0, DFUTURE2: 0,
                        ORDER_DATE: nowIso, LOGIN_ID: v.login_id || '', LOGIN_NAME: v.login_id || '',
                        MEMEBERSHIP_ID: '', PALYER_ID: '',
                        ReturnDate: nowIso, RetunAmount: 0, TOTAL_DISCOUNT: 0, DiscountItem: 0,
                        DiscountType: 'Percentage', IsDiscount: false, QTY: qty,
                        OriginalOrderNumber: null, parent_line_num: 0, IsDeleted: false, IsReturned: false,
                        CurrentIsReturned: false, AreButtonsEnabled: true
                    };
                });
                var totalNet = lines.reduce(function (s, l) { return s + l.NET; }, 0);
                var header = {
                    cartid: cartId,
                    ACCOUNT_NAME: v.customer_name || '', SOURCE_ORDER_NUMBER: null,
                    agent_name: v.agent_name || '', location: v.location || '', return_reason: null,
                    BILL_TO_CUSTOMER_NUMBER: v.bill_to_customer_number || '',
                    PO_NUMBER: v.po_number || '',
                    ORDER_DATE: (v.order_date || nowIso.slice(0, 10)) + 'T00:00:00',
                    BUSINESS_UNIT_IDENTIFIER: '300000003234003', BUSINESS_UNIT: null,
                    ORDER_TYPE: v.order_type || '', FREEZEPRICE: 'YES', FREEZETAX: 'YES',
                    P_USERNAME: v.login_id || '',
                    SITE_USE_ID: v.site_use_id || '', PARTY_SITE_ID: v.party_site_id || '',
                    REQUESTINGLEGALUNIT: 'GRAYS INC', SHIP_TO_CUSTOMER_NUMBER: null,
                    CUST_ACCOUNT_ID: v.cust_account_id || '', EBS_ORDER_NUMBER: '',
                    SALESREP_NAME: '', SALESREP_NUMBER: v.salesrep_number || '',
                    CURRENCY_CODE: v.currency_code || 'MUR', PARTY_ID: v.party_id || '',
                    PAYMENT_TERMS: 'PAYMENT_TERM', DELIVERY_OFFICIER_NAME: '', DELIVERY_OFFICIER_NO: '',
                    REF_REFERENCE: '', COMMENTS: v.comments || '', HOLD_STATUS: 'Completed',
                    WAREHOUSE: v.warehouse || '', SUB_INVENTORY: v.subinventory || '',
                    PRICELIST: v.pricelist || 'PUBLIC', PRICINGDATE: null,
                    FUSION_INTERFACE_ST: 'NO', CONFIRM_ORDER_ST: 'NO',
                    LOGIN_ID: v.login_id || '', LOGIN_NAME: v.login_id || '',
                    MEMEBERSHIP_ID: '', PALYER_ID: '',
                    TOTAL_TAX: 0, TOTAL_DISCOUNT: 0, TOTAL_NET: totalNet, TOTAL_GROSS: totalNet,
                    QOH: 0, SFUTURE1: 'AIChat', SFUTURE2: null, DFUTURE1: 0, DFUTURE2: 0,
                    ORDER_STATUS: 'CONFIRM', IsReturned: false, ReturnDate: null, RetunAmount: 0,
                    DiscountItem: 0, DiscountType: 'Flat ', OriginalOrderNumber: null,
                    approvestatus: null, approvedby: null, approvedDate: null,
                    Holdreleasedate: null, holdreleasedby: null, customerConfirmationStatus: null,
                    ITEM_COMMENTS: null, SHIPIING_COMMENT: null, DELIVERY_LOCATION: null,
                    Payment_type: null, payment_reference: null, DELIVERY_DATE: null, DELIVERED_BY: null,
                    ASSIGNED_BY: null, ASSIGNED_FROM: null, customer_BRN: null, customer_VATREGNO: null,
                    customer_address: null, shopname: null, shopaddress: null, shopphone: null,
                    ASSIGNED_DATE: '0001-01-01T00:00:00', Store_Lat: 0, Store_Long: 0,
                    offline_order_number: String(cartId), order_Creation_mode: 'AIChat',
                    OrderTime: new Date().toTimeString().slice(0, 8),
                    Paymentdetails: [],
                    lines: lines
                };
                return { OrderHeader: [header] };
            },
            note: 'Option 1 of order creation - the order is stored in the WMS DB (NEWORDER) and interfaced to Fusion by the interface procedure. The form values are wrapped into the full OrderHeader payload on submit. TOTAL/TAX amounts are computed as simple sums (no tax engine) - the interface procedure recalculates. Payments are empty (B2B order). Untick any line you don\'t want.'
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

        // Optional transform: an api can reshape the collected form values
        // into the endpoint's real payload (e.g. order.create -> OrderHeader)
        if (typeof api.buildBody === 'function') {
            body = JSON.stringify(api.buildBody(bodyObj, instance));
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
    var CATALOG_URL = 'https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/WAREHOUSEMANAGEMENT/ai/apicatalog';

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

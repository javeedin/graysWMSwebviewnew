/* WMS 2.0 — VERBATIM COPY of the WMS order / store-transaction dialogs (wms/app.js lines 10741-15746:
   editTripOrder, openStoreTransactionsDialog, openOrderTransactionsDialog and every tab / action they use —
   sales order lines, pick release details, lots, shipment lines, pick confirm, ship confirm, cancel lines, QOH,
   allocated lots, set data, process transaction). Copied as is so the same, fully tested code runs in WMS 2.0;
   the WMS module itself is not changed. Do not edit this block: fix the original and copy it again.
   Globals it expects (sendMessageToCSharp, showNotification, transactionDetailsGrid …) come from legacy/bridge.js. */
(function () {
    window.editTripOrder = function(rowData) {
        console.log('[Trip Management] Edit order:', rowData);

        const orderType = rowData.ORDER_TYPE || rowData.order_type || '';

        // Check if order type is 'Store to Van' or 'Van to Store'
        if (orderType === 'Store to Van' || orderType === 'Van to Store') {
            openStoreTransactionsDialog(rowData);
        } else {
            // For other order types, open Order Transactions dialog
            openOrderTransactionsDialog(rowData);
        }
    };

    window.openStoreTransactionsDialog = function(rowData) {
        console.log('[Store Transactions] Opening dialog for order:', rowData);

        const orderNumber = rowData.ORDER_NUMBER || rowData.order_number || '';
        const orderType = rowData.ORDER_TYPE || rowData.order_type || rowData.ORDER_TYPE_CODE || rowData.order_type_code || '';
        const tripId = rowData.TRIP_ID || rowData.trip_id || '';
        const tripDate = rowData.TRIP_DATE || rowData.trip_date || '';
        const accountNumber = rowData.ACCOUNT_NUMBER || rowData.account_number || '';
        const accountName = rowData.ACCOUNT_NAME || rowData.account_name || '';
        const picker = rowData.PICKER || rowData.picker || '';
        const lorry = rowData.LORRY_NUMBER || rowData.lorry_number || '';
        const priority = rowData.PRIORITY || rowData.priority || '';
        const pickConfirmSt = rowData.PICK_CONFIRM_ST || rowData.pick_confirm_st || '';
        const instance = rowData.instance_name || rowData.INSTANCE_NAME || rowData.instance || rowData.INSTANCE || 'TEST';

        // Debug: Log the exact ORDER_TYPE value
        console.log('===========================================');
        console.log('[Store Transactions] ORDER_TYPE from rowData:', orderType);
        console.log('[Store Transactions] ORDER_TYPE length:', orderType.length);
        console.log('[Store Transactions] ORDER_TYPE char codes:', Array.from(orderType).map(c => c.charCodeAt(0)));
        console.log('===========================================');

        // Store order type, tripId, and tripDate in globals for print function
        window.currentStoreTransOrderType = orderType;
        window.currentStoreTransTripId = String(tripId);  // Convert to string for C# handler
        window.currentStoreTransTripDate = tripDate;

        // Create modal HTML
        const modalHtml = `
            <div id="store-transactions-modal" style="display: flex; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 25000; justify-content: center; align-items: center;">
                <div style="background: white; width: 95%; max-width: 1400px; height: 90%; border-radius: 12px; display: flex; flex-direction: column; box-shadow: 0 20px 60px rgba(0,0,0,0.3); overflow: hidden;">
                    <!-- Modal Header -->
                    <div style="padding: 0.75rem 1rem; border-bottom: 2px solid #e2e8f0; background: whitesmoke;">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
                            <div style="display: flex; align-items: center; gap: 0.5rem;">
                                <h2 style="margin: 0; font-size: 1.1rem; color: #1e293b; font-weight: 700;">
                                    <i class="fas fa-exchange-alt" style="color: #667eea;"></i> Store Transactions
                                </h2>
                                <button id="store-trans-header-toggle" onclick="toggleStoreTransHeader()" style="background: transparent; border: none; cursor: pointer; color: #667eea; padding: 0.2rem 0.4rem; transition: all 0.2s;" title="Toggle Details">
                                    <i class="fas fa-chevron-down" style="font-size: 0.9rem; transition: transform 0.3s;"></i>
                                </button>
                            </div>
                            <div style="display: flex; gap: 0.5rem; align-items: center;">
                                <button onclick="toggleStoreTransApiInfo()" style="background: #0ea5e9; border: none; cursor: pointer; color: white; padding: 0.4rem 0.8rem; border-radius: 4px; font-size: 0.75rem; display: flex; align-items: center; gap: 0.3rem; transition: all 0.2s;" onmouseover="this.style.background='#0284c7';" onmouseout="this.style.background='#0ea5e9';" title="View API Endpoints">
                                    <i class="fas fa-plug"></i> API
                                </button>
                                <button onclick="printStoreTransaction('${orderNumber}', '${instance}', '${orderType}', '${tripId}', '${tripDate}')" style="background: #8b5cf6; border: none; cursor: pointer; color: white; padding: 0.4rem 0.8rem; border-radius: 4px; font-size: 0.75rem; display: flex; align-items: center; gap: 0.3rem; transition: all 0.2s;" onmouseover="this.style.background='#7c3aed';" onmouseout="this.style.background='#8b5cf6';" title="Print Store Transaction">
                                    <i class="fas fa-print"></i> Print
                                </button>
                                <button onclick="closeStoreTransactionsModal()" style="background: transparent; border: 1px solid #cbd5e1; font-size: 20px; cursor: pointer; color: #64748b; padding: 0; width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; border-radius: 4px; transition: all 0.2s;" onmouseover="this.style.background='#e2e8f0'; this.style.color='#1e293b';" onmouseout="this.style.background='transparent'; this.style.color='#64748b';">
                                    ×
                                </button>
                            </div>
                        </div>

                        <!-- Header Details (Collapsible, Default Collapsed) -->
                        <div id="store-trans-header-details" style="display: none; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 0.4rem; padding: 0.5rem; background: white; border-radius: 6px; border: 1px solid #e2e8f0; margin-top: 0.5rem; transition: all 0.3s;">
                            <div><span style="color: #64748b; font-size: 0.6rem; font-weight: 600;">Trip ID:</span><br><strong style="color: #1e293b; font-size: 0.75rem;">${tripId}</strong></div>
                            <div><span style="color: #64748b; font-size: 0.6rem; font-weight: 600;">Order Number:</span><br><strong style="color: #1e293b; font-size: 0.75rem;">${orderNumber}</strong></div>
                            <div><span style="color: #64748b; font-size: 0.6rem; font-weight: 600;">Instance:</span><br><strong style="color: #8b5cf6; font-size: 0.75rem; font-weight: 700;">${instance}</strong></div>
                            <div><span style="color: #64748b; font-size: 0.6rem; font-weight: 600;">Date:</span><br><strong style="color: #1e293b; font-size: 0.75rem;">${tripDate}</strong></div>
                            <div><span style="color: #64748b; font-size: 0.6rem; font-weight: 600;">Account Number:</span><br><strong style="color: #1e293b; font-size: 0.75rem;">${accountNumber}</strong></div>
                            <div><span style="color: #64748b; font-size: 0.6rem; font-weight: 600;">Account Name:</span><br><strong style="color: #1e293b; font-size: 0.75rem;">${accountName}</strong></div>
                            <div><span style="color: #64748b; font-size: 0.6rem; font-weight: 600;">Picker:</span><br><strong style="color: #1e293b; font-size: 0.75rem;">${picker}</strong></div>
                            <div><span style="color: #64748b; font-size: 0.6rem; font-weight: 600;">Lorry:</span><br><strong style="color: #1e293b; font-size: 0.75rem;">${lorry}</strong></div>
                            <div><span style="color: #64748b; font-size: 0.6rem; font-weight: 600;">Priority:</span><br><strong style="color: #1e293b; font-size: 0.75rem;">${priority}</strong></div>
                            <div><span style="color: #64748b; font-size: 0.6rem; font-weight: 600;">Pick Confirm St:</span><br><strong style="color: #1e293b; font-size: 0.75rem;">${pickConfirmSt}</strong></div>
                        </div>

                        <!-- API Info Panel (Collapsible) -->
                        <div id="store-trans-api-info" style="display: none; margin-top: 0.5rem; padding: 0.75rem; background: #f0f9ff; border-radius: 8px; border: 1px solid #bae6fd; max-height: 320px; overflow-y: auto;">
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
                                <h4 style="margin: 0; font-size: 0.8rem; color: #0369a1; font-weight: 700;">
                                    <i class="fas fa-plug"></i> API Endpoints Used
                                </h4>
                                <span style="font-size: 0.65rem; color: #64748b;">9 endpoints</span>
                            </div>

                            <div style="display: flex; flex-direction: column; gap: 0.4rem; font-size: 0.7rem;">
                                <!-- 1. refreshTransactionDetails -->
                                <div style="background: white; padding: 0.5rem; border-radius: 6px; border-left: 3px solid #10b981;">
                                    <div style="display: flex; align-items: center; gap: 0.4rem; margin-bottom: 0.2rem;">
                                        <span style="background: #10b981; color: white; padding: 0.1rem 0.4rem; border-radius: 3px; font-size: 0.6rem; font-weight: 700;">GET</span>
                                        <strong style="color: #1e293b;">Transaction Details</strong>
                                        <span style="color: #64748b; font-size: 0.6rem;">— refreshTransactionDetails()</span>
                                    </div>
                                    <code style="color: #0369a1; font-size: 0.6rem; word-break: break-all;">.../WAREHOUSEMANAGEMENT/trip/s2vdetails/{orderNumber}?p_instance_name={instance}</code>
                                </div>

                                <!-- 2. refreshQOHDetails -->
                                <div style="background: white; padding: 0.5rem; border-radius: 6px; border-left: 3px solid #10b981;">
                                    <div style="display: flex; align-items: center; gap: 0.4rem; margin-bottom: 0.2rem;">
                                        <span style="background: #10b981; color: white; padding: 0.1rem 0.4rem; border-radius: 3px; font-size: 0.6rem; font-weight: 700;">GET</span>
                                        <strong style="color: #1e293b;">QOH Details</strong>
                                        <span style="color: #64748b; font-size: 0.6rem;">— refreshQOHDetails()</span>
                                    </div>
                                    <code style="color: #0369a1; font-size: 0.6rem; word-break: break-all;">.../WAREHOUSEMANAGEMENT/trip/tripqoh?v_trx_number={orderNumber}&p_instance_name={instance}</code>
                                </div>

                                <!-- 3. refreshAllocatedLots -->
                                <div style="background: white; padding: 0.5rem; border-radius: 6px; border-left: 3px solid #10b981;">
                                    <div style="display: flex; align-items: center; gap: 0.4rem; margin-bottom: 0.2rem;">
                                        <span style="background: #10b981; color: white; padding: 0.1rem 0.4rem; border-radius: 3px; font-size: 0.6rem; font-weight: 700;">GET</span>
                                        <strong style="color: #1e293b;">Allocated Lots</strong>
                                        <span style="color: #64748b; font-size: 0.6rem;">— refreshAllocatedLots()</span>
                                    </div>
                                    <code style="color: #0369a1; font-size: 0.6rem; word-break: break-all;">.../WAREHOUSEMANAGEMENT/trip/fetchlotdetails?v_trx_number={orderNumber}&p_instance_name={instance}</code>
                                </div>

                                <!-- 4. fetchLotDetails -->
                                <div style="background: white; padding: 0.5rem; border-radius: 6px; border-left: 3px solid #f59e0b;">
                                    <div style="display: flex; align-items: center; gap: 0.4rem; margin-bottom: 0.2rem;">
                                        <span style="background: #f59e0b; color: white; padding: 0.1rem 0.4rem; border-radius: 3px; font-size: 0.6rem; font-weight: 700;">POST</span>
                                        <strong style="color: #1e293b;">Fetch Lot Details</strong>
                                        <span style="color: #64748b; font-size: 0.6rem;">— fetchLotDetails()</span>
                                    </div>
                                    <code style="color: #0369a1; font-size: 0.6rem; word-break: break-all;">.../WAREHOUSEMANAGEMENT/trip/fetchlotdetails</code>
                                    <div style="color: #64748b; font-size: 0.6rem; margin-top: 0.2rem;">Body: { p_trx_number, p_instance_name }</div>
                                </div>

                                <!-- 5. processTransaction -->
                                <div style="background: white; padding: 0.5rem; border-radius: 6px; border-left: 3px solid #f59e0b;">
                                    <div style="display: flex; align-items: center; gap: 0.4rem; margin-bottom: 0.2rem;">
                                        <span style="background: #f59e0b; color: white; padding: 0.1rem 0.4rem; border-radius: 3px; font-size: 0.6rem; font-weight: 700;">POST</span>
                                        <strong style="color: #1e293b;">Process Transaction (S2V)</strong>
                                        <span style="color: #64748b; font-size: 0.6rem;">— processTransaction()</span>
                                    </div>
                                    <code style="color: #0369a1; font-size: 0.6rem; word-break: break-all;">.../WAREHOUSEMANAGEMENT/trip/processs2v</code>
                                    <div style="color: #64748b; font-size: 0.6rem; margin-top: 0.2rem;">Body: { p_trx_number, p_instance_name }</div>
                                </div>

                                <!-- 6. setData -->
                                <div style="background: white; padding: 0.5rem; border-radius: 6px; border-left: 3px solid #f59e0b;">
                                    <div style="display: flex; align-items: center; gap: 0.4rem; margin-bottom: 0.2rem;">
                                        <span style="background: #f59e0b; color: white; padding: 0.1rem 0.4rem; border-radius: 3px; font-size: 0.6rem; font-weight: 700;">POST</span>
                                        <strong style="color: #1e293b;">Set Data</strong>
                                        <span style="color: #64748b; font-size: 0.6rem;">— setData() / submitSetData()</span>
                                    </div>
                                    <code style="color: #0369a1; font-size: 0.6rem; word-break: break-all;">.../TRIPMANAGEMENT/trip/sets2vdata</code>
                                    <div style="color: #64748b; font-size: 0.6rem; margin-top: 0.2rem;">Body: { records: [{ lid, picked_qty, p_instance_name, ... }] }</div>
                                </div>

                                <!-- 7. cancelSelectedTransactionLines -->
                                <div style="background: white; padding: 0.5rem; border-radius: 6px; border-left: 3px solid #ef4444;">
                                    <div style="display: flex; align-items: center; gap: 0.4rem; margin-bottom: 0.2rem;">
                                        <span style="background: #ef4444; color: white; padding: 0.1rem 0.4rem; border-radius: 3px; font-size: 0.6rem; font-weight: 700;">POST</span>
                                        <strong style="color: #1e293b;">Cancel Transaction Lines</strong>
                                        <span style="color: #64748b; font-size: 0.6rem;">— cancelSelectedTransactionLines()</span>
                                    </div>
                                    <code style="color: #0369a1; font-size: 0.6rem; word-break: break-all;">.../TRIPMANAGEMENT/trip/cancels2vline/{transactionId}?p_instance_name={instance}</code>
                                    <div style="color: #64748b; font-size: 0.6rem; margin-top: 0.2rem;">Cancels selected PENDING lines sequentially</div>
                                </div>

                                <!-- 8. checkFusionStatus -->
                                <div style="background: white; padding: 0.5rem; border-radius: 6px; border-left: 3px solid #94a3b8;">
                                    <div style="display: flex; align-items: center; gap: 0.4rem; margin-bottom: 0.2rem;">
                                        <span style="background: #94a3b8; color: white; padding: 0.1rem 0.4rem; border-radius: 3px; font-size: 0.6rem; font-weight: 700;">N/A</span>
                                        <strong style="color: #1e293b;">Check Fusion Status</strong>
                                        <span style="color: #64748b; font-size: 0.6rem;">— checkFusionStatus()</span>
                                    </div>
                                    <code style="color: #94a3b8; font-size: 0.6rem; font-style: italic;">Not yet implemented — placeholder</code>
                                </div>

                                <!-- 9. printStoreTransaction -->
                                <div style="background: white; padding: 0.5rem; border-radius: 6px; border-left: 3px solid #8b5cf6;">
                                    <div style="display: flex; align-items: center; gap: 0.4rem; margin-bottom: 0.2rem;">
                                        <span style="background: #8b5cf6; color: white; padding: 0.1rem 0.4rem; border-radius: 3px; font-size: 0.6rem; font-weight: 700;">SOAP</span>
                                        <strong style="color: #1e293b;">Print Store Transaction</strong>
                                        <span style="color: #64748b; font-size: 0.6rem;">— printStoreTransaction()</span>
                                    </div>
                                    <code style="color: #0369a1; font-size: 0.6rem; word-break: break-all;">C# Handler → Oracle Fusion Cloud SOAP Report</code>
                                    <div style="color: #64748b; font-size: 0.6rem; margin-top: 0.2rem;">S2V/V2S: /Custom/DEXPRESS/STORETRANSACTIONS/GRAYS_MATERIAL_TRANSACTIONS_BIP.xdo<br>Others: /Custom/OQ/GR_SalesOrder_Rep.xdo</div>
                                </div>
                            </div>

                            <div style="margin-top: 0.5rem; padding-top: 0.4rem; border-top: 1px solid #bae6fd; font-size: 0.6rem; color: #64748b;">
                                <strong>Base URL:</strong> https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/<br>
                                <strong>Instance:</strong> ${instance} | <strong>All calls routed via:</strong> C# WebView2 sendMessageToCSharp()
                            </div>
                        </div>
                    </div>

                    <!-- Tab Header -->
                    <div style="display: flex; gap: 0.5rem; padding: 0.75rem 1.5rem; background: #f8f9fc; border-bottom: 2px solid #e2e8f0;">
                        <button class="store-trans-tab active" data-tab="transaction-details" onclick="switchStoreTransTab('transaction-details')" style="padding: 0.5rem 1.5rem; border: none; background: white; border-radius: 6px; cursor: pointer; font-weight: 600; color: #667eea; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                            Transaction Details
                        </button>
                        <button class="store-trans-tab" data-tab="qoh-details" onclick="switchStoreTransTab('qoh-details')" style="padding: 0.5rem 1.5rem; border: none; background: transparent; border-radius: 6px; cursor: pointer; font-weight: 600; color: #64748b;">
                            QOH Details
                        </button>
                        <button class="store-trans-tab" data-tab="allocated-lots" onclick="switchStoreTransTab('allocated-lots')" style="padding: 0.5rem 1.5rem; border: none; background: transparent; border-radius: 6px; cursor: pointer; font-weight: 600; color: #64748b;">
                            Allocated Lots
                        </button>
                        <button class="store-trans-tab" data-tab="debug" onclick="switchStoreTransTab('debug')" style="padding: 0.5rem 1.5rem; border: none; background: transparent; border-radius: 6px; cursor: pointer; font-weight: 600; color: #64748b;">
                            <i class="fas fa-bug"></i> Debug
                        </button>
                    </div>

                    <!-- Tab Content -->
                    <div style="flex: 1; overflow: hidden; position: relative;">
                        <!-- Tab 1: Transaction Details -->
                        <div id="store-trans-transaction-details" class="store-trans-tab-content active" style="height: 100%; overflow: auto; padding: 1rem;">
                            <div style="margin-bottom: 0.75rem; display: flex; gap: 0.5rem; flex-wrap: wrap;">
                                <button class="btn btn-secondary" onclick="refreshTransactionDetails('${orderNumber}')">
                                    <i class="fas fa-sync-alt"></i> Refresh
                                </button>
                                <button class="btn btn-primary" onclick="fetchLotDetails('${orderNumber}')" id="fetch-lot-btn" style="display: none;">
                                    <i class="fas fa-list"></i> Fetch Lot Details
                                </button>
                                <button class="btn btn-danger" onclick="cancelSelectedTransactionLines('${orderNumber}')" id="cancel-selected-lines-btn" style="display: none; background: #e5e7eb; color: #1f2937; border: 1px solid #d1d5db;">
                                    <i class="fas fa-ban"></i> Cancel Selected Lines
                                </button>
                            </div>
                            <div id="transaction-details-content" style="background: white; border-radius: 8px; padding: 0.75rem; height: calc(100% - 4rem);">
                                <div id="transaction-details-grid" style="height: 100%;"></div>
                            </div>
                        </div>

                        <!-- Tab 2: QOH Details -->
                        <div id="store-trans-qoh-details" class="store-trans-tab-content" style="height: 100%; overflow: auto; padding: 1rem; display: none;">
                            <div style="margin-bottom: 0.75rem; display: flex; gap: 0.5rem;">
                                <button class="btn btn-secondary" onclick="refreshQOHDetails('${orderNumber}')">
                                    <i class="fas fa-sync-alt"></i> Refresh
                                </button>
                            </div>
                            <div id="qoh-details-content" style="background: white; border-radius: 8px; padding: 0.75rem; height: calc(100% - 4rem);">
                                <div id="qoh-details-grid" style="height: 100%;"></div>
                            </div>
                        </div>

                        <!-- Tab 3: Allocated Lots -->
                        <div id="store-trans-allocated-lots" class="store-trans-tab-content" style="height: 100%; overflow: auto; padding: 1rem; display: none;">
                            <div style="margin-bottom: 0.75rem; display: flex; gap: 0.5rem; flex-wrap: wrap;">
                                <button class="btn btn-secondary" onclick="refreshAllocatedLots('${orderNumber}')">
                                    <i class="fas fa-sync-alt"></i> Refresh
                                </button>
                                <button class="btn btn-primary" onclick="processTransaction('${orderNumber}')">
                                    <i class="fas fa-cogs"></i> Process Transaction
                                </button>
                                <button class="btn btn-secondary" onclick="setData('${orderNumber}')">
                                    <i class="fas fa-database"></i> Set Data
                                </button>
                                <button class="btn btn-info" onclick="checkFusionStatus('${orderNumber}')">
                                    <i class="fas fa-check-circle"></i> Check Fusion Status
                                </button>
                            </div>
                            <div id="allocated-lots-content" style="background: white; border-radius: 8px; padding: 0.75rem; height: calc(100% - 4rem);">
                                <div id="allocated-lots-grid" style="height: 100%;"></div>
                            </div>
                        </div>

                        <!-- Tab 4: Debug -->
                        <div id="store-trans-debug" class="store-trans-tab-content" style="height: 100%; overflow: auto; padding: 1rem; display: none;">
                            <div style="margin-bottom: 0.75rem; display: flex; gap: 0.5rem; justify-content: space-between; align-items: center;">
                                <h3 style="margin: 0; font-size: 0.9rem; color: #1e293b;">
                                    <i class="fas fa-bug"></i> Debug Log
                                </h3>
                                <button class="btn btn-secondary" onclick="clearDebugLog()" style="font-size: 0.75rem; padding: 0.4rem 0.8rem;">
                                    <i class="fas fa-trash"></i> Clear Log
                                </button>
                            </div>
                            <div id="debug-log-content" style="background: #1e293b; border-radius: 8px; padding: 1rem; font-family: 'Courier New', monospace; font-size: 0.75rem; color: #10b981; height: calc(100% - 3rem); overflow: auto;">
                                <div style="color: #64748b; text-align: center; padding: 2rem;">
                                    <i class="fas fa-info-circle" style="font-size: 1.5rem; margin-bottom: 0.5rem;"></i>
                                    <p>Debug log will appear here when you click any button</p>
                                    <p style="font-size: 0.7rem; margin-top: 0.5rem;">Endpoints, JSON payloads, and responses will be logged</p>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;

        // Add modal to body
        const existingModal = document.getElementById('store-transactions-modal');
        if (existingModal) {
            existingModal.remove();
        }
        document.body.insertAdjacentHTML('beforeend', modalHtml);

        // Auto-load all tabs data
        console.log('[Store Transactions] Auto-loading all tab data for order:', orderNumber);
        setTimeout(() => {
            refreshTransactionDetails(orderNumber);
            refreshQOHDetails(orderNumber);
            refreshAllocatedLots(orderNumber);
        }, 100);
    };

    window.closeStoreTransactionsModal = function() {
        const modal = document.getElementById('store-transactions-modal');
        if (modal) {
            modal.remove();
        }
    };

    window.toggleStoreTransApiInfo = function() {
        const panel = document.getElementById('store-trans-api-info');
        if (panel) {
            panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
        }
    };

    // ============================================================================
    // ORDER TRANSACTIONS DIALOG (Non-S2V/V2S Orders)
    // ============================================================================

    // Store current order transaction context
    window.currentOrderTransContext = null;

    window.openOrderTransactionsDialog = function(rowData) {
        console.log('[Order Transactions] Opening dialog for order:', rowData);

        const orderNumber = rowData.ORDER_NUMBER || rowData.order_number || rowData.SOURCE_ORDER_NUMBER || rowData.source_order_number || '';
        const sourceOrderNumber = rowData.SOURCE_ORDERNUM || rowData.source_ordernum || rowData.SOURCE_ORDER_NUMBER || rowData.source_order_number || orderNumber;
        const orderType = rowData.ORDER_TYPE || rowData.order_type || rowData.ORDER_TYPE_CODE || rowData.order_type_code || '';
        const orderDate = rowData.ORDER_DATE || rowData.order_date || '';
        const tripId = rowData.TRIP_ID || rowData.trip_id || '';
        const tripDate = rowData.TRIP_DATE || rowData.trip_date || '';
        const accountNumber = rowData.ACCOUNT_NUMBER || rowData.account_number || '';
        const accountName = rowData.ACCOUNT_NAME || rowData.account_name || rowData.CUSTOMER_NAME || rowData.customer_name || '';
        const picker = rowData.PICKER || rowData.picker || '';
        const lorry = rowData.LORRY_NUMBER || rowData.lorry_number || '';
        const priority = rowData.PRIORITY || rowData.priority || '';
        const lineStatus = rowData.LINE_STATUS || rowData.line_status || '';
        const instance = rowData.instance_name || rowData.INSTANCE_NAME || rowData.instance || rowData.INSTANCE || window.currentTripInstance || 'TEST';

        // Store instance globally for use by updatePickConfirmStatusSelected
        window.currentOrderTransactionsInstance = instance;

        // Store context globally for API calls
        window.currentOrderTransContext = {
            orderNumber,
            sourceOrderNumber,
            orderType,
            orderDate,
            tripId,
            tripDate,
            accountNumber,
            accountName,
            picker,
            lorry,
            priority,
            lineStatus,
            instance
        };

        console.log('[Order Transactions] ORDER_NUMBER:', orderNumber, 'SOURCE_ORDERNUM:', sourceOrderNumber, 'ORDER_TYPE:', orderType, 'INSTANCE:', instance);

        // Create modal HTML
        const modalHtml = `
            <div id="order-transactions-modal" style="display: flex; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 25000; justify-content: center; align-items: center;">
                <div style="background: white; width: 95%; max-width: 1400px; height: 90%; border-radius: 12px; display: flex; flex-direction: column; box-shadow: 0 20px 60px rgba(0,0,0,0.3); overflow: hidden;">
                    <!-- Modal Header -->
                    <div style="padding: 0.75rem 1rem; border-bottom: 2px solid #e2e8f0; background: whitesmoke;">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
                            <div style="display: flex; align-items: center; gap: 0.5rem;">
                                <h2 style="margin: 0; font-size: 1.1rem; color: #1e293b; font-weight: 700;">
                                    <i class="fas fa-file-invoice" style="color: #667eea;"></i> Order Transactions <span style="color:#667eea;">(${orderNumber})</span>
                                </h2>
                                <button id="order-trans-header-toggle" onclick="toggleOrderTransHeader()" style="background: transparent; border: none; cursor: pointer; color: #667eea; padding: 0.2rem 0.4rem; transition: all 0.2s;" title="Toggle Details">
                                    <i class="fas fa-chevron-down" style="font-size: 0.9rem; transition: transform 0.3s;"></i>
                                </button>
                                <button onclick="showOrderTransactionsApiInfo()" style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; border: none; padding: 4px 10px; border-radius: 6px; font-size: 11px; cursor: pointer; display: flex; align-items: center; gap: 4px;" title="View API Information">
                                    <i class="fas fa-code"></i> API
                                </button>
                                <button onclick="refreshPickSlipDetail('${orderNumber}')" style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: white; border: none; padding: 4px 10px; border-radius: 6px; font-size: 11px; cursor: pointer; display: flex; align-items: center; gap: 4px;" title="Refresh Pick Slip Detail (Web Services 2 & 3)">
                                    <i class="fas fa-sync-alt"></i> Refresh Pick Slip
                                </button>
                                <span style="background: #e0f2fe; color: #0369a1; padding: 3px 8px; border-radius: 4px; font-size: 10px; font-weight: 600;">
                                    Instance: ${instance}
                                </span>
                            </div>
                            <button onclick="closeOrderTransactionsModal()" style="background: none; border: none; font-size: 1.5rem; cursor: pointer; color: #64748b; transition: color 0.2s; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; border-radius: 6px;" onmouseover="this.style.background='#fee2e2'; this.style.color='#dc2626';" onmouseout="this.style.background='none'; this.style.color='#64748b';">
                                <i class="fas fa-times"></i>
                            </button>
                        </div>

                        <!-- Collapsible Header Details (Default: Collapsed) -->
                        <div id="order-trans-header-details" style="display: none; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 0.4rem; padding: 0.5rem; background: white; border-radius: 6px; border: 1px solid #e2e8f0; margin-top: 0.5rem; transition: all 0.3s;">
                            <div><span style="color: #64748b; font-size: 0.6rem; font-weight: 600;">Order Number:</span><br><strong id="otr-order-number" style="color: #1e293b; font-size: 0.75rem;">${orderNumber}</strong></div>
                            <div><span style="color: #64748b; font-size: 0.6rem; font-weight: 600;">Order Date:</span><br><strong id="otr-order-date" style="color: #1e293b; font-size: 0.75rem;">${orderDate || '<span style="color:#9ca3af;font-style:italic;font-size:0.7rem;">Loading...</span>'}</strong></div>
                            <div><span style="color: #64748b; font-size: 0.6rem; font-weight: 600;">Order Type:</span><br><strong id="otr-order-type" style="color: #1e293b; font-size: 0.75rem;">${orderType || '<span style="color:#9ca3af;font-style:italic;font-size:0.7rem;">Loading...</span>'}</strong></div>
                            <div><span style="color: #64748b; font-size: 0.6rem; font-weight: 600;">Account Number:</span><br><strong id="otr-account-number" style="color: #1e293b; font-size: 0.75rem;">${accountNumber || '<span style="color:#9ca3af;font-style:italic;font-size:0.7rem;">Loading...</span>'}</strong></div>
                            <div><span style="color: #64748b; font-size: 0.6rem; font-weight: 600;">Account Name:</span><br><strong id="otr-account-name" style="color: #1e293b; font-size: 0.75rem;">${accountName || '<span style="color:#9ca3af;font-style:italic;font-size:0.7rem;">Loading...</span>'}</strong></div>
                            <div><span style="color: #64748b; font-size: 0.6rem; font-weight: 600;">Trip ID:</span><br><strong id="otr-trip-id" style="color: #1e293b; font-size: 0.75rem;">${tripId || '<span style="color:#9ca3af;font-style:italic;font-size:0.7rem;">Loading...</span>'}</strong></div>
                            <div><span style="color: #64748b; font-size: 0.6rem; font-weight: 600;">Trip Date:</span><br><strong id="otr-trip-date" style="color: #1e293b; font-size: 0.75rem;">${tripDate || '<span style="color:#9ca3af;font-style:italic;font-size:0.7rem;">Loading...</span>'}</strong></div>
                            <div><span style="color: #64748b; font-size: 0.6rem; font-weight: 600;">Picker:</span><br><strong id="otr-picker" style="color: #1e293b; font-size: 0.75rem;">${picker || '<span style="color:#9ca3af;font-style:italic;font-size:0.7rem;">Loading...</span>'}</strong></div>
                            <div><span style="color: #64748b; font-size: 0.6rem; font-weight: 600;">Lorry:</span><br><strong id="otr-lorry" style="color: #1e293b; font-size: 0.75rem;">${lorry || '<span style="color:#9ca3af;font-style:italic;font-size:0.7rem;">Loading...</span>'}</strong></div>
                            <div><span style="color: #64748b; font-size: 0.6rem; font-weight: 600;">Priority:</span><br><strong id="otr-priority" style="color: #1e293b; font-size: 0.75rem;">${priority || '<span style="color:#9ca3af;font-style:italic;font-size:0.7rem;">Loading...</span>'}</strong></div>
                            <div><span style="color: #64748b; font-size: 0.6rem; font-weight: 600;">Status:</span><br><strong id="otr-line-status" style="color: #1e293b; font-size: 0.75rem;">${lineStatus || '<span style="color:#9ca3af;font-style:italic;font-size:0.7rem;">Loading...</span>'}</strong></div>
                            <div><span style="color: #64748b; font-size: 0.6rem; font-weight: 600;">Instance:</span><br><strong style="color: #7c3aed; font-size: 0.75rem;">${instance}</strong></div>
                        </div>
                    </div>

                    <!-- Tab Header -->
                    <div style="display: flex; gap: 0.5rem; padding: 0.75rem 1.5rem; background: #f8f9fc; border-bottom: 2px solid #e2e8f0; overflow-x: auto;">
                        <button class="order-trans-tab active" data-tab="pick-release" onclick="switchOrderTransTab('pick-release')" style="padding: 0.5rem 1.2rem; border: none; background: white; border-radius: 6px; cursor: pointer; font-weight: 600; color: #667eea; box-shadow: 0 2px 4px rgba(0,0,0,0.1); white-space: nowrap; font-size: 0.85rem;">
                            <i class="fas fa-box-open"></i> Pick Release Details
                        </button>
                        <button class="order-trans-tab" data-tab="fusion-shipment-lines" onclick="switchOrderTransTab('fusion-shipment-lines')" style="padding: 0.5rem 1.2rem; border: none; background: transparent; border-radius: 6px; cursor: pointer; font-weight: 600; color: #64748b; white-space: nowrap; font-size: 0.85rem;">
                            <i class="fas fa-truck"></i> Shipment Lines
                        </button>
                        <button class="order-trans-tab" data-tab="sales-order-lines" onclick="switchOrderTransTab('sales-order-lines')" style="padding: 0.5rem 1.2rem; border: none; background: transparent; border-radius: 6px; cursor: pointer; font-weight: 600; color: #64748b; white-space: nowrap; font-size: 0.85rem;">
                            <i class="fas fa-shopping-cart"></i> Sales Order Lines
                        </button>
                        <button class="order-trans-tab" data-tab="lot-details" onclick="switchOrderTransTab('lot-details')" style="padding: 0.5rem 1.2rem; border: none; background: transparent; border-radius: 6px; cursor: pointer; font-weight: 600; color: #64748b; white-space: nowrap; font-size: 0.85rem;">
                            <i class="fas fa-barcode"></i> Lot Details
                        </button>
                        <button class="order-trans-tab" data-tab="shipment-details" onclick="switchOrderTransTab('shipment-details')" style="padding: 0.5rem 1.2rem; border: none; background: transparent; border-radius: 6px; cursor: pointer; font-weight: 600; color: #64748b; white-space: nowrap; font-size: 0.85rem;">
                            <i class="fas fa-shipping-fast"></i> Shipment Details
                        </button>
                        <button class="order-trans-tab" data-tab="pick-confirm-responses" onclick="switchOrderTransTab('pick-confirm-responses')" style="padding: 0.5rem 1.2rem; border: none; background: transparent; border-radius: 6px; cursor: pointer; font-weight: 600; color: #64748b; white-space: nowrap; font-size: 0.85rem;">
                            <i class="fas fa-check-double"></i> Pick Confirm Responses
                        </button>
                        <button class="order-trans-tab" data-tab="ship-confirm-responses" onclick="switchOrderTransTab('ship-confirm-responses')" style="padding: 0.5rem 1.2rem; border: none; background: transparent; border-radius: 6px; cursor: pointer; font-weight: 600; color: #64748b; white-space: nowrap; font-size: 0.85rem;">
                            <i class="fas fa-truck-loading"></i> Ship Confirm Responses
                        </button>
                    </div>

                    <!-- Tab Content -->
                    <div style="flex: 1; overflow: hidden; position: relative;">
                        <!-- Tab 1: Pick Release Details -->
                        <div id="order-trans-pick-release" class="order-trans-tab-content active" style="height: 100%; overflow: auto; padding: 1rem;">
                            <div style="margin-bottom: 0.75rem; display: flex; gap: 0.5rem;">
                                <button class="btn btn-secondary" onclick="refreshPickReleaseDetails('${orderNumber}')">
                                    <i class="fas fa-sync-alt"></i> Refresh
                                </button>
                            </div>
                            <div id="pick-release-content" style="background: white; border-radius: 8px; padding: 0.75rem; height: calc(100% - 4rem);">
                                <div id="pick-release-grid" style="height: 100%;"></div>
                            </div>
                        </div>

                        <!-- Tab: Shipment Lines (Oracle Fusion) -->
                        <div id="order-trans-fusion-shipment-lines" class="order-trans-tab-content" style="height: 100%; overflow: auto; padding: 1rem; display: none;">
                            <div style="margin-bottom: 0.75rem; display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap;">
                                <button class="btn btn-secondary" onclick="refreshFusionShipmentLines('${orderNumber}')">
                                    <i class="fas fa-sync-alt"></i> Refresh
                                </button>
                                <button class="btn btn-primary" onclick="fslPickReleaseBackorders('${orderNumber}')"
                                    style="background:#7c3aed;color:white;border:none;padding:5px 12px;border-radius:6px;cursor:pointer;font-size:12px;font-weight:600;display:flex;align-items:center;gap:5px;">
                                    <i class="fas fa-box-open"></i> Pick Release BackOrders
                                </button>
                                <button onclick="fslShowPickReleaseApiInfo('${orderNumber}')"
                                    style="background:#1e293b;color:#94a3b8;border:1px solid #334155;padding:5px 9px;border-radius:6px;cursor:pointer;font-size:11px;"
                                    title="Show Pick Release API endpoint">
                                    <i class="fas fa-plug"></i>
                                </button>
                                <span id="fusion-shipment-lines-status" style="font-size: 0.8rem; color: #64748b;"></span>
                            </div>
                            <div id="fusion-shipment-lines-content" style="background: white; border-radius: 8px; padding: 0.75rem; height: calc(100% - 4rem);">
                                <div id="fusion-shipment-lines-grid" style="height: 100%;"></div>
                            </div>
                        </div>

                        <!-- Tab 2: Sales Order Lines -->
                        <div id="order-trans-sales-order-lines" class="order-trans-tab-content" style="height: 100%; overflow: auto; padding: 1rem; display: none;">
                            <div style="margin-bottom: 0.75rem; display: flex; gap: 0.5rem; flex-wrap: wrap;">
                                <button class="btn btn-secondary" onclick="refreshSalesOrderLines('${orderNumber}')">
                                    <i class="fas fa-sync-alt"></i> Refresh
                                </button>
                                <button class="btn btn-warning" onclick="showCancelLinesPopup('${orderNumber}', 'scheduled')" style="background: #f59e0b; color: white;">
                                    <i class="fas fa-clock"></i> Cancel Scheduled Lines
                                </button>
                                <button class="btn btn-danger" onclick="showCancelLinesPopup('${orderNumber}', 'selected')" style="background: #ef4444; color: white;">
                                    <i class="fas fa-times-circle"></i> Cancel Selected Lines
                                </button>
                                <button class="btn btn-primary" onclick="fetchFusionOrderLines('${orderNumber}')" style="background: #2563eb; color: white;">
                                    <i class="fas fa-cloud-download-alt"></i> Fetch Order Lines from Fusion
                                </button>
                                <button onclick="showFetchFusionOrderLinesApiInfo('${orderNumber}', '${instance}')" title="View API Info" style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; border: none; padding: 6px 10px; border-radius: 6px; font-size: 11px; cursor: pointer; display: flex; align-items: center; gap: 4px;">
                                    <i class="fas fa-code"></i> API
                                </button>
                            </div>
                            <div id="sales-order-lines-content" style="background: white; border-radius: 8px; padding: 0.75rem; height: calc(100% - 4rem);">
                                <div id="sales-order-lines-grid" style="height: 100%;"></div>
                            </div>
                        </div>

                        <!-- Tab 3: Lot Details -->
                        <div id="order-trans-lot-details" class="order-trans-tab-content" style="height: 100%; overflow: auto; padding: 1rem; display: none;">
                            <div style="margin-bottom: 0.75rem; display: flex; gap: 0.5rem; flex-wrap: wrap;">
                                <button class="btn btn-secondary" onclick="refreshLotDetails('${orderNumber}')">
                                    <i class="fas fa-sync-alt"></i> Refresh
                                </button>
                                <button class="btn btn-primary" onclick="openPickSelectedLinesPopup('${orderNumber}')" style="background: linear-gradient(135deg, #10b981 0%, #059669 100%);">
                                    <i class="fas fa-check-square"></i> Pick Selected Lines
                                </button>
                                <button class="btn btn-warning" onclick="updatePickConfirmStatusSelected('${orderNumber}')" style="background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%); color: white;">
                                    <i class="fas fa-database"></i> Update WMS Status
                                </button>
                                <button class="btn btn-primary" onclick="shipConfirmOrder('${orderNumber}')" style="background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);">
                                    <i class="fas fa-shipping-fast"></i> Ship Confirm Order
                                </button>
                            </div>
                            <div id="lot-details-content" style="background: white; border-radius: 8px; padding: 0.75rem; height: calc(100% - 4rem);">
                                <div id="lot-details-grid" style="height: 100%;"></div>
                            </div>
                        </div>

                        <!-- Tab 4: Shipment Details -->
                        <div id="order-trans-shipment-details" class="order-trans-tab-content" style="height: 100%; overflow: auto; padding: 1rem; display: none;">
                            <div style="margin-bottom: 0.75rem; display: flex; gap: 0.5rem;">
                                <button class="btn btn-secondary" onclick="refreshShipmentDetails('${orderNumber}')">
                                    <i class="fas fa-sync-alt"></i> Refresh
                                </button>
                            </div>
                            <div id="shipment-details-content" style="background: white; border-radius: 8px; padding: 0.75rem; height: calc(100% - 4rem);">
                                <div id="shipment-details-grid" style="height: 100%;"></div>
                            </div>
                        </div>

                        <!-- Tab 5: Pick Confirmation Responses -->
                        <div id="order-trans-pick-confirm-responses" class="order-trans-tab-content" style="height: 100%; overflow: auto; padding: 1rem; display: none;">
                            <div style="margin-bottom: 0.75rem; display: flex; gap: 0.5rem;">
                                <button class="btn btn-secondary" onclick="refreshPickConfirmResponses('${orderNumber}')">
                                    <i class="fas fa-sync-alt"></i> Refresh
                                </button>
                            </div>
                            <div id="pick-confirm-responses-content" style="background: white; border-radius: 8px; padding: 0.75rem; height: calc(100% - 4rem);">
                                <div id="pick-confirm-responses-grid" style="height: 100%;"></div>
                            </div>
                        </div>

                        <!-- Tab 6: Shipment Confirmation Responses -->
                        <div id="order-trans-ship-confirm-responses" class="order-trans-tab-content" style="height: 100%; overflow: auto; padding: 1rem; display: none;">
                            <div style="margin-bottom: 0.75rem; display: flex; gap: 0.5rem;">
                                <button class="btn btn-secondary" onclick="refreshShipConfirmResponses('${orderNumber}')">
                                    <i class="fas fa-sync-alt"></i> Refresh
                                </button>
                            </div>
                            <div id="ship-confirm-responses-content" style="background: white; border-radius: 8px; padding: 0.75rem; height: calc(100% - 4rem);">
                                <div id="ship-confirm-responses-grid" style="height: 100%;"></div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;

        // Add modal to body
        const existingModal = document.getElementById('order-transactions-modal');
        if (existingModal) {
            existingModal.remove();
        }
        document.body.insertAdjacentHTML('beforeend', modalHtml);

        // Auto-load first tab data
        console.log('[Order Transactions] Auto-loading Pick Release Details for order:', orderNumber);
        setTimeout(() => {
            refreshPickReleaseDetails(orderNumber);
        }, 100);
    }

    window.closeOrderTransactionsModal = function() {
        const modal = document.getElementById('order-transactions-modal');
        if (modal) {
            modal.remove();
        }
        // Clear context
        window.currentOrderTransContext = null;
    };

    // Show API Information for Order Transactions
    window.showOrderTransactionsApiInfo = function() {
        const ctx = window.currentOrderTransContext || {};
        const orderNumber = ctx.orderNumber || 'N/A';
        const instance = ctx.instance || 'N/A';
        const tripId = ctx.tripId || 'N/A';

        const baseUrl = 'https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/TRIPMANAGEMENT';

        const apis = [
            {
                name: 'Pick Release Details',
                method: 'GET',
                endpoint: `trips/orders/getpickreleasedetails/${orderNumber}?P_INSTANCE_NAME=${instance}`,
                fullUrl: `${baseUrl}/trips/orders/getpickreleasedetails/${orderNumber}?P_INSTANCE_NAME=${instance}`,
                note: '✅ Instance parameter passed from row data'
            },
            {
                name: 'Sales Order Lines',
                method: 'GET',
                endpoint: `trip/orders/getsalesorderlines/${orderNumber}?P_INSTANCE_NAME=${instance}`,
                fullUrl: `${baseUrl}/trip/orders/getsalesorderlines/${orderNumber}?P_INSTANCE_NAME=${instance}`,
                note: '✅ Instance parameter passed from row data'
            },
            {
                name: 'Lot Details',
                method: 'GET',
                endpoint: `trips/orders/getlotdetails/${orderNumber}?P_INSTANCE_NAME=${instance}`,
                fullUrl: `${baseUrl}/trips/orders/getlotdetails/${orderNumber}?P_INSTANCE_NAME=${instance}`,
                note: '✅ Instance parameter passed from row data'
            },
            {
                name: 'Cancel Lines in Oracle Fusion',
                method: 'PATCH',
                endpoint: `salesOrdersForOrderHub/OPS:{sourceOrderNumber}`,
                fullUrl: instance.toUpperCase() === 'PROD'
                    ? `https://efmh.fa.em3.oraclecloud.com/fscmRestApi/resources/11.13.18.05/salesOrdersForOrderHub/OPS:${ctx.sourceOrderNumber || orderNumber}`
                    : `https://efmh-test.fa.em3.oraclecloud.com/fscmRestApi/resources/11.13.18.05/salesOrdersForOrderHub/OPS:${ctx.sourceOrderNumber || orderNumber}`,
                note: '✅ Uses Oracle Fusion credentials, sets OrderedQuantity=0 with CancelReason'
            },
            {
                name: 'Fetch Order Lines from Fusion',
                method: 'POST',
                endpoint: `trip/order/fetchfusionorderlines?P_INSTANCE_NAME=${instance}&p_order_number=${orderNumber}&p_trip_id=${tripId}`,
                fullUrl: `${baseUrl}/trip/order/fetchfusionorderlines?P_INSTANCE_NAME=${instance}&p_order_number=${orderNumber}&p_trip_id=${tripId}`,
                note: '✅ Instance and Trip ID parameters passed from row data'
            }
        ];

        let apiHtml = '';
        apis.forEach((api, idx) => {
            const bgColor = idx % 2 === 0 ? '#f8fafc' : '#ffffff';
            let methodColor = '#c6f6d5'; // GET - green
            let methodTextColor = '#22543d';
            if (api.method === 'POST') { methodColor = '#fed7aa'; methodTextColor = '#9c4221'; }
            else if (api.method === 'PATCH') { methodColor = '#fecaca'; methodTextColor = '#991b1b'; }

            apiHtml += `
                <div style="background: ${bgColor}; padding: 0.75rem; border-radius: 6px; margin-bottom: 0.5rem; border-left: 3px solid #667eea;">
                    <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.5rem;">
                        <span style="background: ${methodColor}; color: ${methodTextColor}; padding: 2px 8px; border-radius: 4px; font-size: 10px; font-weight: 600;">${api.method}</span>
                        <strong style="color: #1e293b; font-size: 12px;">${api.name}</strong>
                    </div>
                    <div style="margin-bottom: 0.25rem;">
                        <code style="background: #edf2f7; padding: 4px 8px; border-radius: 4px; font-size: 9px; word-break: break-all; display: block;">${api.fullUrl}</code>
                    </div>
                    <div style="font-size: 10px; color: #f59e0b; font-style: italic;">
                        <i class="fas fa-exclamation-triangle"></i> ${api.note}
                    </div>
                </div>
            `;
        });

        const apiInfo = `
            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
                <h4 style="margin: 0 0 1rem 0; color: #333; border-bottom: 2px solid #667eea; padding-bottom: 0.5rem;">
                    <i class="fas fa-code" style="color: #667eea;"></i> API Information - Order Transactions
                </h4>

                <!-- Current Context -->
                <div style="background: #e0f2fe; padding: 0.75rem; border-radius: 8px; margin-bottom: 1rem; border-left: 4px solid #0284c7;">
                    <div style="font-weight: 600; color: #0369a1; margin-bottom: 0.5rem;">Current Context</div>
                    <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
                        <tr>
                            <td style="padding: 4px 8px; border: 1px solid #7dd3fc;">Order Number:</td>
                            <td style="padding: 4px 8px; border: 1px solid #7dd3fc; font-weight: 600;">${orderNumber}</td>
                        </tr>
                        <tr>
                            <td style="padding: 4px 8px; border: 1px solid #7dd3fc;">Instance (from row):</td>
                            <td style="padding: 4px 8px; border: 1px solid #7dd3fc; font-weight: 600; color: #7c3aed;">${instance}</td>
                        </tr>
                        <tr>
                            <td style="padding: 4px 8px; border: 1px solid #7dd3fc;">Trip ID:</td>
                            <td style="padding: 4px 8px; border: 1px solid #7dd3fc; font-weight: 600; color: #0ea5e9;">${tripId}</td>
                        </tr>
                    </table>
                </div>

                <!-- APIs Used -->
                <div style="background: #f8f9fa; padding: 1rem; border-radius: 8px; margin-bottom: 1rem;">
                    <div style="font-weight: 600; color: #1e293b; margin-bottom: 0.75rem;">APIs Used in Order Transactions</div>
                    ${apiHtml}
                </div>

                <!-- Success Note -->
                <div style="background: #d1fae5; padding: 0.75rem; border-radius: 8px; border-left: 4px solid #10b981;">
                    <strong style="color: #065f46;"><i class="fas fa-check-circle"></i> Parameters Configured:</strong>
                    <span style="color: #047857; font-size: 12px;">
                        Instance <strong>P_INSTANCE_NAME=${instance}</strong> and Trip ID <strong>p_trip_id=${tripId}</strong> are being passed to API calls from the order row data.
                    </span>
                </div>
            </div>
        `;

        // Create and show popup
        const popup = document.createElement('div');
        popup.id = 'order-trans-api-info-popup';
        popup.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 26000; display: flex; justify-content: center; align-items: center;';
        popup.innerHTML = `
            <div style="background: white; width: 90%; max-width: 750px; max-height: 85%; border-radius: 12px; box-shadow: 0 20px 60px rgba(0,0,0,0.3); overflow: hidden;">
                <div style="padding: 1.5rem; max-height: calc(85vh - 60px); overflow-y: auto;">
                    ${apiInfo}
                </div>
                <div style="padding: 1rem 1.5rem; border-top: 2px solid #f0f0f0; text-align: right;">
                    <button onclick="document.getElementById('order-trans-api-info-popup').remove()" class="btn btn-secondary" style="padding: 8px 20px;">
                        <i class="fas fa-times"></i> Close
                    </button>
                </div>
            </div>
        `;
        document.body.appendChild(popup);
    };

    // Toggle Order Transactions Header Details
    window.toggleOrderTransHeader = function() {
        const details = document.getElementById('order-trans-header-details');
        const toggleBtn = document.getElementById('order-trans-header-toggle');
        const icon = toggleBtn.querySelector('i');

        if (details.style.display === 'none' || details.style.display === '') {
            details.style.display = 'grid';
            icon.style.transform = 'rotate(180deg)';
        } else {
            details.style.display = 'none';
            icon.style.transform = 'rotate(0deg)';
        }
    };

    window.switchOrderTransTab = function(tabName) {
        // Update tab buttons
        document.querySelectorAll('.order-trans-tab').forEach(tab => {
            if (tab.dataset.tab === tabName) {
                tab.style.background = 'white';
                tab.style.color = '#667eea';
                tab.style.boxShadow = '0 2px 4px rgba(0,0,0,0.1)';
            } else {
                tab.style.background = 'transparent';
                tab.style.color = '#64748b';
                tab.style.boxShadow = 'none';
            }
        });

        // Update tab content
        document.querySelectorAll('.order-trans-tab-content').forEach(content => {
            content.style.display = 'none';
        });
        const activeContent = document.getElementById(`order-trans-${tabName}`);
        if (activeContent) {
            activeContent.style.display = 'block';
        }
    };

    // Placeholder refresh functions for Order Transactions tabs
    window.refreshPickReleaseDetails = function(orderNumber) {
        console.log('[Order Transactions] Refresh Pick Release Details for:', orderNumber);
        const gridContainer = document.getElementById('pick-release-grid');
        if (!gridContainer) {
            console.error('[Order Transactions] Pick Release grid container not found');
            return;
        }

        // Get instance from context
        const instance = window.currentOrderTransContext?.instance || window.currentTripInstance || 'TEST';
        console.log('[Order Transactions] Using instance:', instance);

        // Show loading state
        gridContainer.innerHTML = '<div style="padding: 2rem; text-align: center; color: #64748b;"><i class="fas fa-spinner fa-spin" style="font-size: 2rem; margin-bottom: 1rem;"></i><p>Loading Pick Release Details...</p></div>';

        const apiUrl = `https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/TRIPMANAGEMENT/trips/orders/getpickreleasedetails/${orderNumber}?P_INSTANCE_NAME=${instance}`;

        console.log('[Order Transactions] Fetching Pick Release Details from:', apiUrl);

        // Use C# REST handler
        sendMessageToCSharp({
            action: 'executeGet',
            fullUrl: apiUrl
        }, function(error, data) {
            if (error) {
                console.error('[Order Transactions] Error fetching Pick Release Details:', error);
                gridContainer.innerHTML = `<div style="padding: 2rem; text-align: center; color: #ef4444;"><i class="fas fa-exclamation-circle" style="font-size: 2rem; margin-bottom: 1rem;"></i><p>Error loading data</p><p style="font-size: 0.85rem;">${error}</p></div>`;
                return;
            }

            try {
                let responseData = typeof data === 'string' ? JSON.parse(data) : data;
                let items = responseData.items || responseData || [];

                console.log('[Order Transactions] Pick Release Details received:', items.length, 'records');

                if (items.length === 0) {
                    gridContainer.innerHTML = '<div style="padding: 2rem; text-align: center; color: #64748b;"><i class="fas fa-inbox" style="font-size: 2rem; margin-bottom: 1rem;"></i><p>No Pick Release Details found</p></div>';
                    return;
                }

                // Log first item to see available fields
                console.log('[Order Transactions] Pick Release first item:', items[0]);

                // Update header fields from API data (needed when opened from Co-Pilot with minimal rowData)
                const firstItem = items[0];
                const fmtDate = function(val) {
                    if (!val) return '';
                    // Trim ISO datetime "2026-05-25T00:00:00Z" -> "2026-05-25"
                    return String(val).split('T')[0];
                };
                const headerMap = {
                    'otr-trip-id':        String(firstItem.trip_id        || firstItem.TRIP_ID        || ''),
                    'otr-trip-date':      fmtDate(firstItem.trip_date      || firstItem.TRIP_DATE      || ''),
                    'otr-picker':         firstItem.picker_name  || firstItem.PICKER_NAME  || firstItem.picker  || firstItem.PICKER  || '',
                    'otr-lorry':          firstItem.lorry_number || firstItem.LORRY_NUMBER || firstItem.lorry   || firstItem.LORRY   || '',
                    'otr-priority':       firstItem.trip_priority|| firstItem.TRIP_PRIORITY|| firstItem.priority|| firstItem.PRIORITY|| '',
                    'otr-line-status':    firstItem.line_status  || firstItem.LINE_STATUS  || '',
                    'otr-account-number': firstItem.account_number|| firstItem.ACCOUNT_NUMBER || '',
                    'otr-account-name':   firstItem.account_name || firstItem.ACCOUNT_NAME || firstItem.customer_name || firstItem.CUSTOMER_NAME || '',
                    'otr-order-date':     fmtDate(firstItem.release_date   || firstItem.RELEASE_DATE   || firstItem.order_date || firstItem.ORDER_DATE || ''),
                    'otr-order-type':     firstItem.order_type   || firstItem.ORDER_TYPE   || firstItem.order_type_code || firstItem.ORDER_TYPE_CODE || ''
                };
                Object.entries(headerMap).forEach(function([id, val]) {
                    const el = document.getElementById(id);
                    if (el && val) el.textContent = val;
                });

                // Build columns dynamically from first item
                const columns = Object.keys(firstItem).map(key => {
                    return {
                        dataField: key,
                        caption: key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
                        width: 'auto'
                    };
                });

                // Initialize DevExpress Grid
                if (typeof DevExpress !== 'undefined' && DevExpress.ui?.dxDataGrid) {
                    // Clear container
                    gridContainer.innerHTML = '';

                    new DevExpress.ui.dxDataGrid(gridContainer, {
                        dataSource: items,
                        showBorders: true,
                        showRowLines: true,
                        rowAlternationEnabled: true,
                        allowColumnResizing: true,
                        columnAutoWidth: true,
                        height: '100%',
                        paging: { pageSize: 25 },
                        pager: {
                            showPageSizeSelector: true,
                            allowedPageSizes: [10, 25, 50, 100],
                            showInfo: true
                        },
                        filterRow: { visible: true },
                        headerFilter: { visible: true },
                        searchPanel: { visible: true, width: 200, placeholder: 'Search...' },
                        columns: columns,
                        onContentReady: function(e) {
                            console.log('[Order Transactions] Pick Release grid rendered');
                        }
                    });
                } else {
                    // Fallback to HTML table
                    let html = '<div style="overflow-x: auto; max-height: 400px;"><table style="width: 100%; border-collapse: collapse; font-size: 11px;">';
                    html += '<thead style="position: sticky; top: 0; background: #f8f9fa;"><tr>';
                    Object.keys(firstItem).forEach(key => {
                        html += `<th style="padding: 0.5rem; text-align: left; border-bottom: 2px solid #e2e8f0; font-weight: 600;">${key.replace(/_/g, ' ')}</th>`;
                    });
                    html += '</tr></thead><tbody>';

                    items.forEach((item, idx) => {
                        const bg = idx % 2 === 0 ? '#ffffff' : '#f8fafc';
                        html += `<tr style="background: ${bg};">`;
                        Object.values(item).forEach(val => {
                            html += `<td style="padding: 0.4rem; border-bottom: 1px solid #f1f5f9;">${val !== null ? val : ''}</td>`;
                        });
                        html += '</tr>';
                    });

                    html += '</tbody></table></div>';
                    gridContainer.innerHTML = html;
                }

            } catch (parseError) {
                console.error('[Order Transactions] Parse error:', parseError);
                gridContainer.innerHTML = `<div style="padding: 2rem; text-align: center; color: #ef4444;"><i class="fas fa-exclamation-circle" style="font-size: 2rem; margin-bottom: 1rem;"></i><p>Error parsing data</p><p style="font-size: 0.85rem;">${parseError.message}</p></div>`;
            }
        });
    };

    window.refreshSalesOrderLines = function(orderNumber) {
        console.log('[Order Transactions] Refresh Sales Order Lines for:', orderNumber);
        const gridContainer = document.getElementById('sales-order-lines-grid');
        if (!gridContainer) {
            console.error('[Order Transactions] Sales Order Lines grid container not found');
            return;
        }

        // Get instance from context
        const instance = window.currentOrderTransContext?.instance || window.currentTripInstance || 'TEST';
        console.log('[Order Transactions] Using instance:', instance);

        // Show loading state
        gridContainer.innerHTML = '<div style="padding: 2rem; text-align: center; color: #64748b;"><i class="fas fa-spinner fa-spin" style="font-size: 2rem; margin-bottom: 1rem;"></i><p>Loading Sales Order Lines...</p></div>';

        const apiUrl = `https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/TRIPMANAGEMENT/trip/orders/getsalesorderlines/${orderNumber}?P_INSTANCE_NAME=${instance}`;

        console.log('[Order Transactions] Fetching Sales Order Lines from:', apiUrl);

        // Use C# REST handler
        sendMessageToCSharp({
            action: 'executeGet',
            fullUrl: apiUrl
        }, function(error, data) {
            if (error) {
                console.error('[Order Transactions] Error fetching Sales Order Lines:', error);
                gridContainer.innerHTML = `<div style="padding: 2rem; text-align: center; color: #ef4444;"><i class="fas fa-exclamation-circle" style="font-size: 2rem; margin-bottom: 1rem;"></i><p>Error loading data</p><p style="font-size: 0.85rem;">${error}</p></div>`;
                return;
            }

            try {
                let responseData = typeof data === 'string' ? JSON.parse(data) : data;
                let items = responseData.items || responseData || [];

                console.log('[Order Transactions] Sales Order Lines received:', items.length, 'records');

                if (items.length === 0) {
                    gridContainer.innerHTML = '<div style="padding: 2rem; text-align: center; color: #64748b;"><i class="fas fa-inbox" style="font-size: 2rem; margin-bottom: 1rem;"></i><p>No Sales Order Lines found</p></div>';
                    return;
                }

                // Log first item to see available fields
                console.log('[Order Transactions] Sales Order Lines first item:', items[0]);

                // Build columns dynamically from first item
                const firstItem = items[0];
                const columns = Object.keys(firstItem).map(key => {
                    return {
                        dataField: key,
                        caption: key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
                        width: 'auto'
                    };
                });

                // Initialize DevExpress Grid with selection
                if (typeof DevExpress !== 'undefined' && DevExpress.ui?.dxDataGrid) {
                    // Clear container
                    gridContainer.innerHTML = '';

                    window.salesOrderLinesGrid = new DevExpress.ui.dxDataGrid(gridContainer, {
                        dataSource: items,
                        showBorders: true,
                        showRowLines: true,
                        rowAlternationEnabled: true,
                        allowColumnResizing: true,
                        columnAutoWidth: true,
                        height: '100%',
                        selection: {
                            mode: 'multiple',
                            showCheckBoxesMode: 'always'
                        },
                        paging: { pageSize: 25 },
                        pager: {
                            showPageSizeSelector: true,
                            allowedPageSizes: [10, 25, 50, 100],
                            showInfo: true
                        },
                        filterRow: { visible: true },
                        headerFilter: { visible: true },
                        searchPanel: { visible: true, width: 200, placeholder: 'Search...' },
                        columns: columns,
                        onContentReady: function(e) {
                            console.log('[Order Transactions] Sales Order Lines grid rendered');
                        },
                        onSelectionChanged: function(e) {
                            window.selectedSalesOrderLines = e.selectedRowsData || [];
                            window.selectedSalesOrderLine = e.selectedRowsData[0] || null;
                            console.log('[Order Transactions] Selected Sales Order Lines:', window.selectedSalesOrderLines.length, 'items');
                        }
                    });
                } else {
                    // Fallback to HTML table with selection
                    let html = '<div style="overflow-x: auto; max-height: 400px;"><table id="sales-order-lines-table" style="width: 100%; border-collapse: collapse; font-size: 11px;">';
                    html += '<thead style="position: sticky; top: 0; background: #f8f9fa;"><tr>';
                    html += '<th style="padding: 0.5rem; text-align: center; border-bottom: 2px solid #e2e8f0; width: 30px;"><input type="checkbox" disabled></th>';
                    Object.keys(firstItem).forEach(key => {
                        html += `<th style="padding: 0.5rem; text-align: left; border-bottom: 2px solid #e2e8f0; font-weight: 600;">${key.replace(/_/g, ' ')}</th>`;
                    });
                    html += '</tr></thead><tbody>';

                    items.forEach((item, idx) => {
                        const bg = idx % 2 === 0 ? '#ffffff' : '#f8fafc';
                        html += `<tr data-index="${idx}" style="background: ${bg}; cursor: pointer;" onclick="selectSalesOrderLineRow(this, ${idx})">`;
                        html += `<td style="padding: 0.4rem; border-bottom: 1px solid #f1f5f9; text-align: center;"><input type="radio" name="sol-select" value="${idx}"></td>`;
                        Object.values(item).forEach(val => {
                            html += `<td style="padding: 0.4rem; border-bottom: 1px solid #f1f5f9;">${val !== null ? val : ''}</td>`;
                        });
                        html += '</tr>';
                    });

                    html += '</tbody></table></div>';
                    gridContainer.innerHTML = html;

                    // Store items for selection
                    window.salesOrderLinesData = items;
                }

            } catch (parseError) {
                console.error('[Order Transactions] Parse error:', parseError);
                gridContainer.innerHTML = `<div style="padding: 2rem; text-align: center; color: #ef4444;"><i class="fas fa-exclamation-circle" style="font-size: 2rem; margin-bottom: 1rem;"></i><p>Error parsing data</p><p style="font-size: 0.85rem;">${parseError.message}</p></div>`;
            }
        });
    };

    // Helper function for HTML table row selection
    window.selectSalesOrderLineRow = function(row, index) {
        // Deselect all rows
        document.querySelectorAll('#sales-order-lines-table tbody tr').forEach(tr => {
            tr.style.background = parseInt(tr.dataset.index) % 2 === 0 ? '#ffffff' : '#f8fafc';
        });
        // Select clicked row
        row.style.background = '#e0e7ff';
        row.querySelector('input[type="radio"]').checked = true;
        window.selectedSalesOrderLine = window.salesOrderLinesData ? window.salesOrderLinesData[index] : null;
        console.log('[Order Transactions] Selected Sales Order Line:', window.selectedSalesOrderLine);
    };

    // API Info popup for Fetch Order Lines from Fusion
    window.showFetchFusionOrderLinesApiInfo = function(orderNumber, instance) {
        const postUrl = `https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/TRIPMANAGEMENT/trip/order/fetchfusionorderlines?P_INSTANCE_NAME=${instance}&p_order_number=${orderNumber}`;
        const getUrl  = `https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/TRIPMANAGEMENT/trip/orders/getsalesorderlines/${orderNumber}?P_INSTANCE_NAME=${instance}`;

        const existing = document.getElementById('fetch-fusion-api-info-popup');
        if (existing) existing.remove();

        document.body.insertAdjacentHTML('beforeend', `
            <div id="fetch-fusion-api-info-popup" style="position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:40000;display:flex;justify-content:center;align-items:center;">
                <div style="background:white;width:90%;max-width:640px;border-radius:12px;box-shadow:0 20px 60px rgba(0,0,0,0.3);overflow:hidden;">
                    <div style="background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);color:white;padding:1rem 1.5rem;display:flex;justify-content:space-between;align-items:center;">
                        <h3 style="margin:0;font-size:1.1rem;"><i class="fas fa-code"></i> API Info — Fetch Order Lines From Fusion</h3>
                        <button onclick="document.getElementById('fetch-fusion-api-info-popup').remove()" style="background:rgba(255,255,255,0.2);border:none;color:white;padding:4px 10px;border-radius:6px;cursor:pointer;font-size:16px;">&times;</button>
                    </div>
                    <div style="padding:1.5rem;">
                        <p style="color:#475569;font-size:12px;margin:0 0 1rem;">When you click <strong>Fetch Order Lines From Fusion</strong>, two API calls run in sequence:</p>

                        <!-- Call 1 -->
                        <div style="background:#fff7ed;padding:1rem;border-radius:8px;border-left:4px solid #f97316;margin-bottom:1rem;">
                            <div style="display:flex;align-items:center;gap:8px;margin-bottom:0.5rem;">
                                <span style="background:#f97316;color:white;padding:2px 8px;border-radius:4px;font-size:10px;font-weight:700;">STEP 1 — POST</span>
                                <span style="font-weight:600;color:#9a3412;font-size:12px;">Fetch from Oracle Fusion into WMS DB</span>
                            </div>
                            <table style="width:100%;border-collapse:collapse;font-size:11px;">
                                <tr><td style="padding:3px 8px;border:1px solid #fed7aa;color:#64748b;width:100px;">Endpoint:</td><td style="padding:3px 8px;border:1px solid #fed7aa;font-weight:600;">TRIPMANAGEMENT/trip/order/fetchfusionorderlines</td></tr>
                                <tr><td style="padding:3px 8px;border:1px solid #fed7aa;color:#64748b;">Instance:</td><td style="padding:3px 8px;border:1px solid #fed7aa;color:#7c3aed;font-weight:600;">${instance}</td></tr>
                                <tr><td style="padding:3px 8px;border:1px solid #fed7aa;color:#64748b;">Order:</td><td style="padding:3px 8px;border:1px solid #fed7aa;font-weight:600;">${orderNumber}</td></tr>
                            </table>
                            <code style="background:#fef3c7;padding:5px 8px;border-radius:4px;font-size:9px;word-break:break-all;display:block;margin-top:6px;">${postUrl}</code>
                        </div>

                        <!-- Call 2 -->
                        <div style="background:#eff6ff;padding:1rem;border-radius:8px;border-left:4px solid #3b82f6;">
                            <div style="display:flex;align-items:center;gap:8px;margin-bottom:0.5rem;">
                                <span style="background:#3b82f6;color:white;padding:2px 8px;border-radius:4px;font-size:10px;font-weight:700;">STEP 2 — GET</span>
                                <span style="font-weight:600;color:#1e40af;font-size:12px;">Load results into Sales Order Lines grid</span>
                            </div>
                            <table style="width:100%;border-collapse:collapse;font-size:11px;">
                                <tr><td style="padding:3px 8px;border:1px solid #bfdbfe;color:#64748b;width:100px;">Endpoint:</td><td style="padding:3px 8px;border:1px solid #bfdbfe;font-weight:600;">TRIPMANAGEMENT/trip/orders/getsalesorderlines/{ORDER}</td></tr>
                                <tr><td style="padding:3px 8px;border:1px solid #bfdbfe;color:#64748b;">Instance:</td><td style="padding:3px 8px;border:1px solid #bfdbfe;color:#7c3aed;font-weight:600;">${instance}</td></tr>
                            </table>
                            <code style="background:#dbeafe;padding:5px 8px;border-radius:4px;font-size:9px;word-break:break-all;display:block;margin-top:6px;">${getUrl}</code>
                        </div>
                    </div>
                    <div style="padding:1rem 1.5rem;border-top:1px solid #f0f0f0;display:flex;justify-content:flex-end;">
                        <button onclick="document.getElementById('fetch-fusion-api-info-popup').remove()" style="padding:8px 20px;background:#6366f1;color:white;border:none;border-radius:6px;cursor:pointer;">Close</button>
                    </div>
                </div>
            </div>
        `);
    };

    // Fetch Order Lines from Fusion function
    window.fetchFusionOrderLines = function(orderNumber) {
        console.log('[Order Transactions] Fetch Order Lines from Fusion for order:', orderNumber);

        // Get instance from context
        const instance = window.currentOrderTransContext?.instance || window.currentTripInstance || 'TEST';
        console.log('[Order Transactions] Using instance:', instance);

        // Show confirmation popup with API details
        const apiUrl = `https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/TRIPMANAGEMENT/trip/order/fetchfusionorderlines?P_INSTANCE_NAME=${instance}&p_order_number=${orderNumber}`;

        // Create confirmation popup
        const popupHtml = `
            <div id="fetch-fusion-popup" style="position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 30000; display: flex; justify-content: center; align-items: center;">
                <div style="background: white; width: 90%; max-width: 600px; border-radius: 12px; box-shadow: 0 20px 60px rgba(0,0,0,0.3); overflow: hidden;">
                    <div style="background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%); color: white; padding: 1rem 1.5rem;">
                        <h3 style="margin: 0; font-size: 1.1rem;">
                            <i class="fas fa-cloud-download-alt"></i> Fetch Order Lines from Fusion
                        </h3>
                    </div>
                    <div style="padding: 1.5rem;">
                        <div style="background: #eff6ff; padding: 1rem; border-radius: 8px; margin-bottom: 1rem; border-left: 4px solid #3b82f6;">
                            <div style="font-weight: 600; color: #1e40af; margin-bottom: 0.5rem;">API Details</div>
                            <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
                                <tr>
                                    <td style="padding: 4px 8px; border: 1px solid #bfdbfe;">Method:</td>
                                    <td style="padding: 4px 8px; border: 1px solid #bfdbfe;"><span style="background: #fed7aa; color: #9c4221; padding: 2px 8px; border-radius: 4px; font-size: 10px; font-weight: 600;">POST</span></td>
                                </tr>
                                <tr>
                                    <td style="padding: 4px 8px; border: 1px solid #bfdbfe;">Instance:</td>
                                    <td style="padding: 4px 8px; border: 1px solid #bfdbfe; font-weight: 600; color: #7c3aed;">${instance}</td>
                                </tr>
                                <tr>
                                    <td style="padding: 4px 8px; border: 1px solid #bfdbfe;">Order Number:</td>
                                    <td style="padding: 4px 8px; border: 1px solid #bfdbfe; font-weight: 600;">${orderNumber}</td>
                                </tr>
                            </table>
                        </div>
                        <div style="margin-bottom: 1rem;">
                            <strong style="color: #4a5568; font-size: 12px;">Full URL:</strong>
                            <code style="background: #edf2f7; padding: 6px 10px; border-radius: 4px; font-size: 10px; word-break: break-all; display: block; margin-top: 4px;">${apiUrl}</code>
                        </div>
                        <div style="background: #fef3c7; padding: 0.75rem; border-radius: 8px; border-left: 4px solid #f59e0b;">
                            <strong style="color: #92400e;"><i class="fas fa-info-circle"></i> Note:</strong>
                            <span style="color: #78350f; font-size: 12px;">This will fetch the latest order lines from Oracle Fusion and update the local data.</span>
                        </div>
                    </div>
                    <div style="padding: 1rem 1.5rem; border-top: 2px solid #f0f0f0; display: flex; justify-content: flex-end; gap: 0.5rem;">
                        <button onclick="document.getElementById('fetch-fusion-popup').remove()" class="btn btn-secondary" style="padding: 8px 20px;">
                            <i class="fas fa-times"></i> Cancel
                        </button>
                        <button id="fetch-fusion-execute-btn" onclick="executeFetchFusionOrderLines('${orderNumber}', '${instance}')" class="btn btn-primary" style="padding: 8px 20px; background: #2563eb; color: white; border: none; border-radius: 6px; cursor: pointer;">
                            <i class="fas fa-cloud-download-alt"></i> Fetch Now
                        </button>
                    </div>
                </div>
            </div>
        `;

        // Remove existing popup if any
        const existingPopup = document.getElementById('fetch-fusion-popup');
        if (existingPopup) existingPopup.remove();

        // Add popup to body
        document.body.insertAdjacentHTML('beforeend', popupHtml);
    };

    // Execute the Fetch Fusion Order Lines API call
    window.executeFetchFusionOrderLines = function(orderNumber, instance) {
        console.log('[Order Transactions] Executing Fetch Fusion Order Lines...');

        const apiUrl = `https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/TRIPMANAGEMENT/trip/order/fetchfusionorderlines?P_INSTANCE_NAME=${instance}&p_order_number=${orderNumber}`;

        // Update button to show loading
        const fetchBtn = document.getElementById('fetch-fusion-execute-btn');
        if (fetchBtn) {
            fetchBtn.disabled = true;
            fetchBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Fetching...';
        }

        console.log('[Order Transactions] Fetch Fusion Order Lines API:', apiUrl);

        // Use C# REST handler with POST method
        sendMessageToCSharp({
            action: 'executePost',
            fullUrl: apiUrl,
            body: JSON.stringify({})
        }, function(error, data) {
            // Close popup
            const popup = document.getElementById('fetch-fusion-popup');
            if (popup) popup.remove();

            if (error) {
                console.error('[Order Transactions] Error fetching Fusion order lines:', error);
                alert('Error fetching order lines from Fusion:\n' + error);
                return;
            }

            try {
                let responseData = typeof data === 'string' ? JSON.parse(data) : data;
                console.log('[Order Transactions] Fetch Fusion Order Lines response:', responseData);

                // Show success message
                const message = responseData.message || responseData.MESSAGE || 'Order lines fetched successfully from Fusion';
                alert('✅ ' + message);

                // Refresh the Sales Order Lines grid to show updated data
                setTimeout(() => {
                    refreshSalesOrderLines(orderNumber);
                }, 500);

            } catch (parseError) {
                console.error('[Order Transactions] Parse error:', parseError);
                alert('Error parsing response: ' + parseError.message);
            }
        });
    };

    // Cancel Scheduled Lines function
    window.cancelScheduledLines = function(orderNumber) {
        console.log('[Order Transactions] Cancel Scheduled Lines for order:', orderNumber);

        // Show confirmation dialog
        if (!confirm(`Are you sure you want to cancel all scheduled lines for order ${orderNumber}?`)) {
            return;
        }

        // Get instance from context
        const instance = window.currentOrderTransContext?.instance || window.currentTripInstance || 'TEST';
        console.log('[Order Transactions] Using instance:', instance);

        // Show loading indicator
        showLoading('Cancelling scheduled lines...');

        const apiUrl = `https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/TRIPMANAGEMENT/trip/orders/cancelscheduledlines/${orderNumber}?P_INSTANCE_NAME=${instance}`;

        console.log('[Order Transactions] Cancel Scheduled Lines API:', apiUrl);

        sendMessageToCSharp({
            action: 'executePost',
            fullUrl: apiUrl,
            payload: {}
        }, function(error, data) {
            hideLoading();

            if (error) {
                console.error('[Order Transactions] Error cancelling scheduled lines:', error);
                showNotification('Error cancelling scheduled lines: ' + error, 'error');
                return;
            }

            console.log('[Order Transactions] Cancel Scheduled Lines response:', data);
            showNotification('Scheduled lines cancelled successfully', 'success');

            // Refresh the grid
            refreshSalesOrderLines(orderNumber);
        });
    };

    // Cancel Selected Line function
    window.cancelSelectedSalesOrderLine = function(orderNumber) {
        console.log('[Order Transactions] Cancel Selected Line for order:', orderNumber);

        // Check if a line is selected
        if (!window.selectedSalesOrderLine) {
            showNotification('Please select a line to cancel', 'warning');
            return;
        }

        // Get line identifier (try common field names)
        const lineId = window.selectedSalesOrderLine.LINE_ID ||
                       window.selectedSalesOrderLine.line_id ||
                       window.selectedSalesOrderLine.LINE_NUMBER ||
                       window.selectedSalesOrderLine.line_number ||
                       window.selectedSalesOrderLine.ORDER_LINE_ID ||
                       window.selectedSalesOrderLine.order_line_id;

        if (!lineId) {
            showNotification('Unable to identify the selected line', 'error');
            return;
        }

        // Get instance from context
        const instance = window.currentOrderTransContext?.instance || window.currentTripInstance || 'TEST';
        console.log('[Order Transactions] Using instance:', instance);

        // Show confirmation dialog
        if (!confirm(`Are you sure you want to cancel line ${lineId} for order ${orderNumber}?`)) {
            return;
        }

        // Show loading indicator
        showLoading('Cancelling selected line...');

        const apiUrl = `https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/TRIPMANAGEMENT/trip/orders/cancelorderline/${orderNumber}/${lineId}?P_INSTANCE_NAME=${instance}`;

        console.log('[Order Transactions] Cancel Selected Line API:', apiUrl);

        sendMessageToCSharp({
            action: 'executePost',
            fullUrl: apiUrl,
            payload: {}
        }, function(error, data) {
            hideLoading();

            if (error) {
                console.error('[Order Transactions] Error cancelling selected line:', error);
                showNotification('Error cancelling line: ' + error, 'error');
                return;
            }

            console.log('[Order Transactions] Cancel Selected Line response:', data);
            showNotification('Line cancelled successfully', 'success');

            // Clear selection and refresh the grid
            window.selectedSalesOrderLine = null;
            refreshSalesOrderLines(orderNumber);
        });
    };

    // Cancel Not Picked Lines function
    window.cancelNotPickedLines = function(orderNumber) {
        console.log('[Order Transactions] Cancel Not Picked Lines for order:', orderNumber);

        // Show confirmation dialog
        if (!confirm(`Are you sure you want to cancel all not picked lines for order ${orderNumber}?`)) {
            return;
        }

        // Get instance from context
        const instance = window.currentOrderTransContext?.instance || window.currentTripInstance || 'TEST';
        console.log('[Order Transactions] Using instance:', instance);

        // Show loading indicator
        showLoading('Cancelling not picked lines...');

        const apiUrl = `https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/TRIPMANAGEMENT/trip/orders/cancelnotpickedlines/${orderNumber}?P_INSTANCE_NAME=${instance}`;

        console.log('[Order Transactions] Cancel Not Picked Lines API:', apiUrl);

        sendMessageToCSharp({
            action: 'executePost',
            fullUrl: apiUrl,
            payload: {}
        }, function(error, data) {
            hideLoading();

            if (error) {
                console.error('[Order Transactions] Error cancelling not picked lines:', error);
                showNotification('Error cancelling not picked lines: ' + error, 'error');
                return;
            }

            console.log('[Order Transactions] Cancel Not Picked Lines response:', data);
            showNotification('Not picked lines cancelled successfully', 'success');

            // Refresh the grid
            refreshSalesOrderLines(orderNumber);
        });
    };

    // Show Cancel Lines Popup - displays selected lines and allows cancellation via Oracle Fusion
    window.showCancelLinesPopup = function(orderNumber, mode) {
        console.log('[Order Transactions] Show Cancel Lines Popup for order:', orderNumber, 'mode:', mode);

        // Get instance from context
        const instance = window.currentOrderTransContext?.instance || window.currentTripInstance || 'TEST';
        const sourceOrderNumber = window.currentOrderTransContext?.sourceOrderNumber || orderNumber;

        // Determine which lines to show based on mode
        let linesToCancel = [];

        if (mode === 'selected') {
            // Get selected lines from the grid
            if (window.salesOrderLinesGrid && typeof window.salesOrderLinesGrid.getSelectedRowsData === 'function') {
                linesToCancel = window.salesOrderLinesGrid.getSelectedRowsData() || [];
            } else if (window.selectedSalesOrderLines && window.selectedSalesOrderLines.length > 0) {
                linesToCancel = window.selectedSalesOrderLines;
            } else if (window.selectedSalesOrderLine) {
                linesToCancel = [window.selectedSalesOrderLine];
            }

            if (linesToCancel.length === 0) {
                showNotification('Please select at least one line to cancel', 'warning');
                return;
            }
        } else if (mode === 'scheduled') {
            // Filter lines with STATUS_CODE = 'RES_MANUAL'
            let allLines = [];
            if (window.salesOrderLinesGrid && typeof window.salesOrderLinesGrid.option === 'function') {
                allLines = window.salesOrderLinesGrid.option('dataSource') || [];
            } else if (window.salesOrderLinesData) {
                allLines = window.salesOrderLinesData;
            }

            // Filter for RES_MANUAL status
            linesToCancel = allLines.filter(line => {
                const statusCode = line.STATUS_CODE || line.status_code || line.StatusCode || '';
                return statusCode.toUpperCase() === 'RES_MANUAL';
            });

            if (linesToCancel.length === 0) {
                showNotification('No lines with RES_MANUAL status found', 'warning');
                return;
            }

            // Auto-select these lines in the grid if DevExpress grid is available
            if (window.salesOrderLinesGrid && typeof window.salesOrderLinesGrid.selectRows === 'function') {
                const keys = linesToCancel.map(line => line.LINE_ID || line.line_id || line.FULFILL_LINE_ID || line.fulfill_line_id);
                window.salesOrderLinesGrid.selectRows(keys, false);
            }
        }

        console.log('[Order Transactions] Lines to cancel:', linesToCancel.length);
        console.log('[Order Transactions] Lines data:', linesToCancel);

        // Build the popup HTML
        let linesTableHtml = '';
        // Extract HeaderId from the first line (all lines belong to the same order header)
        const headerId = linesToCancel[0]?.HEADER_ID || linesToCancel[0]?.header_id || linesToCancel[0]?.HeaderId || '';
        console.log('[Order Transactions] HeaderId from lines:', headerId);

        linesToCancel.forEach((line, idx) => {
            const lineId = line.LINE_ID || line.line_id || line.FULFILL_LINE_ID || line.fulfill_line_id || 'N/A';
            const itemNumber = line.ITEM_NUMBER || line.item_number || line.INVENTORY_ITEM || line.inventory_item || 'N/A';
            const description = line.DESCRIPTION || line.description || line.ITEM_DESCRIPTION || line.item_description || '';
            const qty = line.ORDERED_QTY || line.ordered_qty || line.QUANTITY || line.quantity || line.ORDERED_QUANTITY || line.ordered_quantity || 0;
            const statusCode = line.STATUS_CODE || line.status_code || line.StatusCode || 'N/A';
            const fulfillLineId = line.FULFILL_LINE_ID || line.fulfill_line_id || line.FulfillLineId || lineId;

            const bgColor = idx % 2 === 0 ? '#ffffff' : '#f8fafc';
            linesTableHtml += `
                <tr style="background: ${bgColor};" data-fulfill-line-id="${fulfillLineId}" data-header-id="${headerId}">
                    <td style="padding: 8px; border: 1px solid #e2e8f0; text-align: center;">
                        <input type="checkbox" class="cancel-line-checkbox" checked data-fulfill-line-id="${fulfillLineId}" data-header-id="${headerId}">
                    </td>
                    <td style="padding: 8px; border: 1px solid #e2e8f0; font-family: monospace;">${lineId}</td>
                    <td style="padding: 8px; border: 1px solid #e2e8f0;">${itemNumber}</td>
                    <td style="padding: 8px; border: 1px solid #e2e8f0; max-width: 200px; overflow: hidden; text-overflow: ellipsis;" title="${description}">${description}</td>
                    <td style="padding: 8px; border: 1px solid #e2e8f0; text-align: right;">${qty}</td>
                    <td style="padding: 8px; border: 1px solid #e2e8f0;">
                        <span style="background: ${statusCode === 'RES_MANUAL' ? '#fef3c7' : '#e2e8f0'}; color: ${statusCode === 'RES_MANUAL' ? '#92400e' : '#475569'}; padding: 2px 8px; border-radius: 4px; font-size: 11px;">${statusCode}</span>
                    </td>
                </tr>
            `;
        });

        const popupHtml = `
            <div id="cancel-lines-popup" style="position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 30000; display: flex; justify-content: center; align-items: center;">
                <div style="background: white; width: 95%; max-width: 900px; max-height: 80vh; border-radius: 12px; box-shadow: 0 20px 60px rgba(0,0,0,0.3); overflow: hidden; display: flex; flex-direction: column;">
                    <div style="background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%); color: white; padding: 1rem 1.5rem; display: flex; justify-content: space-between; align-items: center;">
                        <h3 style="margin: 0; font-size: 1.1rem;">
                            <i class="fas fa-times-circle"></i> Cancel Lines in Oracle Fusion
                        </h3>
                        <button onclick="document.getElementById('cancel-lines-popup').remove()" style="background: transparent; border: none; color: white; font-size: 1.5rem; cursor: pointer; line-height: 1;">&times;</button>
                    </div>
                    <div style="padding: 1rem 1.5rem; flex: 1; overflow: auto;">
                        <div style="background: #fef3c7; padding: 0.75rem 1rem; border-radius: 8px; margin-bottom: 1rem; border-left: 4px solid #f59e0b;">
                            <strong style="color: #92400e;"><i class="fas fa-exclamation-triangle"></i> Warning:</strong>
                            <span style="color: #78350f; font-size: 13px;">This will cancel the selected lines in Oracle Fusion by setting OrderedQuantity to 0.</span>
                        </div>
                        <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 1rem; margin-bottom: 1rem;">
                            <div style="background: #f8fafc; padding: 0.75rem; border-radius: 8px;">
                                <div style="font-size: 11px; color: #64748b; margin-bottom: 2px;">Order Number</div>
                                <div style="font-weight: 600; color: #1e293b;">${orderNumber}</div>
                            </div>
                            <div style="background: #f8fafc; padding: 0.75rem; border-radius: 8px;">
                                <div style="font-size: 11px; color: #64748b; margin-bottom: 2px;">Source Order Number</div>
                                <div style="font-weight: 600; color: #7c3aed;">${sourceOrderNumber}</div>
                            </div>
                            <div style="background: ${headerId ? '#e0f2fe' : '#fef2f2'}; padding: 0.75rem; border-radius: 8px;">
                                <div style="font-size: 11px; color: #64748b; margin-bottom: 2px;">Fusion HeaderId</div>
                                <div style="font-weight: 600; color: ${headerId ? '#0369a1' : '#dc2626'};">${headerId || 'Not Available'}</div>
                            </div>
                            <div style="background: #f8fafc; padding: 0.75rem; border-radius: 8px;">
                                <div style="font-size: 11px; color: #64748b; margin-bottom: 2px;">Instance</div>
                                <div style="font-weight: 600; color: #059669;">${instance}</div>
                            </div>
                            <div style="background: #f8fafc; padding: 0.75rem; border-radius: 8px;">
                                <div style="font-size: 11px; color: #64748b; margin-bottom: 2px;">Lines Selected</div>
                                <div style="font-weight: 600; color: #dc2626;">${linesToCancel.length}</div>
                            </div>
                            <div style="background: #f0fdf4; padding: 0.75rem; border-radius: 8px;">
                                <div style="font-size: 11px; color: #64748b; margin-bottom: 2px;">API Key Type</div>
                                <div style="font-weight: 600; color: #16a34a;">${headerId ? 'HeaderId (Primary)' : 'Alternate Key'}</div>
                            </div>
                        </div>
                        <div style="font-weight: 600; color: #1e293b; margin-bottom: 0.5rem;">Lines to Cancel:</div>
                        <div style="max-height: 300px; overflow: auto; border: 1px solid #e2e8f0; border-radius: 8px;">
                            <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
                                <thead style="background: #f1f5f9; position: sticky; top: 0;">
                                    <tr>
                                        <th style="padding: 10px 8px; border: 1px solid #e2e8f0; text-align: center; width: 40px;">
                                            <input type="checkbox" id="select-all-cancel-lines" checked onclick="toggleAllCancelLines(this)">
                                        </th>
                                        <th style="padding: 10px 8px; border: 1px solid #e2e8f0; text-align: left;">Line ID</th>
                                        <th style="padding: 10px 8px; border: 1px solid #e2e8f0; text-align: left;">Item</th>
                                        <th style="padding: 10px 8px; border: 1px solid #e2e8f0; text-align: left;">Description</th>
                                        <th style="padding: 10px 8px; border: 1px solid #e2e8f0; text-align: right;">Qty</th>
                                        <th style="padding: 10px 8px; border: 1px solid #e2e8f0; text-align: left;">Status</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${linesTableHtml}
                                </tbody>
                            </table>
                        </div>
                    </div>
                    <div style="padding: 1rem 1.5rem; border-top: 2px solid #f0f0f0; display: flex; justify-content: space-between; align-items: center; background: #f8fafc;">
                        <div id="cancel-lines-status" style="font-size: 12px; color: #64748b;"></div>
                        <div style="display: flex; gap: 0.5rem;">
                            <button onclick="document.getElementById('cancel-lines-popup').remove()" class="btn btn-secondary" style="padding: 10px 24px;">
                                <i class="fas fa-arrow-left"></i> Close
                            </button>
                            <button onclick="cancelLinesInFusion('${orderNumber}', '${sourceOrderNumber}', '${instance}', '${headerId}')" class="btn btn-danger" style="padding: 10px 24px; background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%); color: white; border: none; border-radius: 6px; font-weight: 600; cursor: pointer;">
                                <i class="fas fa-times-circle"></i> Cancel Lines
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;

        // Remove existing popup if any
        const existingPopup = document.getElementById('cancel-lines-popup');
        if (existingPopup) {
            existingPopup.remove();
        }

        // Add popup to body
        document.body.insertAdjacentHTML('beforeend', popupHtml);

        // Store lines data for later use
        window.linesToCancelData = linesToCancel;
    };

    // Toggle all cancel lines checkboxes
    window.toggleAllCancelLines = function(selectAllCheckbox) {
        const checkboxes = document.querySelectorAll('.cancel-line-checkbox');
        checkboxes.forEach(cb => {
            cb.checked = selectAllCheckbox.checked;
        });
    };

    // Cancel Lines in Oracle Fusion via PATCH API
    window.cancelLinesInFusion = function(orderNumber, sourceOrderNumber, instance, headerId) {
        console.log('[Order Transactions] Cancel Lines in Fusion for order:', orderNumber);
        console.log('[Order Transactions] HeaderId received:', headerId);

        // Get checked lines from the popup
        const checkboxes = document.querySelectorAll('.cancel-line-checkbox:checked');
        if (checkboxes.length === 0) {
            showNotification('Please select at least one line to cancel', 'warning');
            return;
        }

        // Build the lines array for the API and try to get headerId from checkboxes if not provided
        const linesPayload = [];
        let extractedHeaderId = headerId;
        checkboxes.forEach(cb => {
            const fulfillLineId = cb.getAttribute('data-fulfill-line-id');
            // Try to extract headerId from checkbox if not already set
            if (!extractedHeaderId || extractedHeaderId === 'undefined' || extractedHeaderId === '') {
                extractedHeaderId = cb.getAttribute('data-header-id');
            }
            if (fulfillLineId && fulfillLineId !== 'N/A') {
                linesPayload.push({
                    FulfillLineId: parseInt(fulfillLineId),
                    OrderedQuantity: 0,
                    CancelReason: "OUT OF STOCK"
                });
            }
        });

        if (linesPayload.length === 0) {
            showNotification('No valid lines found to cancel', 'error');
            return;
        }

        console.log('[Order Transactions] Lines payload:', linesPayload);
        console.log('[Order Transactions] Extracted HeaderId:', extractedHeaderId);

        // Determine the Fusion URL based on instance
        const fusionBaseUrl = instance.toUpperCase() === 'PROD'
            ? 'https://efmh.fa.em3.oraclecloud.com'
            : 'https://efmh-test.fa.em3.oraclecloud.com';

        // Use HeaderId if available (primary key), otherwise fall back to alternate key format
        let fusionUrl;
        if (extractedHeaderId && extractedHeaderId !== 'undefined' && extractedHeaderId !== '' && extractedHeaderId !== 'null') {
            // Use HeaderId (primary key) - more reliable
            fusionUrl = `${fusionBaseUrl}/fscmRestApi/resources/11.13.18.05/salesOrdersForOrderHub/${extractedHeaderId}`;
            console.log('[Order Transactions] Using HeaderId for Fusion URL');
        } else {
            // Fall back to alternate key format
            fusionUrl = `${fusionBaseUrl}/fscmRestApi/resources/11.13.18.05/salesOrdersForOrderHub/OPS:${sourceOrderNumber}`;
            console.log('[Order Transactions] Using alternate key (OPS:sourceOrderNumber) for Fusion URL');
        }

        console.log('[Order Transactions] Fusion URL:', fusionUrl);

        // Update status
        const statusDiv = document.getElementById('cancel-lines-status');
        if (statusDiv) {
            statusDiv.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Cancelling lines in Oracle Fusion...';
            statusDiv.style.color = '#3b82f6';
        }

        // Prepare the request body
        const requestBody = {
            lines: linesPayload
        };

        console.log('[Order Transactions] Request body:', JSON.stringify(requestBody, null, 2));

        // Call the C# backend to make the PATCH request with Fusion credentials
        sendMessageToCSharp({
            action: 'executeOracleFusionPatch',
            fullUrl: fusionUrl,
            body: JSON.stringify(requestBody),
            instance: instance
        }, function(error, data) {
            console.log('[Order Transactions] Fusion response:', data);

            if (error) {
                console.error('[Order Transactions] Error cancelling lines in Fusion:', error);
                if (statusDiv) {
                    statusDiv.innerHTML = '<i class="fas fa-exclamation-circle"></i> Error: ' + error;
                    statusDiv.style.color = '#ef4444';
                }
                showNotification('Error cancelling lines in Fusion: ' + error, 'error');
                return;
            }

            try {
                let responseData = typeof data === 'string' ? JSON.parse(data) : data;
                console.log('[Order Transactions] Parsed response:', responseData);

                // Check for error response
                if (responseData.ReturnStatus === 'Error' || responseData.ErrorExplanation) {
                    const errorMsg = responseData.ErrorExplanation || responseData.message || 'Unknown error';
                    if (statusDiv) {
                        statusDiv.innerHTML = '<i class="fas fa-exclamation-circle"></i> Error: ' + errorMsg;
                        statusDiv.style.color = '#ef4444';
                    }
                    showNotification('Error: ' + errorMsg, 'error');
                    return;
                }

                // Success
                if (statusDiv) {
                    statusDiv.innerHTML = '<i class="fas fa-check-circle"></i> Lines cancelled successfully!';
                    statusDiv.style.color = '#10b981';
                }
                showNotification('Lines cancelled successfully in Oracle Fusion', 'success');

                // Close popup after 2 seconds and refresh grid
                setTimeout(() => {
                    const popup = document.getElementById('cancel-lines-popup');
                    if (popup) {
                        popup.remove();
                    }
                    refreshSalesOrderLines(orderNumber);
                }, 2000);

            } catch (parseError) {
                console.error('[Order Transactions] Parse error:', parseError);
                if (statusDiv) {
                    statusDiv.innerHTML = '<i class="fas fa-check-circle"></i> Request completed';
                    statusDiv.style.color = '#10b981';
                }
                showNotification('Lines cancelled in Oracle Fusion', 'success');

                // Close popup and refresh
                setTimeout(() => {
                    const popup = document.getElementById('cancel-lines-popup');
                    if (popup) {
                        popup.remove();
                    }
                    refreshSalesOrderLines(orderNumber);
                }, 2000);
            }
        });
    };

    window.refreshLotDetails = function(orderNumber) {
        console.log('[Order Transactions] Refresh Lot Details for:', orderNumber);
        const gridContainer = document.getElementById('lot-details-grid');
        if (!gridContainer) {
            console.error('[Order Transactions] Lot Details grid container not found');
            return;
        }

        // Get instance from context
        const instance = window.currentOrderTransContext?.instance || window.currentTripInstance || 'TEST';
        console.log('[Order Transactions] Using instance:', instance);

        // Show loading state
        gridContainer.innerHTML = '<div style="padding: 2rem; text-align: center; color: #64748b;"><i class="fas fa-spinner fa-spin" style="font-size: 2rem; margin-bottom: 1rem;"></i><p>Loading Lot Details...</p></div>';

        const apiUrl = `https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/TRIPMANAGEMENT/trips/orders/getlotdetails/${orderNumber}?P_INSTANCE_NAME=${instance}`;

        console.log('[Order Transactions] Fetching Lot Details from:', apiUrl);

        // Use C# REST handler
        sendMessageToCSharp({
            action: 'executeGet',
            fullUrl: apiUrl
        }, function(error, data) {
            if (error) {
                console.error('[Order Transactions] Error fetching Lot Details:', error);
                gridContainer.innerHTML = `<div style="padding: 2rem; text-align: center; color: #ef4444;"><i class="fas fa-exclamation-circle" style="font-size: 2rem; margin-bottom: 1rem;"></i><p>Error loading data</p><p style="font-size: 0.85rem;">${error}</p></div>`;
                return;
            }

            try {
                let responseData = typeof data === 'string' ? JSON.parse(data) : data;
                let items = responseData.items || responseData || [];

                console.log('[Order Transactions] Lot Details received:', items.length, 'records');

                if (items.length === 0) {
                    gridContainer.innerHTML = '<div style="padding: 2rem; text-align: center; color: #64748b;"><i class="fas fa-inbox" style="font-size: 2rem; margin-bottom: 1rem;"></i><p>No Lot Details found</p></div>';
                    return;
                }

                // Log first item to see available fields
                console.log('[Order Transactions] Lot Details first item:', items[0]);

                // Build columns dynamically from first item
                const firstItem = items[0];
                const columns = Object.keys(firstItem).map(key => {
                    return {
                        dataField: key,
                        caption: key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
                        width: 'auto'
                    };
                });

                // Initialize DevExpress Grid with multi-selection
                if (typeof DevExpress !== 'undefined' && DevExpress.ui?.dxDataGrid) {
                    // Clear container
                    gridContainer.innerHTML = '';

                    window.lotDetailsGridInstance = new DevExpress.ui.dxDataGrid(gridContainer, {
                        dataSource: items,
                        showBorders: true,
                        showRowLines: true,
                        rowAlternationEnabled: true,
                        allowColumnResizing: true,
                        columnAutoWidth: true,
                        height: '100%',
                        paging: { pageSize: 25 },
                        pager: {
                            showPageSizeSelector: true,
                            allowedPageSizes: [10, 25, 50, 100],
                            showInfo: true
                        },
                        filterRow: { visible: true },
                        headerFilter: { visible: true },
                        searchPanel: { visible: true, width: 200, placeholder: 'Search...' },
                        selection: {
                            mode: 'multiple',
                            showCheckBoxesMode: 'always'
                        },
                        columns: columns,
                        onContentReady: function(e) {
                            console.log('[Order Transactions] Lot Details grid rendered with multi-selection');
                        },
                        onSelectionChanged: function(e) {
                            console.log('[Order Transactions] Lot Details selection changed:', e.selectedRowsData.length, 'items selected');
                        }
                    });
                } else {
                    // Fallback to HTML table
                    let html = '<div style="overflow-x: auto; max-height: 400px;"><table style="width: 100%; border-collapse: collapse; font-size: 11px;">';
                    html += '<thead style="position: sticky; top: 0; background: #f8f9fa;"><tr>';
                    Object.keys(firstItem).forEach(key => {
                        html += `<th style="padding: 0.5rem; text-align: left; border-bottom: 2px solid #e2e8f0; font-weight: 600;">${key.replace(/_/g, ' ')}</th>`;
                    });
                    html += '</tr></thead><tbody>';

                    items.forEach((item, idx) => {
                        const bg = idx % 2 === 0 ? '#ffffff' : '#f8fafc';
                        html += `<tr style="background: ${bg};">`;
                        Object.values(item).forEach(val => {
                            html += `<td style="padding: 0.4rem; border-bottom: 1px solid #f1f5f9;">${val !== null ? val : ''}</td>`;
                        });
                        html += '</tr>';
                    });

                    html += '</tbody></table></div>';
                    gridContainer.innerHTML = html;
                }

            } catch (parseError) {
                console.error('[Order Transactions] Parse error:', parseError);
                gridContainer.innerHTML = `<div style="padding: 2rem; text-align: center; color: #ef4444;"><i class="fas fa-exclamation-circle" style="font-size: 2rem; margin-bottom: 1rem;"></i><p>Error parsing data</p><p style="font-size: 0.85rem;">${parseError.message}</p></div>`;
            }
        });
    };

    window.refreshShipmentDetails = function(orderNumber) {
        console.log('[Order Transactions] Refresh Shipment Details for:', orderNumber);
        const gridContainer = document.getElementById('shipment-details-grid');
        if (gridContainer) {
            gridContainer.innerHTML = '<div style="padding: 2rem; text-align: center; color: #64748b;"><i class="fas fa-info-circle" style="font-size: 2rem; margin-bottom: 1rem;"></i><p>Shipment Details will be loaded here</p><p style="font-size: 0.85rem; margin-top: 0.5rem;">Data retrieval API integration pending</p></div>';
        }
    };

    window.refreshFusionShipmentLines = function(orderNumber) {
        const ctx = window.currentOrderTransContext || {};
        const instance = ctx.instance || window.currentOrderTransactionsInstance || 'TEST';
        const fusionBaseUrl = instance.toUpperCase() === 'PROD'
            ? 'https://efmh.fa.em3.oraclecloud.com'
            : 'https://efmh-test.fa.em3.oraclecloud.com';
        const url = `${fusionBaseUrl}/fscmRestApi/resources/11.13.18.05/shipmentLines?q=Order=${orderNumber}&limit=500`;

        console.log('[Fusion Shipment Lines] URL:', url);

        const gridContainer = document.getElementById('fusion-shipment-lines-grid');
        const statusEl = document.getElementById('fusion-shipment-lines-status');

        if (gridContainer) {
            gridContainer.innerHTML = '<div style="padding: 2rem; text-align: center; color: #64748b;"><i class="fas fa-spinner fa-spin" style="font-size: 2rem; margin-bottom: 1rem;"></i><p>Loading Shipment Lines...</p></div>';
        }
        if (statusEl) statusEl.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Loading...';

        sendMessageToCSharp({
            action: 'executeOracleFusionGet',
            fullUrl: url,
            instance: instance
        }, function(error, data) {
            if (statusEl) statusEl.innerHTML = '';
            if (error) {
                console.error('[Fusion Shipment Lines] Error:', error);
                if (gridContainer) {
                    gridContainer.innerHTML = `<div style="padding: 2rem; text-align: center; color: #ef4444;"><i class="fas fa-exclamation-circle" style="font-size: 2rem; margin-bottom: 1rem;"></i><p>Error loading Shipment Lines</p><p style="font-size: 0.85rem;">${error}</p></div>`;
                }
                return;
            }

            try {
                const response = typeof data === 'string' ? JSON.parse(data) : data;

                // Sort by OrderLine numerically (e.g. 1.1, 1.2, 2.1)
                const parseOL = s => (s || '').split('.').map(Number);
                const items = (response.items || []).sort((a, b) => {
                    const [a0 = 0, a1 = 0] = parseOL(a.OrderLine);
                    const [b0 = 0, b1 = 0] = parseOL(b.OrderLine);
                    return a0 !== b0 ? a0 - b0 : a1 - b1;
                });

                if (!items.length) {
                    if (gridContainer) {
                        gridContainer.innerHTML = '<div style="padding: 2rem; text-align: center; color: #64748b;"><i class="fas fa-inbox" style="font-size: 2rem; margin-bottom: 1rem;"></i><p>No shipment lines found for this order</p></div>';
                    }
                    return;
                }

                const columns = [
                    { field: 'ShipmentLine', label: 'Shipment Line', width: '110px' },
                    { field: 'Order', label: 'Order', width: '120px' },
                    { field: 'OrderLine', label: 'Order Line', width: '90px' },
                    { field: 'SourceOrderLine', label: 'Src Order Line', width: '110px' },
                    { field: 'SourceOrderFulfillmentLine', label: 'Fulfillment Line', width: '120px' },
                    { field: 'SourceOrderFulfillmentLineId', label: 'Fulfillment Line ID', width: '150px' },
                    { field: 'Item', label: 'Item', width: '140px' },
                    { field: 'ItemDescription', label: 'Item Description', width: '200px' },
                    { field: 'RequestedQuantity', label: 'Req Qty', width: '80px' },
                    { field: 'StagedQuantity', label: 'Staged Qty', width: '90px' },
                    { field: 'ShippedQuantity', label: 'Shipped Qty', width: '90px' },
                    { field: 'SubinventoryName', label: 'Subinventory', width: '120px' },
                    { field: 'LineStatus', label: 'Line Status', width: '140px' },
                    { field: 'ShipToCustomer', label: 'Ship To Customer', width: '180px' },
                    { field: 'OrganizationCode', label: 'Org', width: '70px' },
                    { field: 'PickWave', label: 'Pick Wave', width: '180px' },
                    { field: 'Shipment', label: 'Shipment', width: '100px' },
                    { field: 'CreationDate', label: 'Created', width: '140px' }
                ];

                const chkTh = `<th style="padding:0.5rem 0.5rem;background:#f8fafc;border-bottom:2px solid #e2e8f0;position:sticky;top:0;z-index:1;width:32px;">
                    <input type="checkbox" id="fsl-chk-all" title="Select all backordered" onchange="fslToggleAllBackordered(this.checked)" style="cursor:pointer;">
                </th>`;
                let headerHtml = chkTh + columns.map(c => `<th style="padding: 0.5rem 0.75rem; background: #f8fafc; border-bottom: 2px solid #e2e8f0; text-align: left; white-space: nowrap; font-size: 0.75rem; color: #475569; font-weight: 600; position: sticky; top: 0; z-index: 1; min-width: ${c.width};">${c.label}</th>`).join('');

                let rowsHtml = items.map((row, idx) => {
                    const statusCode = row.LineStatusCode || '';
                    const lineStatus = (row.LineStatus || '').toUpperCase();
                    const isBackordered = lineStatus.includes('BACKORDER') || lineStatus.includes('BACK ORDER');
                    let statusColor = '#64748b';
                    if (statusCode === 'Y') statusColor = '#10b981';
                    else if (statusCode === 'C') statusColor = '#3b82f6';
                    else if (statusCode === 'X') statusColor = '#ef4444';
                    else if (isBackordered) statusColor = '#d97706';

                    const rowBg = isBackordered ? '#fffbeb' : '';
                    const chkTd = `<td style="padding:0.3rem 0.5rem;border-bottom:1px solid #f1f5f9;">
                        <input type="checkbox" class="fsl-row-chk" data-idx="${idx}"
                            data-order="${row.Order || orderNumber}"
                            data-line="${row.ShipmentLine || ''}"
                            data-item="${row.Item || ''}"
                            data-status="${(row.LineStatus || '').replace(/"/g,'')}"
                            ${isBackordered ? 'checked' : ''}
                            style="cursor:pointer;">
                    </td>`;

                    const cells = columns.map(c => {
                        let val = row[c.field] !== null && row[c.field] !== undefined ? row[c.field] : '';
                        if (c.field === 'LineStatus') {
                            const boBadge = isBackordered ? `<span style="background:#fef3c7;color:#92400e;padding:1px 5px;border-radius:3px;font-size:10px;font-weight:700;margin-left:4px;">BO</span>` : '';
                            val = `<span style="color:${statusColor};font-weight:600;">${val}</span>${boBadge}`;
                        } else if (c.field === 'CreationDate' && val) {
                            val = val.replace('T', ' ').substring(0, 19);
                        }
                        return `<td style="padding: 0.4rem 0.75rem; border-bottom: 1px solid #f1f5f9; font-size: 0.8rem; white-space: nowrap;">${val}</td>`;
                    }).join('');

                    const boAttr = isBackordered ? ' data-bo="1"' : '';
                    return `<tr${boAttr} style="background:${rowBg};" onmouseover="this.style.background='#f1f5f9'" onmouseout="this.style.background='${rowBg}'">${chkTd}${cells}</tr>`;
                }).join('');

                const boCount = items.filter(r => {
                    const s = (r.LineStatus || '').toUpperCase();
                    return s.includes('BACKORDER') || s.includes('BACK ORDER');
                }).length;

                if (gridContainer) {
                    gridContainer.innerHTML = `
                        <div style="display:flex; align-items:center; gap:0.75rem; margin-bottom:0.5rem; flex-wrap:wrap;">
                            <span id="fsl-count" style="font-size:0.8rem; color:#64748b;">${items.length} record(s)</span>
                            ${boCount ? `<span style="background:#fef3c7;color:#92400e;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:700;"><i class="fas fa-exclamation-triangle"></i> ${boCount} backordered</span>` : ''}
                            <div style="position:relative; margin-left:auto;">
                                <i class="fas fa-search" style="position:absolute;left:7px;top:50%;transform:translateY(-50%);color:#94a3b8;font-size:11px;pointer-events:none;"></i>
                                <input type="text" id="fsl-search" placeholder="Search item, status, line..." oninput="fslFilterRows(this.value, ${items.length})"
                                    style="padding:4px 8px 4px 24px;border:1px solid #e2e8f0;border-radius:6px;font-size:11px;width:220px;outline:none;"
                                    onfocus="this.style.borderColor='#667eea'" onblur="this.style.borderColor='#e2e8f0'">
                            </div>
                        </div>
                        <div style="overflow:auto; height:calc(100% - 2.5rem); border:1px solid #e2e8f0; border-radius:6px;">
                            <table id="fsl-table" style="width:100%; border-collapse:collapse; font-size:0.8rem;">
                                <thead><tr>${headerHtml}</tr></thead>
                                <tbody id="fsl-tbody">${rowsHtml}</tbody>
                            </table>
                        </div>`;
                }
            } catch (parseError) {
                console.error('[Fusion Shipment Lines] Parse error:', parseError);
                if (gridContainer) {
                    gridContainer.innerHTML = `<div style="padding: 2rem; text-align: center; color: #ef4444;"><i class="fas fa-exclamation-circle" style="font-size: 2rem; margin-bottom: 1rem;"></i><p>Error parsing response</p><p style="font-size: 0.85rem;">${parseError.message}</p></div>`;
                }
            }
        });
    };

    window.fslFilterRows = function(query, total) {
        const q = (query || '').toLowerCase().trim();
        const rows = document.querySelectorAll('#fsl-tbody tr');
        let visible = 0;
        rows.forEach(row => {
            const show = !q || row.textContent.toLowerCase().includes(q);
            row.style.display = show ? '' : 'none';
            if (show) visible++;
        });
        const countEl = document.getElementById('fsl-count');
        if (countEl) countEl.textContent = q ? `${visible} / ${total} record(s)` : `${total} record(s)`;
    };

    window.fslToggleAllBackordered = function(checked) {
        document.querySelectorAll('#fsl-tbody .fsl-row-chk').forEach(chk => {
            if (checked || chk.closest('tr[data-bo]')) chk.checked = checked;
        });
    };

    window.fslPickReleaseBackorders = function(orderNumber) {
        const ctx = window.currentOrderTransContext || {};
        const instance = ctx.instance || window.currentOrderTransactionsInstance || 'TEST';
        const APEX_BASE_PR = 'https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/TRIPMANAGEMENT';
        const apiUrl = `${APEX_BASE_PR}/trip/pickrelease/oneorder/${orderNumber}?P_INSTANCE_NAME=${instance}`;

        const selected = Array.from(document.querySelectorAll('#fsl-tbody .fsl-row-chk:checked'));
        if (!selected.length) {
            showNotification('Please select at least one line to pick release.', 'warning');
            return;
        }

        const lines = selected.map(chk => ({
            line: chk.dataset.line,
            item: chk.dataset.item,
            status: chk.dataset.status,
            order: chk.dataset.order
        }));

        // Confirm dialog
        const existing = document.getElementById('fsl-pr-confirm-dlg');
        if (existing) existing.remove();
        const dlg = document.createElement('div');
        dlg.id = 'fsl-pr-confirm-dlg';
        dlg.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:99999;display:flex;align-items:center;justify-content:center;';
        dlg.innerHTML = `
            <div style="background:#fff;border-radius:12px;width:520px;max-width:95vw;box-shadow:0 20px 60px rgba(0,0,0,0.3);overflow:hidden;">
                <div style="background:linear-gradient(135deg,#7c3aed,#6d28d9);padding:0.85rem 1.2rem;display:flex;align-items:center;gap:0.6rem;">
                    <i class="fas fa-box-open" style="color:white;font-size:1rem;"></i>
                    <div style="font-weight:700;color:white;">Pick Release BackOrders</div>
                    <button onclick="document.getElementById('fsl-pr-confirm-dlg').remove()" style="margin-left:auto;background:none;border:none;color:rgba(255,255,255,0.8);font-size:1.2rem;cursor:pointer;">×</button>
                </div>
                <div style="padding:1rem 1.2rem;">
                    <div style="background:#f5f3ff;border:1px solid #ddd6fe;border-radius:8px;padding:0.75rem;margin-bottom:0.75rem;font-size:12px;">
                        <div style="font-weight:700;color:#6d28d9;margin-bottom:4px;">Order: ${orderNumber} &nbsp;·&nbsp; Instance: ${instance}</div>
                        <div style="color:#64748b;word-break:break-all;">${apiUrl}</div>
                    </div>
                    <div style="font-size:12px;color:#475569;margin-bottom:0.5rem;font-weight:600;">${lines.length} selected line(s):</div>
                    <div style="max-height:160px;overflow-y:auto;border:1px solid #e2e8f0;border-radius:6px;">
                        <table style="width:100%;border-collapse:collapse;font-size:11px;">
                            <thead><tr style="background:#f8fafc;">
                                <th style="padding:4px 8px;text-align:left;color:#64748b;">Shipment Line</th>
                                <th style="padding:4px 8px;text-align:left;color:#64748b;">Item</th>
                                <th style="padding:4px 8px;text-align:left;color:#64748b;">Status</th>
                            </tr></thead>
                            <tbody>${lines.map(l => `<tr style="border-bottom:1px solid #f1f5f9;">
                                <td style="padding:4px 8px;">${l.line || '—'}</td>
                                <td style="padding:4px 8px;font-weight:600;">${l.item || '—'}</td>
                                <td style="padding:4px 8px;"><span style="background:#fef3c7;color:#92400e;padding:1px 5px;border-radius:3px;font-size:10px;">${l.status || '—'}</span></td>
                            </tr>`).join('')}</tbody>
                        </table>
                    </div>
                </div>
                <div style="padding:0.75rem 1.2rem;border-top:1px solid #e2e8f0;background:#f8fafc;display:flex;gap:0.5rem;justify-content:flex-end;">
                    <button onclick="document.getElementById('fsl-pr-confirm-dlg').remove()"
                        style="padding:6px 16px;border:1px solid #cbd5e1;border-radius:6px;background:#fff;cursor:pointer;font-size:12px;font-weight:600;color:#475569;">Cancel</button>
                    <button onclick="fslExecutePickRelease('${orderNumber}','${instance}')"
                        style="padding:6px 16px;border:none;border-radius:6px;background:#7c3aed;color:white;cursor:pointer;font-size:12px;font-weight:700;">
                        <i class="fas fa-box-open"></i> Run Pick Release
                    </button>
                </div>
            </div>`;
        document.body.appendChild(dlg);
    };

    window.fslExecutePickRelease = async function(orderNumber, instance) {
        const APEX_BASE_PR = 'https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/TRIPMANAGEMENT';
        const apiUrl = `${APEX_BASE_PR}/trip/pickrelease/oneorder/${orderNumber}?P_INSTANCE_NAME=${instance}`;

        const dlg = document.getElementById('fsl-pr-confirm-dlg');
        const execBtn = dlg && dlg.querySelector('button[onclick*="fslExecutePickRelease"]');
        if (execBtn) { execBtn.disabled = true; execBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Running…'; }

        try {
            await new Promise((resolve, reject) => {
                sendMessageToCSharp({ action: 'executeGet', fullUrl: apiUrl }, function(err, data) {
                    if (err) reject(new Error(err));
                    else resolve(data);
                });
            });
            document.getElementById('fsl-pr-confirm-dlg')?.remove();
            showNotification(`Pick Release submitted for order ${orderNumber}.`, 'success');
            // Refresh shipment lines
            setTimeout(() => refreshFusionShipmentLines(orderNumber), 1500);
        } catch(e) {
            if (execBtn) { execBtn.disabled = false; execBtn.innerHTML = '<i class="fas fa-box-open"></i> Run Pick Release'; }
            showNotification('Pick Release failed: ' + e.message, 'error');
        }
    };

    window.fslShowPickReleaseApiInfo = function(orderNumber) {
        const ctx = window.currentOrderTransContext || {};
        const instance = ctx.instance || window.currentOrderTransactionsInstance || 'TEST';
        const APEX_BASE_PR = 'https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/TRIPMANAGEMENT';
        const apiUrl = `${APEX_BASE_PR}/trip/pickrelease/oneorder/${orderNumber}?P_INSTANCE_NAME=${instance}`;

        const existing = document.getElementById('fsl-pr-api-popup');
        if (existing) { existing.remove(); return; }

        const pop = document.createElement('div');
        pop.id = 'fsl-pr-api-popup';
        pop.style.cssText = 'position:fixed;top:80px;right:20px;width:560px;max-width:95vw;background:#0f172a;color:#e2e8f0;border-radius:10px;box-shadow:0 16px 48px rgba(0,0,0,0.6);z-index:99999;font-family:monospace;font-size:11px;';
        pop.innerHTML = `
            <div style="padding:0.7rem 1rem;background:#1e293b;border-radius:10px 10px 0 0;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #334155;">
                <span style="font-weight:800;font-size:12px;color:#a78bfa;"><i class="fas fa-plug"></i> Pick Release BackOrders — API Endpoint</span>
                <button onclick="document.getElementById('fsl-pr-api-popup').remove()" style="background:none;border:none;color:#94a3b8;cursor:pointer;font-size:14px;">×</button>
            </div>
            <div style="padding:0.9rem 1rem;display:flex;flex-direction:column;gap:0.75rem;">
                <div>
                    <div style="color:#94a3b8;font-size:9px;font-weight:700;text-transform:uppercase;margin-bottom:0.4rem;">
                        <span style="background:#059669;color:white;padding:1px 6px;border-radius:4px;margin-right:4px;">GET</span>
                        APEX — Pick Release (one order)
                    </div>
                    <div style="background:#1e293b;border:1px solid #7c3aed;border-radius:6px;padding:0.6rem 0.8rem;">
                        <div style="color:#a78bfa;font-size:9px;margin-bottom:5px;font-weight:700;">Instance: <strong>${instance}</strong></div>
                        <div style="color:#38bdf8;word-break:break-all;line-height:1.7;">${apiUrl}</div>
                    </div>
                    <div style="color:#64748b;font-size:9px;margin-top:0.4rem;line-height:1.7;">
                        <strong style="color:#94a3b8;">Path param:</strong> <code>{ORDER_NUMBER}</code> — the order number<br>
                        <strong style="color:#94a3b8;">Query param:</strong> <code>P_INSTANCE_NAME</code> — PROD or TEST<br>
                        <strong style="color:#94a3b8;">Action:</strong> Triggers pick release wave for the order in Oracle WMS
                    </div>
                </div>
                <div style="background:#1e293b;border-radius:6px;padding:0.6rem 0.8rem;font-size:9px;color:#94a3b8;line-height:1.8;">
                    <div style="color:#e2e8f0;font-weight:700;margin-bottom:0.3rem;"><i class="fas fa-info-circle" style="color:#a78bfa;"></i> How selection works</div>
                    <div>Backordered rows (highlighted in yellow) are pre-selected. Select/deselect lines as needed, then click <strong style="color:#a78bfa;">Pick Release BackOrders</strong>. The API is called once per order number.</div>
                </div>
            </div>`;
        document.body.appendChild(pop);
    };

    window.refreshPickConfirmResponses = function(orderNumber) {
        console.log('[Order Transactions] Refresh Pick Confirmation Responses for:', orderNumber);
        const gridContainer = document.getElementById('pick-confirm-responses-grid');
        if (gridContainer) {
            gridContainer.innerHTML = '<div style="padding: 2rem; text-align: center; color: #64748b;"><i class="fas fa-info-circle" style="font-size: 2rem; margin-bottom: 1rem;"></i><p>Pick Confirmation Responses will be loaded here</p><p style="font-size: 0.85rem; margin-top: 0.5rem;">Data retrieval API integration pending</p></div>';
        }
    };

    window.refreshShipConfirmResponses = function(orderNumber) {
        console.log('[Order Transactions] Refresh Shipment Confirmation Responses for:', orderNumber);
        const gridContainer = document.getElementById('ship-confirm-responses-grid');
        if (gridContainer) {
            gridContainer.innerHTML = '<div style="padding: 2rem; text-align: center; color: #64748b;"><i class="fas fa-info-circle" style="font-size: 2rem; margin-bottom: 1rem;"></i><p>Shipment Confirmation Responses will be loaded here</p><p style="font-size: 0.85rem; margin-top: 0.5rem;">Data retrieval API integration pending</p></div>';
        }
    };

    // Refresh Pick Slip Detail - calls Web Services 2 (Sales Order Lines) and 3 (Lot Details)
    window.refreshPickSlipDetail = function(orderNumber) {
        console.log('[Order Transactions] Refresh Pick Slip Detail for:', orderNumber);
        console.log('[Order Transactions] Calling Web Service 2 (Sales Order Lines) and Web Service 3 (Lot Details)');

        // Call Web Service 2 - Sales Order Lines
        refreshSalesOrderLines(orderNumber);

        // Call Web Service 3 - Lot Details
        refreshLotDetails(orderNumber);

        // Show notification to user
        if (typeof showNotification === 'function') {
            showNotification('Refreshing Pick Slip Detail...', 'info');
        }
    };

    // Open Pick Selected Lines Popup
    window.openPickSelectedLinesPopup = function(orderNumber) {
        console.log('[Order Transactions] Opening Pick Selected Lines popup for:', orderNumber);

        // Get selected rows from lot details grid
        if (!window.lotDetailsGridInstance) {
            alert('Please load Lot Details first by clicking Refresh.');
            return;
        }

        const selectedRows = window.lotDetailsGridInstance.getSelectedRowsData();
        if (!selectedRows || selectedRows.length === 0) {
            alert('Please select at least one line to pick.');
            return;
        }

        console.log('[Order Transactions] Selected rows for picking:', selectedRows.length);
        console.log('[Order Transactions] First row data:', selectedRows[0]);

        // Get instance
        const instance = window.currentOrderTransContext?.instance || window.currentTripInstance || 'TEST';

        // Initialize pick line results storage
        window.pickLineResults = {};

        // Build table rows for selected items
        let tableRows = '';
        selectedRows.forEach((row, index) => {
            const itemCode = row.ITEM_CODE || row.item_code || row.ITEM || row.item || '';
            const description = row.DESCRIPTION || row.description || row.ITEM_DESC || row.item_desc || row.ITEM_DESCRIPTION || '';
            const lotNumber = row.LOT_NUMBER || row.lot_number || row.LOT || row.lot || '';
            const quantity = row.QUANTITY || row.quantity || row.QTY || row.qty || row.TRANSACTION_QUANTITY || 0;
            const pickSlip = row.PICK_SLIP || row.pick_slip || row.PICKSLIP || row.pickslip || '';
            const pickSlipLine = row.PICK_SLIP_LINE || row.pick_slip_line || row.LINE_NO || row.line_no || row.LINE_NUMBER || row.line_number || '';
            const subinventory = row.SOURCE_SUBINVENTORY || row.source_subinventory || row.SUBINVENTORY || row.subinventory || row.SUBINVENTORY_CODE || 'DUTY PAID';
            const pickConfirmSt = row.PICK_CONFIRM_ST || row.pick_confirm_st || '';
            const isAlreadyConfirmed = pickConfirmSt === 'YES';

            tableRows += `
                <tr data-index="${index}" id="pick-line-row-${index}" style="${isAlreadyConfirmed ? 'background: #f0fdf4;' : ''}">
                    <td style="padding: 0.5rem; border-bottom: 1px solid #e2e8f0; text-align: center;">${index + 1}</td>
                    <td style="padding: 0.5rem; border-bottom: 1px solid #e2e8f0; font-weight: 600;">${itemCode}</td>
                    <td style="padding: 0.5rem; border-bottom: 1px solid #e2e8f0; font-size: 0.8rem;">${description}</td>
                    <td style="padding: 0.5rem; border-bottom: 1px solid #e2e8f0; font-weight: 500;">${lotNumber}</td>
                    <td style="padding: 0.5rem; border-bottom: 1px solid #e2e8f0; text-align: right;">${quantity}</td>
                    <td style="padding: 0.5rem; border-bottom: 1px solid #e2e8f0; text-align: center;">
                        <input type="number" class="pick-qty-input" id="pick-qty-${index}" data-index="${index}" value="${quantity}" min="0" max="${quantity}"
                            style="width: 70px; padding: 0.3rem; border: 1px solid #d1d5db; border-radius: 4px; text-align: right; font-size: 0.85rem;" ${isAlreadyConfirmed ? 'disabled' : ''}>
                    </td>
                    <td id="pick-fusion-status-${index}" style="padding: 0.5rem; border-bottom: 1px solid #e2e8f0; text-align: center;">
                        ${isAlreadyConfirmed ? '<span style="color: #22c55e;"><i class="fas fa-check-circle"></i></span>' : '<span style="color: #9ca3af;"><i class="fas fa-minus-circle"></i></span>'}
                    </td>
                    <td id="pick-wms-status-${index}" style="padding: 0.5rem; border-bottom: 1px solid #e2e8f0; text-align: center;">
                        ${isAlreadyConfirmed ? '<span style="color: #22c55e;"><i class="fas fa-check-circle"></i></span>' : '<span style="color: #9ca3af;"><i class="fas fa-minus-circle"></i></span>'}
                    </td>
                    <td id="pick-confirm-st-${index}" style="padding: 0.5rem; border-bottom: 1px solid #e2e8f0; text-align: center; font-weight: 600; color: ${isAlreadyConfirmed ? '#22c55e' : '#9ca3af'};">
                        ${pickConfirmSt || '-'}
                    </td>
                    <td style="padding: 0.5rem; border-bottom: 1px solid #e2e8f0; text-align: center;">
                        <button id="pick-result-btn-${index}" onclick="showPickLineResult(${index})" style="padding: 0.3rem 0.5rem; background: #f1f5f9; color: #6366f1; border: 1px solid #e2e8f0; border-radius: 4px; cursor: pointer; font-size: 0.75rem; display: none;" title="View Result">
                            <i class="fas fa-info-circle"></i>
                        </button>
                        <button onclick="showPickLineApiInfo(${index}, '${pickSlip}', '${pickSlipLine}', '${lotNumber}', '${subinventory}', '${instance}')"
                            style="padding: 0.3rem 0.5rem; background: #f1f5f9; color: #6366f1; border: 1px solid #e2e8f0; border-radius: 4px; cursor: pointer; font-size: 0.75rem;"
                            title="View API Info">
                            <i class="fas fa-code"></i>
                        </button>
                    </td>
                    <td style="padding: 0.5rem; border-bottom: 1px solid #e2e8f0; text-align: center;">
                        <button id="pick-btn-${index}" onclick="confirmPickByLine(${index}, '${orderNumber}', '${instance}')"
                            style="padding: 0.35rem 0.6rem; background: ${isAlreadyConfirmed ? '#9ca3af' : 'linear-gradient(135deg, #10b981 0%, #059669 100%)'}; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 0.75rem; font-weight: 600; white-space: nowrap;" ${isAlreadyConfirmed ? 'disabled' : ''}>
                            ${isAlreadyConfirmed ? '<i class="fas fa-check-circle"></i> Done' : '<i class="fas fa-check"></i> Confirm'}
                        </button>
                    </td>
                </tr>
            `;
        });

        // Create popup HTML
        const popupHtml = `
            <div id="pick-lines-popup-overlay" style="position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 100001; display: flex; align-items: center; justify-content: center;">
                <div style="background: white; border-radius: 12px; box-shadow: 0 25px 50px rgba(0,0,0,0.3); width: 95%; max-width: 1100px; max-height: 85vh; overflow: hidden; display: flex; flex-direction: column;">
                    <!-- Header -->
                    <div style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: white; padding: 1rem 1.5rem; display: flex; align-items: center; justify-content: space-between;">
                        <div style="display: flex; align-items: center; gap: 0.75rem;">
                            <i class="fas fa-check-square" style="font-size: 1.25rem;"></i>
                            <div>
                                <div style="font-weight: 600; font-size: 1.1rem;">Pick Selected Lines (Oracle Fusion)</div>
                                <div style="font-size: 0.8rem; opacity: 0.9;">Order: ${orderNumber} | ${selectedRows.length} line(s) selected | Instance: ${instance}</div>
                            </div>
                        </div>
                        <button onclick="closePickLinesPopup()" style="background: rgba(255,255,255,0.2); border: none; color: white; padding: 0.5rem 0.75rem; border-radius: 6px; cursor: pointer;">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>

                    <!-- Content -->
                    <div style="flex: 1; overflow: auto; padding: 1rem;">
                        <table style="width: 100%; border-collapse: collapse; font-size: 0.85rem;">
                            <thead>
                                <tr style="background: #f8fafc;">
                                    <th style="padding: 0.6rem 0.4rem; text-align: center; border-bottom: 2px solid #e2e8f0; width: 40px;">S.No</th>
                                    <th style="padding: 0.6rem 0.4rem; text-align: left; border-bottom: 2px solid #e2e8f0;">Item Code</th>
                                    <th style="padding: 0.6rem 0.4rem; text-align: left; border-bottom: 2px solid #e2e8f0;">Description</th>
                                    <th style="padding: 0.6rem 0.4rem; text-align: left; border-bottom: 2px solid #e2e8f0;">Lot Number</th>
                                    <th style="padding: 0.6rem 0.4rem; text-align: right; border-bottom: 2px solid #e2e8f0; width: 70px;">Qty</th>
                                    <th style="padding: 0.6rem 0.4rem; text-align: center; border-bottom: 2px solid #e2e8f0; width: 90px;">Picked Qty</th>
                                    <th style="padding: 0.6rem 0.4rem; text-align: center; border-bottom: 2px solid #e2e8f0; width: 70px;">Fusion</th>
                                    <th style="padding: 0.6rem 0.4rem; text-align: center; border-bottom: 2px solid #e2e8f0; width: 70px;">WMS</th>
                                    <th style="padding: 0.6rem 0.4rem; text-align: center; border-bottom: 2px solid #e2e8f0; width: 80px;">Pick ST</th>
                                    <th style="padding: 0.6rem 0.4rem; text-align: center; border-bottom: 2px solid #e2e8f0; width: 80px;">Info</th>
                                    <th style="padding: 0.6rem 0.4rem; text-align: center; border-bottom: 2px solid #e2e8f0; width: 100px;">Action</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${tableRows}
                            </tbody>
                        </table>
                    </div>

                    <!-- Footer -->
                    <div style="padding: 1rem 1.5rem; background: #f8fafc; border-top: 1px solid #e2e8f0; display: flex; justify-content: space-between; align-items: center;">
                        <div id="pick-confirm-progress" style="font-size: 0.85rem; color: #64748b; display: none;">
                            <i class="fas fa-spinner fa-spin"></i> <span id="pick-progress-text">Processing...</span>
                        </div>
                        <div style="display: flex; gap: 0.75rem; margin-left: auto;">
                            <button id="pick-confirm-all-btn" onclick="confirmPickAllLines('${orderNumber}', '${instance}')" style="padding: 0.6rem 1.25rem; background: linear-gradient(135deg, #6366f1 0%, #4f46e5 100%); color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 600; font-size: 0.9rem;">
                                <i class="fas fa-check-double"></i> Pick Confirm All
                            </button>
                            <button onclick="closePickLinesPopup()" style="padding: 0.6rem 1.25rem; background: #e2e8f0; color: #475569; border: none; border-radius: 6px; cursor: pointer; font-weight: 600; font-size: 0.9rem;">
                                <i class="fas fa-times"></i> Close
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;

        // Store selected rows for later use
        window.pickLinesSelectedRows = selectedRows;

        // Remove existing popup if any
        const existingPopup = document.getElementById('pick-lines-popup-overlay');
        if (existingPopup) existingPopup.remove();

        // Add popup to body
        document.body.insertAdjacentHTML('beforeend', popupHtml);
    };

    // Close Pick Lines Popup
    window.closePickLinesPopup = function() {
        const popup = document.getElementById('pick-lines-popup-overlay');
        if (popup) popup.remove();
        window.pickLinesSelectedRows = null;
    };

    // Confirm Pick By Line - calls Oracle Fusion API for individual line
    window.confirmPickByLine = function(index, orderNumber, instance, skipConfirmDialog = false) {
        console.log('[Order Transactions] Confirming pick for line index:', index);

        if (!window.pickLinesSelectedRows || !window.pickLinesSelectedRows[index]) {
            alert('Line data not found.');
            return Promise.reject('Line data not found');
        }

        const row = window.pickLinesSelectedRows[index];
        const pickedQtyInput = document.getElementById(`pick-qty-${index}`);
        const pickedQty = pickedQtyInput ? parseFloat(pickedQtyInput.value) || 0 : 0;

        if (pickedQty <= 0) {
            alert('Please enter a valid picked quantity.');
            return Promise.reject('Invalid quantity');
        }

        // Extract data from row for Oracle Fusion API
        const pickSlip = row.PICK_SLIP || row.pick_slip || row.PICKSLIP || row.pickslip || '';
        const pickSlipLine = row.PICK_SLIP_LINE || row.pick_slip_line || row.LINE_NO || row.line_no || row.LINE_NUMBER || row.line_number || '';
        const lotNumber = row.LOT_NUMBER || row.lot_number || row.LOT || row.lot || '';
        const subinventory = row.SOURCE_SUBINVENTORY || row.source_subinventory || row.SUBINVENTORY || row.subinventory || row.SUBINVENTORY_CODE || 'DUTY PAID';
        const itemCode = row.ITEM_CODE || row.item_code || row.ITEM || row.item || '';
        const transactionId = row.TRANSACTION_ID || row.transaction_id || '';

        // Show confirmation dialog (unless skipped for batch processing)
        if (!skipConfirmDialog) {
            const confirmMsg = `Confirm Pick for Line?\n\nItem: ${itemCode}\nPick Slip: ${pickSlip}\nLine: ${pickSlipLine}\nLot: ${lotNumber}\nPicked Qty: ${pickedQty}\nSubinventory: ${subinventory}`;
            if (!confirm(confirmMsg)) {
                return Promise.reject('User cancelled');
            }
        }

        // Prepare Oracle Fusion API request body
        const requestBody = {
            pickLines: [
                {
                    PickSlip: String(pickSlip),
                    PickSlipLine: String(pickSlipLine),
                    PickedQuantity: String(pickedQty),
                    SubinventoryCode: String(subinventory),
                    lotItemLots: [
                        {
                            Lot: String(lotNumber),
                            Quantity: String(pickedQty)
                        }
                    ]
                }
            ]
        };

        console.log('[Order Transactions] Oracle Fusion Pick Confirm API Request:', requestBody);

        // Disable button and show loading
        const btn = document.getElementById(`pick-btn-${index}`);
        const fusionStatusCell = document.getElementById(`pick-fusion-status-${index}`);
        const wmsStatusCell = document.getElementById(`pick-wms-status-${index}`);
        const pickConfirmStCell = document.getElementById(`pick-confirm-st-${index}`);
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
            btn.style.background = '#9ca3af';
        }
        if (fusionStatusCell) {
            fusionStatusCell.innerHTML = '<span style="color: #f59e0b;"><i class="fas fa-spinner fa-spin"></i></span>';
        }

        // Get Oracle Fusion API URL based on instance
        const apiUrl = instance.toUpperCase() === 'PROD'
            ? API_CONFIG.ORACLE_FUSION_PICK_API.PROD
            : API_CONFIG.ORACLE_FUSION_PICK_API.TEST;

        console.log('[Order Transactions] Using Oracle Fusion API:', apiUrl);

        return new Promise((resolve, reject) => {
            sendMessageToCSharp({
                action: 'executeOracleFusionPost',
                fullUrl: apiUrl,
                body: JSON.stringify(requestBody),
                instance: instance
            }, async function(error, data) {
                let response = null;
                let isSuccess = false;

                console.log('[Oracle Fusion] Callback received - Error:', error, 'Data type:', typeof data);
                console.log('[Oracle Fusion] Raw data:', data);

                if (error) {
                    console.error('[Oracle Fusion] API Error:', error);
                    response = { error: error, ReturnStatus: 'Error', ErrorExplanation: error };
                } else {
                    // Parse response - handle nested JSON strings
                    try {
                        if (typeof data === 'string') {
                            // First parse
                            response = JSON.parse(data);
                            console.log('[Oracle Fusion] First parse result:', response);

                            // If the result is still a string (double-encoded), parse again
                            if (typeof response === 'string') {
                                response = JSON.parse(response);
                                console.log('[Oracle Fusion] Second parse result:', response);
                            }
                        } else {
                            response = data;
                        }
                    } catch (e) {
                        console.error('[Oracle Fusion] Parse error:', e.message);
                        response = { rawResponse: data, ReturnStatus: 'Unknown', parseError: e.message };
                    }

                    console.log('[Oracle Fusion] Final parsed response:', response);

                    // Check for success - Oracle Fusion returns ReturnStatus
                    isSuccess = response.ReturnStatus === 'Success';
                    console.log('[Oracle Fusion] Is Success:', isSuccess, 'ReturnStatus:', response.ReturnStatus);
                }

                // Store result for viewing later
                window.pickLineResults = window.pickLineResults || {};
                window.pickLineResults[index] = {
                    request: requestBody,
                    response: response,
                    isSuccess: isSuccess,
                    timestamp: new Date().toISOString(),
                    itemCode: itemCode,
                    lotNumber: lotNumber
                };

                // Update Fusion status cell with icon
                if (fusionStatusCell) {
                    if (isSuccess) {
                        fusionStatusCell.innerHTML = '<span style="color: #22c55e; font-size: 1.1rem;"><i class="fas fa-check-circle"></i></span>';
                    } else {
                        fusionStatusCell.innerHTML = '<span style="color: #ef4444; font-size: 1.1rem;"><i class="fas fa-times-circle"></i></span>';
                    }
                }

                // Show result button
                const resultBtn = document.getElementById(`pick-result-btn-${index}`);
                if (resultBtn) {
                    resultBtn.style.display = 'inline-block';
                    if (isSuccess) {
                        resultBtn.style.color = '#22c55e';
                        resultBtn.style.borderColor = '#22c55e';
                    } else {
                        resultBtn.style.color = '#ef4444';
                        resultBtn.style.borderColor = '#ef4444';
                    }
                }

                // Mark row with appropriate color
                const rowEl = document.getElementById(`pick-line-row-${index}`);
                if (rowEl) {
                    rowEl.style.background = isSuccess ? '#f0fdf4' : '#fef2f2';
                }

                // Show notification
                if (isSuccess) {
                    showNotification(`Fusion Pick confirmed for ${itemCode} - Lot: ${lotNumber}`, 'success');

                    // Show loading for WMS status
                    if (wmsStatusCell) {
                        wmsStatusCell.innerHTML = '<span style="color: #f59e0b;"><i class="fas fa-spinner fa-spin"></i></span>';
                    }

                    // Call updatepickconfirmstatus webservice on success
                    const updateStatusUrl = 'https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/TRIPMANAGEMENT/trip/updatepickconfirmstatus';
                    const updateStatusBody = {
                        P_TRANSACTION_ID: transactionId,
                        p_instance_name: instance.toUpperCase(),
                        p_pickedQty: pickedQty
                    };

                    console.log('[Pick Confirm] Calling updatepickconfirmstatus API:', updateStatusUrl);
                    console.log('[Pick Confirm] Request Body:', updateStatusBody);

                    // Store the update status request in results
                    window.pickLineResults[index].updateStatusRequest = updateStatusBody;
                    window.pickLineResults[index].updateStatusUrl = updateStatusUrl;

                    // Make the API call to update pick confirm status via C# backend (to avoid CORS)
                    try {
                        const updateData = await new Promise((resolveUpdate, rejectUpdate) => {
                            sendMessageToCSharp({
                                action: 'executePost',
                                fullUrl: updateStatusUrl,
                                body: JSON.stringify(updateStatusBody)
                            }, function(error, data) {
                                if (error) {
                                    rejectUpdate(new Error(error));
                                } else {
                                    // Parse the response if it's a string
                                    let parsedData = data;
                                    if (typeof data === 'string') {
                                        try {
                                            parsedData = JSON.parse(data);
                                        } catch (e) {
                                            // Keep as string if not valid JSON
                                        }
                                    }
                                    resolveUpdate(parsedData);
                                }
                            });
                        });
                        console.log('[Pick Confirm] updatepickconfirmstatus API Response:', updateData);
                        window.pickLineResults[index].updateStatusResponse = updateData;
                        window.pickLineResults[index].updateStatusSuccess = true;

                        // Update WMS status cell to success
                        if (wmsStatusCell) {
                            wmsStatusCell.innerHTML = '<span style="color: #22c55e; font-size: 1.1rem;"><i class="fas fa-check-circle"></i></span>';
                        }

                        // Update Pick Confirm ST to YES
                        if (pickConfirmStCell) {
                            pickConfirmStCell.innerHTML = 'YES';
                            pickConfirmStCell.style.color = '#22c55e';
                        }

                        showNotification(`WMS status updated for ${itemCode}`, 'success');
                    } catch (updateError) {
                        console.error('[Pick Confirm] updatepickconfirmstatus API Error:', updateError);
                        window.pickLineResults[index].updateStatusResponse = { error: updateError.message };
                        window.pickLineResults[index].updateStatusSuccess = false;

                        // Update WMS status cell to error
                        if (wmsStatusCell) {
                            wmsStatusCell.innerHTML = '<span style="color: #ef4444; font-size: 1.1rem;"><i class="fas fa-times-circle"></i></span>';
                        }

                        showNotification(`WMS status update failed for ${itemCode}: ${updateError.message}`, 'error');
                    }

                    // Update button state after everything is done
                    if (btn) {
                        btn.innerHTML = '<i class="fas fa-check-circle"></i> Done';
                        btn.style.background = '#22c55e';
                        btn.disabled = true;
                    }

                    resolve(response);
                } else {
                    // Update button state for failure
                    if (btn) {
                        btn.innerHTML = '<i class="fas fa-times"></i> Failed';
                        btn.style.background = '#ef4444';
                        btn.disabled = false;
                        btn.onclick = function() { confirmPickByLine(index, orderNumber, instance); };
                    }

                    const errorMsg = response.ErrorExplanation || response.error || 'Unknown error';
                    showNotification(`Pick failed for ${itemCode}: ${errorMsg}`, 'error');
                    reject(response);
                }
            });
        });
    };

    // Show Pick Line Result popup
    window.showPickLineResult = function(index) {
        const result = window.pickLineResults && window.pickLineResults[index];
        if (!result) {
            alert('No result available for this line.');
            return;
        }

        const isSuccess = result.isSuccess;
        const statusColor = isSuccess ? '#22c55e' : '#ef4444';
        const statusIcon = isSuccess ? 'fa-check-circle' : 'fa-times-circle';
        const statusText = isSuccess ? 'Success' : 'Error';

        const popupHtml = `
            <div id="pick-result-popup" style="position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 100010; display: flex; align-items: center; justify-content: center;">
                <div style="background: white; border-radius: 12px; box-shadow: 0 25px 50px rgba(0,0,0,0.3); width: 90%; max-width: 700px; max-height: 80vh; overflow: hidden; display: flex; flex-direction: column;">
                    <!-- Header -->
                    <div style="background: ${statusColor}; color: white; padding: 1rem 1.5rem; display: flex; align-items: center; justify-content: space-between;">
                        <div style="display: flex; align-items: center; gap: 0.75rem;">
                            <i class="fas ${statusIcon}" style="font-size: 1.25rem;"></i>
                            <div>
                                <div style="font-weight: 600; font-size: 1.1rem;">Pick Confirm Result - ${statusText}</div>
                                <div style="font-size: 0.8rem; opacity: 0.9;">Item: ${result.itemCode} | Lot: ${result.lotNumber}</div>
                            </div>
                        </div>
                        <button onclick="document.getElementById('pick-result-popup').remove()" style="background: rgba(255,255,255,0.2); border: none; color: white; padding: 0.5rem 0.75rem; border-radius: 6px; cursor: pointer;">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>

                    <!-- Content -->
                    <div style="flex: 1; overflow: auto; padding: 1.5rem;">
                        <!-- Timestamp -->
                        <div style="margin-bottom: 1rem; font-size: 0.85rem; color: #64748b;">
                            <i class="fas fa-clock" style="margin-right: 0.5rem;"></i>
                            Processed: ${new Date(result.timestamp).toLocaleString()}
                        </div>

                        <!-- Request -->
                        <div style="margin-bottom: 1rem;">
                            <div style="font-weight: 600; color: #374151; margin-bottom: 0.5rem; font-size: 0.85rem;">
                                <i class="fas fa-upload" style="color: #6366f1; margin-right: 0.5rem;"></i>Request Body
                            </div>
                            <pre style="background: #1e293b; border-radius: 6px; padding: 1rem; font-family: monospace; font-size: 0.75rem; color: #e2e8f0; overflow-x: auto; margin: 0; white-space: pre-wrap; max-height: 150px;">${JSON.stringify(result.request, null, 2)}</pre>
                        </div>

                        <!-- Response -->
                        <div>
                            <div style="font-weight: 600; color: #374151; margin-bottom: 0.5rem; font-size: 0.85rem;">
                                <i class="fas fa-download" style="color: ${statusColor}; margin-right: 0.5rem;"></i>Response
                            </div>
                            <pre style="background: #1e293b; border-radius: 6px; padding: 1rem; font-family: monospace; font-size: 0.75rem; color: #e2e8f0; overflow-x: auto; margin: 0; white-space: pre-wrap; max-height: 200px;">${JSON.stringify(result.response, null, 2)}</pre>
                        </div>
                    </div>

                    <!-- Footer -->
                    <div style="padding: 1rem 1.5rem; background: #f8fafc; border-top: 1px solid #e2e8f0; display: flex; justify-content: flex-end;">
                        <button onclick="document.getElementById('pick-result-popup').remove()" style="padding: 0.6rem 1.25rem; background: #6366f1; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 600; font-size: 0.9rem;">
                            <i class="fas fa-times"></i> Close
                        </button>
                    </div>
                </div>
            </div>
        `;

        // Remove existing popup if any
        const existingPopup = document.getElementById('pick-result-popup');
        if (existingPopup) existingPopup.remove();

        // Add popup to body
        document.body.insertAdjacentHTML('beforeend', popupHtml);
    };

    // Confirm Pick All Lines - loops through all lines
    window.confirmPickAllLines = async function(orderNumber, instance) {
        if (!window.pickLinesSelectedRows || window.pickLinesSelectedRows.length === 0) {
            alert('No lines to process.');
            return;
        }

        const totalLines = window.pickLinesSelectedRows.length;
        const confirmMsg = `Are you sure you want to pick confirm ALL ${totalLines} line(s)?\n\nThis will process each line one by one using Oracle Fusion API.`;
        if (!confirm(confirmMsg)) {
            return;
        }

        // Disable the Pick Confirm All button
        const allBtn = document.getElementById('pick-confirm-all-btn');
        if (allBtn) {
            allBtn.disabled = true;
            allBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing...';
            allBtn.style.background = '#9ca3af';
        }

        // Show progress indicator
        const progressDiv = document.getElementById('pick-confirm-progress');
        const progressText = document.getElementById('pick-progress-text');
        if (progressDiv) progressDiv.style.display = 'block';

        let successCount = 0;
        let failureCount = 0;

        // Process each line sequentially
        for (let i = 0; i < totalLines; i++) {
            // Check if already processed (button is disabled)
            const btn = document.getElementById(`pick-btn-${i}`);
            if (btn && btn.disabled && btn.innerHTML.includes('Done')) {
                successCount++;
                continue; // Skip already processed lines
            }

            // Update progress
            if (progressText) {
                progressText.textContent = `Processing line ${i + 1} of ${totalLines}...`;
            }

            try {
                await confirmPickByLine(i, orderNumber, instance, true);
                successCount++;
            } catch (error) {
                console.error(`[Order Transactions] Error processing line ${i}:`, error);
                failureCount++;
            }

            // Small delay between API calls to avoid overwhelming the server
            await new Promise(resolve => setTimeout(resolve, 500));
        }

        // Hide progress
        if (progressDiv) progressDiv.style.display = 'none';

        // Update button to show completion
        if (allBtn) {
            allBtn.innerHTML = `<i class="fas fa-check-double"></i> Completed (${successCount}/${totalLines})`;
            allBtn.style.background = failureCount === 0 ? '#22c55e' : '#f59e0b';
            allBtn.disabled = true;
        }

        // Show summary notification
        if (failureCount === 0) {
            showNotification(`All ${successCount} lines pick confirmed successfully!`, 'success');
        } else {
            showNotification(`Pick confirm completed: ${successCount} success, ${failureCount} failed. Click info icons to see details.`, 'warning');
        }
    };

    // Update Pick Confirm Status for selected lines from the Lot Details grid (WMS only, no Fusion call)
    window.updatePickConfirmStatusSelected = async function(orderNumber) {
        if (!window.lotDetailsGridInstance) {
            alert('Lot Details grid not initialized.');
            return;
        }

        const selectedRows = window.lotDetailsGridInstance.getSelectedRowsData();
        if (!selectedRows || selectedRows.length === 0) {
            alert('Please select at least one line to update WMS status.');
            return;
        }

        // Get instance from the current context
        const instance = window.currentOrderTransactionsInstance || 'PROD';

        const confirmMsg = `Update WMS Pick Confirm Status for ${selectedRows.length} selected line(s)?\n\nThis will call the updatepickconfirmstatus webservice for each selected line.`;
        if (!confirm(confirmMsg)) {
            return;
        }

        const updateStatusUrl = 'https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/TRIPMANAGEMENT/trip/updatepickconfirmstatus';

        let successCount = 0;
        let failureCount = 0;
        const results = [];

        // Show processing notification
        showNotification(`Processing ${selectedRows.length} lines...`, 'info');

        for (let i = 0; i < selectedRows.length; i++) {
            const row = selectedRows[i];
            const transactionId = row.TRANSACTION_ID || row.transaction_id || '';
            const pickedQty = row.QUANTITY || row.quantity || row.QTY || row.qty || row.TRANSACTION_QUANTITY || 0;
            const itemCode = row.ITEM_CODE || row.item_code || row.ITEM || row.item || '';
            const lotNumber = row.LOT_NUMBER || row.lot_number || row.LOT || row.lot || '';

            if (!transactionId) {
                console.warn('[Update WMS Status] Skipping row without TRANSACTION_ID:', row);
                failureCount++;
                results.push({ itemCode, lotNumber, success: false, error: 'No transaction ID' });
                continue;
            }

            const updateStatusBody = {
                P_TRANSACTION_ID: transactionId,
                p_instance_name: instance.toUpperCase(),
                p_pickedQty: pickedQty
            };

            console.log('[Update WMS Status] Calling API for:', itemCode, lotNumber);
            console.log('[Update WMS Status] Request Body:', updateStatusBody);

            try {
                // Use C# backend to avoid CORS issues
                const data = await new Promise((resolveUpdate, rejectUpdate) => {
                    sendMessageToCSharp({
                        action: 'executePost',
                        fullUrl: updateStatusUrl,
                        body: JSON.stringify(updateStatusBody)
                    }, function(error, responseData) {
                        if (error) {
                            rejectUpdate(new Error(error));
                        } else {
                            // Parse the response if it's a string
                            let parsedData = responseData;
                            if (typeof responseData === 'string') {
                                try {
                                    parsedData = JSON.parse(responseData);
                                } catch (e) {
                                    // Keep as string if not valid JSON
                                }
                            }
                            resolveUpdate(parsedData);
                        }
                    });
                });
                console.log('[Update WMS Status] Response:', data);
                successCount++;
                results.push({ itemCode, lotNumber, success: true, response: data });
            } catch (error) {
                console.error('[Update WMS Status] Error:', error);
                failureCount++;
                results.push({ itemCode, lotNumber, success: false, error: error.message });
            }

            // Small delay between calls
            await new Promise(resolve => setTimeout(resolve, 300));
        }

        // Show results
        if (failureCount === 0) {
            showNotification(`WMS status updated for all ${successCount} lines successfully!`, 'success');
        } else {
            showNotification(`WMS status update: ${successCount} success, ${failureCount} failed.`, 'warning');
        }

        // Show detailed results popup
        showUpdateWmsStatusResults(results);

        // Refresh the lot details grid
        setTimeout(() => {
            refreshLotDetails(orderNumber);
        }, 1000);
    };

    // Show Update WMS Status Results popup
    window.showUpdateWmsStatusResults = function(results) {
        let tableRows = results.map((r, i) => `
            <tr style="background: ${r.success ? '#f0fdf4' : '#fef2f2'};">
                <td style="padding: 0.5rem; border-bottom: 1px solid #e2e8f0;">${i + 1}</td>
                <td style="padding: 0.5rem; border-bottom: 1px solid #e2e8f0; font-weight: 600;">${r.itemCode}</td>
                <td style="padding: 0.5rem; border-bottom: 1px solid #e2e8f0;">${r.lotNumber}</td>
                <td style="padding: 0.5rem; border-bottom: 1px solid #e2e8f0; text-align: center;">
                    ${r.success
                        ? '<span style="color: #22c55e;"><i class="fas fa-check-circle"></i> Success</span>'
                        : '<span style="color: #ef4444;"><i class="fas fa-times-circle"></i> Failed</span>'}
                </td>
                <td style="padding: 0.5rem; border-bottom: 1px solid #e2e8f0; font-size: 0.75rem;">
                    ${r.success ? JSON.stringify(r.response || {}) : (r.error || 'Unknown error')}
                </td>
            </tr>
        `).join('');

        const popupHtml = `
            <div id="update-wms-results-popup" style="position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 100010; display: flex; align-items: center; justify-content: center;">
                <div style="background: white; border-radius: 12px; box-shadow: 0 25px 50px rgba(0,0,0,0.3); width: 90%; max-width: 800px; max-height: 80vh; overflow: hidden; display: flex; flex-direction: column;">
                    <div style="background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%); color: white; padding: 1rem 1.5rem; display: flex; align-items: center; justify-content: space-between;">
                        <div style="display: flex; align-items: center; gap: 0.75rem;">
                            <i class="fas fa-database" style="font-size: 1.25rem;"></i>
                            <div style="font-weight: 600; font-size: 1.1rem;">Update WMS Status Results</div>
                        </div>
                        <button onclick="document.getElementById('update-wms-results-popup').remove()" style="background: rgba(255,255,255,0.2); border: none; color: white; padding: 0.5rem 0.75rem; border-radius: 6px; cursor: pointer;">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                    <div style="flex: 1; overflow: auto; padding: 1rem;">
                        <table style="width: 100%; border-collapse: collapse; font-size: 0.85rem;">
                            <thead>
                                <tr style="background: #f8fafc;">
                                    <th style="padding: 0.6rem; text-align: left; border-bottom: 2px solid #e2e8f0;">#</th>
                                    <th style="padding: 0.6rem; text-align: left; border-bottom: 2px solid #e2e8f0;">Item</th>
                                    <th style="padding: 0.6rem; text-align: left; border-bottom: 2px solid #e2e8f0;">Lot</th>
                                    <th style="padding: 0.6rem; text-align: center; border-bottom: 2px solid #e2e8f0;">Status</th>
                                    <th style="padding: 0.6rem; text-align: left; border-bottom: 2px solid #e2e8f0;">Details</th>
                                </tr>
                            </thead>
                            <tbody>${tableRows}</tbody>
                        </table>
                    </div>
                    <div style="padding: 1rem 1.5rem; background: #f8fafc; border-top: 1px solid #e2e8f0; display: flex; justify-content: flex-end;">
                        <button onclick="document.getElementById('update-wms-results-popup').remove()" style="padding: 0.6rem 1.25rem; background: #6366f1; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 600;">
                            <i class="fas fa-times"></i> Close
                        </button>
                    </div>
                </div>
            </div>
        `;

        const existingPopup = document.getElementById('update-wms-results-popup');
        if (existingPopup) existingPopup.remove();
        document.body.insertAdjacentHTML('beforeend', popupHtml);
    };

    // Show Pick Line API Info popup - Oracle Fusion API format
    window.showPickLineApiInfo = function(index, pickSlip, pickSlipLine, lotNumber, subinventory, instance) {
        // Get picked qty from input
        const pickedQtyInput = document.getElementById(`pick-qty-${index}`);
        const pickedQty = pickedQtyInput ? pickedQtyInput.value : '0';

        // Get Oracle Fusion API URL based on instance
        const apiUrl = instance.toUpperCase() === 'PROD'
            ? API_CONFIG.ORACLE_FUSION_PICK_API.PROD
            : API_CONFIG.ORACLE_FUSION_PICK_API.TEST;

        // Build Oracle Fusion request body
        const requestBody = {
            pickLines: [
                {
                    PickSlip: String(pickSlip),
                    PickSlipLine: String(pickSlipLine),
                    PickedQuantity: String(pickedQty),
                    SubinventoryCode: String(subinventory),
                    lotItemLots: [
                        {
                            Lot: String(lotNumber),
                            Quantity: String(pickedQty)
                        }
                    ]
                }
            ]
        };

        const jsonBodyFormatted = JSON.stringify(requestBody, null, 2);

        const popupHtml = `
            <div id="pick-api-info-popup" style="position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 100010; display: flex; align-items: center; justify-content: center;">
                <div style="background: white; border-radius: 12px; box-shadow: 0 25px 50px rgba(0,0,0,0.3); width: 90%; max-width: 700px; max-height: 80vh; overflow: hidden; display: flex; flex-direction: column;">
                    <!-- Header -->
                    <div style="background: linear-gradient(135deg, #6366f1 0%, #4f46e5 100%); color: white; padding: 1rem 1.5rem; display: flex; align-items: center; justify-content: space-between;">
                        <div style="display: flex; align-items: center; gap: 0.75rem;">
                            <i class="fas fa-cloud" style="font-size: 1.25rem;"></i>
                            <div>
                                <div style="font-weight: 600; font-size: 1.1rem;">Oracle Fusion API - Line ${index + 1}</div>
                                <div style="font-size: 0.8rem; opacity: 0.9;">Pick Transactions API (${instance})</div>
                            </div>
                        </div>
                        <button onclick="document.getElementById('pick-api-info-popup').remove()" style="background: rgba(255,255,255,0.2); border: none; color: white; padding: 0.5rem 0.75rem; border-radius: 6px; cursor: pointer;">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>

                    <!-- Content -->
                    <div style="flex: 1; overflow: auto; padding: 1.5rem;">
                        <!-- Instance Badge -->
                        <div style="margin-bottom: 1rem; display: flex; align-items: center; gap: 0.5rem;">
                            <span style="background: ${instance.toUpperCase() === 'PROD' ? '#ef4444' : '#22c55e'}; color: white; padding: 0.25rem 0.75rem; border-radius: 20px; font-size: 0.75rem; font-weight: 600;">
                                ${instance.toUpperCase() === 'PROD' ? 'PRODUCTION' : 'TEST'}
                            </span>
                            <span style="color: #64748b; font-size: 0.85rem;">Oracle Fusion Cloud</span>
                        </div>

                        <!-- Method -->
                        <div style="margin-bottom: 1rem;">
                            <div style="font-weight: 600; color: #374151; margin-bottom: 0.5rem; font-size: 0.85rem;">
                                <i class="fas fa-exchange-alt" style="color: #10b981; margin-right: 0.5rem;"></i>Method
                            </div>
                            <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 6px; padding: 0.75rem; font-family: monospace; font-size: 0.85rem; color: #166534;">
                                POST
                            </div>
                        </div>

                        <!-- URL -->
                        <div style="margin-bottom: 1rem;">
                            <div style="font-weight: 600; color: #374151; margin-bottom: 0.5rem; font-size: 0.85rem;">
                                <i class="fas fa-link" style="color: #6366f1; margin-right: 0.5rem;"></i>Full URL
                            </div>
                            <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 0.75rem; font-family: monospace; font-size: 0.75rem; word-break: break-all; color: #475569;">
                                ${apiUrl}
                            </div>
                        </div>

                        <!-- JSON Body -->
                        <div style="margin-bottom: 1rem;">
                            <div style="font-weight: 600; color: #374151; margin-bottom: 0.5rem; font-size: 0.85rem;">
                                <i class="fas fa-file-code" style="color: #f59e0b; margin-right: 0.5rem;"></i>JSON Request Body
                            </div>
                            <pre style="background: #1e293b; border-radius: 6px; padding: 1rem; font-family: monospace; font-size: 0.8rem; color: #e2e8f0; overflow-x: auto; margin: 0; white-space: pre-wrap;">${jsonBodyFormatted}</pre>
                        </div>

                        <!-- Expected Response -->
                        <div>
                            <div style="font-weight: 600; color: #374151; margin-bottom: 0.5rem; font-size: 0.85rem;">
                                <i class="fas fa-reply" style="color: #10b981; margin-right: 0.5rem;"></i>Expected Response Format
                            </div>
                            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem;">
                                <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 6px; padding: 0.75rem;">
                                    <div style="font-weight: 600; color: #166534; font-size: 0.75rem; margin-bottom: 0.5rem;"><i class="fas fa-check-circle"></i> Success</div>
                                    <pre style="font-size: 0.7rem; color: #166534; margin: 0; white-space: pre-wrap;">ReturnStatus: "Success"</pre>
                                </div>
                                <div style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 6px; padding: 0.75rem;">
                                    <div style="font-weight: 600; color: #dc2626; font-size: 0.75rem; margin-bottom: 0.5rem;"><i class="fas fa-times-circle"></i> Error</div>
                                    <pre style="font-size: 0.7rem; color: #dc2626; margin: 0; white-space: pre-wrap;">ReturnStatus: "Error"</pre>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Footer -->
                    <div style="padding: 1rem 1.5rem; background: #f8fafc; border-top: 1px solid #e2e8f0; display: flex; justify-content: flex-end;">
                        <button onclick="document.getElementById('pick-api-info-popup').remove()" style="padding: 0.6rem 1.25rem; background: #6366f1; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 600; font-size: 0.9rem;">
                            <i class="fas fa-times"></i> Close
                        </button>
                    </div>
                </div>
            </div>
        `;

        // Remove existing popup if any
        const existingPopup = document.getElementById('pick-api-info-popup');
        if (existingPopup) {
            existingPopup.remove();
        }

        // Add popup to body
        document.body.insertAdjacentHTML('beforeend', popupHtml);
    };

    // Ship Confirm Order
    window.shipConfirmOrder = async function(orderNumber) {
        console.log('[Ship Confirm] Starting for order:', orderNumber);

        const ctx = window.currentOrderTransContext;
        const instance = ctx?.instance || window.currentOrderTransactionsInstance || window.currentTripInstance || 'TEST';
        const sourceOrderNumber = ctx?.sourceOrderNumber || orderNumber;

        if (!confirm(`Ship Confirm order ${sourceOrderNumber}?\n\nThis will run 3 steps:\n  1. Get Shipment Number\n  2. Confirm Shipment in Oracle Fusion\n  3. Update WMS Ship Confirm Status`)) {
            return;
        }

        // ── Helper: wrap sendMessageToCSharp in a Promise ──────────────
        function postApex(url, body) {
            return new Promise((resolve, reject) => {
                sendMessageToCSharp({ action: 'executePost', fullUrl: url, body: JSON.stringify(body) }, function(err, data) {
                    if (err) return reject(err);
                    try { resolve(typeof data === 'string' ? JSON.parse(data) : data); }
                    catch(e) { resolve(data); }
                });
            });
        }
        function postFusion(url, body) {
            return new Promise((resolve, reject) => {
                sendMessageToCSharp({ action: 'executeOracleFusionPost', fullUrl: url, body: JSON.stringify(body), instance }, function(err, data) {
                    if (err) return reject(err);
                    try {
                        let parsed = typeof data === 'string' ? JSON.parse(data) : data;
                        if (typeof parsed === 'string') parsed = JSON.parse(parsed);
                        resolve(parsed);
                    } catch(e) { resolve(data); }
                });
            });
        }

        // ── Build / show progress modal ─────────────────────────────────
        const existingModal = document.getElementById('ship-confirm-progress-modal');
        if (existingModal) existingModal.remove();

        const stepHtml = (num, label) => `
            <div id="sc-step-${num}" style="display:flex; align-items:flex-start; gap:1rem; padding:1rem; border-radius:8px; background:#f8fafc; border:1px solid #e2e8f0; margin-bottom:0.75rem;">
                <div id="sc-icon-${num}" style="width:32px;height:32px;border-radius:50%;background:#e2e8f0;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:0.9rem;font-weight:700;color:#64748b;">${num}</div>
                <div style="flex:1;min-width:0;">
                    <div style="font-weight:600;color:#1e293b;margin-bottom:0.25rem;">${label}</div>
                    <div id="sc-msg-${num}" style="font-size:0.82rem;color:#64748b;">Waiting…</div>
                    <div id="sc-detail-${num}" style="font-size:0.78rem;color:#94a3b8;margin-top:0.25rem;word-break:break-all;display:none;"></div>
                </div>
            </div>`;

        document.body.insertAdjacentHTML('beforeend', `
            <div id="ship-confirm-progress-modal" style="position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.55);z-index:99999;display:flex;justify-content:center;align-items:center;">
                <div style="background:white;border-radius:14px;width:520px;max-width:95vw;box-shadow:0 24px 60px rgba(0,0,0,0.3);overflow:hidden;">
                    <div style="padding:1.25rem 1.5rem;background:linear-gradient(135deg,#1e293b,#334155);color:white;display:flex;align-items:center;gap:0.75rem;">
                        <i class="fas fa-truck-loading" style="font-size:1.2rem;"></i>
                        <div>
                            <div style="font-weight:700;font-size:1rem;">Ship Confirm Order</div>
                            <div style="font-size:0.8rem;opacity:0.75;">${sourceOrderNumber} &nbsp;·&nbsp; ${instance.toUpperCase()}</div>
                        </div>
                    </div>
                    <div style="padding:1.25rem 1.5rem;">
                        ${stepHtml(1, 'Get Shipment Number')}
                        ${stepHtml(2, 'Fusion Ship Confirm')}
                        ${stepHtml(3, 'Update WMS Ship Confirm Status')}
                        <div id="sc-footer" style="display:flex;justify-content:flex-end;margin-top:0.5rem;">
                            <button id="sc-close-btn" onclick="document.getElementById('ship-confirm-progress-modal').remove()" disabled
                                style="padding:0.5rem 1.5rem;background:#e2e8f0;color:#94a3b8;border:none;border-radius:6px;cursor:not-allowed;font-weight:600;">
                                Close
                            </button>
                        </div>
                    </div>
                </div>
            </div>`);

        // ── Step UI helpers ─────────────────────────────────────────────
        function setStepRunning(n) {
            document.getElementById(`sc-icon-${n}`).innerHTML = '<i class="fas fa-spinner fa-spin" style="font-size:0.85rem;"></i>';
            document.getElementById(`sc-icon-${n}`).style.background = '#dbeafe';
            document.getElementById(`sc-icon-${n}`).style.color = '#3b82f6';
            document.getElementById(`sc-step-${n}`).style.borderColor = '#93c5fd';
            document.getElementById(`sc-msg-${n}`).textContent = 'Running…';
            document.getElementById(`sc-msg-${n}`).style.color = '#3b82f6';
        }
        function setStepOk(n, msg, detail) {
            document.getElementById(`sc-icon-${n}`).innerHTML = '<i class="fas fa-check" style="font-size:0.85rem;"></i>';
            document.getElementById(`sc-icon-${n}`).style.background = '#dcfce7';
            document.getElementById(`sc-icon-${n}`).style.color = '#16a34a';
            document.getElementById(`sc-step-${n}`).style.borderColor = '#86efac';
            document.getElementById(`sc-step-${n}`).style.background = '#f0fdf4';
            document.getElementById(`sc-msg-${n}`).textContent = msg;
            document.getElementById(`sc-msg-${n}`).style.color = '#16a34a';
            if (detail) {
                const el = document.getElementById(`sc-detail-${n}`);
                el.textContent = detail;
                el.style.display = 'block';
            }
        }
        function setStepFail(n, msg) {
            document.getElementById(`sc-icon-${n}`).innerHTML = '<i class="fas fa-times" style="font-size:0.85rem;"></i>';
            document.getElementById(`sc-icon-${n}`).style.background = '#fee2e2';
            document.getElementById(`sc-icon-${n}`).style.color = '#dc2626';
            document.getElementById(`sc-step-${n}`).style.borderColor = '#fca5a5';
            document.getElementById(`sc-step-${n}`).style.background = '#fff5f5';
            document.getElementById(`sc-msg-${n}`).textContent = msg;
            document.getElementById(`sc-msg-${n}`).style.color = '#dc2626';
        }
        function enableClose(success) {
            const btn = document.getElementById('sc-close-btn');
            btn.disabled = false;
            btn.style.cursor = 'pointer';
            btn.style.background = success ? '#16a34a' : '#dc2626';
            btn.style.color = 'white';
        }

        // ── APEX base URL ───────────────────────────────────────────────
        const apexBase = 'https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP';

        // ── Fusion shipping URL (PROD vs TEST) ──────────────────────────
        const fusionShipUrl = instance.toUpperCase() === 'PROD'
            ? 'https://efmh.fa.em3.oraclecloud.com/fscmRestApi/resources/11.13.18.05/shippingTransactions'
            : 'https://efmh-test.fa.em3.oraclecloud.com/fscmRestApi/resources/11.13.18.05/shippingTransactions';

        let shipmentName = null;

        try {
            // ── STEP 1: Get Shipment Number ─────────────────────────────
            setStepRunning(1);
            console.log('[Ship Confirm] Step 1 – Get Shipment Number');
            const step1Res = await postApex(
                `${apexBase}/WAREHOUSEMANAGEMENT/getshipmentnumber`,
                { source_order_number: sourceOrderNumber, p_instance_name: instance }
            );
            console.log('[Ship Confirm] Step 1 response:', step1Res);

            // Accept various response shapes
            shipmentName = step1Res?.shipment_number || step1Res?.SHIPMENT_NUMBER
                        || step1Res?.ShipmentName    || step1Res?.shipmentName
                        || step1Res?.p_shipment_number || step1Res?.P_SHIPMENT_NUMBER
                        || null;

            if (!shipmentName) {
                const msg = step1Res?.message || step1Res?.error || JSON.stringify(step1Res);
                setStepFail(1, 'No shipment number returned: ' + msg);
                enableClose(false);
                return;
            }
            setStepOk(1, `Shipment: ${shipmentName}`, JSON.stringify(step1Res));

            // ── STEP 2: Fusion Ship Confirm ─────────────────────────────
            setStepRunning(2);
            console.log('[Ship Confirm] Step 2 – Fusion Ship Confirm, URL:', fusionShipUrl);
            const step2Body = { ShipmentName: shipmentName, Action: 'CONFIRM', Organization: 'GIC' };
            let step2Res;
            try {
                step2Res = await postFusion(fusionShipUrl, step2Body);
                console.log('[Ship Confirm] Step 2 response:', step2Res);
            } catch(fusionErr) {
                setStepFail(2, 'Fusion error: ' + fusionErr);
                enableClose(false);
                return;
            }

            // Fusion returns HTTP 201 on success; check for error fields
            const hasFusionError = step2Res?.type === 'error'
                                || step2Res?.['o:errorDetails']
                                || (step2Res?.detail && !step2Res?.ShipmentName && !step2Res?.shipmentName);
            if (hasFusionError) {
                const errMsg = step2Res?.detail || step2Res?.title || JSON.stringify(step2Res);
                setStepFail(2, 'Fusion rejected: ' + errMsg);
                enableClose(false);
                return;
            }
            setStepOk(2, 'Shipment confirmed in Oracle Fusion', JSON.stringify(step2Res));

            // ── STEP 3: Update Ship Confirmation Status ─────────────────
            setStepRunning(3);
            console.log('[Ship Confirm] Step 3 – Update WMS Ship Confirm Status');
            const step3Res = await postApex(
                `${apexBase}/TRIPMANAGEMENT/updateshipconfirmationstatus`,
                { P_SOURCE_ORDER: sourceOrderNumber, p_instance_name: instance }
            );
            console.log('[Ship Confirm] Step 3 response:', step3Res);

            const step3Ok = step3Res?.status === 'success' || step3Res?.STATUS === 'SUCCESS'
                         || step3Res?.result === 'success' || step3Res?.p_status === 'SUCCESS'
                         || (!step3Res?.error && !step3Res?.ERROR);
            if (!step3Ok) {
                const errMsg = step3Res?.message || step3Res?.error || JSON.stringify(step3Res);
                setStepFail(3, 'WMS update failed: ' + errMsg);
                enableClose(false);
                showNotification(`Ship Confirm: Fusion OK but WMS update failed for ${sourceOrderNumber}`, 'warning');
                return;
            }
            setStepOk(3, 'WMS status updated', JSON.stringify(step3Res));

            enableClose(true);
            showNotification(`Ship Confirm complete for ${sourceOrderNumber}`, 'success');
            console.log('[Ship Confirm] All 3 steps completed successfully.');

        } catch(err) {
            console.error('[Ship Confirm] Unexpected error:', err);
            enableClose(false);
            showNotification('Ship Confirm error: ' + err, 'error');
        }
    };

    // Toggle Store Transactions Header Details
    window.toggleStoreTransHeader = function() {
        const details = document.getElementById('store-trans-header-details');
        const toggleBtn = document.getElementById('store-trans-header-toggle');
        const icon = toggleBtn.querySelector('i');

        if (details.style.display === 'none' || details.style.display === '') {
            details.style.display = 'grid';
            icon.style.transform = 'rotate(180deg)';
        } else {
            details.style.display = 'none';
            icon.style.transform = 'rotate(0deg)';
        }
    };

    window.switchStoreTransTab = function(tabName) {
        // Update tab buttons
        document.querySelectorAll('.store-trans-tab').forEach(tab => {
            if (tab.dataset.tab === tabName) {
                tab.style.background = 'white';
                tab.style.color = '#667eea';
                tab.style.boxShadow = '0 2px 4px rgba(0,0,0,0.1)';
            } else {
                tab.style.background = 'transparent';
                tab.style.color = '#64748b';
                tab.style.boxShadow = 'none';
            }
        });

        // Update tab content
        document.querySelectorAll('.store-trans-tab-content').forEach(content => {
            content.style.display = 'none';
        });
        const activeContent = document.getElementById(`store-trans-${tabName}`);
        if (activeContent) {
            activeContent.style.display = 'block';
        }
    };

    // Debug logging function
    window.logDebugInfo = function(action, endpoint, payload, response, error, method) {
        const debugContent = document.getElementById('debug-log-content');
        if (!debugContent) return;

        // Clear welcome message if it exists
        const welcomeMsg = debugContent.querySelector('div[style*="text-align: center"]');
        if (welcomeMsg) {
            debugContent.innerHTML = '';
        }

        const timestamp = new Date().toLocaleTimeString();
        const logEntry = document.createElement('div');
        logEntry.style.cssText = 'margin-bottom: 1.5rem; padding: 1rem; background: #0f172a; border-radius: 6px; border-left: 4px solid #667eea;';

        let html = `
            <div style="color: #10b981; font-weight: 700; margin-bottom: 0.5rem;">
                [${timestamp}] ${action}
            </div>
        `;

        if (method) {
            const methodColor = method === 'POST' ? '#f59e0b' : (method === 'SOAP' ? '#a855f7' : '#06b6d4');
            html += `
                <div style="display: inline-block; background: ${methodColor}; color: white; padding: 0.2rem 0.6rem; border-radius: 4px; font-size: 0.7rem; font-weight: 700; margin-bottom: 0.5rem;">
                    ${method}
                </div>
            `;
        }

        if (endpoint) {
            html += `
                <div style="color: #60a5fa; margin-bottom: 0.5rem; margin-top: 0.5rem;">
                    <strong>Endpoint:</strong>
                </div>
                <div style="color: #cbd5e1; margin-bottom: 0.75rem; word-break: break-all; font-size: 0.7rem;">
                    ${endpoint}
                </div>
            `;
        }

        if (payload) {
            html += `
                <div style="color: #fbbf24; margin-bottom: 0.5rem;">
                    <strong>Payload:</strong>
                </div>
            `;

            // Special handling for SOAP XML
            if (method === 'SOAP' && payload.soapPayload) {
                // Show SOAP XML with syntax highlighting
                const escapedXml = payload.soapPayload
                    .replace(/&/g, '&amp;')
                    .replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;');

                html += `
                    <pre style="color: #e2e8f0; background: #1e293b; padding: 0.5rem; border-radius: 4px; overflow-x: auto; font-size: 0.7rem; margin-bottom: 0.75rem; max-height: 300px;">${escapedXml}</pre>
                `;

                // Show other fields except soapPayload
                const { soapPayload, ...otherFields } = payload;
                if (Object.keys(otherFields).length > 0) {
                    html += `
                        <div style="color: #fbbf24; margin-bottom: 0.5rem; margin-top: 0.5rem;">
                            <strong>Parameters:</strong>
                        </div>
                        <pre style="color: #e2e8f0; background: #1e293b; padding: 0.5rem; border-radius: 4px; overflow-x: auto; font-size: 0.7rem; margin-bottom: 0.75rem;">${JSON.stringify(otherFields, null, 2)}</pre>
                    `;
                }
            } else {
                // Regular JSON display
                html += `
                    <pre style="color: #e2e8f0; background: #1e293b; padding: 0.5rem; border-radius: 4px; overflow-x: auto; font-size: 0.7rem; margin-bottom: 0.75rem;">${JSON.stringify(payload, null, 2)}</pre>
                `;
            }
        }

        if (response) {
            html += `
                <div style="color: #34d399; margin-bottom: 0.5rem;">
                    <strong>Response:</strong>
                </div>
                <pre style="color: #e2e8f0; background: #1e293b; padding: 0.5rem; border-radius: 4px; overflow-x: auto; font-size: 0.7rem;">${JSON.stringify(response, null, 2)}</pre>
            `;
        }

        if (error) {
            html += `
                <div style="color: #f87171; margin-bottom: 0.5rem;">
                    <strong>Error:</strong>
                </div>
                <div style="color: #fca5a5; background: #7f1d1d; padding: 0.5rem; border-radius: 4px; font-size: 0.7rem;">
                    ${error}
                </div>
            `;
        }

        logEntry.innerHTML = html;
        debugContent.insertBefore(logEntry, debugContent.firstChild);
    };

    // Clear debug log
    window.clearDebugLog = function() {
        const debugContent = document.getElementById('debug-log-content');
        if (debugContent) {
            debugContent.innerHTML = `
                <div style="color: #64748b; text-align: center; padding: 2rem;">
                    <i class="fas fa-info-circle" style="font-size: 1.5rem; margin-bottom: 0.5rem;"></i>
                    <p>Debug log cleared</p>
                    <p style="font-size: 0.7rem; margin-top: 0.5rem;">New actions will be logged here</p>
                </div>
            `;
        }
    };

    window.refreshTransactionDetails = async function(orderNumber) {
        console.log('[Store Transactions] Refreshing transaction details for:', orderNumber);

        const gridContainer = document.getElementById('transaction-details-grid');
        if (!gridContainer) {
            console.error('[Store Transactions] Grid container not found');
            return;
        }

        // Show loading indicator
        gridContainer.innerHTML = '<div style="text-align: center; padding: 2rem;"><i class="fas fa-circle-notch fa-spin" style="font-size: 2rem; color: #667eea;"></i><p style="margin-top: 1rem; color: #64748b;">Loading transaction details...</p></div>';

        const currentInstance = sessionStorage.getItem('loggedInInstance') || localStorage.getItem('fusionInstance') || 'TEST';
        const apiUrl = `https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/WAREHOUSEMANAGEMENT/trip/s2vdetails/${orderNumber}?p_instance_name=${currentInstance}`;

        // Log debug info
        logDebugInfo('Refresh Transaction Details', apiUrl, { orderNumber, instance: currentInstance }, null, null, 'GET');

        sendMessageToCSharp({
            action: 'executeGet',
            fullUrl: apiUrl
        }, function(error, data) {
            console.log('[Store Transactions] Callback - Error:', error, 'Data:', data);

            // Log response or error
            if (error) {
                logDebugInfo('Refresh Transaction Details - Error', apiUrl, null, null, error, 'GET');
                gridContainer.innerHTML = `<p style="color: #ef4444; text-align: center; padding: 2rem;">Error: ${error}</p>`;
                return;
            } else {
                logDebugInfo('Refresh Transaction Details - Success', apiUrl, null, data, null, 'GET');
            }

            try {
                const response = JSON.parse(data);
                console.log('[Store Transactions] Parsed Response:', response);

                if (response && response.items && response.items.length > 0) {
                    // Clear loading message
                    gridContainer.innerHTML = '';

                    // Destroy existing grid if present
                    if (transactionDetailsGrid) {
                        try {
                            transactionDetailsGrid.dispose();
                        } catch (e) {
                            console.warn('[Store Transactions] Error disposing grid:', e);
                        }
                    }

                    // Get keys from first item to create columns dynamically
                    const keys = Object.keys(response.items[0]);
                    const columns = keys.map(key => ({
                        dataField: key,
                        caption: key.replace(/_/g, ' ').toUpperCase(),
                        width: 'auto'
                    }));

                    // Initialize DevExpress DataGrid with checkbox selection
                    transactionDetailsGrid = $('#transaction-details-grid').dxDataGrid({
                        dataSource: response.items,
                        showBorders: true,
                        showRowLines: true,
                        showColumnLines: true,
                        rowAlternationEnabled: true,
                        columnAutoWidth: false,
                        allowColumnReordering: true,
                        allowColumnResizing: true,
                        wordWrapEnabled: false,
                        hoverStateEnabled: true,
                        selection: {
                            mode: 'multiple',
                            showCheckBoxesMode: 'always',
                            allowSelectAll: true
                        },
                        scrolling: {
                            mode: 'standard',
                            columnRenderingMode: 'virtual',
                            useNative: true
                        },
                        columnFixing: {
                            enabled: true
                        },
                        sorting: {
                            mode: 'multiple'
                        },
                        columns: columns,
                        paging: {
                            pageSize: 50
                        },
                        pager: {
                            visible: true,
                            showPageSizeSelector: true,
                            allowedPageSizes: [20, 50, 100, 200],
                            showInfo: true,
                            showNavigationButtons: true
                        },
                        filterRow: {
                            visible: true,
                            applyFilter: 'auto'
                        },
                        headerFilter: {
                            visible: true
                        },
                        searchPanel: {
                            visible: true,
                            width: 240,
                            placeholder: 'Search...'
                        },
                        columnChooser: {
                            enabled: true,
                            mode: 'select'
                        },
                        export: {
                            enabled: true,
                            allowExportSelectedData: true
                        },
                        onExporting: function(e) {
                            const workbook = new ExcelJS.Workbook();
                            const worksheet = workbook.addWorksheet('Transaction Details');

                            DevExpress.excelExporter.exportDataGrid({
                                component: e.component,
                                worksheet: worksheet,
                                autoFilterEnabled: true
                            }).then(function() {
                                workbook.xlsx.writeBuffer().then(function(buffer) {
                                    saveAs(new Blob([buffer], { type: 'application/octet-stream' }), 'TransactionDetails.xlsx');
                                });
                            });
                            e.cancel = true;
                        },
                        onSelectionChanged: function(e) {
                            const selectedCount = e.selectedRowsData.length;
                            console.log('[Store Transactions] Selection changed, selected count:', selectedCount);
                            // Update button visibility based on selection
                            const cancelBtn = document.getElementById('cancel-selected-lines-btn');
                            if (cancelBtn) {
                                cancelBtn.style.display = selectedCount > 0 ? 'inline-flex' : 'none';
                            }
                        },
                        onContentReady: function(e) {
                            console.log('[Store Transactions] Transaction Details Grid loaded, row count:', e.component.totalCount());
                        }
                    }).dxDataGrid('instance');

                    // Show Fetch Lot Details button
                    document.getElementById('fetch-lot-btn').style.display = 'inline-flex';
                    // Initially hide Cancel Selected Lines button (will show when rows selected)
                    document.getElementById('cancel-selected-lines-btn').style.display = 'none';
                } else {
                    gridContainer.innerHTML = '<p style="color: #ef4444; text-align: center; padding: 2rem;">No data found for this order</p>';
                }
            } catch (parseError) {
                console.error('[Store Transactions] Parse Error:', parseError);
                gridContainer.innerHTML = `<p style="color: #ef4444; text-align: center; padding: 2rem;">Error parsing data: ${parseError.message}</p>`;
            }
        });
    };


    window.fetchLotDetails = function(orderNumber) {
        console.log('[Store Transactions] Fetching lot details for:', orderNumber);

        // Show confirmation dialog
        if (!confirm(`Are you sure you want to fetch lot details for transaction ${orderNumber}?`)) {
            console.log('[Store Transactions] Fetch lot details cancelled by user');
            return;
        }

        // Get fusion instance from localStorage
        const fusionInstance = localStorage.getItem('fusionInstance') || 'TEST';

        // Show loading state
        const fetchBtn = document.getElementById('fetch-lot-btn');
        if (fetchBtn) {
            fetchBtn.disabled = true;
            fetchBtn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Fetching...';
        }

        // Prepare POST data
        const postData = {
            p_trx_number: orderNumber,
            p_instance_name: fusionInstance
        };

        const apiUrl = 'https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/WAREHOUSEMANAGEMENT/trip/fetchlotdetails';

        console.log('[Store Transactions] Calling fetch lot details API:', apiUrl, postData);

        // Log debug info
        logDebugInfo('Fetch Lot Details', apiUrl, postData, null, null, 'POST');

        sendMessageToCSharp({
            action: 'executePost',
            fullUrl: apiUrl,
            body: JSON.stringify(postData)
        }, function(error, data) {
            console.log('[Store Transactions] Fetch Lot Details Response - Error:', error, 'Data:', data);

            // Log response or error
            if (error) {
                logDebugInfo('Fetch Lot Details - Error', apiUrl, postData, null, error, 'POST');
            } else {
                try {
                    const response = JSON.parse(data);
                    logDebugInfo('Fetch Lot Details - Success', apiUrl, postData, response, null, 'POST');
                } catch (e) {
                    logDebugInfo('Fetch Lot Details - Success', apiUrl, postData, data, null, 'POST');
                }
            }

            // Re-enable button
            if (fetchBtn) {
                fetchBtn.disabled = false;
                fetchBtn.innerHTML = '<i class="fas fa-list"></i> Fetch Lot Details';
            }

            if (error) {
                alert('Error fetching lot details: ' + error);
                return;
            }

            try {
                const response = JSON.parse(data);
                console.log('[Store Transactions] Parsed response:', response);

                if (response.success) {
                    const recordCount = response.recordCount || 0;
                    const countMsg = recordCount > 0 ? ` - ${recordCount} record(s) processed` : '';
                    alert('Success: ' + (response.message || 'Lot details fetched successfully') + countMsg);

                    // Refresh the transaction details to show updated data
                    refreshTransactionDetails(orderNumber);
                } else {
                    alert('Failed: ' + (response.message || 'Unknown error occurred'));
                }
            } catch (parseError) {
                console.error('[Store Transactions] Parse Error:', parseError);
                alert('Error parsing response: ' + parseError.message);
            }
        });
    };

    // Cancel Selected Transaction Lines
    window.cancelSelectedTransactionLines = async function(orderNumber) {
        console.log('[Store Transactions] Cancel Selected Lines called for order:', orderNumber);

        // Get selected rows from the grid
        if (!transactionDetailsGrid) {
            alert('Transaction details grid not loaded');
            return;
        }

        const selectedRows = transactionDetailsGrid.getSelectedRowsData();
        console.log('[Store Transactions] Selected rows:', selectedRows);

        if (!selectedRows || selectedRows.length === 0) {
            alert('Please select at least one line to cancel');
            return;
        }

        // Filter only PENDING lines (case-insensitive check)
        const pendingRows = selectedRows.filter(row => {
            const status = (row.TRANSACTION_STATUS || row.transaction_status || '').toUpperCase();
            return status === 'PENDING' || status === '' || !status;
        });

        if (pendingRows.length === 0) {
            alert('No pending lines selected. Only lines with PENDING status can be cancelled.');
            return;
        }

        // Warn if some rows are not pending
        if (pendingRows.length < selectedRows.length) {
            const nonPendingCount = selectedRows.length - pendingRows.length;
            if (!confirm(`${nonPendingCount} line(s) are not in PENDING status and will be skipped.\n\nContinue to cancel ${pendingRows.length} pending line(s)?`)) {
                return;
            }
        } else {
            if (!confirm(`Are you sure you want to cancel ${pendingRows.length} selected line(s)?`)) {
                return;
            }
        }

        // Show progress modal
        showCancelLinesProgressModal(pendingRows, orderNumber);
    };

    // Show Cancel Lines Progress Modal
    function showCancelLinesProgressModal(lines, orderNumber) {
        // Remove existing modal if any
        const existingModal = document.getElementById('cancel-lines-progress-modal');
        if (existingModal) existingModal.remove();

        const modalHtml = `
            <div id="cancel-lines-progress-modal" style="position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); z-index: 100000; display: flex; align-items: center; justify-content: center;">
                <div style="background: white; border-radius: 12px; width: 600px; max-height: 80vh; overflow: hidden; box-shadow: 0 20px 60px rgba(0,0,0,0.3);">
                    <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 1rem 1.5rem; display: flex; justify-content: space-between; align-items: center;">
                        <h3 style="margin: 0; font-size: 1.1rem;"><i class="fas fa-ban"></i> Cancelling Selected Lines</h3>
                        <span id="cancel-progress-count" style="font-size: 0.9rem;">0 / ${lines.length}</span>
                    </div>
                    <div style="padding: 1.5rem;">
                        <div style="margin-bottom: 1rem;">
                            <div style="display: flex; justify-content: space-between; margin-bottom: 0.5rem;">
                                <span style="font-size: 0.85rem; color: #64748b;">Progress</span>
                                <span id="cancel-progress-percent" style="font-size: 0.85rem; font-weight: 600; color: #667eea;">0%</span>
                            </div>
                            <div style="height: 8px; background: #e2e8f0; border-radius: 4px; overflow: hidden;">
                                <div id="cancel-progress-bar" style="height: 100%; background: linear-gradient(90deg, #667eea, #764ba2); width: 0%; transition: width 0.3s ease;"></div>
                            </div>
                        </div>
                        <div id="cancel-lines-status" style="max-height: 300px; overflow-y: auto; border: 1px solid #e2e8f0; border-radius: 8px; padding: 0.5rem;">
                            ${lines.map((line, idx) => `
                                <div id="cancel-line-status-${idx}" style="padding: 0.5rem; border-bottom: 1px solid #f0f0f0; display: flex; align-items: center; gap: 0.75rem;">
                                    <span id="cancel-line-icon-${idx}" style="width: 20px; text-align: center;">
                                        <i class="fas fa-clock" style="color: #94a3b8;"></i>
                                    </span>
                                    <span style="flex: 1; font-size: 0.85rem;">
                                        <strong>ID:</strong> ${line.TRANSACTION_ID || line.transaction_id || 'N/A'} |
                                        <strong>Item:</strong> ${line.ITEM || line.item || 'N/A'}
                                    </span>
                                    <span id="cancel-line-result-${idx}" style="font-size: 0.75rem; color: #94a3b8;">Waiting...</span>
                                </div>
                            `).join('')}
                        </div>
                        <div id="cancel-summary" style="margin-top: 1rem; padding: 0.75rem; background: #f8fafc; border-radius: 8px; display: none;">
                            <div style="display: flex; gap: 1.5rem; justify-content: center;">
                                <span style="color: #10b981; font-weight: 600;"><i class="fas fa-check-circle"></i> Success: <span id="cancel-success-count">0</span></span>
                                <span style="color: #ef4444; font-weight: 600;"><i class="fas fa-times-circle"></i> Failed: <span id="cancel-failed-count">0</span></span>
                            </div>
                        </div>
                    </div>
                    <div style="padding: 1rem 1.5rem; border-top: 1px solid #e2e8f0; display: flex; justify-content: flex-end; gap: 0.5rem;">
                        <button id="cancel-lines-close-btn" onclick="closeCancelLinesModal('${orderNumber}')" style="background: #e5e7eb; color: #1f2937; border: 1px solid #d1d5db; padding: 0.5rem 1.5rem; border-radius: 6px; cursor: pointer; font-weight: 600; display: none;">
                            Close
                        </button>
                    </div>
                </div>
            </div>
        `;

        document.body.insertAdjacentHTML('beforeend', modalHtml);

        // Start cancelling lines
        processCancelLines(lines, orderNumber);
    }

    // Process Cancel Lines one by one
    async function processCancelLines(lines, orderNumber) {
        let successCount = 0;
        let failedCount = 0;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const transactionId = line.TRANSACTION_ID || line.transaction_id;

            // Update current line status to processing
            const iconEl = document.getElementById(`cancel-line-icon-${i}`);
            const resultEl = document.getElementById(`cancel-line-result-${i}`);
            if (iconEl) iconEl.innerHTML = '<i class="fas fa-spinner fa-spin" style="color: #f59e0b;"></i>';
            if (resultEl) {
                resultEl.textContent = 'Cancelling...';
                resultEl.style.color = '#f59e0b';
            }

            try {
                const result = await callCancelLineAPI(transactionId);

                if (result.success) {
                    successCount++;
                    if (iconEl) iconEl.innerHTML = '<i class="fas fa-check-circle" style="color: #10b981;"></i>';
                    if (resultEl) {
                        resultEl.textContent = 'Cancelled';
                        resultEl.style.color = '#10b981';
                    }
                } else {
                    failedCount++;
                    if (iconEl) iconEl.innerHTML = '<i class="fas fa-times-circle" style="color: #ef4444;"></i>';
                    if (resultEl) {
                        resultEl.textContent = result.message || 'Failed';
                        resultEl.style.color = '#ef4444';
                    }
                }
            } catch (error) {
                failedCount++;
                if (iconEl) iconEl.innerHTML = '<i class="fas fa-times-circle" style="color: #ef4444;"></i>';
                if (resultEl) {
                    resultEl.textContent = error.message || 'Error';
                    resultEl.style.color = '#ef4444';
                }
            }

            // Update progress
            const progress = Math.round(((i + 1) / lines.length) * 100);
            const progressBar = document.getElementById('cancel-progress-bar');
            const progressPercent = document.getElementById('cancel-progress-percent');
            const progressCount = document.getElementById('cancel-progress-count');

            if (progressBar) progressBar.style.width = `${progress}%`;
            if (progressPercent) progressPercent.textContent = `${progress}%`;
            if (progressCount) progressCount.textContent = `${i + 1} / ${lines.length}`;

            // Small delay between API calls
            if (i < lines.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 300));
            }
        }

        // Show summary and close button
        const summary = document.getElementById('cancel-summary');
        const closeBtn = document.getElementById('cancel-lines-close-btn');
        const successEl = document.getElementById('cancel-success-count');
        const failedEl = document.getElementById('cancel-failed-count');

        if (summary) summary.style.display = 'block';
        if (closeBtn) closeBtn.style.display = 'inline-block';
        if (successEl) successEl.textContent = successCount;
        if (failedEl) failedEl.textContent = failedCount;

        console.log('[Store Transactions] Cancel complete - Success:', successCount, 'Failed:', failedCount);
    }

    // Call Cancel Line API
    function callCancelLineAPI(transactionId) {
        return new Promise((resolve, reject) => {
            const currentInstance = sessionStorage.getItem('loggedInInstance') || localStorage.getItem('fusionInstance') || 'TEST';
            const apiUrl = `https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/TRIPMANAGEMENT/trip/cancels2vline/${transactionId}?p_instance_name=${currentInstance}`;

            console.log('[Store Transactions] Calling cancel API for transaction:', transactionId, 'instance:', currentInstance);

            sendMessageToCSharp({
                action: 'executePost',
                fullUrl: apiUrl,
                body: JSON.stringify({})
            }, function(error, data) {
                if (error) {
                    console.error('[Store Transactions] Cancel API error:', error);
                    reject(new Error(error));
                    return;
                }

                try {
                    const response = JSON.parse(data);
                    console.log('[Store Transactions] Cancel API response:', response);

                    if (response.success || response.status === 'success' || response.message?.toLowerCase().includes('success')) {
                        resolve({ success: true, message: response.message || 'Cancelled' });
                    } else {
                        resolve({ success: false, message: response.message || 'Failed to cancel' });
                    }
                } catch (parseError) {
                    // If response is not JSON, check if it's a success indicator
                    if (data && (data.toLowerCase().includes('success') || data.toLowerCase().includes('cancelled'))) {
                        resolve({ success: true, message: 'Cancelled' });
                    } else {
                        resolve({ success: false, message: data || 'Unknown error' });
                    }
                }
            });
        });
    }

    // Close Cancel Lines Modal
    window.closeCancelLinesModal = function(orderNumber) {
        const modal = document.getElementById('cancel-lines-progress-modal');
        if (modal) modal.remove();

        // Refresh the transaction details grid
        if (orderNumber) {
            refreshTransactionDetails(orderNumber);
        }

        // Clear selection in grid
        if (transactionDetailsGrid) {
            transactionDetailsGrid.clearSelection();
        }
    };

    // Refresh Allocated Lots (Tab 3)
    window.refreshAllocatedLots = async function(orderNumber) {
        console.log('[Store Transactions] Refreshing allocated lots for:', orderNumber);

        const gridContainer = document.getElementById('allocated-lots-grid');
        if (!gridContainer) {
            console.error('[Store Transactions] Allocated Lots Grid container not found');
            return;
        }

        // Show loading indicator
        gridContainer.innerHTML = '<div style="text-align: center; padding: 2rem;"><i class="fas fa-circle-notch fa-spin" style="font-size: 2rem; color: #667eea;"></i><p style="margin-top: 1rem; color: #64748b;">Loading allocated lots...</p></div>';

        const currentInstance = sessionStorage.getItem('loggedInInstance') || localStorage.getItem('fusionInstance') || 'TEST';
        const apiUrl = `https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/WAREHOUSEMANAGEMENT/trip/fetchlotdetails?v_trx_number=${orderNumber}&p_instance_name=${currentInstance}`;

        // Log debug info
        logDebugInfo('Refresh Allocated Lots', apiUrl, { orderNumber, instance: currentInstance }, null, null, 'GET');

        sendMessageToCSharp({
            action: 'executeGet',
            fullUrl: apiUrl
        }, function(error, data) {
            console.log('[Store Transactions] Allocated Lots Callback - Error:', error, 'Data:', data);

            // Log response or error
            if (error) {
                logDebugInfo('Refresh Allocated Lots - Error', apiUrl, null, null, error, 'GET');
                gridContainer.innerHTML = `<p style="color: #ef4444; text-align: center; padding: 2rem;">Error: ${error}</p>`;
                return;
            } else {
                try {
                    const response = JSON.parse(data);
                    logDebugInfo('Refresh Allocated Lots - Success', apiUrl, null, response, null, 'GET');
                } catch (e) {
                    logDebugInfo('Refresh Allocated Lots - Success', apiUrl, null, data, null, 'GET');
                }
            }

            try {
                const response = JSON.parse(data);

                if (response && response.items && response.items.length > 0) {
                    // Store items globally for access when setting data
                    window.allocatedLotsData = response.items;

                    // Debug: Log first item structure
                    console.log('[Store Transactions] Allocated Lots - First item:', response.items[0]);
                    console.log('[Store Transactions] Allocated Lots - Total items:', response.items.length);

                    // Clear loading message
                    gridContainer.innerHTML = '';

                    // Destroy existing grid if present
                    if (allocatedLotsGrid) {
                        try {
                            allocatedLotsGrid.dispose();
                        } catch (e) {
                            console.warn('[Store Transactions] Error disposing Allocated Lots grid:', e);
                        }
                    }

                    // Helper function to check if column is status
                    const isStatusColumn = (key) => {
                        const lowerKey = key.toLowerCase();
                        const upperKey = key.toUpperCase();
                        return lowerKey.includes('status') ||
                            lowerKey.includes('_st') ||
                            upperKey === 'PICKED_ST' ||
                            upperKey === 'CANCELED_ST' ||
                            upperKey === 'SHIPED_ST' ||
                            lowerKey === 'picked_status' ||
                            lowerKey === 'canceled_status' ||
                            lowerKey === 'ship_confirm_st';
                    };

                    // Get keys from first item to create columns dynamically
                    const keys = Object.keys(response.items[0]);
                    console.log('[Store Transactions] Allocated Lots - Column keys:', keys);

                    const columns = keys.map(key => {
                        const column = {
                            dataField: key,
                            caption: key.replace(/_/g, ' ').toUpperCase(),
                            width: 'auto',
                            allowFiltering: true,
                            allowSorting: true
                        };

                        // Add custom cell template ONLY for status columns
                        if (isStatusColumn(key)) {
                            console.log('[Store Transactions] Status column detected:', key);
                            column.cellTemplate = function(container, options) {
                                const value = options.value;
                                console.log('[Store Transactions] Rendering status cell:', key, '=', value, 'Type:', typeof value);

                                // Create wrapper div
                                const wrapper = document.createElement('div');
                                wrapper.style.textAlign = 'center';

                                // Create icon element using DOM methods
                                const icon = document.createElement('i');
                                icon.style.fontSize = '0.9rem';

                                if (value === 'Y' || value === 'Yes' || value === 'YES') {
                                    icon.className = 'fas fa-check-circle';
                                    icon.style.color = '#10b981';
                                    icon.title = 'Yes';
                                    console.log('[Store Transactions] Matched YES condition - creating green check');
                                } else {
                                    // Show red X for NO, null, or empty values
                                    icon.className = 'fas fa-times-circle';
                                    icon.style.color = '#ef4444';
                                    icon.title = 'No';
                                    console.log('[Store Transactions] Matched NO condition - creating red X');
                                }

                                wrapper.appendChild(icon);
                                $(container).empty().append(wrapper);
                                console.log('[Store Transactions] Icon element appended to container');
                            };
                            column.alignment = 'center';
                        }
                        // For non-status columns, let DevExpress handle default rendering (no cellTemplate)

                        return column;
                    });

                    // Initialize DevExpress DataGrid with selection
                    allocatedLotsGrid = $('#allocated-lots-grid').dxDataGrid({
                        dataSource: response.items,
                        showBorders: true,
                        showRowLines: true,
                        showColumnLines: true,
                        rowAlternationEnabled: true,
                        columnAutoWidth: false,
                        allowColumnReordering: true,
                        allowColumnResizing: true,
                        wordWrapEnabled: false,
                        hoverStateEnabled: true,
                        scrolling: {
                            mode: 'standard',
                            columnRenderingMode: 'virtual',
                            useNative: true
                        },
                        columnFixing: {
                            enabled: true
                        },
                        sorting: {
                            mode: 'multiple'
                        },
                        selection: {
                            mode: 'multiple',
                            showCheckBoxesMode: 'always'
                        },
                        columns: columns,
                        paging: {
                            pageSize: 50
                        },
                        pager: {
                            visible: true,
                            showPageSizeSelector: true,
                            allowedPageSizes: [20, 50, 100, 200],
                            showInfo: true,
                            showNavigationButtons: true
                        },
                        filterRow: {
                            visible: true,
                            applyFilter: 'auto'
                        },
                        headerFilter: {
                            visible: true
                        },
                        searchPanel: {
                            visible: true,
                            width: 240,
                            placeholder: 'Search...'
                        },
                        columnChooser: {
                            enabled: true,
                            mode: 'select'
                        },
                        export: {
                            enabled: true,
                            allowExportSelectedData: true
                        },
                        onExporting: function(e) {
                            const workbook = new ExcelJS.Workbook();
                            const worksheet = workbook.addWorksheet('Allocated Lots');

                            DevExpress.excelExporter.exportDataGrid({
                                component: e.component,
                                worksheet: worksheet,
                                autoFilterEnabled: true
                            }).then(function() {
                                workbook.xlsx.writeBuffer().then(function(buffer) {
                                    saveAs(new Blob([buffer], { type: 'application/octet-stream' }), 'AllocatedLots.xlsx');
                                });
                            });
                            e.cancel = true;
                        },
                        onSelectionChanged: function(e) {
                            const selectedCount = e.selectedRowsData.length;
                            console.log('[Store Transactions] Selected rows:', selectedCount);
                        },
                        onContentReady: function(e) {
                            console.log('[Store Transactions] Allocated Lots Grid loaded, row count:', e.component.totalCount());
                            // Force grid to recalculate dimensions on first load only
                            if (!this._firstLoadComplete) {
                                this._firstLoadComplete = true;
                                setTimeout(() => {
                                    e.component.repaint();
                                }, 100);
                            }
                        }
                    }).dxDataGrid('instance');
                } else {
                    gridContainer.innerHTML = '<p style="color: #ef4444; text-align: center; padding: 2rem;">No allocated lots found for this order</p>';
                }
            } catch (parseError) {
                console.error('[Store Transactions] Parse Error:', parseError);
                gridContainer.innerHTML = `<p style="color: #ef4444; text-align: center; padding: 2rem;">Error parsing data: ${parseError.message}</p>`;
            }
        });
    };


    // Refresh QOH Details (Tab 2)
    window.refreshQOHDetails = async function(orderNumber) {
        console.log('[Store Transactions] Refreshing QOH details for:', orderNumber);

        const gridContainer = document.getElementById('qoh-details-grid');
        if (!gridContainer) {
            console.error('[Store Transactions] QOH Grid container not found');
            return;
        }

        // Show loading indicator
        gridContainer.innerHTML = '<div style="text-align: center; padding: 2rem;"><i class="fas fa-circle-notch fa-spin" style="font-size: 2rem; color: #667eea;"></i><p style="margin-top: 1rem; color: #64748b;">Loading QOH details...</p></div>';

        const currentInstance = sessionStorage.getItem('loggedInInstance') || localStorage.getItem('fusionInstance') || 'TEST';
        const apiUrl = `https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/WAREHOUSEMANAGEMENT/trip/tripqoh?v_trx_number=${orderNumber}&p_instance_name=${currentInstance}`;

        // Log debug info
        logDebugInfo('Refresh QOH Details', apiUrl, { orderNumber, instance: currentInstance }, null, null, 'GET');

        sendMessageToCSharp({
            action: 'executeGet',
            fullUrl: apiUrl
        }, function(error, data) {
            console.log('[Store Transactions] QOH Details Callback - Error:', error, 'Data:', data);

            // Log response or error
            if (error) {
                logDebugInfo('Refresh QOH Details - Error', apiUrl, null, null, error, 'GET');
                gridContainer.innerHTML = `<p style="color: #ef4444; text-align: center; padding: 2rem;">Error: ${error}</p>`;
                return;
            } else {
                try {
                    const response = JSON.parse(data);
                    logDebugInfo('Refresh QOH Details - Success', apiUrl, null, response, null, 'GET');
                } catch (e) {
                    logDebugInfo('Refresh QOH Details - Success', apiUrl, null, data, null, 'GET');
                }
            }

            try {
                const response = JSON.parse(data);

                if (response && response.items && response.items.length > 0) {
                    // Store QOH data globally for lot number lookup
                    window.qohData = response.items;

                    // Clear loading message
                    gridContainer.innerHTML = '';

                    // Destroy existing grid if present
                    if (qohDetailsGrid) {
                        try {
                            qohDetailsGrid.dispose();
                        } catch (e) {
                            console.warn('[Store Transactions] Error disposing QOH grid:', e);
                        }
                    }

                    // Get keys from first item to create columns dynamically
                    const keys = Object.keys(response.items[0]);
                    const columns = keys.map(key => ({
                        dataField: key,
                        caption: key.replace(/_/g, ' ').toUpperCase(),
                        width: 'auto'
                    }));

                    // Initialize DevExpress DataGrid
                    qohDetailsGrid = $('#qoh-details-grid').dxDataGrid({
                        dataSource: response.items,
                        showBorders: true,
                        showRowLines: true,
                        showColumnLines: true,
                        rowAlternationEnabled: true,
                        columnAutoWidth: false,
                        allowColumnReordering: true,
                        allowColumnResizing: true,
                        wordWrapEnabled: false,
                        hoverStateEnabled: true,
                        scrolling: {
                            mode: 'standard',
                            columnRenderingMode: 'virtual',
                            useNative: true
                        },
                        columnFixing: {
                            enabled: true
                        },
                        sorting: {
                            mode: 'multiple'
                        },
                        columns: columns,
                        paging: {
                            pageSize: 50
                        },
                        pager: {
                            visible: true,
                            showPageSizeSelector: true,
                            allowedPageSizes: [20, 50, 100, 200],
                            showInfo: true,
                            showNavigationButtons: true
                        },
                        filterRow: {
                            visible: true,
                            applyFilter: 'auto'
                        },
                        headerFilter: {
                            visible: true
                        },
                        searchPanel: {
                            visible: true,
                            width: 240,
                            placeholder: 'Search...'
                        },
                        columnChooser: {
                            enabled: true,
                            mode: 'select'
                        },
                        export: {
                            enabled: true,
                            allowExportSelectedData: false
                        },
                        onExporting: function(e) {
                            const workbook = new ExcelJS.Workbook();
                            const worksheet = workbook.addWorksheet('QOH Details');

                            DevExpress.excelExporter.exportDataGrid({
                                component: e.component,
                                worksheet: worksheet,
                                autoFilterEnabled: true
                            }).then(function() {
                                workbook.xlsx.writeBuffer().then(function(buffer) {
                                    saveAs(new Blob([buffer], { type: 'application/octet-stream' }), 'QOHDetails.xlsx');
                                });
                            });
                            e.cancel = true;
                        },
                        onContentReady: function(e) {
                            console.log('[Store Transactions] QOH Details Grid loaded, row count:', e.component.totalCount());
                            // Force grid to recalculate dimensions on first load only
                            if (!this._firstLoadComplete) {
                                this._firstLoadComplete = true;
                                setTimeout(() => {
                                    e.component.repaint();
                                }, 100);
                            }
                        }
                    }).dxDataGrid('instance');
                } else {
                    gridContainer.innerHTML = '<p style="color: #ef4444; text-align: center; padding: 2rem;">No QOH data found for this order</p>';
                }
            } catch (parseError) {
                console.error('[Store Transactions] Parse Error:', parseError);
                gridContainer.innerHTML = `<p style="color: #ef4444; text-align: center; padding: 2rem;">Error parsing data: ${parseError.message}</p>`;
            }
        });
    };


    // Get selected rows from Allocated Lots grid (for use in setData and other functions)
    window.getSelectedAllocatedLots = function() {
        console.log('[Store Transactions] getSelectedAllocatedLots called');
        console.log('[Store Transactions] allocatedLotsGrid exists:', !!allocatedLotsGrid);

        if (allocatedLotsGrid) {
            console.log('[Store Transactions] allocatedLotsGrid type:', typeof allocatedLotsGrid);
            console.log('[Store Transactions] allocatedLotsGrid has getSelectedRowsData:', typeof allocatedLotsGrid.getSelectedRowsData);

            try {
                const selectedData = allocatedLotsGrid.getSelectedRowsData();
                console.log('[Store Transactions] Selected rows count:', selectedData.length);
                console.log('[Store Transactions] Selected rows data:', selectedData);
                return selectedData;
            } catch (error) {
                console.error('[Store Transactions] Error getting selected rows:', error);
                return [];
            }
        } else {
            console.warn('[Store Transactions] allocatedLotsGrid is null/undefined');
        }
        return [];
    };

    window.processTransaction = function(orderNumber) {
        console.log('[Store Transactions] Processing transaction for:', orderNumber);

        // Show confirmation dialog
        if (!confirm(`Are you sure you want to process transaction ${orderNumber}?`)) {
            console.log('[Store Transactions] Process transaction cancelled by user');
            return;
        }

        // Get fusion instance from localStorage
        const fusionInstance = localStorage.getItem('fusionInstance') || 'TEST';

        // Prepare POST data
        const postData = {
            p_trx_number: orderNumber,
            p_instance_name: fusionInstance
        };

        const apiUrl = 'https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/WAREHOUSEMANAGEMENT/trip/processs2v';

        console.log('[Store Transactions] Calling process transaction API:', apiUrl, postData);

        // Log debug info
        logDebugInfo('Process Transaction', apiUrl, postData, null, null, 'POST');

        // Show loading dialog
        const loadingDiv = document.createElement('div');
        loadingDiv.id = 'process-transaction-loading';
        loadingDiv.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 10002; display: flex; align-items: center; justify-content: center;';
        loadingDiv.innerHTML = `
            <div style="background: white; padding: 2rem; border-radius: 12px; box-shadow: 0 8px 24px rgba(0,0,0,0.3); text-align: center;">
                <i class="fas fa-spinner fa-spin" style="font-size: 2.5rem; color: #667eea; margin-bottom: 1rem;"></i>
                <div style="font-size: 1.1rem; font-weight: 600; color: #1f2937;">Processing Transaction...</div>
                <div style="font-size: 0.9rem; color: #64748b; margin-top: 0.5rem;">Order: ${orderNumber}</div>
                <div style="font-size: 0.85rem; color: #64748b; margin-top: 0.25rem;">Instance: ${fusionInstance}</div>
            </div>
        `;
        document.body.appendChild(loadingDiv);

        sendMessageToCSharp({
            action: 'executePost',
            fullUrl: apiUrl,
            body: JSON.stringify(postData)
        }, function(error, data) {
            console.log('[Store Transactions] Process Transaction Response - Error:', error, 'Data:', data);

            // Remove loading dialog
            const loading = document.getElementById('process-transaction-loading');
            if (loading) loading.remove();

            // Log response or error
            if (error) {
                logDebugInfo('Process Transaction - Error', apiUrl, postData, null, error, 'POST');
                alert('Error processing transaction: ' + error);
                return;
            }

            try {
                const response = JSON.parse(data);
                logDebugInfo('Process Transaction - Success', apiUrl, postData, response, null, 'POST');

                console.log('[Store Transactions] Parsed response:', response);

                if (response.success) {
                    alert('Success: ' + (response.message || 'Transaction processed successfully'));

                    // Refresh the transaction details and allocated lots to show updated data
                    refreshTransactionDetails(orderNumber);
                    refreshAllocatedLots(orderNumber);
                } else {
                    alert('Failed: ' + (response.message || 'Unknown error occurred'));
                }
            } catch (parseError) {
                console.error('[Store Transactions] Parse Error:', parseError);
                logDebugInfo('Process Transaction - Success', apiUrl, postData, data, null, 'POST');
                alert('Transaction response: ' + data);
            }
        });
    };

    window.setData = function(orderNumber) {
        console.log('[Store Transactions] Set data for:', orderNumber);

        // Get selected rows from DevExpress grid
        const selectedItems = getSelectedAllocatedLots();

        if (selectedItems.length === 0) {
            alert('Please select at least one record to set data');
            return;
        }

        console.log('[Store Transactions] Selected items:', selectedItems);

        // Open Set Data dialog
        openSetDataDialog(orderNumber, selectedItems);
    };

    // Open Set Data Dialog
    function openSetDataDialog(orderNumber, selectedItems) {
        const isSingleSelection = selectedItems.length === 1;
        let modalHtml = '';

        if (isSingleSelection) {
            // Single selection mode - Form with input + datalist
            const item = selectedItems[0];
            const itemNumber = item.ITEM_NUMBER || item.item_number || item.ITEM || item.item || item.itemnumber || item.ITEMNUMBER || '';
            const itemDescription = item.ITEM_DESCRIPTION || item.item_description || item.DESCRIPTION || item.description || item.DESC || item.desc || '';

            console.log('[Set Data] Single selection - Item:', itemNumber);
            console.log('[Set Data] Single selection - Full item data:', item);

            // Get available lots for this item from QOH data
            const availableLots = window.qohData ? window.qohData.filter(qoh => {
                // QOH uses ITEMNUMBER (no underscore)
                const qohItem = qoh.ITEMNUMBER || qoh.itemnumber || qoh.ITEM_NUMBER || qoh.item_number || qoh.ITEM || qoh.item || '';
                const match = qohItem === itemNumber || qohItem.trim() === itemNumber.trim();
                if (match) {
                    console.log('[Set Data] Matched QOH item:', qohItem, 'with allocated item:', itemNumber);
                }
                return match;
            }) : [];

            console.log('[Set Data] Single selection - Found', availableLots.length, 'lots:', availableLots);
            if (window.qohData && window.qohData.length > 0) {
                console.log('[Set Data] Sample QOH record:', window.qohData[0]);
            }

            // Get allocated quantity from item
            const allocatedQty = item.ALLOCATED_QTY || item.allocated_qty || item.QTY || item.qty || item.QUANTITY || item.quantity || '';

            // Build datalist options with quantity
            let lotDatalistOptions = '';
            const singleLotExpirationMap = {};
            availableLots.forEach(lot => {
                const lotNum = lot.LOT_NUMBER || lot.lot_number || lot.LOT || lot.lot || '';
                const lotExp = lot.LOT_EXPIRATION_DATE || lot.lot_expiration_date || lot.EXPIRATION_DATE || lot.expiration_date || lot.EXPIRE_DATE || lot.expire_date || '';
                const lotQty = lot.primaryquantity || lot.PRIMARYQUANTITY || lot.QTY || lot.qty || lot.QUANTITY || lot.quantity || lot.QOH || lot.qoh || '';
                if (lotNum) {
                    // Show lot number with quantity in dropdown
                    lotDatalistOptions += `<option value="${lotNum}" label="Lot: ${lotNum} | Qty: ${lotQty}">`;
                    singleLotExpirationMap[lotNum] = lotExp;
                }
            });

            // Store expiration map globally
            window.singleLotExpirationMap = singleLotExpirationMap;

            modalHtml = `
                <div id="set-data-modal" style="display: flex; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 10001; justify-content: center; align-items: center;">
                    <div style="background: white; width: 90%; max-width: 600px; border-radius: 12px; display: flex; flex-direction: column; box-shadow: 0 20px 60px rgba(0,0,0,0.3); overflow: hidden;">
                        <div style="padding: 1rem 1.5rem; border-bottom: 2px solid #e2e8f0; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);">
                            <h3 style="margin: 0; color: white; font-size: 1.1rem;">
                                <i class="fas fa-edit"></i> Set Data for Item
                            </h3>
                            <p style="margin: 0.5rem 0 0 0; color: rgba(255,255,255,0.9); font-size: 0.8rem; line-height: 1.5;">
                                <strong>Item:</strong> ${itemNumber}<br>
                                ${itemDescription ? `<span style="font-size: 0.75rem; opacity: 0.9;">${itemDescription}</span><br>` : ''}
                                <span style="font-size: 0.75rem;">${availableLots.length} lot(s) available</span>
                            </p>
                        </div>

                        <div style="padding: 1.5rem; overflow-y: auto; max-height: 60vh;">
                            <form id="set-data-form" style="display: grid; gap: 1rem;">
                                <div>
                                    <label style="display: block; font-size: 0.85rem; font-weight: 600; color: #475569; margin-bottom: 0.4rem;">
                                        Lot Number
                                    </label>
                                    <input type="text" list="single-lot-datalist" id="set-lot-number"
                                        onchange="onLotNumberChangeInput()" oninput="onLotNumberChangeInput()"
                                        placeholder="Type or select lot number"
                                        style="width: 100%; padding: 0.6rem; border: 1px solid #e2e8f0; border-radius: 6px; font-size: 0.85rem;">
                                    <datalist id="single-lot-datalist">
                                        ${lotDatalistOptions}
                                    </datalist>
                                </div>

                                <div>
                                    <label style="display: block; font-size: 0.85rem; font-weight: 600; color: #475569; margin-bottom: 0.4rem;">
                                        Lot Expiration Date
                                    </label>
                                    <input type="date" id="set-lot-exp-date" readonly
                                        style="width: 100%; padding: 0.6rem; border: 1px solid #e2e8f0; border-radius: 6px; font-size: 0.85rem; background: #f8f9fc;">
                                </div>

                                <div>
                                    <label style="display: block; font-size: 0.85rem; font-weight: 600; color: #475569; margin-bottom: 0.4rem;">
                                        Picked Qty
                                    </label>
                                    <input type="number" id="set-picked-qty" step="0.01" value="${allocatedQty}"
                                        style="width: 100%; padding: 0.6rem; border: 1px solid #e2e8f0; border-radius: 6px; font-size: 0.85rem;"
                                        placeholder="Enter picked quantity">
                                </div>

                                <div>
                                    <label style="display: block; font-size: 0.85rem; font-weight: 600; color: #475569; margin-bottom: 0.4rem;">
                                        Ship Confirm Status
                                    </label>
                                    <select id="set-ship-confirm-status"
                                        style="width: 100%; padding: 0.6rem; border: 1px solid #e2e8f0; border-radius: 6px; font-size: 0.85rem;">
                                        <option value="">-- Select --</option>
                                        <option value="YES">YES</option>
                                        <option value="NO">NO</option>
                                    </select>
                                </div>

                                <div>
                                    <label style="display: block; font-size: 0.85rem; font-weight: 600; color: #475569; margin-bottom: 0.4rem;">
                                        Pick Confirm Status
                                    </label>
                                    <select id="set-pick-confirm-status"
                                        style="width: 100%; padding: 0.6rem; border: 1px solid #e2e8f0; border-radius: 6px; font-size: 0.85rem;">
                                        <option value="">-- Select --</option>
                                        <option value="YES">YES</option>
                                        <option value="NO">NO</option>
                                    </select>
                                </div>

                                <div>
                                    <label style="display: block; font-size: 0.85rem; font-weight: 600; color: #475569; margin-bottom: 0.4rem;">
                                        Cancelled Status
                                    </label>
                                    <select id="set-cancelled-status"
                                        style="width: 100%; padding: 0.6rem; border: 1px solid #e2e8f0; border-radius: 6px; font-size: 0.85rem;">
                                        <option value="">-- Select --</option>
                                        <option value="YES">YES</option>
                                        <option value="NO">NO</option>
                                    </select>
                                </div>
                            </form>
                        </div>

                        <div style="padding: 1rem 1.5rem; border-top: 1px solid #e2e8f0; background: #f8f9fc; display: flex; gap: 0.75rem; justify-content: flex-end;">
                            <button class="btn btn-secondary" onclick="closeSetDataDialog()">
                                <i class="fas fa-times"></i> Cancel
                            </button>
                            <button class="btn btn-primary" onclick="submitSetData('${orderNumber}', ${JSON.stringify(selectedItems).replace(/"/g, '&quot;')})">
                                <i class="fas fa-save"></i> Set Data
                            </button>
                        </div>
                    </div>
                </div>
            `;
        } else {
            // Multiple selection mode - Grid view
            let gridRows = '';
            selectedItems.forEach((item, index) => {
                const itemNumber = item.ITEM_NUMBER || item.item_number || item.ITEM || item.item || item.itemnumber || item.ITEMNUMBER || '';
                const itemDescription = item.ITEM_DESCRIPTION || item.item_description || item.DESCRIPTION || item.description || item.DESC || item.desc || '';
                const lineNumber = item.LINE_NUMBER || item.line_number || item.LINE || item.line || index + 1;

                console.log(`[Set Data] Row ${index} - Item: ${itemNumber}`);
                console.log(`[Set Data] Row ${index} - Full item data:`, item);

                // Get available lots for this item
                const availableLots = window.qohData ? window.qohData.filter(qoh => {
                    // QOH uses ITEMNUMBER (no underscore)
                    const qohItem = qoh.ITEMNUMBER || qoh.itemnumber || qoh.ITEM_NUMBER || qoh.item_number || qoh.ITEM || qoh.item || '';
                    const match = qohItem === itemNumber || qohItem.trim() === itemNumber.trim();
                    if (match) {
                        console.log(`[Set Data] Row ${index} - Matched QOH item: ${qohItem} with allocated item: ${itemNumber}`);
                    }
                    return match;
                }) : [];

                console.log(`[Set Data] Row ${index} - Found ${availableLots.length} lots:`, availableLots);
                if (index === 0 && window.qohData && window.qohData.length > 0) {
                    console.log('[Set Data] Sample QOH record:', window.qohData[0]);
                }

                // Get allocated quantity from item
                const allocatedQty = item.ALLOCATED_QTY || item.allocated_qty || item.QTY || item.qty || item.QUANTITY || item.quantity || '';

                // Build datalist options for autocomplete with quantity
                let lotDatalistId = `lot-datalist-${index}`;
                let lotDatalistOptions = '';
                const lotExpirationMap = {};

                availableLots.forEach(lot => {
                    const lotNum = lot.LOT_NUMBER || lot.lot_number || lot.LOT || lot.lot || '';
                    const lotExp = lot.LOT_EXPIRATION_DATE || lot.lot_expiration_date || lot.EXPIRATION_DATE || lot.expiration_date || lot.EXPIRE_DATE || lot.expire_date || '';
                    const lotQty = lot.primaryquantity || lot.PRIMARYQUANTITY || lot.QTY || lot.qty || lot.QUANTITY || lot.quantity || lot.QOH || lot.qoh || '';
                    if (lotNum) {
                        // Show lot number with quantity in dropdown
                        lotDatalistOptions += `<option value="${lotNum}" label="Lot: ${lotNum} | Qty: ${lotQty}">`;
                        lotExpirationMap[lotNum] = lotExp;
                    }
                });

                // Store expiration map globally for this row
                if (!window.lotExpirationMaps) window.lotExpirationMaps = {};
                window.lotExpirationMaps[index] = lotExpirationMap;

                gridRows += `
                    <tr style="border-bottom: 1px solid #e2e8f0;">
                        <td style="padding: 0.5rem; font-size: 0.75rem; white-space: nowrap;">${lineNumber}</td>
                        <td style="padding: 0.5rem; font-size: 0.75rem;">
                            <div style="font-weight: 500;">${itemNumber}</div>
                            ${itemDescription ? `<div style="font-size: 0.65rem; color: #64748b; margin-top: 0.2rem; line-height: 1.2;">${itemDescription}</div>` : ''}
                        </td>
                        <td style="padding: 0.5rem;">
                            <input type="text" list="${lotDatalistId}" class="grid-lot-number" data-row="${index}"
                                onchange="onGridLotChangeInput(${index})" oninput="onGridLotChangeInput(${index})"
                                placeholder="Type or select lot"
                                style="width: 100%; padding: 0.4rem; border: 1px solid #e2e8f0; border-radius: 4px; font-size: 0.75rem;">
                            <datalist id="${lotDatalistId}">
                                ${lotDatalistOptions}
                            </datalist>
                            <small style="color: #64748b; font-size: 0.65rem;">${availableLots.length} lot(s) available</small>
                        </td>
                        <td style="padding: 0.5rem;">
                            <input type="date" class="grid-lot-exp" data-row="${index}" readonly
                                style="width: 100%; padding: 0.4rem; border: 1px solid #e2e8f0; border-radius: 4px; font-size: 0.75rem; background: #f8f9fc;">
                        </td>
                        <td style="padding: 0.5rem;">
                            <input type="number" class="grid-picked-qty" data-row="${index}" step="0.01" value="${allocatedQty}"
                                style="width: 100%; padding: 0.4rem; border: 1px solid #e2e8f0; border-radius: 4px; font-size: 0.75rem;">
                        </td>
                        <td style="padding: 0.5rem;">
                            <select class="grid-ship-status" data-row="${index}"
                                style="width: 100%; padding: 0.4rem; border: 1px solid #e2e8f0; border-radius: 4px; font-size: 0.75rem;">
                                <option value="">--</option>
                                <option value="YES">YES</option>
                                <option value="NO">NO</option>
                            </select>
                        </td>
                        <td style="padding: 0.5rem;">
                            <select class="grid-pick-status" data-row="${index}"
                                style="width: 100%; padding: 0.4rem; border: 1px solid #e2e8f0; border-radius: 4px; font-size: 0.75rem;">
                                <option value="">--</option>
                                <option value="YES">YES</option>
                                <option value="NO">NO</option>
                            </select>
                        </td>
                        <td style="padding: 0.5rem;">
                            <select class="grid-cancel-status" data-row="${index}"
                                style="width: 100%; padding: 0.4rem; border: 1px solid #e2e8f0; border-radius: 4px; font-size: 0.75rem;">
                                <option value="">--</option>
                                <option value="YES">YES</option>
                                <option value="NO">NO</option>
                            </select>
                        </td>
                    </tr>
                `;
            });

            modalHtml = `
                <div id="set-data-modal" style="display: flex; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 10001; justify-content: center; align-items: center;">
                    <div style="background: white; width: 95%; max-width: 1200px; border-radius: 12px; display: flex; flex-direction: column; box-shadow: 0 20px 60px rgba(0,0,0,0.3); overflow: hidden;">
                        <div style="padding: 1rem 1.5rem; border-bottom: 2px solid #e2e8f0; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);">
                            <h3 style="margin: 0; color: white; font-size: 1.1rem;">
                                <i class="fas fa-edit"></i> Set Data for Multiple Records
                            </h3>
                            <p style="margin: 0.5rem 0 0 0; color: rgba(255,255,255,0.9); font-size: 0.8rem;">
                                ${selectedItems.length} records selected
                            </p>
                        </div>

                        <div style="padding: 1rem; overflow-y: auto; max-height: 70vh;">
                            <div style="overflow-x: auto;">
                                <table style="width: 100%; border-collapse: collapse;">
                                    <thead style="position: sticky; top: 0; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); z-index: 10;">
                                        <tr>
                                            <th style="padding: 0.6rem; color: white; font-size: 0.75rem; white-space: nowrap; text-align: left;">Line</th>
                                            <th style="padding: 0.6rem; color: white; font-size: 0.75rem; white-space: nowrap; text-align: left;">Item Number</th>
                                            <th style="padding: 0.6rem; color: white; font-size: 0.75rem; white-space: nowrap; text-align: left;">Lot Number</th>
                                            <th style="padding: 0.6rem; color: white; font-size: 0.75rem; white-space: nowrap; text-align: left;">Lot Exp Date</th>
                                            <th style="padding: 0.6rem; color: white; font-size: 0.75rem; white-space: nowrap; text-align: left;">Picked Qty</th>
                                            <th style="padding: 0.6rem; color: white; font-size: 0.75rem; white-space: nowrap; text-align: left;">Ship Confirm</th>
                                            <th style="padding: 0.6rem; color: white; font-size: 0.75rem; white-space: nowrap; text-align: left;">Pick Confirm</th>
                                            <th style="padding: 0.6rem; color: white; font-size: 0.75rem; white-space: nowrap; text-align: left;">Cancelled</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        ${gridRows}
                                    </tbody>
                                </table>
                            </div>
                        </div>

                        <div style="padding: 1rem 1.5rem; border-top: 1px solid #e2e8f0; background: #f8f9fc; display: flex; gap: 0.75rem; justify-content: flex-end;">
                            <button class="btn btn-secondary" onclick="closeSetDataDialog()">
                                <i class="fas fa-times"></i> Cancel
                            </button>
                            <button class="btn btn-primary" onclick="submitSetDataGrid('${orderNumber}', ${JSON.stringify(selectedItems).replace(/"/g, '&quot;')})">
                                <i class="fas fa-save"></i> Set Data
                            </button>
                        </div>
                    </div>
                </div>
            `;
        }

        // Remove existing modal if any
        const existingModal = document.getElementById('set-data-modal');
        if (existingModal) {
            existingModal.remove();
        }

        document.body.insertAdjacentHTML('beforeend', modalHtml);

        // Send Store transactions modal to back when Set Data opens
        const storeTransModal = document.getElementById('store-transactions-modal');
        if (storeTransModal) {
            console.log('[Set Data] Sending Store transactions modal to back (lowering z-index)');
            storeTransModal.style.zIndex = '100';  // Lower z-index to send to back
        }
    }

    window.closeSetDataDialog = function() {
        const modal = document.getElementById('set-data-modal');
        if (modal) {
            modal.remove();
        }

        // Restore Store transactions modal z-index when Set Data closes
        const storeTransModal = document.getElementById('store-transactions-modal');
        if (storeTransModal) {
            console.log('[Set Data] Restoring Store transactions modal z-index to front');
            storeTransModal.style.zIndex = '25000';  // Restore original z-index
        }
    };

    window.submitSetData = async function(orderNumber, selectedItems) {
        console.log('[Store Transactions] Submitting set data for:', orderNumber, selectedItems);

        // Get form values
        const lotNumber = document.getElementById('set-lot-number').value.trim();
        const lotExpDate = document.getElementById('set-lot-exp-date').value;
        const pickedQty = document.getElementById('set-picked-qty').value;
        const shipConfirmStatus = document.getElementById('set-ship-confirm-status').value;
        const pickConfirmStatus = document.getElementById('set-pick-confirm-status').value;
        const cancelledStatus = document.getElementById('set-cancelled-status').value;

        // Validate at least one field is filled
        if (!lotNumber && !lotExpDate && !pickedQty && !shipConfirmStatus && !pickConfirmStatus && !cancelledStatus) {
            alert('Please fill at least one field to update');
            return;
        }

        // Get instance name
        const currentInstance = sessionStorage.getItem('loggedInInstance') || localStorage.getItem('fusionInstance') || 'TEST';

        // Build records array for the API (always multiple records format)
        const records = [];

        // For single selection, still send as array with one record
        selectedItems.forEach(item => {
            const record = {
                lid: item.LID || item.lid || item.ID || item.id
            };

            // Only include fields that have values
            if (lotNumber) record.lot_number = lotNumber;
            if (lotExpDate) record.lot_expiration_date = lotExpDate;
            if (pickedQty) record.picked_qty = parseFloat(pickedQty);
            record.p_instance_name = currentInstance;
            if (shipConfirmStatus) record.ship_confirm_status = shipConfirmStatus;
            if (pickConfirmStatus) record.pick_confirm_status = pickConfirmStatus;
            if (cancelledStatus) record.cancelled_status = cancelledStatus;

            records.push(record);
        });

        const payload = { records };

        console.log('[Set Data] API Payload:', JSON.stringify(payload, null, 2));

        // ORDS endpoint URL
        const apiUrl = 'https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/TRIPMANAGEMENT/trip/sets2vdata';

        // Log debug info before request
        logDebugInfo('Set Data (Single)', apiUrl, payload, null, null, 'POST');

        try {
            // Make POST request via C# (to handle CORS)
            sendMessageToCSharp({
                action: 'executePost',
                fullUrl: apiUrl,
                body: JSON.stringify(payload),
                headers: {
                    'Content-Type': 'application/json'
                }
            }, function(error, data) {
                console.log('[Set Data] Response received');
                console.log('[Set Data] Error:', error);
                console.log('[Set Data] Data type:', typeof data);
                console.log('[Set Data] Data length:', data ? data.length : 0);
                console.log('[Set Data] Raw data:', data);
                console.log('[Set Data] First 200 chars:', data ? data.substring(0, 200) : 'null');

                if (error) {
                    // Log error to debug
                    logDebugInfo('Set Data (Single) - Error', apiUrl, payload, null, error, 'POST');
                    alert('Failed to set data: ' + error);
                    return;
                }

                // Parse response
                try {
                    // Clean the data - remove any whitespace/newlines and try to extract JSON
                    let cleanData = data;
                    if (typeof data === 'string') {
                        // Log original for debugging
                        console.log('[Set Data] Original response (with escape chars):', JSON.stringify(data));

                        // Handle multiple concatenated JSON objects (e.g., }{)
                        // Split by }{ and try to find the valid response object
                        if (data.includes('}{')) {
                            console.log('[Set Data] Multiple JSON objects detected, splitting...');
                            const parts = data.split('}{');

                            // Try to parse each part (add back the braces)
                            for (let i = parts.length - 1; i >= 0; i--) {
                                let part = parts[i];
                                if (i > 0) part = '{' + part; // Add opening brace
                                if (i < parts.length - 1) part = part + '}'; // Add closing brace

                                try {
                                    const parsed = JSON.parse(part);
                                    // Use the first valid JSON that has a 'success' field (the actual response)
                                    if (parsed.hasOwnProperty('success')) {
                                        cleanData = part;
                                        console.log('[Set Data] Found valid response object:', cleanData);
                                        break;
                                    }
                                } catch (e) {
                                    console.log('[Set Data] Part ' + i + ' is not valid JSON, skipping');
                                }
                            }
                        } else {
                            // Try to extract JSON if response has extra content
                            const jsonMatch = data.match(/\{[\s\S]*\}/);
                            if (jsonMatch) {
                                cleanData = jsonMatch[0];
                                console.log('[Set Data] Extracted JSON:', cleanData);
                            }
                        }
                    }

                    const response = typeof cleanData === 'string' ? JSON.parse(cleanData) : cleanData;
                    console.log('[Set Data] Parsed response:', response);

                    // Log success to debug
                    logDebugInfo('Set Data (Single) - Success', apiUrl, payload, response, null, 'POST');

                    if (response.success) {
                        alert(`Success! Updated ${response.successCount} record(s).\n\n${response.message}`);
                        closeSetDataDialog();
                        // Refresh the allocated lots grid to show updated data
                        refreshAllocatedLots(orderNumber);
                    } else {
                        const errorMsg = response.errorDetails || response.message || 'Unknown error';
                        alert(`Failed to set data:\n\n${errorMsg}`);
                    }
                } catch (parseError) {
                    console.error('[Set Data] Parse error:', parseError);
                    console.error('[Set Data] Failed to parse data:', data);

                    // Log with raw data for debugging
                    const debugData = {
                        rawResponse: data,
                        responseType: typeof data,
                        responseLength: data ? data.length : 0,
                        first100chars: data ? data.substring(0, 100) : null
                    };
                    logDebugInfo('Set Data (Single) - Parse Error', apiUrl, payload, debugData, parseError.message, 'POST');

                    alert(`Error parsing response: ${parseError.message}\n\nRaw response (first 200 chars):\n${data ? data.substring(0, 200) : 'null'}\n\nCheck Debug Log for full details.`);
                }
            });

        } catch (error) {
            console.error('[Set Data] Error:', error);
            logDebugInfo('Set Data (Single) - Exception', apiUrl, payload, null, error.message, 'POST');
            alert('Error submitting data: ' + error.message);
        }
    };

    // Handle lot number change for single selection (input field with datalist)
    window.onLotNumberChangeInput = function() {
        const lotInput = document.getElementById('set-lot-number');
        const expDateInput = document.getElementById('set-lot-exp-date');

        const lotNumber = lotInput.value.trim();

        // Check if this lot number has an expiration date in our map
        if (window.singleLotExpirationMap && window.singleLotExpirationMap[lotNumber]) {
            const expiration = window.singleLotExpirationMap[lotNumber];
            if (expiration) {
                const formattedDate = expiration.split('T')[0]; // Handle ISO date format
                expDateInput.value = formattedDate;
            } else {
                expDateInput.value = '';
            }
        } else {
            expDateInput.value = '';
        }
    };

    // Keep old function for backward compatibility
    window.onLotNumberChange = function() {
        onLotNumberChangeInput();
    };

    // Handle lot number change for grid rows (input field with datalist)
    window.onGridLotChangeInput = function(rowIndex) {
        const lotInput = document.querySelector(`.grid-lot-number[data-row="${rowIndex}"]`);
        const expDateInput = document.querySelector(`.grid-lot-exp[data-row="${rowIndex}"]`);

        const lotNumber = lotInput.value.trim();

        // Check if this lot number has an expiration date in our map
        if (window.lotExpirationMaps && window.lotExpirationMaps[rowIndex]) {
            const expiration = window.lotExpirationMaps[rowIndex][lotNumber];
            if (expiration) {
                const formattedDate = expiration.split('T')[0];
                expDateInput.value = formattedDate;
            } else {
                expDateInput.value = '';
            }
        } else {
            expDateInput.value = '';
        }
    };

    // Keep old function for backward compatibility
    window.onGridLotChange = function(rowIndex) {
        onGridLotChangeInput(rowIndex);
    };

    // Submit grid data for multiple selections
    window.submitSetDataGrid = async function(orderNumber, selectedItems) {
        console.log('[Store Transactions] Submitting grid set data for:', orderNumber);

        // Get instance name
        const currentInstance = sessionStorage.getItem('loggedInInstance') || localStorage.getItem('fusionInstance') || 'TEST';

        // Build records array for the API
        const records = [];

        selectedItems.forEach((item, index) => {
            const lotNumber = document.querySelector(`.grid-lot-number[data-row="${index}"]`).value.trim();
            const lotExpDate = document.querySelector(`.grid-lot-exp[data-row="${index}"]`).value;
            const pickedQty = document.querySelector(`.grid-picked-qty[data-row="${index}"]`).value;
            const shipStatus = document.querySelector(`.grid-ship-status[data-row="${index}"]`).value;
            const pickStatus = document.querySelector(`.grid-pick-status[data-row="${index}"]`).value;
            const cancelStatus = document.querySelector(`.grid-cancel-status[data-row="${index}"]`).value;

            // Build record with lid
            const record = {
                lid: item.LID || item.lid || item.ID || item.id
            };

            // Only include fields that have values
            if (lotNumber) record.lot_number = lotNumber;
            if (lotExpDate) record.lot_expiration_date = lotExpDate;
            if (pickedQty) record.picked_qty = parseFloat(pickedQty);
            record.p_instance_name = currentInstance;
            if (shipStatus) record.ship_confirm_status = shipStatus;
            if (pickStatus) record.pick_confirm_status = pickStatus;
            if (cancelStatus) record.cancelled_status = cancelStatus;

            records.push(record);
        });

        const payload = { records };

        console.log('[Set Data Grid] API Payload:', JSON.stringify(payload, null, 2));

        // ORDS endpoint URL
        const apiUrl = 'https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/TRIPMANAGEMENT/trip/sets2vdata';

        // Log debug info before request
        logDebugInfo('Set Data (Multiple)', apiUrl, payload, null, null, 'POST');

        try {
            // Make POST request via C# (to handle CORS)
            sendMessageToCSharp({
                action: 'executePost',
                fullUrl: apiUrl,
                body: JSON.stringify(payload),
                headers: {
                    'Content-Type': 'application/json'
                }
            }, function(error, data) {
                console.log('[Set Data Grid] Response received');
                console.log('[Set Data Grid] Error:', error);
                console.log('[Set Data Grid] Data type:', typeof data);
                console.log('[Set Data Grid] Data length:', data ? data.length : 0);
                console.log('[Set Data Grid] Raw data:', data);
                console.log('[Set Data Grid] First 200 chars:', data ? data.substring(0, 200) : 'null');

                if (error) {
                    // Log error to debug
                    logDebugInfo('Set Data (Multiple) - Error', apiUrl, payload, null, error, 'POST');
                    alert('Failed to set data: ' + error);
                    return;
                }

                // Parse response
                try {
                    // Clean the data - remove any whitespace/newlines and try to extract JSON
                    let cleanData = data;
                    if (typeof data === 'string') {
                        // Log original for debugging
                        console.log('[Set Data Grid] Original response (with escape chars):', JSON.stringify(data));

                        // Handle multiple concatenated JSON objects (e.g., }{)
                        // Split by }{ and try to find the valid response object
                        if (data.includes('}{')) {
                            console.log('[Set Data Grid] Multiple JSON objects detected, splitting...');
                            const parts = data.split('}{');

                            // Try to parse each part (add back the braces)
                            for (let i = parts.length - 1; i >= 0; i--) {
                                let part = parts[i];
                                if (i > 0) part = '{' + part; // Add opening brace
                                if (i < parts.length - 1) part = part + '}'; // Add closing brace

                                try {
                                    const parsed = JSON.parse(part);
                                    // Use the first valid JSON that has a 'success' field (the actual response)
                                    if (parsed.hasOwnProperty('success')) {
                                        cleanData = part;
                                        console.log('[Set Data Grid] Found valid response object:', cleanData);
                                        break;
                                    }
                                } catch (e) {
                                    console.log('[Set Data Grid] Part ' + i + ' is not valid JSON, skipping');
                                }
                            }
                        } else {
                            // Try to extract JSON if response has extra content
                            const jsonMatch = data.match(/\{[\s\S]*\}/);
                            if (jsonMatch) {
                                cleanData = jsonMatch[0];
                                console.log('[Set Data Grid] Extracted JSON:', cleanData);
                            }
                        }
                    }

                    const response = typeof cleanData === 'string' ? JSON.parse(cleanData) : cleanData;
                    console.log('[Set Data Grid] Parsed response:', response);

                    // Log success to debug
                    logDebugInfo('Set Data (Multiple) - Success', apiUrl, payload, response, null, 'POST');

                    if (response.success) {
                        const message = `Success! Updated ${response.successCount} record(s).\n\n${response.message}`;
                        if (response.errorCount > 0) {
                            alert(`${message}\n\nErrors: ${response.errorCount}\nDetails: ${response.errorDetails}`);
                        } else {
                            alert(message);
                        }
                        closeSetDataDialog();
                        // Refresh the allocated lots grid to show updated data
                        refreshAllocatedLots(orderNumber);
                    } else {
                        const errorMsg = response.errorDetails || response.message || 'Unknown error';
                        alert(`Failed to set data:\n\n${errorMsg}`);
                    }
                } catch (parseError) {
                    console.error('[Set Data Grid] Parse error:', parseError);
                    console.error('[Set Data Grid] Failed to parse data:', data);

                    // Log with raw data for debugging
                    const debugData = {
                        rawResponse: data,
                        responseType: typeof data,
                        responseLength: data ? data.length : 0,
                        first100chars: data ? data.substring(0, 100) : null
                    };
                    logDebugInfo('Set Data (Multiple) - Parse Error', apiUrl, payload, debugData, parseError.message, 'POST');

                    alert(`Error parsing response: ${parseError.message}\n\nRaw response (first 200 chars):\n${data ? data.substring(0, 200) : 'null'}\n\nCheck Debug Log for full details.`);
                }
            });

        } catch (error) {
            console.error('[Set Data Grid] Error:', error);
            logDebugInfo('Set Data (Multiple) - Exception', apiUrl, payload, null, error.message, 'POST');
            alert('Error submitting data: ' + error.message);
        }
    };

    window.checkFusionStatus = function(orderNumber) {
        console.log('[Store Transactions] Check fusion status for:', orderNumber);
        alert('Check Fusion Status functionality - To be implemented');
    };

    /**
     * After an order is removed from a trip: delete its picker assignment (WMS_PICKER_ASSIGNMENT) too, so the picker /
     * loading bay of the old trip does not stay behind. Matched by order number (trimmed) and only when the order is no
     * longer on any trip line. Runs through the app's APEX gateway (ai/executewrite); never blocks the removal itself.
     * Resolves {ok, rows} or {ok:false, error}.
     */
})();

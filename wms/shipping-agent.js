// ============================================================
// SHIPPING AGENTS — WMS Module
// ============================================================

(function() {
    'use strict';

    const APEX_BASE = 'https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/TRIPMANAGEMENT';
    const WMS_BASE  = 'https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/WAREHOUSEMANAGEMENT';

    // Active agent loop handles: { agentId: intervalHandle }
    window._saLoops       = {};
    // Current selected agent
    window._saCurrentAgent = null;
    // All loaded agents
    window._saAgents       = [];

    // ─── Status colours ─────────────────────────────────────
    const STATUS_STYLE = {
        IDLE:      { bg: '#f1f5f9', color: '#475569', dot: '#94a3b8' },
        RUNNING:   { bg: '#dcfce7', color: '#15803d', dot: '#22c55e' },
        PAUSED:    { bg: '#fef9c3', color: '#a16207', dot: '#eab308' },
        COMPLETED: { bg: '#ede9fe', color: '#6d28d9', dot: '#8b5cf6' },
        ERROR:     { bg: '#fee2e2', color: '#b91c1c', dot: '#ef4444' }
    };

    const ACTIVITY_ICON = {
        CHECK_STATUS:    { icon: 'fa-eye',            color: '#0891b2' },
        PRINT:           { icon: 'fa-print',          color: '#7c3aed' },
        PICK_RELEASE:    { icon: 'fa-shipping-fast',  color: '#0891b2' },
        NOTIFY_PICKER:   { icon: 'fa-bell',           color: '#d97706' },
        SHIP_CONFIRM:    { icon: 'fa-check-circle',   color: '#059669' },
        CANCEL_LINE:     { icon: 'fa-times-circle',   color: '#dc2626' },
        ANOMALY_DETECT:  { icon: 'fa-exclamation-triangle', color: '#d97706' },
        AI_ANALYSIS:     { icon: 'fa-brain',          color: '#7c3aed' }
    };

    const TRIP_STATUS_STYLE = {
        PENDING:   { bg: '#f1f5f9', color: '#475569' },
        ACTIVE:    { bg: '#dcfce7', color: '#15803d' },
        COMPLETED: { bg: '#ede9fe', color: '#6d28d9' },
        FAILED:    { bg: '#fee2e2', color: '#b91c1c' }
    };

    // ─── C# IPC API helpers ──────────────────────────────────
    // All REST calls go through C# (WebView2 IPC) via sendMessageToCSharp

    function rawGet(url) {
        return new Promise((resolve, reject) => {
            console.log('[ShippingAgent] GET', url);
            if (typeof sendMessageToCSharp !== 'function') {
                return reject(new Error('C# bridge not available (sendMessageToCSharp undefined)'));
            }
            sendMessageToCSharp({ action: 'executeGet', fullUrl: url }, function(err, data) {
                if (err) { console.error('[ShippingAgent] GET error', url, err); return reject(new Error(String(err))); }
                try { resolve(typeof data === 'string' ? JSON.parse(data) : data); }
                catch(e) { resolve(data); }
            });
        });
    }

    function fusionShipmentLinesGet(orderNumber, instanceName) {
        const baseUrl = (instanceName || 'PROD').toUpperCase() === 'PROD'
            ? 'https://efmh.fa.em3.oraclecloud.com'
            : 'https://efmh-test.fa.em3.oraclecloud.com';
        const url = `${baseUrl}/fscmRestApi/resources/11.13.18.05/shipmentLines?q=Order=${encodeURIComponent(orderNumber)}&limit=500`;
        console.log('[ShippingAgent] Fusion shipmentLines GET', url);
        return new Promise((resolve, reject) => {
            if (typeof sendMessageToCSharp !== 'function') {
                return reject(new Error('C# bridge not available'));
            }
            sendMessageToCSharp({ action: 'executeOracleFusionGet', fullUrl: url, instance: instanceName }, function(err, data) {
                if (err) { console.error('[ShippingAgent] Fusion GET error', url, err); return reject(new Error(String(err))); }
                try { resolve(typeof data === 'string' ? JSON.parse(data) : data); }
                catch(e) { resolve(data); }
            });
        });
    }

    function fusionShipmentLinesUrl(orderNumber, instanceName) {
        const baseUrl = (instanceName || 'PROD').toUpperCase() === 'PROD'
            ? 'https://efmh.fa.em3.oraclecloud.com'
            : 'https://efmh-test.fa.em3.oraclecloud.com';
        return `${baseUrl}/fscmRestApi/resources/11.13.18.05/shipmentLines?q=Order=${encodeURIComponent(orderNumber || '{ORDER_NUMBER}')}&limit=500`;
    }

    function wmsGet(path) { return rawGet(`${WMS_BASE}/${path}`); }

    function apexGet(path) {
        return new Promise((resolve, reject) => {
            const url = `${APEX_BASE}/${path}`;
            console.log('[ShippingAgent] GET', url);
            if (typeof sendMessageToCSharp !== 'function') {
                return reject(new Error('C# bridge not available (sendMessageToCSharp undefined)'));
            }
            sendMessageToCSharp({ action: 'executeGet', fullUrl: url }, function(err, data) {
                if (err) {
                    console.error('[ShippingAgent] GET error', url, err);
                    return reject(new Error(String(err)));
                }
                console.log('[ShippingAgent] GET response', url, data);
                try { resolve(typeof data === 'string' ? JSON.parse(data) : data); }
                catch(e) { resolve(data); }
            });
        });
    }

    function apexPost(path, body) {
        return new Promise((resolve, reject) => {
            const url     = `${APEX_BASE}/${path}`;
            const bodyStr = JSON.stringify(body);
            console.log('[ShippingAgent] POST', url, bodyStr);
            if (typeof sendMessageToCSharp !== 'function') {
                return reject(new Error('C# bridge not available (sendMessageToCSharp undefined)'));
            }
            sendMessageToCSharp({ action: 'executePost', fullUrl: url, body: bodyStr }, function(err, data) {
                if (err) {
                    console.error('[ShippingAgent] POST error', url, err);
                    return reject(new Error(String(err)));
                }
                console.log('[ShippingAgent] POST response', url, data);
                try { resolve(typeof data === 'string' ? JSON.parse(data) : data); }
                catch(e) { resolve(data); }
            });
        });
    }

    function apexPut(path, body) {
        return new Promise((resolve, reject) => {
            const url     = `${APEX_BASE}/${path}`;
            const bodyStr = JSON.stringify(body);
            console.log('[ShippingAgent] PUT', url, bodyStr);
            if (typeof sendMessageToCSharp !== 'function') {
                return reject(new Error('C# bridge not available (sendMessageToCSharp undefined)'));
            }
            sendMessageToCSharp({ action: 'executePost', fullUrl: url, body: bodyStr, method: 'PUT' }, function(err, data) {
                if (err) {
                    console.error('[ShippingAgent] PUT error', url, err);
                    return reject(new Error(String(err)));
                }
                try { resolve(typeof data === 'string' ? JSON.parse(data) : data); }
                catch(e) { resolve(data); }
            });
        });
    }

    function apexDelete(path) {
        return new Promise((resolve, reject) => {
            const url = `${APEX_BASE}/${path}`;
            console.log('[ShippingAgent] DELETE', url);
            if (typeof sendMessageToCSharp !== 'function') {
                return reject(new Error('C# bridge not available (sendMessageToCSharp undefined)'));
            }
            sendMessageToCSharp({ action: 'executePost', fullUrl: url, body: '{}', method: 'DELETE' }, function(err, data) {
                if (err) {
                    console.error('[ShippingAgent] DELETE error', url, err);
                    return reject(new Error(String(err)));
                }
                try { resolve(typeof data === 'string' ? JSON.parse(data) : data); }
                catch(e) { resolve(data); }
            });
        });
    }

    // Show API info popup (used by page header and create modal)
    window.saShowApiInfo = function(method, url, bodyObj) {
        const existing = document.getElementById('sa-api-popup');
        if (existing) existing.remove();
        const bodyHtml = bodyObj
            ? `<div style="margin-top:0.75rem;"><div style="color:#94a3b8;font-size:10px;font-weight:700;margin-bottom:4px;">REQUEST BODY</div>
               <pre style="margin:0;color:#86efac;font-family:monospace;font-size:11px;white-space:pre-wrap;max-height:200px;overflow-y:auto;">${esc(JSON.stringify(bodyObj, null, 2))}</pre></div>`
            : '';
        const methodColor = method === 'GET' ? '#0891b2' : method === 'POST' ? '#059669' : method === 'PUT' ? '#d97706' : '#dc2626';
        document.body.insertAdjacentHTML('beforeend', `
        <div id="sa-api-popup" style="position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:20000;display:flex;align-items:center;justify-content:center;" onclick="if(event.target===this)this.remove()">
            <div style="background:#0f172a;border-radius:12px;padding:1.5rem;width:560px;max-width:95vw;box-shadow:0 20px 60px rgba(0,0,0,0.5);">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;">
                    <span style="color:#e2e8f0;font-weight:700;font-size:13px;"><i class="fas fa-code" style="color:#667eea;margin-right:6px;"></i>API Call Details</span>
                    <button onclick="document.getElementById('sa-api-popup').remove()" style="background:none;border:none;color:#64748b;font-size:1.3rem;cursor:pointer;">&times;</button>
                </div>
                <div style="display:flex;align-items:center;gap:0.6rem;margin-bottom:0.5rem;">
                    <span style="background:${methodColor};color:white;padding:3px 8px;border-radius:4px;font-size:11px;font-weight:700;">${method}</span>
                    <span style="color:#60a5fa;font-size:11px;word-break:break-all;font-family:monospace;">${esc(url)}</span>
                </div>
                <div style="color:#94a3b8;font-size:10px;margin-bottom:0.5rem;">Content-Type: application/json &nbsp;·&nbsp; Via: C# RestApiClient (executePost / executeGet)</div>
                ${bodyHtml}
            </div>
        </div>`);
    };

    // ─── Page initialisation ────────────────────────────────
    window.saInitPage = async function() {
        // Default date filter: today
        const today = new Date().toISOString().slice(0, 10);
        const fromEl    = document.getElementById('sa-from-date');
        const toEl      = document.getElementById('sa-to-date');
        const statusEl  = document.getElementById('sa-status-filter');
        if (fromEl   && !fromEl.value)   fromEl.value   = today;
        if (toEl     && !toEl.value)     toEl.value     = today;
        if (statusEl && !statusEl.value) statusEl.value = 'ACTIVE';
        try {
            await saRefreshDashboard();
        } catch(e) {
            console.error('[ShippingAgent] Init error:', e);
        }
    };

    // Build the agents/list query string from date + status inputs
    function saListQueryString() {
        const from   = document.getElementById('sa-from-date')?.value   || '';
        const to     = document.getElementById('sa-to-date')?.value     || '';
        const status = document.getElementById('sa-status-filter')?.value || 'ACTIVE';
        const parts  = [];
        if (from)                parts.push(`FROM_DATE=${encodeURIComponent(from)}`);
        if (to)                  parts.push(`TO_DATE=${encodeURIComponent(to)}`);
        if (status !== 'ALL')    parts.push(`AGENT_STATUS=${encodeURIComponent(status)}`);
        return parts.length ? `agents/list?${parts.join('&')}` : 'agents/list';
    }

    // ─── Dashboard ──────────────────────────────────────────
    window.saRefreshDashboard = async function() {
        const icon = document.getElementById('sa-refresh-icon');
        if (icon) icon.classList.add('fa-spin');
        const path = saListQueryString();
        try {
            const data = await apexGet(path);
            // Normalise: APEX may return column names in any case; map to uppercase keys
            const agents = (data.items || []).map(a => ({
                ID:                   a.ID   || a.id   || a.AGENT_ID || a.agent_id,
                NAME:                 a.NAME || a.name,
                DESCRIPTION:          a.DESCRIPTION  || a.description  || '',
                INSTANCE_NAME:        a.INSTANCE_NAME || a.instance_name || '',
                CAPABILITIES:         a.CAPABILITIES  || a.capabilities  || '',
                STATUS:               a.STATUS || a.status || 'IDLE',
                AGENT_STATUS:         a.AGENT_STATUS || a.agent_status || (a.CLOSED_DATE || a.closed_date ? 'CLOSED' : 'ACTIVE'),
                CHECK_INTERVAL_SECONDS: a.CHECK_INTERVAL_SECONDS || a.check_interval_seconds || 60,
                MAX_RETRIES:          a.MAX_RETRIES   || a.max_retries   || 3,
                CREATED_BY:           a.CREATED_BY    || a.created_by    || '',
                CREATED_DATE:         a.CREATED_DATE  || a.created_date,
                LAST_ACTIVE_DATE:     a.LAST_ACTIVE_DATE || a.last_active_date,
                TOTAL_TRIPS_PROCESSED: a.TOTAL_TRIPS_PROCESSED || a.total_trips_processed || 0,
                TOTAL_ACTIONS_TAKEN:  a.TOTAL_ACTIONS_TAKEN || a.total_actions_taken || 0,
                TRIP_COUNT:           a.TRIP_COUNT    || a.trip_count    || 0,
                ACTIONS_TODAY:        a.ACTIONS_TODAY || a.actions_today || 0,
                ANOMALIES_TODAY:      a.ANOMALIES_TODAY || a.anomalies_today || 0
            }));
            window._saAgents = agents;
            saRenderCards(agents);
            saUpdateStats(agents);
        } catch(e) {
            console.error('[ShippingAgent] Refresh error:', e);
            showNotification(`Failed to load agents: ${e.message} | URL: ${APEX_BASE}/${path}`, 'error');
        } finally {
            if (icon) icon.classList.remove('fa-spin');
        }
    };

    // Called from the API icon on the page header
    window.saShowPageApiInfo = function() {
        const path   = saListQueryString();
        const from   = document.getElementById('sa-from-date')?.value    || '(all)';
        const to     = document.getElementById('sa-to-date')?.value      || '(all)';
        const status = document.getElementById('sa-status-filter')?.value || 'ACTIVE';
        saShowApiInfo('GET', `${APEX_BASE}/${path}`,
            { note: 'Query parameters', FROM_DATE: from, TO_DATE: to, AGENT_STATUS: status });
    };

    function saUpdateStats(agents) {
        const running   = agents.filter(a => a.STATUS === 'RUNNING').length;
        const trips     = agents.reduce((s, a) => s + (a.TRIP_COUNT || 0), 0);
        const actions   = agents.reduce((s, a) => s + (a.ACTIONS_TODAY || 0), 0);
        const anomalies = agents.reduce((s, a) => s + (a.ANOMALIES_TODAY || 0), 0);

        setText('sa-stat-total',    agents.length);
        setText('sa-stat-running',  running);
        setText('sa-stat-trips',    trips);
        setText('sa-stat-actions',  actions);
        setText('sa-stat-anomalies',anomalies);
        setText('sa-active-count',  `${running} Active`);
    }

    function saRenderCards(agents) {
        const container  = document.getElementById('sa-agent-cards');
        const noAgentsEl = document.getElementById('sa-no-agents');
        if (!container) return;

        // Remove existing cards (keep no-agents placeholder)
        container.querySelectorAll('.sa-agent-card').forEach(c => c.remove());

        if (agents.length === 0) {
            if (noAgentsEl) noAgentsEl.style.display = 'block';
            return;
        }
        if (noAgentsEl) noAgentsEl.style.display = 'none';

        agents.forEach(agent => {
            const st   = STATUS_STYLE[agent.STATUS] || STATUS_STYLE.IDLE;
            const card = document.createElement('div');
            card.className = 'sa-agent-card';
            card.setAttribute('data-agent-id', agent.ID);
            const isSelected = window._saCurrentAgent && window._saCurrentAgent.ID === agent.ID;
            card.style.cssText = `background: white; border-radius: 10px; padding: 0.85rem 1rem;
                box-shadow: 0 2px 8px rgba(0,0,0,0.07); cursor: pointer; transition: all 0.2s;
                border: 2px solid ${isSelected ? '#7c3aed' : 'transparent'};`;
            card.onmouseenter = () => { if (!isSelected) card.style.borderColor = '#e2e8f0'; };
            card.onmouseleave = () => { if (!isSelected) card.style.borderColor = 'transparent'; };
            card.onclick = () => saSelectAgent(agent);

            const isRunning = window._saLoops[agent.ID] != null;
            const loopIndicator = isRunning
                ? `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#22c55e;margin-right:4px;animation:saPulse 1.5s infinite;"></span>`
                : '';

            card.innerHTML = `
                <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:0.5rem;">
                    <div style="font-size:13px;font-weight:700;color:#1e293b;line-height:1.3;">${loopIndicator}${esc(agent.NAME)}</div>
                    <div style="display:flex;gap:4px;align-items:center;flex-shrink:0;margin-left:6px;">
                        <span style="background:${agent.AGENT_STATUS==='CLOSED'?'#fee2e2':agent.AGENT_STATUS==='ACTIVE'?'#dcfce7':'#fef9c3'};color:${agent.AGENT_STATUS==='CLOSED'?'#b91c1c':agent.AGENT_STATUS==='ACTIVE'?'#15803d':'#a16207'};padding:2px 7px;border-radius:10px;font-size:9px;font-weight:700;">${agent.AGENT_STATUS||'ACTIVE'}</span>
                        <span style="background:${st.bg};color:${st.color};padding:2px 7px;border-radius:10px;font-size:9px;font-weight:700;">${agent.STATUS}</span>
                    </div>
                </div>
                <div style="font-size:10px;color:#64748b;margin-bottom:0.5rem;">${esc(agent.INSTANCE_NAME)} · ${esc(agent.DESCRIPTION || '')}</div>
                <div style="display:flex;gap:0.4rem;flex-wrap:wrap;margin-bottom:0.5rem;">${saCapabilityChips(agent.CAPABILITIES)}</div>
                <div style="display:flex;gap:0.75rem;font-size:10px;color:#94a3b8;">
                    <span><i class="fas fa-truck" style="color:#0891b2;"></i> ${agent.TRIP_COUNT || 0} trip(s)</span>
                    <span><i class="fas fa-bolt" style="color:#d97706;"></i> ${agent.ACTIONS_TODAY || 0} today</span>
                    <span><i class="fas fa-clock"></i> ${saTimeAgo(agent.LAST_ACTIVE_DATE)}</span>
                </div>
                <div style="margin-top:5px;font-size:10px;color:#cbd5e1;border-top:1px solid #f1f5f9;padding-top:4px;">
                    <i class="fas fa-calendar-plus" style="color:#a78bfa;"></i> Created: <span style="color:#7c3aed;font-weight:600;">${saFormatDate(agent.CREATED_DATE)}</span>
                </div>
                ${isSelected ? `<div id="sa-left-trips-${agent.ID}" style="margin-top:6px;border-top:1px solid #e2e8f0;padding-top:6px;">
                    <div style="font-size:9px;color:#94a3b8;"><i class="fas fa-spinner fa-spin"></i> Loading trips...</div>
                </div>` : ''}`;

            container.appendChild(card);
        });
    }

    function saCapabilityChips(caps) {
        if (!caps) return '';
        const LABELS = {
            MONITOR:      { label: 'Monitor',      color: '#0891b2' },
            PRINT:        { label: 'Print',         color: '#7c3aed' },
            PICK_RELEASE: { label: 'Pick Release',  color: '#059669' },
            NOTIFY:       { label: 'Notify',        color: '#d97706' },
            ANOMALY:      { label: 'Anomaly',       color: '#dc2626' },
            AI_ANALYSIS:  { label: 'AI',            color: '#6d28d9' }
        };
        return caps.split(',').map(c => {
            const info = LABELS[c.trim()] || { label: c.trim(), color: '#64748b' };
            return `<span style="background:${info.color}18;color:${info.color};border:1px solid ${info.color}33;padding:1px 6px;border-radius:8px;font-size:9px;font-weight:700;">${info.label}</span>`;
        }).join('');
    }

    // ─── Select Agent → show detail ─────────────────────────
    window.saSelectAgent = async function(agent) {
        window._saCurrentAgent = agent;

        // Re-render cards to show selection
        saRenderCards(window._saAgents);

        const empty   = document.getElementById('sa-detail-empty');
        const content = document.getElementById('sa-detail-content');
        if (empty)   empty.style.display   = 'none';
        if (content) { content.style.display = 'flex'; }

        setText('sa-detail-name', agent.NAME);
        const idChip = document.getElementById('sa-detail-agent-id');
        if (idChip) idChip.innerHTML = `<span style="background:#1e293b;color:#a78bfa;padding:2px 8px;border-radius:6px;font-size:10px;font-weight:700;font-family:monospace;">ID: ${agent.ID}</span>`;
        const isClosed = agent.AGENT_STATUS === 'CLOSED';
        document.getElementById('sa-detail-meta').innerHTML =
            `<span style="color:#7c3aed;font-weight:600;">${esc(agent.INSTANCE_NAME)}</span> &nbsp;·&nbsp; Interval: ${agent.CHECK_INTERVAL_SECONDS}s &nbsp;·&nbsp; Max retries: ${agent.MAX_RETRIES} &nbsp;·&nbsp; Created: ${saFormatDate(agent.CREATED_DATE)}${isClosed ? ` &nbsp;·&nbsp; <span style="color:#b91c1c;font-weight:700;">CLOSED ${saFormatDate(agent.CLOSED_DATE)}</span>` : ''}`;
        // Update Close Agent button state
        const closeBtn = document.getElementById('sa-btn-close-agent');
        if (closeBtn) {
            closeBtn.disabled        = isClosed;
            closeBtn.style.opacity   = isClosed ? '0.5' : '1';
            closeBtn.innerHTML       = isClosed
                ? '<i class="fas fa-times-circle"></i> Closed'
                : '<i class="fas fa-times-circle"></i> Close Agent';
        }

        saUpdateDetailStatusBadge(agent.STATUS);

        // Load first tab
        saShowTab('trips');
        await saLoadTrips();
    };

    function saUpdateDetailStatusBadge(status) {
        const st = STATUS_STYLE[status] || STATUS_STYLE.IDLE;
        const badge = document.getElementById('sa-detail-status-badge');
        if (badge) {
            badge.textContent = status;
            badge.style.background = st.bg;
            badge.style.color      = st.color;
        }
        // Show/hide control buttons
        const btnStart  = document.getElementById('sa-btn-start');
        const btnPause  = document.getElementById('sa-btn-pause');
        const btnStop   = document.getElementById('sa-btn-stop');
        if (btnStart)  btnStart.style.display  = (status === 'IDLE' || status === 'PAUSED')  ? '' : 'none';
        if (btnPause)  btnPause.style.display  = status === 'RUNNING' ? '' : 'none';
        if (btnStop)   btnStop.style.display   = (status === 'RUNNING' || status === 'PAUSED') ? '' : 'none';
    }

    // ─── Tabs ────────────────────────────────────────────────
    window.saShowTab = function(tab, btnEl) {
        document.querySelectorAll('.sa-tab-content').forEach(t => t.style.display = 'none');
        document.querySelectorAll('.sa-tab-btn').forEach(b => {
            b.style.color       = '#64748b';
            b.style.borderBottom = '2px solid transparent';
        });
        const content = document.getElementById(`sa-tab-${tab}`);
        if (content) content.style.display = '';

        const btn = btnEl || document.querySelector(`.sa-tab-btn[data-tab="${tab}"]`);
        if (btn) {
            btn.style.color       = '#7c3aed';
            btn.style.borderBottom = '2px solid #7c3aed';
        }

        if (tab === 'activity')     saRefreshActivity();
        if (tab === 'performance')  saLoadPerformance();
        if (tab === 'notifications') saLoadNotifications();
    };

    // ─── Trips Tab ───────────────────────────────────────────
    const SHIPPING_STATUS_STYLE = {
        SHIPPED:     { bg: '#dcfce7', color: '#15803d', icon: 'fa-check-circle' },
        CONFIRMED:   { bg: '#dbeafe', color: '#1d4ed8', icon: 'fa-thumbs-up' },
        STAGED:      { bg: '#e0f2fe', color: '#0369a1', icon: 'fa-layer-group' },
        BACKORDERED: { bg: '#fef9c3', color: '#a16207', icon: 'fa-exclamation-circle' },
        CANCELLED:   { bg: '#fee2e2', color: '#b91c1c', icon: 'fa-times-circle' },
        PENDING:     { bg: '#f1f5f9', color: '#475569', icon: 'fa-clock' }
    };

    async function saLoadTrips() {
        const agent = window._saCurrentAgent;
        if (!agent) return;
        const list = document.getElementById('sa-trips-list');
        if (!list) return;
        list.innerHTML = `<div style="padding:1rem;text-align:center;color:#94a3b8;font-size:12px;"><i class="fas fa-spinner fa-spin"></i> Loading trips...</div>`;
        try {
            const data  = await apexGet(`agents/${agent.ID}/trips`);
            const trips = (data.items || []).map(t => ({
                TRIP_ID:          t.TRIP_ID   || t.trip_id,
                TRIP_NAME:        t.TRIP_NAME || t.trip_name,
                STATUS:           t.STATUS    || t.status    || 'PENDING',
                INSTANCE_NAME:    t.INSTANCE_NAME || t.instance_name || agent.INSTANCE_NAME,
                ORDERS_TOTAL:     t.ORDERS_TOTAL  || t.orders_total  || 0,
                ORDERS_PROCESSED: t.ORDERS_PROCESSED || t.orders_processed || 0,
                ORDERS_PRINTED:   t.ORDERS_PRINTED   || t.orders_printed   || 0,
                ORDERS_STUCK:     t.ORDERS_STUCK     || t.orders_stuck     || 0,
                ANOMALIES_FOUND:  t.ANOMALIES_FOUND  || t.anomalies_found  || 0,
                ASSIGNED_DATE:    t.ASSIGNED_DATE    || t.assigned_date,
                NOTES:            t.NOTES || t.notes || '',
                LORRY_NUMBER:     t.LORRY_NUMBER  || t.lorry_number  || '',
                LOADING_BAY:      t.LOADING_BAY   || t.loading_bay   || '',
                PRIORITY:         t.PRIORITY      || t.priority      || ''
            }));
            // Store trips for this agent globally
            window._saAgentTrips = window._saAgentTrips || {};
            window._saAgentTrips[agent.ID] = trips;

            // Populate left-panel trip checklist (all checked by default)
            window._saSelectedTrips = window._saSelectedTrips || {};
            trips.forEach(t => {
                if (window._saSelectedTrips[t.TRIP_ID] === undefined)
                    window._saSelectedTrips[t.TRIP_ID] = true;
            });
            const leftTrips = document.getElementById(`sa-left-trips-${agent.ID}`);
            if (leftTrips) {
                leftTrips.innerHTML = trips.length === 0
                    ? `<div style="font-size:9px;color:#94a3b8;">No trips assigned</div>`
                    : `<div style="font-size:9px;font-weight:700;color:#475569;margin-bottom:4px;">TRIPS — select to show</div>` +
                      trips.map(t => {
                          const checked = window._saSelectedTrips[t.TRIP_ID] !== false;
                          const st = TRIP_STATUS_STYLE[t.STATUS] || TRIP_STATUS_STYLE.PENDING;
                          return `<label style="display:flex;align-items:center;gap:6px;padding:3px 0;cursor:pointer;font-size:10px;color:#1e293b;" onclick="event.stopPropagation()">
                              <input type="checkbox" ${checked ? 'checked' : ''} onchange="saToggleTripVisible('${esc(t.TRIP_ID)}', this.checked)" style="accent-color:#7c3aed;cursor:pointer;">
                              <span style="font-weight:600;">${esc(t.TRIP_NAME || t.TRIP_ID)}</span>
                              <span style="background:${st.bg};color:${st.color};padding:1px 6px;border-radius:6px;font-size:8px;font-weight:700;">${t.STATUS}</span>
                          </label>`;
                      }).join('');
            }

            if (trips.length === 0) {
                list.innerHTML = `<div style="padding:2rem;text-align:center;color:#94a3b8;font-size:12px;">No trips assigned yet.<br>Click <strong>Assign Trip</strong> to add one.</div>`;
                return;
            }
            // Render cards — only show trips that are checked in left panel
            const visibleTrips = trips.filter(t => window._saSelectedTrips[t.TRIP_ID] !== false);
            // Render cards first (meta chips filled async below)
            list.innerHTML = visibleTrips.map(t => {
                const st  = TRIP_STATUS_STYLE[t.STATUS] || TRIP_STATUS_STYLE.PENDING;
                const pct = t.ORDERS_TOTAL > 0 ? Math.round((t.ORDERS_PROCESSED / t.ORDERS_TOTAL) * 100) : 0;
                return `
                <div style="background:white;border-radius:10px;border:1px solid #e2e8f0;box-shadow:0 1px 4px rgba(0,0,0,0.06);overflow:hidden;">
                    <!-- Trip header -->
                    <div style="background:linear-gradient(to right,#f8fafc,#fff);padding:0.75rem 1rem;border-bottom:1px solid #f1f5f9;display:flex;justify-content:space-between;align-items:center;">
                        <div style="display:flex;align-items:center;gap:0.5rem;">
                            <div style="width:28px;height:28px;background:linear-gradient(135deg,#7c3aed,#5b21b6);border-radius:6px;display:flex;align-items:center;justify-content:center;">
                                <i class="fas fa-truck" style="color:white;font-size:0.7rem;"></i>
                            </div>
                            <div>
                                <div style="font-size:13px;font-weight:700;color:#1e293b;">${esc(t.TRIP_NAME || t.TRIP_ID)}</div>
                                <div style="font-size:10px;color:#64748b;">${esc(t.INSTANCE_NAME)} · Assigned: ${saFormatDate(t.ASSIGNED_DATE)}</div>
                                <div id="sa-trip-meta-${esc(t.TRIP_ID)}" style="display:flex;gap:0.5rem;margin-top:3px;flex-wrap:wrap;">
                                    <span style="color:#cbd5e1;font-size:9px;"><i class="fas fa-spinner fa-spin"></i></span>
                                </div>
                            </div>
                        </div>
                        <div style="display:flex;gap:0.4rem;align-items:center;flex-wrap:wrap;">
                            <span style="background:${st.bg};color:${st.color};padding:2px 10px;border-radius:10px;font-size:10px;font-weight:700;">${t.STATUS}</span>
                            <button onclick="saShowTripOrdersApiInfo('${esc(t.TRIP_ID)}','${esc(t.INSTANCE_NAME)}')" style="background:#1e293b;color:#94a3b8;border:none;padding:3px 7px;border-radius:5px;font-size:10px;cursor:pointer;font-weight:600;" title="Show API calls for this trip"><i class="fas fa-code"></i></button>
                            <button onclick="saLoadTripOrders('${esc(t.TRIP_ID)}','${esc(t.INSTANCE_NAME)}')" style="background:#0891b2;color:white;border:none;padding:3px 8px;border-radius:5px;font-size:10px;cursor:pointer;font-weight:600;" title="Load order details">
                                <i class="fas fa-list"></i> Orders
                            </button>
                            <button onclick="saShowTripLines('${esc(t.TRIP_ID)}','${esc(t.INSTANCE_NAME)}')" style="background:#f59e0b;color:white;border:none;padding:3px 8px;border-radius:5px;font-size:10px;cursor:pointer;font-weight:600;" title="Show all order lines for this trip">
                                <i class="fas fa-table"></i> Order Lines
                            </button>
                            <button onclick="saUnassignTrip(${agent.ID},'${esc(t.TRIP_ID)}')" style="background:none;border:none;cursor:pointer;color:#94a3b8;font-size:12px;padding:3px 5px;" title="Remove trip" onmouseover="this.style.color='#dc2626'" onmouseout="this.style.color='#94a3b8'"><i class="fas fa-times"></i></button>
                        </div>
                    </div>
                    <!-- Trip stats row -->
                    <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:0;border-bottom:1px solid #f1f5f9;">
                        ${saTripStatCell('Orders',    t.ORDERS_TOTAL,    '#667eea', 'fa-box')}
                        ${saTripStatCell('Processed', t.ORDERS_PROCESSED,'#059669', 'fa-check')}
                        ${saTripStatCell('Printed',   t.ORDERS_PRINTED,  '#7c3aed', 'fa-print')}
                        ${saTripStatCell('Stuck',     t.ORDERS_STUCK,    '#d97706', 'fa-pause-circle')}
                        ${saTripStatCell('Anomalies', t.ANOMALIES_FOUND, '#dc2626', 'fa-exclamation-triangle')}
                    </div>
                    <!-- Progress bar -->
                    <div style="padding:0.5rem 1rem;background:#fafafa;">
                        <div style="display:flex;justify-content:space-between;font-size:10px;color:#64748b;margin-bottom:3px;">
                            <span>Processing progress</span><span style="font-weight:700;color:#7c3aed;">${pct}%</span>
                        </div>
                        <div style="background:#e2e8f0;border-radius:4px;height:5px;overflow:hidden;">
                            <div style="background:linear-gradient(90deg,#7c3aed,#5b21b6);height:100%;width:${pct}%;transition:width 0.4s;border-radius:4px;"></div>
                        </div>
                    </div>
                    <!-- Order details container (loaded on demand) -->
                    <div id="sa-trip-orders-${esc(t.TRIP_ID)}" style="display:none;"></div>
                </div>`;
            }).join('');

            // Auto-load orders for ALL trips (silent) so DB status GET runs on agent open
            // Use all trips (not just visible) so data is ready if user unchecks then re-checks
            trips.forEach(t => {
                saLoadTripOrders(t.TRIP_ID, t.INSTANCE_NAME, true);
            });


            // Async: fetch lorry/bay/priority for each trip from GETTRIPDETAILS (first row only)
            trips.forEach(t => {
                wmsGet(`GETTRIPDETAILS/${encodeURIComponent(t.TRIP_ID)}?P_INSTANCE_NAME=${t.INSTANCE_NAME}&limit=1`)
                    .then(d => {
                        const row = (d.items || [])[0];
                        if (!row) return;
                        const lorry    = row.TRIP_LORRY    || row.trip_lorry    || '';
                        const bay      = row.LOADING_BAY   || row.loading_bay   || '';
                        const prio     = row.TRIP_PRIORITY || row.trip_priority || '';
                        const rawDate  = row.TRIP_DATE     || row.trip_date     || '';
                        // Format trip date: take just the date part (strip time if ISO string)
                        const tripDate = rawDate ? rawDate.toString().split('T')[0] : '';
                        const metaEl  = document.getElementById(`sa-trip-meta-${t.TRIP_ID}`);
                        if (!metaEl) return;
                        // Store trip date on the card element for use by saPrintOrder
                        metaEl.setAttribute('data-trip-date', tripDate);
                        const chips = [
                            tripDate ? `<span style="background:#f0fdf4;color:#15803d;padding:1px 8px;border-radius:8px;font-size:9px;font-weight:700;"><i class="fas fa-calendar-alt"></i> Trip Date: ${esc(tripDate)}</span>` : '',
                            lorry    ? `<span style="background:#e0f2fe;color:#0369a1;padding:1px 8px;border-radius:8px;font-size:9px;font-weight:700;"><i class="fas fa-truck"></i> ${esc(lorry)}</span>` : '',
                            bay      ? `<span style="background:#fef9c3;color:#a16207;padding:1px 8px;border-radius:8px;font-size:9px;font-weight:700;"><i class="fas fa-warehouse"></i> Bay ${esc(bay)}</span>` : '',
                            prio     ? `<span style="background:#fce7f3;color:#be185d;padding:1px 8px;border-radius:8px;font-size:9px;font-weight:700;"><i class="fas fa-star"></i> Priority ${esc(prio)}</span>` : ''
                        ].filter(Boolean).join('');
                        metaEl.innerHTML = chips || '';
                    })
                    .catch(() => {
                        const metaEl = document.getElementById(`sa-trip-meta-${t.TRIP_ID}`);
                        if (metaEl) metaEl.innerHTML = '';
                    });
            });

        } catch(e) {
            list.innerHTML = `<div style="padding:1rem;color:#dc2626;font-size:12px;">${e.message}</div>`;
        }
    }

    // Toggle a trip's visibility in the right panel and re-render trips
    window.saToggleTripVisible = function(tripId, checked) {
        window._saSelectedTrips = window._saSelectedTrips || {};
        window._saSelectedTrips[tripId] = checked;
        saLoadTrips(); // re-render right panel with updated selection
    };

    window.saShowTripOrdersApiInfo = function(tripId, instanceName) {
        const agent  = window._saCurrentAgent;
        const agentId = agent ? agent.ID : '{agentId}';
        const inst   = instanceName || 'PROD';

        const url1 = `${WMS_BASE}/GETTRIPDETAILS/${encodeURIComponent(tripId)}?P_INSTANCE_NAME=${inst}`;
        const url2 = `${APEX_BASE}/agents/${agentId}/trips/${encodeURIComponent(tripId)}/orders?P_INSTANCE_NAME=${inst}`;

        saShowApiInfo('GET', url1, null, 'Step 1 — Primary: GETTRIPDETAILS (all trip orders)');
        // Show both in a combined popup
        const existing = document.getElementById('sa-api-popup');
        if (existing) {
            existing.remove();
        }
        const pop = document.createElement('div');
        pop.id = 'sa-api-popup';
        pop.style.cssText = 'position:fixed;top:60px;right:20px;width:580px;max-height:85vh;overflow-y:auto;background:#0f172a;color:#e2e8f0;border-radius:12px;box-shadow:0 20px 60px rgba(0,0,0,0.6);z-index:99999;font-family:monospace;font-size:11px;';
        pop.innerHTML = `
            <div style="padding:0.75rem 1rem;background:#1e293b;border-radius:12px 12px 0 0;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #334155;">
                <span style="font-weight:800;font-size:12px;color:#7c3aed;"><i class="fas fa-code"></i> Trip Orders — API Calls (Trip ${esc(tripId)})</span>
                <button onclick="document.getElementById('sa-api-popup').remove()" style="background:none;border:none;color:#94a3b8;cursor:pointer;font-size:14px;">×</button>
            </div>
            <div style="padding:1rem;display:flex;flex-direction:column;gap:1rem;">

                <div>
                    <div style="color:#94a3b8;font-size:9px;font-weight:700;text-transform:uppercase;margin-bottom:0.4rem;">
                        <span style="background:#059669;color:white;padding:1px 6px;border-radius:4px;margin-right:4px;">GET</span>
                        Step 1 — Primary source: all orders on this trip
                    </div>
                    <div style="background:#1e293b;border:1px solid #334155;border-radius:6px;padding:0.5rem 0.7rem;">
                        <div style="color:#38bdf8;word-break:break-all;">${esc(url1)}</div>
                    </div>
                    <div style="color:#64748b;font-size:9px;margin-top:0.3rem;">
                        Module: <strong>WAREHOUSEMANAGEMENT</strong> · Endpoint: <strong>GETTRIPDETAILS/{tripId}</strong><br>
                        Returns all order lines for the trip. Deduplicated by ORDER_NUMBER in JS. Always available.
                    </div>
                </div>

                <div>
                    <div style="color:#94a3b8;font-size:9px;font-weight:700;text-transform:uppercase;margin-bottom:0.4rem;">
                        <span style="background:#059669;color:white;padding:1px 6px;border-radius:4px;margin-right:4px;">GET</span>
                        Step 2 — Enrichment: shipment line details (optional)
                    </div>
                    <div style="background:#1e293b;border:1px solid #334155;border-radius:6px;padding:0.5rem 0.7rem;">
                        <div style="color:#38bdf8;word-break:break-all;">${esc(url2)}</div>
                    </div>
                    <div style="color:#64748b;font-size:9px;margin-top:0.3rem;">
                        Module: <strong>TRIPMANAGEMENT</strong> · Endpoint: <strong>agents/:agentId/trips/:tripId/orders</strong><br>
                        Provides print job counts from <code>wms_print_jobs</code>.
                    </div>
                </div>

                <div>
                    <div style="color:#94a3b8;font-size:9px;font-weight:700;text-transform:uppercase;margin-bottom:0.4rem;">
                        <span style="background:#059669;color:white;padding:1px 6px;border-radius:4px;margin-right:4px;">GET</span>
                        Step 3 — Live status per order: Oracle Fusion shipmentLines
                    </div>
                    <div style="background:#1e293b;border:1px solid #334155;border-radius:6px;padding:0.5rem 0.7rem;">
                        <div style="color:#38bdf8;word-break:break-all;">${esc(fusionShipmentLinesUrl('{ORDER_NUMBER}', inst))}</div>
                    </div>
                    <div style="color:#64748b;font-size:9px;margin-top:0.3rem;">
                        Triggered by <strong>Get Shipment Lines</strong> or <strong>Refresh</strong> button per order.<br>
                        PROD → <code>efmh.fa.em3.oraclecloud.com</code> &nbsp;|&nbsp; TRAIN → <code>efmh-test.fa.em3.oraclecloud.com</code>
                    </div>
                </div>

                <div style="background:#1e293b;border-radius:6px;padding:0.5rem 0.7rem;font-size:9px;color:#94a3b8;">
                    <i class="fas fa-info-circle" style="color:#7c3aed;"></i>
                    Steps 1 & 2 via <strong>executeGet</strong>. Step 3 via <strong>executeOracleFusionGet</strong> (Fusion credentials from C# config).<br>
                    Check console for <code>[ShippingAgent] GET ...</code> and <code>[ShippingAgent] Fusion shipmentLines GET ...</code> logs.
                </div>
            </div>`;
        document.body.appendChild(pop);
    };

    function saTripStatCell(label, value, color, icon) {
        return `<div style="padding:0.5rem 0.3rem;text-align:center;border-right:1px solid #f1f5f9;">
            <i class="fas ${icon}" style="color:${color};font-size:0.75rem;display:block;margin-bottom:2px;"></i>
            <div style="font-size:13px;font-weight:800;color:${color};">${value || 0}</div>
            <div style="font-size:9px;color:#94a3b8;font-weight:600;">${label}</div>
        </div>`;
    }

    window.saLoadTripOrders = async function(tripId, instanceName, silent) {
        const agent = window._saCurrentAgent;
        if (!agent) return;
        const container = document.getElementById(`sa-trip-orders-${tripId}`);
        if (!container) return;

        if (container.dataset.loaded === '1') {
            // Already loaded — Orders button toggles visibility
            if (!silent) container.style.display = container.style.display === 'none' ? 'block' : 'none';
            return;
        }
        // Always show the container while loading (visible to user)
        container.style.display = 'block';
        container.innerHTML = `<div style="padding:0.75rem 1rem;text-align:center;color:#94a3b8;font-size:11px;"><i class="fas fa-spinner fa-spin"></i> Loading orders...</div>`;

        try {
            const inst = instanceName || 'PROD';

            const tripData = await wmsGet(`GETTRIPDETAILS/${encodeURIComponent(tripId)}?P_INSTANCE_NAME=${inst}`);
            const rows = (tripData.items || []);

            if (rows.length === 0) {
                container.innerHTML = `<div style="padding:0.75rem 1rem;font-size:11px;color:#94a3b8;text-align:center;">No orders found for this trip.</div>`;
                return;
            }

            // Deduplicate by ORDER_NUMBER — keep first occurrence for customer name + all fields for editTripOrder
            const seen = new Set();
            const orders = [];
            rows.forEach(r => {
                const on = (r.ORDER_NUMBER || r.order_number || '').toString().trim();
                if (!on || seen.has(on)) return;
                seen.add(on);
                orders.push({
                    ORDER_NUMBER:   on,
                    ACCOUNT_NAME:   r.ACCOUNT_NAME    || r.account_name    || '',
                    ACCOUNT_NUMBER: r.ACCOUNT_NUMBER  || r.account_number  || '',
                    ORDER_TYPE:     r.ORDER_TYPE       || r.order_type      || '',
                    INSTANCE:       r.INSTANCE         || r.instance        || inst,
                    TRIP_ID:        r.TRIP_ID          || r.trip_id         || tripId,
                    TRIP_DATE:      r.TRIP_DATE        || r.trip_date       || '',
                    LORRY_NUMBER:   r.TRIP_LORRY       || r.trip_lorry      || r.LORRY_NUMBER || '',
                    PICKER:         r.PICKER_NAME      || r.picker_name     || '',
                    PRIORITY:       r.TRIP_PRIORITY    || r.trip_priority   || '',
                    PICK_CONFIRM_ST: r.PICK_CONFIRM_ST || r.pick_confirm_st || ''
                });
            });

            container.innerHTML = saRenderOrdersTable(orders, tripId, inst);
            container.dataset.loaded = '1';
            container.style.display = 'block';

            // Pre-populate from DB (previously saved status)
            try {
                const dbData = await apexGet(`agents/${agent.ID}/trips/${encodeURIComponent(tripId)}/orders/status`);
                (dbData.items || []).forEach(rec => {
                    const on = (rec.ORDER_NUMBER || rec.order_number || '').toString().trim();
                    const rowEl = document.getElementById(`sa-order-row-${tripId}-${on}`);
                    if (!rowEl) return;
                    const sc = (col, html) => { const c = rowEl.querySelector(`[data-col="${col}"]`); if (c) c.innerHTML = html; };
                    const activeL  = parseInt(rec.ACTIVE_LINES   || rec.active_lines   || 0);
                    const stagedL  = parseInt(rec.STAGED_LINES   || rec.staged_lines   || 0);
                    const ifcL     = parseInt(rec.INTERFACED_LINES|| rec.interfaced_lines|| 0);
                    const cancelL  = parseInt(rec.CANCELLED_LINES|| rec.cancelled_lines || 0);
                    const otherL   = parseInt(rec.BACKORDER_LINES || rec.backorder_lines || 0);
                    const pickedL  = parseInt(rec.PICKED_COUNT   || rec.picked_count   || 0);
                    const shippedL = parseInt(rec.SHIPPED_COUNT  || rec.shipped_count  || 0);
                    const pTotal   = parseInt(rec.PRINT_TOTAL    || rec.print_total    || 0);
                    const pPrint   = parseInt(rec.PRINT_PRINTED  || rec.print_printed  || 0);
                    const olCount  = parseInt(rec.ORDER_LINES_COUNT || rec.order_lines_count || 0);
                    const status   = rec.ORDER_STATUS || rec.order_status || '';
                    const lastF    = (rec.LAST_FETCHED || rec.last_fetched || '').toString().substring(0,16);

                    // Order Status badge
                    let stBadge;
                    if ((status.includes('Interfaced') || status.includes('Shipped')) && !status.includes('/'))
                        stBadge = saBadge('Interfaced', '#dcfce7', '#15803d', 'fa-check-circle');
                    else if (status.includes('Interfaced') || status.includes('Shipped'))
                        stBadge = saBadge(status, '#fef9c3', '#a16207', 'fa-truck');
                    else if (status.includes('Staged'))
                        stBadge = saBadge(status, '#dbeafe', '#1d4ed8', 'fa-layer-group');
                    else if (status)
                        stBadge = saBadge(status, '#f1f5f9', '#64748b', 'fa-clock');
                    else stBadge = `<span style="color:#94a3b8;font-size:9px;">—</span>`;

                    sc('status',    stBadge);
                    sc('staged',    stagedL > 0 ? saBadge(`${stagedL}/${activeL}`, '#dbeafe', '#1d4ed8', 'fa-layer-group') : saBadge('0', '#f0fdf4', '#15803d', null));
                    sc('picking',   activeL > 0 ? (pickedL === activeL ? saBadge(`${pickedL}/${activeL}`, '#dcfce7', '#15803d', 'fa-check') : saBadge(`${pickedL}/${activeL}`, '#fef9c3', '#a16207', 'fa-box')) : saBadge('N/A', '#f1f5f9', '#94a3b8', null));
                    sc('shipping',  activeL > 0 ? (shippedL === activeL ? saBadge(`${shippedL}/${activeL}`, '#dcfce7', '#15803d', 'fa-truck') : saBadge(`${shippedL}/${activeL}`, '#fef9c3', '#a16207', 'fa-truck')) : saBadge('N/A', '#f1f5f9', '#94a3b8', null));
                    sc('backorder', otherL > 0 ? saBadge(`${otherL}`, '#fef9c3', '#a16207', 'fa-exclamation-triangle') : saBadge('0', '#f0fdf4', '#15803d', null));
                    sc('cancel',    cancelL > 0 ? saBadge(`${cancelL}`, '#fee2e2', '#b91c1c', 'fa-ban') : saBadge('0', '#f0fdf4', '#15803d', null));
                    sc('order_lines', olCount > 0 ? `<span style="font-weight:700;color:#1e293b;font-size:11px;">${olCount}</span><div style="color:#94a3b8;font-size:8px;">lines</div>` : `<span style="color:#94a3b8;font-size:9px;">—</span>`);
                    sc('print',     pTotal > 0 ? (pPrint === pTotal ? saBadge('Printed', '#dcfce7', '#15803d', 'fa-check') : saBadge(`${pPrint}/${pTotal}`, '#fef9c3', '#a16207', 'fa-print')) : saBadge('No Jobs', '#f1f5f9', '#94a3b8', 'fa-print'));
                    sc('checked',   lastF ? `<span style="font-size:8px;color:#64748b;">${lastF}</span>` : `<span style="color:#94a3b8;font-size:9px;">—</span>`);
                });
            } catch(e) {
                console.warn('[ShippingAgent] Could not pre-populate from DB:', e.message);
            }

            // Auto-run print status + shipment lines after orders are loaded
            setTimeout(() => saGetPrintStatus(tripId, inst), 200);
            setTimeout(() => saGetAllShipmentLines(tripId, inst), 500);

        } catch(e) {
            container.innerHTML = `<div style="padding:0.75rem 1rem;color:#dc2626;font-size:11px;">${e.message}</div>`;
        }
    };

    // Track last-fetch timestamps per order: { orderNumber: Date }
    window._saOrderLastFetched    = window._saOrderLastFetched    || {};
    // Track classified line counts per order for DB save
    window._saLastFetchedCounts   = window._saLastFetchedCounts   || {};

    window.saFetchOrderStatus = async function(orderNumber, instanceName, tripId) {
        const rowEl = document.getElementById(`sa-order-row-${tripId}-${orderNumber}`);
        if (!rowEl) return;

        const setCell = (col, html) => {
            const cell = rowEl.querySelector(`[data-col="${col}"]`);
            if (cell) cell.innerHTML = html;
        };

        // Record fetch time immediately
        const fetchedAt = new Date();
        window._saOrderLastFetched[orderNumber] = fetchedAt;
        const timeStr = fetchedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

        setCell('status',   `<i class="fas fa-spinner fa-spin" style="color:#94a3b8;font-size:9px;"></i>`);
        setCell('picking',  `<i class="fas fa-spinner fa-spin" style="color:#94a3b8;font-size:9px;"></i>`);
        setCell('shipping', `<i class="fas fa-spinner fa-spin" style="color:#94a3b8;font-size:9px;"></i>`);
        setCell('cancel',   `<i class="fas fa-spinner fa-spin" style="color:#94a3b8;font-size:9px;"></i>`);
        setCell('print',    `<i class="fas fa-spinner fa-spin" style="color:#94a3b8;font-size:9px;"></i>`);
        setCell('staged',    `<i class="fas fa-spinner fa-spin" style="color:#94a3b8;font-size:9px;"></i>`);
        setCell('backorder', `<i class="fas fa-spinner fa-spin" style="color:#94a3b8;font-size:9px;"></i>`);
        setCell('checked',  `<span style="color:#94a3b8;font-size:9px;"><i class="fas fa-sync fa-spin"></i> Fetching...</span>`);

        // Declare counts outside try so they're available for the DB save below
        let readyToRelease = 0, releasedToWH = 0, staged = 0, interfaced = 0, cancelled = 0, other = 0;
        let totalQty = 0, stagedQty = 0, shippedQty = 0;
        let totalLines = 0, fusionFetchOk = false;
        let orderStatusText = 'Pending';
        let rowAccountName = '', rowOrderType = '';

        // Read account/order type from row data for DB save
        try {
            const dr = rowEl.querySelector('[data-row]');
            if (dr) { const rd = JSON.parse(dr.getAttribute('data-row')); rowAccountName = rd.ACCOUNT_NAME || ''; rowOrderType = rd.ORDER_TYPE || ''; }
        } catch(e) {}

        try {
            // Use Oracle Fusion REST API directly (executeOracleFusionGet via C# bridge)
            const slData = await fusionShipmentLinesGet(orderNumber, instanceName);
            const lines  = slData.items || [];

            if (lines.length === 0) {
                setCell('status',    saBadge('No Lines', '#f1f5f9', '#94a3b8', 'fa-clock'));
                setCell('staged',    saBadge('—', '#f1f5f9', '#94a3b8', null));
                setCell('picking',   saBadge('—', '#f1f5f9', '#94a3b8', null));
                setCell('shipping',  saBadge('—', '#f1f5f9', '#94a3b8', null));
                setCell('backorder', saBadge('—', '#f1f5f9', '#94a3b8', null));
                setCell('cancel',    saBadge('—', '#f1f5f9', '#94a3b8', null));
                setCell('print',     saBadge('N/A', '#f1f5f9', '#94a3b8', 'fa-print'));
                setCell('checked',   saCheckedBadge(timeStr, 0));
                fusionFetchOk = true;
                // Fall through to DB save with all zeros
            } else {

            let shippedLines = 0;
            lines.forEach(l => {
                // Fusion uses LineStatusCode: Y=Interfaced/Shipped, C=Staged, X=Cancelled
                // LineStatus text: "Ready to Release", "Released to Warehouse", "Staged", "Interfaced", "Cancelled"
                const lsc  = (l.LineStatusCode || '').toString().toUpperCase().trim();
                const ls   = (l.LineStatus || l.LineStatusCode || '').toString().toUpperCase().trim();

                const isShipped = ls.includes('SHIPPED') && !ls.includes('INTERFACED');
                if (isShipped) shippedLines++;

                if      (lsc === 'Y' || ls.includes('INTERFACED') || ls.includes('PENDING INVENTORY') || ls.includes('SHIPPED'))  interfaced++;
                else if (lsc === 'C' || ls.includes('STAGED'))                  staged++;
                else if (lsc === 'X' || ls.includes('CANCEL'))                  cancelled++;
                else if (ls.includes('RELEASED TO WAREHOUSE') || ls.includes('RELEASED')) releasedToWH++;
                else if (ls.includes('READY'))                                  readyToRelease++;
                else                                                            other++;

                totalQty   += parseFloat(l.RequestedQuantity || 0);
                stagedQty  += parseFloat(l.StagedQuantity    || 0);
                shippedQty += parseFloat(l.ShippedQuantity   || 0);
            });

            totalLines = lines.length;
            const total = totalLines;
            const activeLines = total - cancelled;

            // ── Overall line-status badge (dominant) ──
            // interfaced bucket includes Shipped lines — show as Interfaced
            let domBadge;
            if (interfaced > 0 && interfaced === total)
                domBadge = saBadge('Interfaced',       '#dcfce7', '#15803d', 'fa-check-circle');
            else if (interfaced > 0 && interfaced === activeLines)
                domBadge = saBadge('Interfaced',       '#dcfce7', '#15803d', 'fa-check-circle');
            else if (cancelled > 0 && cancelled === total)
                domBadge = saBadge('Cancelled',        '#fee2e2', '#b91c1c', 'fa-ban');
            else if (interfaced > 0)
                domBadge = saBadge(`Part Interfaced`,  '#bbf7d0', '#166534', 'fa-truck');
            else if (staged > 0 && staged === total)
                domBadge = saBadge('Staged',           '#dbeafe', '#1d4ed8', 'fa-layer-group');
            else if (staged > 0)
                domBadge = saBadge(`Part Staged`,      '#bfdbfe', '#1d4ed8', 'fa-layer-group');
            else if (releasedToWH > 0)
                domBadge = saBadge('Released to WH',   '#e0f2fe', '#0369a1', 'fa-share-square');
            else if (readyToRelease > 0)
                domBadge = saBadge('Ready to Release', '#fef9c3', '#a16207', 'fa-clock');
            else
                domBadge = saBadge('Pending',          '#f1f5f9', '#64748b', 'fa-clock');

            // ── Order Status: "Interfaced" if all active lines interfaced, else "9/10 Interfaced" ──
            let orderStatusBadge;
            if (activeLines === 0)
                orderStatusBadge = saBadge('Cancelled', '#fee2e2', '#b91c1c', 'fa-ban');
            else if (interfaced === activeLines)
                orderStatusBadge = saBadge('Interfaced', '#dcfce7', '#15803d', 'fa-check-circle');
            else if (interfaced > 0)
                orderStatusBadge = saBadge(`${interfaced}/${activeLines} Interfaced`, '#fef9c3', '#a16207', 'fa-truck');
            else if (staged > 0 && staged === activeLines)
                orderStatusBadge = saBadge('Staged', '#dbeafe', '#1d4ed8', 'fa-layer-group');
            else if (staged > 0)
                orderStatusBadge = saBadge(`${staged}/${activeLines} Staged`, '#e0f2fe', '#0369a1', 'fa-layer-group');
            else if (releasedToWH > 0)
                orderStatusBadge = saBadge('Released to WH', '#e0f2fe', '#0369a1', 'fa-share-square');
            else if (readyToRelease > 0)
                orderStatusBadge = saBadge('Ready to Release', '#fef9c3', '#a16207', 'fa-clock');
            else
                orderStatusBadge = saBadge('Pending', '#f1f5f9', '#64748b', 'fa-clock');

            // ── Staged column ──
            const stagedBadge = staged === 0
                ? saBadge('0', '#f1f5f9', '#94a3b8', null)
                : staged === activeLines
                    ? saBadge(`${staged}/${activeLines}`, '#dbeafe', '#1d4ed8', 'fa-layer-group')
                    : saBadge(`${staged}/${activeLines}`, '#e0f2fe', '#0369a1', 'fa-layer-group');

            // ── Picking: staged + interfaced = picked ──
            const pickedCount = staged + interfaced;
            const pickBadge = activeLines === 0
                ? saBadge('N/A', '#f1f5f9', '#94a3b8', null)
                : pickedCount === activeLines
                    ? saBadge(`${pickedCount}/${activeLines}`, '#dcfce7', '#15803d', 'fa-check')
                    : pickedCount === 0
                        ? saBadge(`0/${activeLines}`, '#fef2f2', '#b91c1c', 'fa-times')
                        : saBadge(`${pickedCount}/${activeLines}`, '#fef9c3', '#a16207', 'fa-box');

            // ── Shipping: interfaced = shipped ──
            const shipBadge = activeLines === 0
                ? saBadge('N/A', '#f1f5f9', '#94a3b8', null)
                : interfaced === activeLines
                    ? saBadge(`${interfaced}/${activeLines}`, '#dcfce7', '#15803d', 'fa-truck')
                    : interfaced === 0
                        ? saBadge(`0/${activeLines}`, '#fef2f2', '#b91c1c', 'fa-times')
                        : saBadge(`${interfaced}/${activeLines}`, '#fef9c3', '#a16207', 'fa-truck');

            // ── Backorder (other bucket) ──
            const backorderBadge = other > 0
                ? saBadge(`${other}`, '#fef9c3', '#a16207', 'fa-exclamation-triangle')
                : saBadge('0', '#f0fdf4', '#15803d', null);

            // ── Cancellation ──
            const cancelBadge = cancelled > 0
                ? saBadge(`${cancelled}`, '#fee2e2', '#b91c1c', 'fa-ban')
                : saBadge('0', '#f0fdf4', '#15803d', null);

            // Determine order status text for DB save
            orderStatusText = activeLines === 0 ? 'Cancelled'
                : interfaced === activeLines ? 'Interfaced'
                : interfaced > 0 ? `${interfaced}/${activeLines} Interfaced`
                : staged > 0 ? 'Staged'
                : releasedToWH > 0 ? 'Released to WH'
                : readyToRelease > 0 ? 'Ready to Release'
                : 'Pending';

            setCell('status',    orderStatusBadge);
            setCell('staged',    stagedBadge);
            setCell('picking',   pickBadge);
            setCell('shipping',  shipBadge);
            setCell('backorder', backorderBadge);
            setCell('cancel',    cancelBadge);
            setCell('checked',   saCheckedBadge(timeStr, lines.length));
            // Update shipped indicator in first column
            if (shippedLines > 0) {
                const indEl = row.querySelector('[data-col="shipped-indicator"]');
                if (indEl) indEl.innerHTML = `<span style="background:#fef9c3;color:#a16207;border:1px solid #fde68a;padding:0px 5px;border-radius:4px;font-size:9px;font-weight:700;" title="${shippedLines} line(s) with Shipped status">${shippedLines}s</span>`;
            }

            // Post activity log for single-order refresh
            const agent = window._saCurrentAgent;
            if (agent) {
                saLogActivity(agent.ID, tripId, orderNumber, 'CHECK_STATUS', 'SUCCESS', 1,
                    `Shipment lines checked: ${lines.length} line(s) — ${domBadge.replace(/<[^>]+>/g,'').trim()} at ${timeStr}`,
                    null, null);
            }
            fusionFetchOk = true;
            } // end else (lines.length > 0)

        } catch(e) {
            // Don't overwrite status with Error — preserve last good status, just flag checked cell
            const existingStatus = rowEl?.querySelector('[data-col="status"]')?.textContent?.trim();
            if (!existingStatus || existingStatus === '' || existingStatus === '—') {
                setCell('status', `<span style="color:#dc2626;font-size:9px;" title="${esc(e.message)}">Error</span>`);
            }
            setCell('checked', `<span style="color:#dc2626;font-size:9px;" title="${esc(e.message)}"><i class="fas fa-exclamation-circle"></i> ${timeStr}</span>`);

            const agent = window._saCurrentAgent;
            if (agent) {
                saLogActivity(agent.ID, tripId, orderNumber, 'CHECK_STATUS', 'FAILED', 1,
                    `Shipment lines fetch failed: ${e.message}`, null, null);
            }
        }

        // ── Print status — query wms_print_jobs directly via APEX ──
        let pTotal = 0, pPrinted = 0;
        try {
            const pjData = await apexGet(`printjobs/order/${encodeURIComponent(orderNumber)}?P_INSTANCE_NAME=${instanceName}`);
            pTotal   = parseInt((pjData.items || []).length || pjData.total || 0);
            pPrinted = parseInt((pjData.items || []).filter(j => (j.PRINT_STATUS || j.print_status || '').toUpperCase() === 'PRINTED').length || 0);
        } catch(e) {
            // Fallback: try getting counts from wms_shiping_agents_orders_status if print endpoint not deployed
            try {
                const agent = window._saCurrentAgent;
                if (agent) {
                    const dbData = await apexGet(`agents/${agent.ID}/trips/${encodeURIComponent(tripId)}/orders/status`);
                    const match = (dbData.items || []).find(o => (o.ORDER_NUMBER || o.order_number || '').toString().trim() === orderNumber.toString().trim());
                    if (match) {
                        pTotal   = parseInt(match.PRINT_TOTAL   || match.print_total   || 0);
                        pPrinted = parseInt(match.PRINT_PRINTED || match.print_printed || 0);
                    }
                }
            } catch(e2) { /* non-fatal */ }
        }

        const printBadge = pTotal === 0
            ? saBadge('No Jobs', '#f1f5f9', '#94a3b8', 'fa-print')
            : pPrinted === pTotal
                ? saBadge('Printed', '#dcfce7', '#15803d', 'fa-check')
                : saBadge(`${pPrinted}/${pTotal}`, '#fef9c3', '#a16207', 'fa-print');
        setCell('print', printBadge);

        // ── Order Lines count: GET getsalesorderlines ──
        let orderLinesCount = 0;
        try {
            setCell('order_lines', `<i class="fas fa-spinner fa-spin" style="color:#94a3b8;font-size:9px;"></i>`);
            const olData = await apexGet(`trip/orders/getsalesorderlines/${encodeURIComponent(orderNumber)}?P_INSTANCE_NAME=${instanceName}`);
            orderLinesCount = (olData.items || []).length || (olData.count) || 0;
            setCell('order_lines', `<span style="font-weight:700;color:#1e293b;font-size:11px;">${orderLinesCount}</span><div style="color:#94a3b8;font-size:8px;">lines</div>`);
        } catch(e) {
            setCell('order_lines', `<span style="color:#94a3b8;font-size:9px;">—</span>`);
        }

        // ── Fetch Fusion order lines (save to APEX DB) ──
        try {
            await apexPost(`trip/order/fetchfusionorderlines?P_INSTANCE_NAME=${instanceName}&p_order_number=${encodeURIComponent(orderNumber)}`, {});
            saLogActivity(window._saCurrentAgent && window._saCurrentAgent.ID, tripId, orderNumber,
                'FETCH_ORDERS', 'SUCCESS', 1, `Fusion order lines fetched for ${orderNumber}`, null, null);
        } catch(e) {
            console.warn('[ShippingAgent] fetchfusionorderlines failed (non-fatal):', e.message);
        }

        // ── Save status to DB (DELETE + INSERT via APEX) ──
        try {
            const agent = window._saCurrentAgent;
            if (agent) {
                const activeL = totalLines - cancelled;
                const payload = {
                    agentId:         agent.ID,
                    tripId:          tripId,
                    orderNumber:     orderNumber,
                    instanceName:    instanceName,
                    accountName:     rowAccountName,
                    orderType:       rowOrderType,
                    orderStatus:     orderStatusText,
                    totalLines:      totalLines,
                    activeLines:     activeL,
                    stagedLines:     staged,
                    interfacedLines: interfaced,
                    releasedLines:   releasedToWH,
                    readyLines:      readyToRelease,
                    cancelledLines:  cancelled,
                    backorderLines:  other,
                    pickedCount:     staged + interfaced,
                    shippedCount:    interfaced,
                    totalQty:        totalQty,
                    stagedQty:       stagedQty,
                    shippedQty:      shippedQty,
                    orderLinesCount: orderLinesCount
                    // printTotal / printPrinted omitted — queried live from wms_print_jobs in PL/SQL
                };
                // Store last payload globally so API info popup can display it
                window._saLastDbSavePayload = payload;
                console.log('[ShippingAgent] Saving order status to DB:', payload);
                const saveResult = await apexPost('agents/orders/status/save', payload);
                console.log('[ShippingAgent] DB save result:', saveResult);
                if (saveResult && saveResult.status === 'error') {
                    console.error('[ShippingAgent] DB save returned error:', saveResult.message);
                }
                // Update print cell immediately from DB save response (has live print counts from wms_print_jobs)
                if (saveResult && saveResult.printTotal !== undefined) {
                    const pt = parseInt(saveResult.printTotal  || 0);
                    const pp = parseInt(saveResult.printPrinted || 0);
                    const pb = pt === 0
                        ? saBadge('No Jobs', '#f1f5f9', '#94a3b8', 'fa-print')
                        : pp === pt
                            ? saBadge('Printed', '#dcfce7', '#15803d', 'fa-check')
                            : saBadge(`${pp}/${pt}`, '#fef9c3', '#a16207', 'fa-print');
                    setCell('print', pb);
                }
            }
        } catch(e) {
            console.error('[ShippingAgent] Save order status FAILED:', e.message,
                '— Check that APEX handler agents/orders/status/save is deployed (30_agents_order_status.sql)');
        }
    };

    // Run shipment lines fetch for ALL orders in the trip table
    window.saGetAllShipmentLines = async function(tripId, instanceName) {
        const agent = window._saCurrentAgent;
        const btn   = document.getElementById(`sa-btn-get-sl-${tripId}`);
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Fetching...'; }

        // Collect all order rows in this trip's container
        const container = document.getElementById(`sa-trip-orders-${tripId}`);
        if (!container) return;
        const rows = container.querySelectorAll('tr[id^="sa-order-row-"]');

        let fetched = 0;
        const fetchPromises = Array.from(rows).map(async row => {
            // Extract orderNumber and instance from row id: sa-order-row-{tripId}-{orderNumber}
            const idParts = row.id.replace(`sa-order-row-${tripId}-`, '');
            const orderNumber = idParts;
            if (!orderNumber) return;
            await saFetchOrderStatus(orderNumber, instanceName, tripId);
            fetched++;
        });

        await Promise.all(fetchPromises);

        // Post activity log entry
        if (agent) {
            const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
            saLogActivity(agent.ID, tripId, null, 'CHECK_STATUS', 'SUCCESS', 1,
                `Fetched shipment lines for ${fetched} order(s) at ${now}`,
                JSON.stringify({ orders: fetched, instance: instanceName }), null);
        }

        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-download"></i> Get Shipment Lines'; }
        showNotification(`Shipment lines fetched for ${fetched} order(s).`, 'success');
    };

    // Cache: { [tripId]: { [orderNumber]: { total, printed } } }
    window._saPrintCache = window._saPrintCache || {};

    // Fetch live print status from wms_print_jobs for all orders in the trip and update grid
    window.saGetPrintStatus = async function(tripId, instanceName) {
        const btn = document.getElementById(`sa-btn-print-status-${tripId}`);
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Checking...'; }

        try {
            const data = await apexGet(`printjobs/trip/${encodeURIComponent(tripId)}`);
            const rows = (data.items || []);

            // Build map and store in cache
            const map = {};
            rows.forEach(r => {
                const on      = (r.ORDER_NUMBER || r.order_number || '').toString().trim();
                const total   = parseInt(r.PRINT_TOTAL   || r.print_total   || 0);
                const printed = parseInt(r.PRINT_PRINTED || r.print_printed || 0);
                if (on) map[on] = { total, printed };
            });
            window._saPrintCache[tripId] = map;

            if (rows.length === 0) {
                showNotification('No print jobs found for this trip.', 'info');
            } else {
                // Update the print cell for every order row in this trip
                const container = document.getElementById(`sa-trip-orders-${tripId}`);
                if (container) {
                    container.querySelectorAll('tr[id^="sa-order-row-"]').forEach(row => {
                        const parts = row.id.split(`sa-order-row-${tripId}-`);
                        const on = parts[1] || '';
                        const cell = row.querySelector('[data-col="print"]');
                        if (!cell) return;
                        const info = map[on];
                        if (info && info.total > 0) {
                            cell.innerHTML = info.printed === info.total
                                ? saBadge('Printed', '#dcfce7', '#15803d', 'fa-check')
                                : saBadge(`${info.printed}/${info.total}`, '#fef9c3', '#a16207', 'fa-print');
                        } else {
                            cell.innerHTML = saBadge('No Jobs', '#f1f5f9', '#94a3b8', 'fa-print');
                        }
                    });
                }

                showNotification(`Print status updated for ${rows.length} order(s).`, 'success');
            }
        } catch(e) {
            showNotification(`Print status fetch failed: ${e.message}`, 'error');
            console.error('[ShippingAgent] saGetPrintStatus failed:', e);
        }

        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-print"></i> Get Print Status'; }
    };

    // ─── Verify PDFs dialog ───────────────────────────────────
    window.saVerifyPdfs = async function(tripId, instanceName) {
        const metaEl   = document.getElementById(`sa-trip-meta-${tripId}`);
        const tripDate = (metaEl && metaEl.getAttribute('data-trip-date')) || new Date().toISOString().split('T')[0];

        // Collect orders from the rendered table
        const container = document.getElementById(`sa-trip-orders-${tripId}`);
        const orderRows = container ? Array.from(container.querySelectorAll('tr[id^="sa-order-row-"]')) : [];

        const orders = orderRows.map(row => {
            const parts = row.id.split(`sa-order-row-${tripId}-`);
            const on = parts[1] || '';
            let customer = '';
            try { const a = row.querySelector('a[data-row]'); if (a) { const d = JSON.parse(a.getAttribute('data-row').replace(/&quot;/g,'"')); customer = d.ACCOUNT_NAME || ''; } } catch(e) {}
            return { orderNumber: on, customer };
        }).filter(o => o.orderNumber);

        if (orders.length === 0) {
            showNotification('No orders found — click Orders first.', 'info');
            return;
        }

        // Build dialog
        const dlg = document.createElement('div');
        dlg.id = 'sa-verify-dlg';
        dlg.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:99998;display:flex;align-items:center;justify-content:center;';
        dlg.innerHTML = `
            <div style="background:white;border-radius:14px;width:92vw;max-width:1100px;max-height:90vh;display:flex;flex-direction:column;box-shadow:0 24px 80px rgba(0,0,0,0.4);overflow:hidden;">
                <div style="padding:0.9rem 1.2rem;background:#0f172a;display:flex;justify-content:space-between;align-items:center;flex-shrink:0;">
                    <span style="font-size:14px;font-weight:800;color:#f59e0b;"><i class="fas fa-file-pdf"></i> Verify PDFs — Trip ${esc(tripId)} &nbsp;<span style="font-size:10px;color:#94a3b8;font-weight:400;">Date: ${esc(tripDate)} &nbsp;·&nbsp; ${orders.length} orders</span></span>
                    <button onclick="document.getElementById('sa-verify-dlg').remove()" style="background:none;border:none;color:#94a3b8;font-size:18px;cursor:pointer;">×</button>
                </div>
                <div style="overflow:auto;flex:1;">
                    <table style="width:100%;border-collapse:collapse;font-size:11px;">
                        <thead>
                            <tr style="background:#f8fafc;position:sticky;top:0;z-index:1;">
                                <th style="padding:8px 10px;text-align:left;color:#475569;font-weight:700;border-bottom:2px solid #e2e8f0;">#</th>
                                <th style="padding:8px 10px;text-align:left;color:#475569;font-weight:700;border-bottom:2px solid #e2e8f0;">Order Number</th>
                                <th style="padding:8px 10px;text-align:left;color:#475569;font-weight:700;border-bottom:2px solid #e2e8f0;">Customer</th>
                                <th style="padding:8px 10px;text-align:left;color:#475569;font-weight:700;border-bottom:2px solid #e2e8f0;">File Name</th>
                                <th style="padding:8px 10px;text-align:center;color:#475569;font-weight:700;border-bottom:2px solid #e2e8f0;">File Exists</th>
                                <th style="padding:8px 10px;text-align:center;color:#475569;font-weight:700;border-bottom:2px solid #e2e8f0;">Lines Exist</th>
                                <th style="padding:8px 10px;text-align:center;color:#475569;font-weight:700;border-bottom:2px solid #e2e8f0;">Preview</th>
                            </tr>
                        </thead>
                        <tbody id="sa-verify-tbody">
                            ${orders.map((o, i) => `
                            <tr id="sa-verify-row-${esc(o.orderNumber)}" style="border-bottom:1px solid #f1f5f9;">
                                <td style="padding:7px 10px;color:#94a3b8;">${i+1}</td>
                                <td style="padding:7px 10px;font-weight:700;color:#1e293b;">${esc(o.orderNumber)}</td>
                                <td style="padding:7px 10px;color:#475569;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(o.customer)}</td>
                                <td style="padding:7px 10px;color:#64748b;font-family:monospace;font-size:10px;">${esc(o.orderNumber)}.pdf</td>
                                <td style="padding:7px 10px;text-align:center;" id="sv-exists-${esc(o.orderNumber)}"><i class="fas fa-spinner fa-spin" style="color:#94a3b8;"></i></td>
                                <td style="padding:7px 10px;text-align:center;" id="sv-lines-${esc(o.orderNumber)}"><i class="fas fa-spinner fa-spin" style="color:#94a3b8;"></i></td>
                                <td style="padding:7px 10px;text-align:center;" id="sv-preview-${esc(o.orderNumber)}">—</td>
                            </tr>`).join('')}
                        </tbody>
                    </table>
                </div>
            </div>`;
        document.body.appendChild(dlg);

        // Verify each order sequentially
        for (const o of orders) {
            await new Promise(resolve => {
                sendMessageToCSharp({
                    action: 'verifyOrderPdf',
                    orderNumber: o.orderNumber,
                    tripId, tripDate
                }, function(err, data) {
                    try { if (typeof data === 'string') data = JSON.parse(data); } catch(e) {}

                    const existsCell  = document.getElementById(`sv-exists-${o.orderNumber}`);
                    const linesCell   = document.getElementById(`sv-lines-${o.orderNumber}`);
                    const previewCell = document.getElementById(`sv-preview-${o.orderNumber}`);
                    const row         = document.getElementById(`sa-verify-row-${o.orderNumber}`);

                    if (err || !data || data.success === false) {
                        if (existsCell) existsCell.innerHTML = `<span style="color:#dc2626;font-size:13px;">✗</span>`;
                        if (linesCell)  linesCell.innerHTML  = `<span style="color:#dc2626;font-size:13px;">✗</span>`;
                        if (previewCell) previewCell.innerHTML = `<span style="font-size:9px;color:#94a3b8;">error</span>`;
                        resolve(); return;
                    }

                    // File exists?
                    if (existsCell) existsCell.innerHTML = data.exists
                        ? `<span style="color:#15803d;font-size:16px;">✓</span>`
                        : `<span style="color:#dc2626;font-size:16px;">✗</span><div style="font-size:8px;color:#94a3b8;">not found</div>`;

                    // Lines exist? (fileSize > 500 = has content)
                    if (linesCell) linesCell.innerHTML = !data.exists
                        ? `<span style="color:#94a3b8;">—</span>`
                        : data.hasLines
                            ? `<span style="color:#15803d;font-size:16px;">✓</span><div style="font-size:8px;color:#64748b;">${Math.round(data.fileSize/1024)}KB</div>`
                            : `<span style="color:#f59e0b;font-size:16px;">⚠</span><div style="font-size:8px;color:#94a3b8;">empty / no lines</div>`;

                    // Highlight row red if missing or empty
                    if (row && (!data.exists || !data.hasLines)) row.style.background = '#fff5f5';

                    // PDF preview thumbnail
                    if (previewCell && data.base64) {
                        const pdfUrl = `data:application/pdf;base64,${data.base64}`;
                        previewCell.innerHTML = `
                            <button onclick="saVerifyShowPdf('${o.orderNumber}','${data.base64}')"
                                style="background:#7c3aed;color:white;border:none;padding:3px 8px;border-radius:5px;font-size:9px;cursor:pointer;">
                                <i class="fas fa-eye"></i> View
                            </button>`;
                    } else if (previewCell && data.exists) {
                        previewCell.innerHTML = `<span style="font-size:9px;color:#94a3b8;">too large</span>`;
                    }

                    resolve();
                });
            });
        }
    };

    // Show PDF fullscreen from base64
    window.saVerifyShowPdf = function(orderNumber, base64) {
        const existing = document.getElementById('sa-pdf-viewer-dlg');
        if (existing) existing.remove();

        const dlg = document.createElement('div');
        dlg.id = 'sa-pdf-viewer-dlg';
        dlg.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.8);z-index:99999;display:flex;flex-direction:column;';
        dlg.innerHTML = `
            <div style="padding:0.6rem 1rem;background:#1e293b;display:flex;justify-content:space-between;align-items:center;flex-shrink:0;">
                <span style="color:white;font-weight:700;font-size:13px;"><i class="fas fa-file-pdf" style="color:#f87171;"></i> ${esc(orderNumber)}.pdf</span>
                <button onclick="document.getElementById('sa-pdf-viewer-dlg').remove()" style="background:#dc2626;color:white;border:none;padding:4px 12px;border-radius:6px;cursor:pointer;font-weight:700;">✕ Close</button>
            </div>
            <iframe src="data:application/pdf;base64,${base64}" style="flex:1;border:none;"></iframe>`;
        document.body.appendChild(dlg);
    };

    // Open the PDF download folder for this trip in Windows Explorer
    window.saOpenPdfFolder = function(tripId) {
        const metaEl = document.getElementById(`sa-trip-meta-${tripId}`);
        const tripDate = (metaEl && metaEl.getAttribute('data-trip-date')) || new Date().toISOString().split('T')[0];
        const folderPath = `C:\\fusion\\${tripDate}\\${tripId}`;

        sendMessageToCSharp({ action: 'openFolder', folderPath }, function(err) {
            if (err) showNotification(`Could not open folder: ${err}`, 'error');
        });
    };

    // ─── PDF Download / Print helpers ────────────────────────

    // Returns the SOAP URL for the given order/instance (display only)
    function saSoapReportUrl(instanceName) {
        return (instanceName || 'PROD').toUpperCase() === 'PROD'
            ? 'https://efmh.fa.em3.oraclecloud.com/xmlpserver/services/v2/ReportService'
            : 'https://efmh-test.fa.em3.oraclecloud.com/xmlpserver/services/v2/ReportService';
    }

    // Show API info popup for the print SOAP call
    window.saShowPrintApiInfo = function(orderNumber, instanceName) {
        const soapUrl    = saSoapReportUrl(instanceName);
        const reportPath = '/Custom/OQ/GR_SalesOrder_Rep.xdo';
        const inst       = (instanceName || 'PROD').toUpperCase();
        const existing = document.getElementById('sa-api-popup');
        if (existing) existing.remove();

        const soapXml = `&lt;soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
  xmlns:v2="http://xmlns.oracle.com/oxp/service/v2"&gt;
  &lt;soapenv:Body&gt;
    &lt;v2:runReport&gt;
      &lt;v2:reportRequest&gt;
        &lt;v2:reportAbsolutePath&gt;${reportPath}&lt;/v2:reportAbsolutePath&gt;
        &lt;v2:parameterNameValues&gt;
          &lt;v2:listOfParamNameValues&gt;
            &lt;v2:item&gt;
              &lt;v2:name&gt;Order_Number&lt;/v2:name&gt;
              &lt;v2:values&gt;&lt;v2:item&gt;<strong>${esc(orderNumber)}</strong>&lt;/v2:item&gt;&lt;/v2:values&gt;
            &lt;/v2:item&gt;
          &lt;/v2:listOfParamNameValues&gt;
        &lt;/v2:parameterNameValues&gt;
      &lt;/v2:reportRequest&gt;
      &lt;v2:userID&gt;[Fusion username from config]&lt;/v2:userID&gt;
      &lt;v2:password&gt;[Fusion password from config]&lt;/v2:password&gt;
    &lt;/v2:runReport&gt;
  &lt;/soapenv:Body&gt;
&lt;/soapenv:Envelope&gt;`;

        document.body.insertAdjacentHTML('beforeend', `
        <div id="sa-api-popup" style="position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:20000;display:flex;align-items:center;justify-content:center;" onclick="if(event.target===this)this.remove()">
            <div style="background:#0f172a;border-radius:12px;padding:1.5rem;width:640px;max-width:95vw;max-height:88vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,0.6);">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;">
                    <span style="color:#e2e8f0;font-weight:700;font-size:13px;"><i class="fas fa-soap" style="color:#ef4444;margin-right:6px;"></i>SOAP — Invoice PDF Download</span>
                    <button onclick="document.getElementById('sa-api-popup').remove()" style="background:none;border:none;color:#64748b;font-size:1.3rem;cursor:pointer;">&times;</button>
                </div>

                <!-- Endpoint -->
                <div style="margin-bottom:0.75rem;">
                    <div style="font-size:9px;color:#94a3b8;font-weight:700;text-transform:uppercase;margin-bottom:4px;">
                        <span style="background:#7c3aed;color:white;padding:1px 6px;border-radius:4px;margin-right:4px;">SOAP POST</span>
                        Oracle Fusion BI Publisher — runReport
                    </div>
                    <div style="background:#1e293b;border:1px solid #7c3aed;border-radius:6px;padding:0.5rem 0.8rem;">
                        <div style="color:#a78bfa;font-size:9px;margin-bottom:4px;font-weight:700;">${inst === 'PROD' ? '🟢 PROD' : '🟡 TRAIN/TEST'} — Instance: <strong>${esc(inst)}</strong></div>
                        <div style="color:#38bdf8;font-size:11px;word-break:break-all;font-family:monospace;">${esc(soapUrl)}</div>
                    </div>
                </div>

                <!-- Report details -->
                <div style="background:#1e293b;border-radius:6px;padding:0.6rem 0.8rem;margin-bottom:0.75rem;font-size:10px;line-height:1.8;color:#94a3b8;">
                    <div><span style="color:#e2e8f0;font-weight:700;">Report Path:</span> <code style="color:#fbbf24;">${reportPath}</code></div>
                    <div><span style="color:#e2e8f0;font-weight:700;">Parameter:</span> <code>Order_Number</code> = <strong style="color:#4ade80;">${esc(orderNumber)}</strong></div>
                    <div><span style="color:#e2e8f0;font-weight:700;">SOAPAction:</span> <code>"runReport"</code></div>
                    <div><span style="color:#e2e8f0;font-weight:700;">Auth:</span> Fusion credentials from C# local config (LocalStorageManager)</div>
                    <div><span style="color:#e2e8f0;font-weight:700;">Dispatched via:</span> <code>sendMessageToCSharp({ action: 'printSalesOrder', ... })</code></div>
                    <div><span style="color:#e2e8f0;font-weight:700;">C# Handler:</span> <code>HandlePrintSalesOrder()</code> → <code>FusionPdfDownloader.DownloadSalesOrderPdfAsync()</code></div>
                    <div><span style="color:#e2e8f0;font-weight:700;">PDF saved to:</span> <code>C:\\fusion\\{tripDate}\\{tripId}\\${esc(orderNumber)}.pdf</code></div>
                </div>

                <!-- SOAP XML -->
                <div style="margin-bottom:0.5rem;">
                    <div style="font-size:9px;color:#94a3b8;font-weight:700;text-transform:uppercase;margin-bottom:4px;">SOAP REQUEST BODY</div>
                    <pre style="background:#1e293b;border-radius:6px;padding:0.75rem;color:#86efac;font-size:10px;overflow-x:auto;white-space:pre-wrap;margin:0;">${soapXml}</pre>
                </div>
            </div>
        </div>`);
    };

    // Call C# printSalesOrder action → SOAP → C# saves PDF → returns actual filePath from C#
    function saDownloadOrderPdf(orderNumber, tripId, tripDate, instanceName) {
        const date = (tripDate || new Date().toISOString().split('T')[0]).split('T')[0];
        return new Promise((resolve, reject) => {
            if (typeof sendMessageToCSharp !== 'function') return reject(new Error('C# bridge not available'));
            console.log('[ShippingAgent] printSalesOrder SOAP call:', { orderNumber, tripId, date, instanceName });
            sendMessageToCSharp({
                action:      'printSalesOrder',
                orderNumber: orderNumber,
                tripId:      tripId,
                tripDate:    date,
                instance:    instanceName || 'PROD'
            }, function(err, data) {
                if (err) return reject(new Error(String(err)));
                try { data = typeof data === 'string' ? JSON.parse(data) : data; } catch(e) {}
                if (data && data.success === false) return reject(new Error(data.message || 'PDF download failed'));
                // Use the filePath that C# actually saved to (do NOT override it)
                console.log('[ShippingAgent] printSalesOrder result:', data);
                resolve(data);
            });
        });
    }

    // Call C# getPdfAsBase64 → returns base64 string; also validates PDF has content
    function saGetPdfBase64(filePath) {
        return new Promise((resolve, reject) => {
            if (typeof sendMessageToCSharp !== 'function') return reject(new Error('C# bridge not available'));
            console.log('[ShippingAgent] getPdfAsBase64 request — path:', filePath);
            sendMessageToCSharp({ action: 'getPdfAsBase64', filePath: filePath }, function(err, data) {
                console.log('[ShippingAgent] getPdfAsBase64 response — err:', err, 'data:', data);
                if (err) return reject(new Error(`C# error reading PDF at "${filePath}": ${err}`));
                try { data = typeof data === 'string' ? JSON.parse(data) : data; } catch(e) {}
                if (!data || !data.success) {
                    const msg = (data && data.message) || (data && data.error) || JSON.stringify(data);
                    return reject(new Error(`Failed to read PDF at "${filePath}" — C# says: ${msg}`));
                }
                resolve(data.data || data);
            });
        });
    }

    // Show choice popup: "Preview PDF" or "Close" after successful download + verification
    // hasLines: true when PDF has pages (invoice generated)
    function saShowPdfChoice(base64, orderNumber, filePath, fileSize, hasLines) {
        const existing = document.getElementById('sa-pdf-choice-modal');
        if (existing) existing.remove();

        const sizeKb   = Math.round(fileSize / 1024);
        const statusBg = hasLines ? '#dcfce7' : '#fef9c3';
        const statusCol= hasLines ? '#15803d' : '#a16207';
        const statusIcon = hasLines ? 'fa-check-circle' : 'fa-exclamation-triangle';
        const statusMsg  = hasLines
            ? `Invoice PDF downloaded successfully — ${sizeKb}KB. This order has lines and is ready to print.`
            : `PDF downloaded (${sizeKb}KB) but appears to have no content. The invoice may not be fully generated yet.`;

        document.body.insertAdjacentHTML('beforeend', `
        <div id="sa-pdf-choice-modal" style="position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:25000;display:flex;align-items:center;justify-content:center;" onclick="if(event.target===this)this.remove()">
            <div style="background:white;border-radius:14px;width:420px;max-width:95vw;box-shadow:0 20px 60px rgba(0,0,0,0.4);overflow:hidden;">
                <!-- Header -->
                <div style="background:linear-gradient(135deg,#1e293b,#334155);padding:1rem 1.25rem;display:flex;justify-content:space-between;align-items:center;">
                    <span style="color:white;font-weight:700;font-size:13px;"><i class="fas fa-file-pdf" style="color:#ef4444;margin-right:6px;"></i>PDF Downloaded</span>
                    <button onclick="document.getElementById('sa-pdf-choice-modal').remove()" style="background:#475569;color:white;border:none;padding:3px 10px;border-radius:5px;cursor:pointer;font-size:12px;">&times;</button>
                </div>
                <!-- Status banner -->
                <div style="background:${statusBg};padding:0.75rem 1.25rem;border-bottom:1px solid #e2e8f0;">
                    <div style="display:flex;align-items:flex-start;gap:0.5rem;">
                        <i class="fas ${statusIcon}" style="color:${statusCol};margin-top:1px;"></i>
                        <div>
                            <div style="font-weight:700;color:${statusCol};font-size:12px;">Order: ${esc(orderNumber)}</div>
                            <div style="font-size:11px;color:#374151;margin-top:2px;">${statusMsg}</div>
                        </div>
                    </div>
                </div>
                <!-- File path -->
                <div style="padding:0.6rem 1.25rem;background:#f8fafc;border-bottom:1px solid #e2e8f0;">
                    <div style="font-size:9px;color:#94a3b8;font-weight:700;margin-bottom:2px;">SAVED TO</div>
                    <div style="font-size:10px;color:#475569;font-family:monospace;word-break:break-all;">${esc(filePath)}</div>
                </div>
                <!-- Action buttons -->
                <div style="padding:1rem 1.25rem;display:flex;gap:0.75rem;justify-content:flex-end;">
                    <button onclick="document.getElementById('sa-pdf-choice-modal').remove()"
                        style="background:#f1f5f9;color:#475569;border:none;padding:8px 16px;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;">
                        <i class="fas fa-times"></i> Close
                    </button>
                    <button onclick="document.getElementById('sa-pdf-choice-modal').remove(); window._saOpenPdfFull()"
                        style="background:linear-gradient(135deg,#7c3aed,#5b21b6);color:white;border:none;padding:8px 18px;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;">
                        <i class="fas fa-eye"></i> Preview Order
                    </button>
                </div>
            </div>
        </div>`);

        // Store the open-PDF callback on window so the button can call it after closing modal
        window._saOpenPdfFull = function() {
            const ex2 = document.getElementById('sa-pdf-full-modal');
            if (ex2) ex2.remove();
            document.body.insertAdjacentHTML('beforeend', `
            <div id="sa-pdf-full-modal" style="position:fixed;inset:0;background:rgba(0,0,0,0.8);z-index:26000;display:flex;flex-direction:column;align-items:center;justify-content:center;" onclick="if(event.target===this)this.remove()">
                <div style="background:#1e293b;border-radius:12px;padding:1rem;width:90vw;max-width:950px;height:88vh;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,0.7);">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.75rem;">
                        <span style="color:#e2e8f0;font-weight:700;font-size:13px;"><i class="fas fa-file-pdf" style="color:#ef4444;margin-right:6px;"></i>Invoice — ${esc(orderNumber)}</span>
                        <button onclick="document.getElementById('sa-pdf-full-modal').remove()" style="background:#475569;color:white;border:none;padding:4px 12px;border-radius:6px;cursor:pointer;font-weight:700;">&times; Close</button>
                    </div>
                    <iframe src="data:application/pdf;base64,${base64}" style="flex:1;border:none;border-radius:8px;background:white;"></iframe>
                </div>
            </div>`);
        };
    }

    // Insert a record into wms_print_jobs via APEX REST POST
    async function saInsertPrintJob(orderNumber, tripId, tripDate, instanceName, filePath, fileSize, accountName, accountNumber) {
        const cleanDate = (tripDate || new Date().toISOString().split('T')[0]).split('T')[0];
        const payload = {
            orderNumber,
            tripId,
            tripDate:      cleanDate,
            instanceName:  instanceName || 'PROD',
            filePath:      filePath      || '',
            fileSizeBytes: fileSize      || 0,
            downloadStatus: 'Completed',
            printStatus:    'Pending',
            overallStatus:  'Downloaded',
            customerName:  accountName   || '',
            accountNumber: accountNumber || ''
        };
        console.log('[ShippingAgent] POST printjobs/save payload:', JSON.stringify(payload));
        try {
            const result = await apexPost('printjobs/save', payload);
            console.log('[ShippingAgent] printjobs/save response:', JSON.stringify(result));
            if (result && result.status === 'error') {
                console.error('[ShippingAgent] printjobs/save ERROR:', result.message);
                showNotification(`Print job save failed: ${result.message}`, 'error');
            }
        } catch(e) {
            console.error('[ShippingAgent] Could not insert print job:', e.message,
                '— Check that APEX handler printjobs/save is deployed (31_agents_printjob_save.sql)');
            showNotification(`Print job save failed: ${e.message}`, 'error');
        }
    }

    // Print a single order: download PDF via SOAP → verify content → show choice popup
    window.saPrintOrder = async function(orderNumber, tripId, tripDate, instanceName, silent) {
        const btn = document.getElementById(`sa-print-btn-${tripId}-${orderNumber}`);
        const setBtn = (html, disabled) => { if (btn) { btn.innerHTML = html; btn.disabled = !!disabled; } };
        setBtn('<i class="fas fa-spinner fa-spin"></i>', true);

        const agent = window._saCurrentAgent;

        // Prefer trip date from the meta chip element (fetched from GETTRIPDETAILS = actual trip date)
        // Fall back to passed-in tripDate, then today
        const metaEl = document.getElementById(`sa-trip-meta-${tripId}`);
        const actualTripDate = (metaEl && metaEl.getAttribute('data-trip-date'))
            || (tripDate || '').split('T')[0]
            || new Date().toISOString().split('T')[0];

        // Get account info from row data for print job record
        let accountName = '', accountNumber = '';
        const rowEl = document.getElementById(`sa-order-row-${tripId}-${orderNumber}`);
        if (rowEl) {
            const dr = rowEl.querySelector('[data-row]');
            if (dr) try { const rd = JSON.parse(dr.getAttribute('data-row')); accountName = rd.ACCOUNT_NAME || ''; accountNumber = rd.ACCOUNT_NUMBER || ''; } catch(e) {}
        }

        console.log(`[ShippingAgent] saPrintOrder: order=${orderNumber} tripId=${tripId} tripDate=${actualTripDate} instance=${instanceName}`);

        try {
            // 1. Download PDF via SOAP → C# saves to C:\fusion\{tripDate}\{tripId}\{order}.pdf
            //    C# now also returns base64 in the response so we don't need a second read call
            showNotification(`Downloading invoice PDF for ${orderNumber}...`, 'info');
            const dlResult = await saDownloadOrderPdf(orderNumber, tripId, actualTripDate, instanceName);
            console.log('[ShippingAgent] SOAP download result (base64 length):', (dlResult.base64 || '').length, 'filePath:', dlResult.filePath);
            const filePath = dlResult.filePath || dlResult.pdfPath || '';
            if (!filePath) throw new Error('PDF path not returned from C#');

            // 2. Use base64 returned directly from printSalesOrder response (no second round-trip needed)
            const base64   = dlResult.base64 || '';
            const fileSize = dlResult.fileSize || Math.round(base64.length * 0.75);
            const hasLines = fileSize > 500;
            console.log(`[ShippingAgent] PDF ready: size=${fileSize} hasLines=${hasLines} path=${filePath}`);

            // 3. Only insert into wms_print_jobs when PDF has real content (lines found)
            if (hasLines) {
                await saInsertPrintJob(orderNumber, tripId, actualTripDate, instanceName, filePath, fileSize, accountName, accountNumber);
                console.log(`[ShippingAgent] Print job inserted for ${orderNumber} — file has content`);
            } else {
                console.warn(`[ShippingAgent] Skipping print job insert for ${orderNumber} — PDF appears empty`);
            }

            // 4. Update print cell badge on the row
            if (rowEl) {
                const pc = rowEl.querySelector('[data-col="print"]');
                if (pc) pc.innerHTML = hasLines
                    ? saBadge('Downloaded', '#dcfce7', '#15803d', 'fa-check')
                    : saBadge('Empty PDF', '#fef9c3', '#a16207', 'fa-exclamation-triangle');
            }

            // 5. Show choice popup only for individual prints (not batch Print Trip)
            if (!silent) saShowPdfChoice(base64, orderNumber, filePath, fileSize, hasLines);

            // 6. Log activity
            if (agent) {
                saLogActivity(agent.ID, tripId, orderNumber, 'PRINT', 'SUCCESS', 1,
                    `PDF downloaded — ${Math.round(fileSize/1024)}KB, hasLines: ${hasLines}`, null, null);
            }

            setBtn('<i class="fas fa-print"></i>', false);
            showNotification(`PDF for ${orderNumber} downloaded${hasLines ? ' — has content.' : ' — may be empty!'}`, hasLines ? 'success' : 'warning');

        } catch(e) {
            setBtn('<i class="fas fa-print"></i>', false);
            showNotification(`Print failed for ${orderNumber}: ${e.message}`, 'error');
            if (agent) {
                saLogActivity(agent.ID, tripId, orderNumber, 'PRINT', 'FAILED', 1,
                    `PDF download failed: ${e.message}`, null, null);
            }
        }
    };

    // Print ALL fully-interfaced orders in a trip
    window.saPrintTrip = async function(tripId, instanceName) {
        const agent    = window._saCurrentAgent;
        const container = document.getElementById(`sa-trip-orders-${tripId}`);
        if (!container) return;

        const btn = document.getElementById(`sa-btn-print-trip-${tripId}`);
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Printing...'; }

        const rows = Array.from(container.querySelectorAll('tr[id^="sa-order-row-"]'));
        let printed = 0, skipped = 0;

        for (const row of rows) {
            const orderNumber = row.id.replace(`sa-order-row-${tripId}-`, '');
            if (!orderNumber) continue;

            // Only print if status cell shows Interfaced or Shipped (all lines done)
            const statusCell = row.querySelector('[data-col="status"]');
            const statusText = statusCell ? statusCell.textContent.trim() : '';
            const isPrintable = (statusText.includes('Interfaced') || statusText.includes('Shipped')) && !statusText.includes('/');
            if (!isPrintable) {
                skipped++;
                continue; // not fully interfaced
            }

            // Get tripDate from row data attribute
            let tripDate = new Date().toISOString().split('T')[0];
            const dataRow = row.querySelector('[data-row]');
            if (dataRow) {
                try { const rd = JSON.parse(dataRow.getAttribute('data-row')); tripDate = rd.TRIP_DATE || tripDate; } catch(e) {}
            }

            try {
                await saPrintOrder(orderNumber, tripId, tripDate, instanceName, true); // silent=true: no popup
                printed++;
            } catch(e) {
                console.warn(`[ShippingAgent] Print failed for ${orderNumber}:`, e.message);
            }
        }

        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-print"></i> Print Trip'; }

        if (agent) {
            saLogActivity(agent.ID, tripId, null, 'PRINT', 'SUCCESS', 1,
                `Trip print done — ${printed} printed, ${skipped} skipped (not fully interfaced)`, null, null);
        }
        showNotification(`Trip print complete: ${printed} printed, ${skipped} skipped.`, 'success');
    };

    // Cancel Sales Orders — fetches all trip lines, shows Scheduled/Manual Reservations for review
    window.saCancelTripOrders = async function(tripId, instanceName) {
        const inst   = instanceName || 'PROD';
        const agent  = window._saCurrentAgent || null;
        const url    = `${APEX_BASE}/trip/orders/getsalesorderlinesbytrip/${encodeURIComponent(tripId)}?P_INSTANCE_NAME=${encodeURIComponent(inst)}`;

        // Show loading indicator on the button
        const btn = [...document.querySelectorAll('[onclick]')].find(el =>
            el.getAttribute('onclick') && el.getAttribute('onclick').includes(`saCancelTripOrders('${tripId}'`));
        const origHtml = btn ? btn.innerHTML : '';
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Loading...'; }

        let allLines = [];
        try {
            const data = await new Promise((resolve, reject) => {
                sendMessageToCSharp({ action: 'apiGet', url }, (err, result) => {
                    if (err) reject(new Error(err));
                    else resolve(result);
                });
            });
            allLines = (data && data.items) ? data.items : (Array.isArray(data) ? data : []);
        } catch(e) {
            showNotification(`Failed to load trip lines: ${e.message}`, 'error');
            if (btn) { btn.disabled = false; btn.innerHTML = origHtml; }
            return;
        } finally {
            if (btn) { btn.disabled = false; btn.innerHTML = origHtml; }
        }

        // Filter to lines needing cancellation
        const cancelLines = allLines.filter(l => {
            const st = (l.STATUS || l.status || '').toUpperCase();
            return st.includes('SCHEDULED') || st.includes('MANUAL RESERVATION');
        });

        if (cancelLines.length === 0) {
            showNotification(`No Scheduled or Manual Reservation lines found for Trip ${tripId}.`, 'info');
            return;
        }

        // Group by order number
        const cancelGroups = {};
        for (const line of cancelLines) {
            const orderNum = line.SOURCE_ORDER_NUMBER || line.source_order_number || line.ORDER_NUMBER || '—';
            if (!cancelGroups[orderNum]) cancelGroups[orderNum] = [];
            // Normalise field names to match saShowCancelReviewDialog expectations
            cancelGroups[orderNum].push({
                LINE_NUMBER            : line.LINE_NUMBER    || line.line_number    || '—',
                ITEM_NUMBER            : line.PRODUCT_NUMBER || line.product_number || '—',
                DESCRIPTION            : line.PRODUCT_DESCRIPTION || line.product_description || '',
                STATUS                 : line.STATUS         || line.status         || '—',
                ORDERED_QTY            : line.ORDERED_QUANTITY || line.ordered_quantity || '—',
                FULFILLMENT_LINE_ID    : line.FULFILL_LINE_ID || line.fulfill_line_id || '—',
            });
        }

        // Re-use the existing cancel review dialog (passes null for agent if opened manually)
        const fakeAgent = agent || { ID: null };
        await saShowCancelReviewDialog(fakeAgent, tripId, inst, cancelGroups);
    };

    window.saShowShipmentLinesApiInfo = function(sampleOrderNumber, instanceName) {
        const inst     = instanceName || 'PROD';
        const fusionUrl = fusionShipmentLinesUrl(sampleOrderNumber, inst);
        const isProd   = inst.toUpperCase() === 'PROD';

        const existing = document.getElementById('sa-api-popup');
        if (existing) existing.remove();

        const pop = document.createElement('div');
        pop.id = 'sa-api-popup';
        pop.style.cssText = 'position:fixed;top:60px;right:20px;width:600px;max-height:90vh;overflow-y:auto;background:#0f172a;color:#e2e8f0;border-radius:12px;box-shadow:0 20px 60px rgba(0,0,0,0.6);z-index:99999;font-family:monospace;font-size:11px;';
        pop.innerHTML = `
            <div style="padding:0.75rem 1rem;background:#1e293b;border-radius:12px 12px 0 0;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #334155;">
                <span style="font-weight:800;font-size:12px;color:#7c3aed;"><i class="fas fa-code"></i> Get Shipment Lines — Oracle Fusion REST API</span>
                <button onclick="document.getElementById('sa-api-popup').remove()" style="background:none;border:none;color:#94a3b8;cursor:pointer;font-size:14px;">×</button>
            </div>
            <div style="padding:1rem;display:flex;flex-direction:column;gap:0.9rem;">

                <div>
                    <div style="color:#94a3b8;font-size:9px;font-weight:700;text-transform:uppercase;margin-bottom:0.4rem;">
                        <span style="background:#059669;color:white;padding:1px 6px;border-radius:4px;margin-right:4px;">GET</span>
                        Oracle Fusion — shipmentLines (called once per order)
                    </div>
                    <div style="background:#1e293b;border:1px solid #7c3aed;border-radius:6px;padding:0.6rem 0.8rem;">
                        <div style="color:#a78bfa;font-size:9px;margin-bottom:4px;font-weight:700;">
                            ${isProd ? '🟢 PROD' : '🟡 TRAIN/TEST'} — Instance: <strong>${esc(inst)}</strong>
                        </div>
                        <div style="color:#38bdf8;word-break:break-all;line-height:1.6;">${esc(fusionUrl)}</div>
                    </div>
                    <div style="color:#64748b;font-size:9px;margin-top:0.4rem;line-height:1.7;">
                        <strong style="color:#94a3b8;">Host:</strong>
                        <span style="color:#f472b6;">PROD</span> → <code>efmh.fa.em3.oraclecloud.com</code> &nbsp;|&nbsp;
                        <span style="color:#fbbf24;">TRAIN</span> → <code>efmh-test.fa.em3.oraclecloud.com</code><br>
                        <strong style="color:#94a3b8;">Resource:</strong> <code>/fscmRestApi/resources/11.13.18.05/shipmentLines</code><br>
                        <strong style="color:#94a3b8;">Query:</strong> <code>q=Order={ORDER_NUMBER}&limit=500</code><br>
                        <strong style="color:#94a3b8;">Auth:</strong> Via C# <code>executeOracleFusionGet</code> (Fusion credentials from config)<br>
                        <strong style="color:#94a3b8;">Response fields:</strong> <code>LineStatusCode</code>, <code>LineStatus</code>, <code>RequestedQuantity</code>, <code>StagedQuantity</code>, <code>ShippedQuantity</code>
                    </div>
                </div>

                <div style="background:#1e293b;border-radius:6px;padding:0.6rem 0.8rem;font-size:9px;color:#94a3b8;line-height:1.8;">
                    <div style="color:#e2e8f0;font-weight:700;margin-bottom:0.4rem;"><i class="fas fa-sitemap" style="color:#7c3aed;"></i> Status Classification (LineStatusCode → meaning)</div>
                    <div><code style="color:#fbbf24;">Ready to Release</code> → Picking not yet started</div>
                    <div><code style="color:#38bdf8;">Released to WH</code> → Pick wave released, picking in progress</div>
                    <div><code style="color:#60a5fa;">C → Staged</code> → <strong style="color:#e2e8f0;">Picking done</strong> ✓</div>
                    <div><code style="color:#4ade80;">Y → Interfaced</code> → <strong style="color:#e2e8f0;">Shipping done</strong> ✓✓</div>
                    <div><code style="color:#4ade80;">Pending inventory processing</code> → treated as <strong style="color:#e2e8f0;">Interfaced</strong> ✓✓</div>
                    <div><code style="color:#f87171;">X → Cancelled</code> → Line cancelled</div>
                </div>

                <div>
                    <div style="color:#94a3b8;font-size:9px;font-weight:700;text-transform:uppercase;margin-bottom:0.4rem;">
                        <span style="background:#059669;color:white;padding:1px 6px;border-radius:4px;margin-right:4px;">GET</span>
                        APEX — Sales Order Lines count (per order)
                    </div>
                    <div style="background:#1e293b;border:1px solid #0891b2;border-radius:6px;padding:0.5rem 0.8rem;color:#38bdf8;font-size:10px;word-break:break-all;">
                        ${esc(APEX_BASE)}/trip/orders/getsalesorderlines/<strong>{ORDER_NUMBER}</strong>?P_INSTANCE_NAME=${esc(inst)}
                    </div>
                </div>

                <div>
                    <div style="color:#94a3b8;font-size:9px;font-weight:700;text-transform:uppercase;margin-bottom:0.4rem;">
                        <span style="background:#d97706;color:white;padding:1px 6px;border-radius:4px;margin-right:4px;">POST</span>
                        APEX — Save Fusion order lines to DB (per order)
                    </div>
                    <div style="background:#1e293b;border:1px solid #d97706;border-radius:6px;padding:0.5rem 0.8rem;color:#fcd34d;font-size:10px;word-break:break-all;">
                        ${esc(APEX_BASE)}/trip/order/fetchfusionorderlines?P_INSTANCE_NAME=${esc(inst)}&amp;p_order_number=<strong>{ORDER_NUMBER}</strong>
                    </div>
                </div>

                <div>
                    <div style="color:#94a3b8;font-size:9px;font-weight:700;text-transform:uppercase;margin-bottom:0.4rem;">
                        <span style="background:#7c3aed;color:white;padding:1px 6px;border-radius:4px;margin-right:4px;">SOAP</span>
                        Oracle Fusion — Download Invoice PDF (Print button)
                    </div>
                    <div style="background:#1e293b;border:1px solid #7c3aed;border-radius:6px;padding:0.5rem 0.8rem;color:#c4b5fd;font-size:10px;word-break:break-all;">
                        ${isProd ? 'https://efmh.fa.em3.oraclecloud.com' : 'https://efmh-test.fa.em3.oraclecloud.com'}/xmlpserver/services/v2/ReportService<br>
                        <span style="color:#94a3b8;">Report:</span> /Custom/OQ/GR_SalesOrder_Rep.xdo &nbsp;·&nbsp; <span style="color:#94a3b8;">Param:</span> Order_Number=<strong>{ORDER_NUMBER}</strong><br>
                        <span style="color:#94a3b8;">Via C#:</span> <code>printSalesOrder</code> action → saves PDF to C:\fusion\{date}\{tripId}\{order}.pdf
                    </div>
                </div>

                <div style="font-size:9px;color:#64748b;line-height:1.6;">
                    <i class="fas fa-clock" style="color:#7c3aed;"></i> Fetch time stored in <code>window._saOrderLastFetched[orderNumber]</code> — shown in <strong>Last Checked</strong> column.<br>
                    <i class="fas fa-history" style="color:#7c3aed;"></i> Every fetch posts a <code>CHECK_STATUS</code> entry to the agent Activity Log.<br>
                    <i class="fas fa-print" style="color:#7c3aed;"></i> Print button available per order and at trip level (Print Trip). PDF verified by reading back base64 content.
                </div>
            </div>`;
        document.body.appendChild(pop);
    };

    window.saShowDbSaveApiInfo = function() {
        const existing = document.getElementById('sa-api-popup');
        if (existing) existing.remove();

        const payload = window._saLastDbSavePayload;
        const payloadJson = payload
            ? JSON.stringify(payload, null, 2)
            : '// Not yet fetched — click "Get Shipment Lines" first';

        const pop = document.createElement('div');
        pop.id = 'sa-api-popup';
        pop.style.cssText = 'position:fixed;top:60px;right:20px;width:620px;max-height:90vh;overflow-y:auto;background:#0f172a;color:#e2e8f0;border-radius:12px;box-shadow:0 20px 60px rgba(0,0,0,0.6);z-index:99999;font-family:monospace;font-size:11px;';
        pop.innerHTML = `
            <div style="padding:0.75rem 1rem;background:#1e293b;border-radius:12px 12px 0 0;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #334155;">
                <span style="font-weight:800;font-size:12px;color:#f59e0b;"><i class="fas fa-database"></i> DB Save — WMS_SHIPING_AGENTS_ORDERS_STATUS</span>
                <button onclick="document.getElementById('sa-api-popup').remove()" style="background:none;border:none;color:#94a3b8;cursor:pointer;font-size:14px;">×</button>
            </div>
            <div style="padding:1rem;display:flex;flex-direction:column;gap:0.9rem;">
                <div>
                    <div style="color:#94a3b8;font-size:9px;font-weight:700;text-transform:uppercase;margin-bottom:0.4rem;">
                        <span style="background:#d97706;color:white;padding:1px 6px;border-radius:4px;margin-right:4px;">POST</span>
                        APEX REST — Save order shipment status per order
                    </div>
                    <div style="background:#1e293b;border:1px solid #f59e0b;border-radius:6px;padding:0.6rem 0.8rem;color:#fcd34d;font-size:10px;word-break:break-all;">
                        ${esc(APEX_BASE)}/agents/orders/status/save
                    </div>
                    <div style="color:#64748b;font-size:9px;margin-top:0.35rem;line-height:1.7;">
                        Called from <code>saFetchOrderStatus()</code> after each Fusion shipmentLines response.<br>
                        <code>printTotal</code> / <code>printPrinted</code> are <strong>not sent</strong> — PL/SQL queries <code>wms_print_jobs</code> live.<br>
                        Deployed via: <code>apex_sql/30_agents_order_status.sql</code> — Handler A.
                    </div>
                </div>
                <div>
                    <div style="color:#94a3b8;font-size:9px;font-weight:700;margin-bottom:0.4rem;">
                        ${payload ? '<span style="color:#4ade80;">● Last actual payload sent</span>' : '<span style="color:#f87171;">● No payload yet — fetch shipment lines first</span>'}
                    </div>
                    <pre style="background:#1e293b;border:1px solid #334155;border-radius:6px;padding:0.8rem;overflow-x:auto;font-size:10px;color:#a5f3fc;margin:0;white-space:pre-wrap;line-height:1.6;">${esc(payloadJson)}</pre>
                </div>
                <div style="background:#1e293b;border-radius:6px;padding:0.6rem 0.8rem;font-size:9px;color:#94a3b8;line-height:1.8;">
                    <div style="color:#e2e8f0;font-weight:700;margin-bottom:0.4rem;"><i class="fas fa-table" style="color:#f59e0b;"></i> Table: WMS_SHIPING_AGENTS_ORDERS_STATUS</div>
                    <div>Unique constraint: <code>(agent_id, trip_id, order_number, instance_name)</code></div>
                    <div>Strategy: <strong>DELETE + INSERT</strong> on every fetch (full refresh per order)</div>
                    <div>GET endpoint: <code>agents/{agentId}/trips/{tripId}/orders/status</code></div>
                    <div>DELETE endpoint: <code>agents/{agentId}/trips/{tripId}/orders/status</code></div>
                </div>
            </div>`;
        document.body.appendChild(pop);
    };

    window.saShowGetStatusApiInfo = function(tripId, instanceName) {
        const agent   = window._saCurrentAgent;
        const agentId = agent ? (agent.ID || agent.id) : '?';
        const getUrl  = `${APEX_BASE}/agents/${agentId}/trips/${encodeURIComponent(tripId)}/orders/status`;

        const existing = document.getElementById('sa-api-popup');
        if (existing) existing.remove();

        const pop = document.createElement('div');
        pop.id = 'sa-api-popup';
        pop.style.cssText = 'position:fixed;top:60px;right:20px;width:620px;max-height:90vh;overflow-y:auto;background:#0f172a;color:#e2e8f0;border-radius:12px;box-shadow:0 20px 60px rgba(0,0,0,0.6);z-index:99999;font-family:monospace;font-size:11px;';
        pop.innerHTML = `
            <div style="padding:0.75rem 1rem;background:#1e293b;border-radius:12px 12px 0 0;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #334155;">
                <span style="font-weight:800;font-size:12px;color:#4ade80;"><i class="fas fa-search"></i> GET — WMS_SHIPING_AGENTS_ORDERS_STATUS</span>
                <button onclick="document.getElementById('sa-api-popup').remove()" style="background:none;border:none;color:#94a3b8;cursor:pointer;font-size:14px;">×</button>
            </div>
            <div style="padding:1rem;display:flex;flex-direction:column;gap:0.9rem;">
                <div>
                    <div style="color:#94a3b8;font-size:9px;font-weight:700;text-transform:uppercase;margin-bottom:0.4rem;">
                        <span style="background:#059669;color:white;padding:1px 6px;border-radius:4px;margin-right:4px;">GET</span>
                        Called on trip open — pre-populates order status columns from DB
                    </div>
                    <div style="background:#1e293b;border:1px solid #4ade80;border-radius:6px;padding:0.8rem;color:#4ade80;font-size:10px;word-break:break-all;line-height:1.8;">
                        ${esc(getUrl)}
                    </div>
                    <div style="color:#64748b;font-size:9px;margin-top:0.4rem;line-height:1.7;">
                        <strong style="color:#94a3b8;">agentId:</strong> <code>${agentId}</code> &nbsp;·&nbsp;
                        <strong style="color:#94a3b8;">tripId:</strong> <code>${esc(tripId)}</code> &nbsp;·&nbsp;
                        <strong style="color:#94a3b8;">instanceName:</strong> <code>${esc(instanceName || 'PROD')}</code><br>
                        <strong style="color:#94a3b8;">When:</strong> Inside <code>saLoadTripOrders()</code> — runs every time you click Orders on a trip card.<br>
                        <strong style="color:#94a3b8;">APEX handler:</strong> URI Template <code>agents/:agentId/trips/:tripId/orders/status</code> — Method <strong>GET</strong> — Source Type <strong>SQL Query</strong>
                    </div>
                </div>
                <div style="background:#1e293b;border-radius:6px;padding:0.7rem 0.8rem;font-size:9px;color:#94a3b8;line-height:1.8;">
                    <div style="color:#e2e8f0;font-weight:700;margin-bottom:0.4rem;"><i class="fas fa-exclamation-triangle" style="color:#f59e0b;"></i> If this returns no rows or 404:</div>
                    <div>1. Make sure Handler B (GET) is deployed in APEX — <code>apex_sql/30_agents_order_status.sql</code></div>
                    <div>2. URI template must be exactly: <code>agents/:agentId/trips/:tripId/orders/status</code></div>
                    <div>3. Source Type must be <strong>SQL Query</strong> (not PL/SQL)</div>
                    <div>4. Run POST (Get Shipment Lines) first to insert data, then reload trip orders</div>
                </div>
            </div>`;
        document.body.appendChild(pop);
    };

    function saCheckedBadge(timeStr, lineCount) {
        return `<div style="font-size:9px;color:#059669;"><i class="fas fa-check-circle"></i> ${timeStr}</div>` +
               `<div style="font-size:9px;color:#94a3b8;">${lineCount} line(s)</div>`;
    }

    // Badge helpers
    function saBadge(label, bg, color, icon) {
        return `<span style="background:${bg};color:${color};padding:2px 7px;border-radius:6px;font-size:9px;font-weight:700;white-space:nowrap;display:inline-block;">${icon ? `<i class="fas ${icon}"></i> ` : ''}${label}</span>`;
    }

    function saPickBadge(yesCount, noCount, total) {
        if (total === 0) return saBadge('N/A', '#f1f5f9', '#94a3b8', null);
        if (yesCount === total) return saBadge('Confirmed', '#dcfce7', '#15803d', 'fa-check');
        if (yesCount === 0)    return saBadge('Not Picked', '#fef2f2', '#b91c1c', 'fa-times');
        return saBadge(`${yesCount}/${total} Picked`, '#fef9c3', '#a16207', 'fa-box');
    }

    function saShipBadge(yesCount, noCount, total) {
        if (total === 0) return saBadge('N/A', '#f1f5f9', '#94a3b8', null);
        if (yesCount === total) return saBadge('Shipped', '#dcfce7', '#15803d', 'fa-truck');
        if (yesCount === 0)    return saBadge('Not Shipped', '#fef2f2', '#b91c1c', 'fa-times');
        return saBadge(`${yesCount}/${total} Shipped`, '#fef9c3', '#a16207', 'fa-truck');
    }

    function saRenderOrdersTable(orders, tripId, inst) {
        const spin = `<i class="fas fa-spinner fa-spin" style="color:#94a3b8;font-size:9px;"></i>`;
        const rows = orders.map(o => {
            // Encode row data for editTripOrder (same structure as GETTRIPDETAILS row)
            const rowJson = JSON.stringify(o).replace(/'/g, "\\'").replace(/"/g, '&quot;');
            return `
            <tr id="sa-order-row-${esc(tripId)}-${esc(o.ORDER_NUMBER)}" style="border-bottom:1px solid #f1f5f9;" onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background=''">
                <td style="padding:6px 8px;min-width:120px;">
                    <a href="javascript:void(0)" onclick='editTripOrder(JSON.parse(this.getAttribute("data-row")))' data-row="${rowJson}"
                        style="font-weight:700;color:#6d28d9;font-size:11px;text-decoration:none;cursor:pointer;"
                        title="Open order transactions">${esc(o.ORDER_NUMBER)}</a>
                    <div style="color:#64748b;font-size:9px;">${esc(o.ACCOUNT_NAME)}</div>
                    <div style="color:#94a3b8;font-size:9px;">${esc(o.ORDER_TYPE)} <span data-col="shipped-indicator"></span></div>
                </td>
                <td style="padding:6px 8px;text-align:center;" data-col="status">${spin}</td>
                <td style="padding:6px 8px;text-align:center;" data-col="staged">${spin}</td>
                <td style="padding:6px 8px;text-align:center;" data-col="picking">${spin}</td>
                <td style="padding:6px 8px;text-align:center;" data-col="shipping">${spin}</td>
                <td style="padding:6px 8px;text-align:center;" data-col="backorder">${spin}</td>
                <td style="padding:6px 8px;text-align:center;" data-col="cancel">${spin}</td>
                <td style="padding:6px 8px;text-align:center;" data-col="order_lines">${spin}</td>
                <td style="padding:6px 8px;text-align:center;" data-col="print">${spin}</td>
                <td style="padding:6px 8px;text-align:center;" data-col="checked"><span style="color:#94a3b8;font-size:9px;">—</span></td>
                <td style="padding:6px 8px;text-align:center;">
                    <div style="display:flex;gap:3px;justify-content:center;flex-wrap:wrap;">
                        <button onclick="saFetchOrderStatus('${esc(o.ORDER_NUMBER)}','${esc(o.INSTANCE)}','${esc(tripId)}')"
                            style="background:#e0f2fe;color:#0369a1;border:none;padding:3px 7px;border-radius:5px;font-size:9px;cursor:pointer;font-weight:700;" title="Refresh shipment lines">
                            <i class="fas fa-sync"></i>
                        </button>
                        <button id="sa-print-btn-${esc(tripId)}-${esc(o.ORDER_NUMBER)}"
                            onclick="saPrintOrder('${esc(o.ORDER_NUMBER)}','${esc(tripId)}','${esc(o.TRIP_DATE)}','${esc(o.INSTANCE)}')"
                            style="background:#7c3aed;color:white;border:none;padding:3px 7px;border-radius:5px;font-size:9px;cursor:pointer;font-weight:700;" title="Download invoice PDF via SOAP">
                            <i class="fas fa-print"></i>
                        </button>
                        <button onclick="saShowPrintApiInfo('${esc(o.ORDER_NUMBER)}','${esc(o.INSTANCE)}')"
                            style="background:#1e293b;color:#94a3b8;border:none;padding:3px 6px;border-radius:5px;font-size:9px;cursor:pointer;font-weight:600;" title="Show SOAP call details">
                            <i class="fas fa-code"></i>
                        </button>
                    </div>
                </td>
            </tr>`;
        }).join('');

        return `
        <div style="padding:0.5rem 0;overflow-x:auto;">
            <div style="padding:0 1rem 0.4rem;display:flex;justify-content:space-between;align-items:center;">
                <span style="font-size:10px;font-weight:700;color:#475569;">${orders.length} ORDER(S)</span>
                <div style="display:flex;gap:0.4rem;align-items:center;">
                    <button onclick="saShowShipmentLinesApiInfo('${esc(orders[0] && orders[0].ORDER_NUMBER || '')}','${esc(inst)}')"
                        style="background:#1e293b;color:#94a3b8;border:none;padding:4px 8px;border-radius:5px;font-size:10px;cursor:pointer;font-weight:600;"
                        title="Show Fusion API info"><i class="fas fa-code"></i></button>
                    <button onclick="saShowDbSaveApiInfo()"
                        style="background:#1e293b;color:#f59e0b;border:1px solid #f59e0b;padding:4px 8px;border-radius:5px;font-size:10px;cursor:pointer;font-weight:700;"
                        title="Show DB save POST body (WMS_SHIPING_AGENTS_ORDERS_STATUS)"><i class="fas fa-database"></i></button>
                    <button onclick="saShowGetStatusApiInfo('${esc(tripId)}','${esc(inst)}')"
                        style="background:#1e293b;color:#4ade80;border:1px solid #4ade80;padding:4px 8px;border-radius:5px;font-size:10px;cursor:pointer;font-weight:700;"
                        title="Show GET status URL (WMS_SHIPING_AGENTS_ORDERS_STATUS)"><i class="fas fa-search"></i></button>
                    <button id="sa-btn-get-sl-${esc(tripId)}"
                        onclick="saGetAllShipmentLines('${esc(tripId)}','${esc(inst)}')"
                        style="background:#7c3aed;color:white;border:none;padding:4px 12px;border-radius:5px;font-size:10px;cursor:pointer;font-weight:700;">
                        <i class="fas fa-download"></i> Get Shipment Lines
                    </button>
                    <button id="sa-btn-print-status-${esc(tripId)}"
                        onclick="saGetPrintStatus('${esc(tripId)}','${esc(inst)}')"
                        style="background:#0891b2;color:white;border:none;padding:4px 12px;border-radius:5px;font-size:10px;cursor:pointer;font-weight:700;"
                        title="Fetch live print status from wms_print_jobs for this trip">
                        <i class="fas fa-print"></i> Get Print Status
                    </button>
                    <button onclick="saOpenPdfFolder('${esc(tripId)}')"
                        style="background:#475569;color:white;border:none;padding:4px 12px;border-radius:5px;font-size:10px;cursor:pointer;font-weight:700;"
                        title="Open PDF download folder in Windows Explorer">
                        <i class="fas fa-folder-open"></i> Open PDF Folder
                    </button>
                    <button onclick="saVerifyPdfs('${esc(tripId)}','${esc(inst)}')"
                        style="background:#0f172a;color:#f59e0b;border:1px solid #f59e0b;padding:4px 12px;border-radius:5px;font-size:10px;cursor:pointer;font-weight:700;"
                        title="Check each order PDF exists and has lines">
                        <i class="fas fa-file-pdf"></i> Verify PDFs
                    </button>
                    <button id="sa-btn-print-trip-${esc(tripId)}"
                        onclick="saPrintTrip('${esc(tripId)}','${esc(inst)}')"
                        style="background:#059669;color:white;border:none;padding:4px 12px;border-radius:5px;font-size:10px;cursor:pointer;font-weight:700;"
                        title="Download & view invoice PDFs for all fully-interfaced orders">
                        <i class="fas fa-print"></i> Print Trip
                    </button>
                    <button onclick="saCancelTripOrders('${esc(tripId)}','${esc(inst)}')"
                        style="background:#dc2626;color:white;border:none;padding:4px 12px;border-radius:5px;font-size:10px;cursor:pointer;font-weight:700;"
                        title="Cancel Sales Orders">
                        <i class="fas fa-ban"></i> Cancel Orders
                    </button>
                </div>
            </div>
            <table style="width:100%;border-collapse:collapse;font-size:11px;">
                <thead>
                    <tr style="background:#f8fafc;border-bottom:2px solid #e2e8f0;">
                        <th style="padding:5px 8px;text-align:left;font-size:10px;color:#64748b;font-weight:700;">Order # / Customer</th>
                        <th style="padding:5px 8px;text-align:center;font-size:10px;color:#64748b;font-weight:700;">Order Status</th>
                        <th style="padding:5px 8px;text-align:center;font-size:10px;color:#64748b;font-weight:700;">Staged</th>
                        <th style="padding:5px 8px;text-align:center;font-size:10px;color:#64748b;font-weight:700;">Picking</th>
                        <th style="padding:5px 8px;text-align:center;font-size:10px;color:#64748b;font-weight:700;">Shipping</th>
                        <th style="padding:5px 8px;text-align:center;font-size:10px;color:#64748b;font-weight:700;">Backorder</th>
                        <th style="padding:5px 8px;text-align:center;font-size:10px;color:#64748b;font-weight:700;">Cancelled</th>
                        <th style="padding:5px 8px;text-align:center;font-size:10px;color:#64748b;font-weight:700;">Order Lines</th>
                        <th style="padding:5px 8px;text-align:center;font-size:10px;color:#64748b;font-weight:700;">Printing</th>
                        <th style="padding:5px 8px;text-align:center;font-size:10px;color:#64748b;font-weight:700;">Last Checked</th>
                        <th style="padding:5px 8px;text-align:center;font-size:10px;color:#64748b;font-weight:700;">Actions</th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
        </div>`;
    }


    window.saUnassignTrip = async function(agentId, tripId) {
        if (!confirm(`Remove trip "${tripId}" from this agent?`)) return;
        try {
            await apexDelete(`agents/${agentId}/trips/${encodeURIComponent(tripId)}`);
            showNotification('Trip removed from agent.', 'success');
            await saLoadTrips();
        } catch(e) {
            showNotification('Failed to remove trip: ' + e.message, 'error');
        }
    };

    // ─── Show Trip Order Lines dialog ────────────────────────

    window.saShowTripLines = async function(tripId, instanceName) {
        const inst = instanceName || 'PROD';
        const url  = `${APEX_BASE.replace('TRIPMANAGEMENT','TRIPMANAGEMENT')}/gettrillines?P_TRIP_ID=${encodeURIComponent(tripId)}&P_INSTANCE_NAME=${inst}`;

        // Show modal with spinner first
        const existing = document.getElementById('sa-triplines-modal');
        if (existing) existing.remove();
        document.body.insertAdjacentHTML('beforeend', `
        <div id="sa-triplines-modal" style="position:fixed;inset:0;background:rgba(0,0,0,0.65);z-index:22000;display:flex;align-items:center;justify-content:center;" onclick="if(event.target===this)this.remove()">
            <div style="background:white;border-radius:12px;width:95vw;max-width:1200px;max-height:90vh;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,0.4);">
                <div style="padding:1rem 1.25rem;background:linear-gradient(135deg,#1e293b,#334155);border-radius:12px 12px 0 0;display:flex;justify-content:space-between;align-items:center;">
                    <div>
                        <div style="color:white;font-weight:700;font-size:14px;"><i class="fas fa-table" style="color:#fbbf24;margin-right:6px;"></i>Order Lines — Trip ${esc(tripId)}</div>
                        <div style="color:#94a3b8;font-size:10px;margin-top:2px;">${esc(inst)} · ${esc(url)}</div>
                    </div>
                    <button onclick="document.getElementById('sa-triplines-modal').remove()" style="background:#475569;color:white;border:none;padding:5px 12px;border-radius:6px;cursor:pointer;font-weight:700;">&times;</button>
                </div>
                <div id="sa-triplines-body" style="flex:1;overflow:auto;padding:1rem;">
                    <div style="text-align:center;padding:2rem;color:#94a3b8;"><i class="fas fa-spinner fa-spin fa-2x"></i><div style="margin-top:0.5rem;">Loading order lines...</div></div>
                </div>
            </div>
        </div>`);

        try {
            const data  = await rawGet(`${APEX_BASE}/gettrillines?P_TRIP_ID=${encodeURIComponent(tripId)}&P_INSTANCE_NAME=${inst}`);
            const lines = data.items || [];
            const body  = document.getElementById('sa-triplines-body');
            if (!body) return;

            if (lines.length === 0) {
                body.innerHTML = `<div style="text-align:center;padding:2rem;color:#94a3b8;font-size:12px;">No order lines found for trip ${esc(tripId)}.</div>`;
                return;
            }

            // Collect column headers dynamically from first row
            const cols = Object.keys(lines[0]);
            const thStyle = 'padding:6px 10px;text-align:left;font-size:10px;color:#64748b;font-weight:700;white-space:nowrap;border-bottom:2px solid #e2e8f0;background:#f8fafc;';
            const tdStyle = 'padding:5px 10px;font-size:11px;color:#1e293b;border-bottom:1px solid #f1f5f9;white-space:nowrap;';

            body.innerHTML = `
            <div style="margin-bottom:0.5rem;font-size:11px;color:#475569;font-weight:600;">${lines.length} line(s)</div>
            <div style="overflow-x:auto;">
            <table style="width:100%;border-collapse:collapse;">
                <thead><tr>${cols.map(c => `<th style="${thStyle}">${esc(c)}</th>`).join('')}</tr></thead>
                <tbody>${lines.map((row, i) => `
                <tr style="background:${i%2===0?'white':'#f8fafc'};" onmouseover="this.style.background='#eff6ff'" onmouseout="this.style.background='${i%2===0?'white':'#f8fafc'}'">
                    ${cols.map(c => `<td style="${tdStyle}">${esc(String(row[c] ?? ''))}</td>`).join('')}
                </tr>`).join('')}
                </tbody>
            </table>
            </div>`;
        } catch(e) {
            const body = document.getElementById('sa-triplines-body');
            if (body) body.innerHTML = `<div style="padding:1rem;color:#dc2626;font-size:12px;">${esc(e.message)}</div>`;
        }
    };

    // ─── Activity Log Tab ────────────────────────────────────

    const ACTIVITY_LABEL = {
        CHECK_STATUS:   'Fetching Shipment Lines',
        PRINT:          'Printing',
        PICK_RELEASE:   'Pick Release',
        NOTIFY_PICKER:  'Notify Picker',
        SHIP_CONFIRM:   'Ship Confirm',
        CANCEL_LINE:    'Cancelling Lines',
        ANOMALY_DETECT: 'Anomaly Detection',
        AI_ANALYSIS:    'AI Analysis',
        FETCH_ORDERS:   'Fetching Sales Order Lines',
        FETCH_TRIPS:    'Fetching Trips',
        ASSIGN_TRIP:    'Assigning Trip',
    };

    window.saRefreshActivity = async function() {
        const agent = window._saCurrentAgent;
        if (!agent) return;
        const feed = document.getElementById('sa-activity-feed');
        if (!feed) return;
        feed.innerHTML = `<div style="padding:1rem;text-align:center;color:#94a3b8;font-size:11px;"><i class="fas fa-spinner fa-spin"></i></div>`;
        try {
            const data       = await apexGet(`agents/${agent.ID}/activity?LIMIT=100`);
            const activities = data.items || [];
            if (activities.length === 0) {
                feed.innerHTML = `<div style="padding:1rem;text-align:center;color:#94a3b8;font-size:11px;">No activity yet.</div>`;
                return;
            }
            feed.innerHTML = activities.map(a => {
                // Normalize lowercase ORDS column names
                const actType    = a.ACTIVITY_TYPE  || a.activity_type  || '';
                const status     = a.STATUS         || a.status         || '';
                const msg        = a.MESSAGE        || a.message        || '';
                const tripId     = a.TRIP_ID        || a.trip_id        || '';
                const orderNum   = a.ORDER_NUMBER   || a.order_number   || '';
                const attempt    = a.ATTEMPT_NUMBER || a.attempt_number || 1;
                const durationMs = a.DURATION_MS    || a.duration_ms    || null;
                const createdDate= a.CREATED_DATE   || a.created_date   || '';

                const info  = ACTIVITY_ICON[actType] || { icon: 'fa-history', color: '#64748b' };
                const label = ACTIVITY_LABEL[actType] || actType || 'Activity';

                const isOk    = status === 'SUCCESS';
                const isFail  = status === 'FAILED';
                const isRetry = status === 'RETRY';
                const statusColor = isOk ? '#059669' : isFail ? '#dc2626' : isRetry ? '#d97706' : '#94a3b8';
                const statusBg    = isOk ? '#f0fdf4' : isFail ? '#fff5f5' : isRetry ? '#fefce8' : '#f8fafc';
                const statusIcon  = isOk ? 'fa-check-circle' : isFail ? 'fa-times-circle' : isRetry ? 'fa-redo' : 'fa-circle';

                const meta = [
                    tripId    ? `<span style="background:#ede9fe;color:#6d28d9;padding:1px 5px;border-radius:3px;font-size:8px;font-weight:700;">Trip ${esc(tripId)}</span>` : '',
                    orderNum  ? `<span style="background:#e0f2fe;color:#0369a1;padding:1px 5px;border-radius:3px;font-size:8px;font-weight:700;">Order ${esc(orderNum)}</span>` : '',
                    durationMs ? `<span style="color:#94a3b8;font-size:8px;">${durationMs}ms</span>` : '',
                    attempt > 1 ? `<span style="background:#fef9c3;color:#a16207;padding:1px 5px;border-radius:3px;font-size:8px;font-weight:700;">Attempt #${attempt}</span>` : ''
                ].filter(Boolean).join(' ');

                return `
                <div style="display:flex;gap:0.6rem;align-items:flex-start;padding:7px 8px;border-radius:7px;background:${statusBg};border:1px solid ${isOk?'#dcfce7':isFail?'#fee2e2':isRetry?'#fef9c3':'#f1f5f9'};margin-bottom:4px;">
                    <div style="width:26px;height:26px;border-radius:6px;background:${info.color}20;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                        <i class="fas ${info.icon}" style="color:${info.color};font-size:11px;"></i>
                    </div>
                    <div style="flex:1;min-width:0;">
                        <div style="display:flex;justify-content:space-between;align-items:center;gap:0.4rem;flex-wrap:wrap;">
                            <span style="font-weight:700;color:#1e293b;font-size:11px;">${esc(label)}</span>
                            <div style="display:flex;align-items:center;gap:4px;">
                                <i class="fas ${statusIcon}" style="color:${statusColor};font-size:10px;"></i>
                                <span style="font-size:10px;color:${statusColor};font-weight:700;">${esc(status)}</span>
                            </div>
                        </div>
                        ${msg ? `<div style="color:#475569;font-size:10px;margin-top:2px;white-space:pre-wrap;word-break:break-word;">${esc(msg)}</div>` : ''}
                        <div style="margin-top:3px;display:flex;gap:4px;flex-wrap:wrap;align-items:center;">
                            ${meta}
                            <span style="color:#94a3b8;font-size:8px;">${saFormatDate(createdDate)}</span>
                        </div>
                    </div>
                </div>`;
            }).join('');
        } catch(e) {
            feed.innerHTML = `<div style="color:#dc2626;font-size:11px;">${e.message}</div>`;
        }
    };

    // ─── Performance Tab ─────────────────────────────────────
    async function saLoadPerformance() {
        const agent = window._saCurrentAgent;
        if (!agent) return;
        const content = document.getElementById('sa-performance-content');
        if (!content) return;
        content.innerHTML = `<div style="padding:1rem;text-align:center;color:#94a3b8;font-size:12px;"><i class="fas fa-spinner fa-spin"></i> Loading...</div>`;
        try {
            const data  = await apexGet(`agents/${agent.ID}/performance`);
            const rows  = data.items || [];
            if (rows.length === 0) {
                content.innerHTML = `<div style="padding:2rem;text-align:center;color:#94a3b8;font-size:12px;">No performance data yet.</div>`;
                return;
            }
            const today = rows[0];
            content.innerHTML = `
                <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:0.75rem;">
                    ${saStatCard('Status Checks',    today.STATUS_CHECKS,    '#0891b2', 'fa-eye')}
                    ${saStatCard('Prints',           today.PRINTS_TRIGGERED, '#7c3aed', 'fa-print')}
                    ${saStatCard('Pick Releases',    today.PICK_RELEASES,    '#059669', 'fa-shipping-fast')}
                    ${saStatCard('Notifications',    today.NOTIFICATIONS_SENT,'#d97706','fa-bell')}
                    ${saStatCard('Anomalies',        today.ANOMALIES_FLAGGED,'#dc2626', 'fa-exclamation-triangle')}
                    ${saStatCard('AI Calls',         today.AI_CALLS,         '#6d28d9', 'fa-brain')}
                    ${saStatCard('Retries',          today.RETRIES_TOTAL,    '#f59e0b', 'fa-redo')}
                    ${saStatCard('Errors',           today.ERRORS_TOTAL,     '#dc2626', 'fa-times-circle')}
                </div>
                <div style="margin-top:1rem;">
                    <div style="font-size:12px;font-weight:700;color:#1e293b;margin-bottom:0.75rem;">Daily History</div>
                    <div style="overflow-x:auto;">
                        <table style="width:100%;border-collapse:collapse;font-size:11px;">
                            <thead>
                                <tr style="background:#f8fafc;">
                                    <th style="padding:6px 8px;text-align:left;border-bottom:2px solid #e2e8f0;color:#64748b;">Date</th>
                                    <th style="padding:6px 8px;text-align:right;border-bottom:2px solid #e2e8f0;color:#64748b;">Checks</th>
                                    <th style="padding:6px 8px;text-align:right;border-bottom:2px solid #e2e8f0;color:#64748b;">Prints</th>
                                    <th style="padding:6px 8px;text-align:right;border-bottom:2px solid #e2e8f0;color:#64748b;">Pick Rel.</th>
                                    <th style="padding:6px 8px;text-align:right;border-bottom:2px solid #e2e8f0;color:#64748b;">Notifs</th>
                                    <th style="padding:6px 8px;text-align:right;border-bottom:2px solid #e2e8f0;color:#64748b;">Retries</th>
                                    <th style="padding:6px 8px;text-align:right;border-bottom:2px solid #e2e8f0;color:#64748b;">Errors</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${rows.map(r => `
                                <tr style="border-bottom:1px solid #f1f5f9;" onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background=''">
                                    <td style="padding:5px 8px;font-weight:600;color:#374151;">${r.PERF_DATE || ''}</td>
                                    <td style="padding:5px 8px;text-align:right;color:#0891b2;">${r.STATUS_CHECKS || 0}</td>
                                    <td style="padding:5px 8px;text-align:right;color:#7c3aed;">${r.PRINTS_TRIGGERED || 0}</td>
                                    <td style="padding:5px 8px;text-align:right;color:#059669;">${r.PICK_RELEASES || 0}</td>
                                    <td style="padding:5px 8px;text-align:right;color:#d97706;">${r.NOTIFICATIONS_SENT || 0}</td>
                                    <td style="padding:5px 8px;text-align:right;color:#f59e0b;">${r.RETRIES_TOTAL || 0}</td>
                                    <td style="padding:5px 8px;text-align:right;color:#dc2626;">${r.ERRORS_TOTAL || 0}</td>
                                </tr>`).join('')}
                            </tbody>
                        </table>
                    </div>
                </div>`;
        } catch(e) {
            content.innerHTML = `<div style="color:#dc2626;font-size:12px;">${e.message}</div>`;
        }
    }

    function saStatCard(label, value, color, icon) {
        return `<div style="background:${color}12;border:1px solid ${color}30;border-radius:8px;padding:0.75rem;text-align:center;">
            <i class="fas ${icon}" style="color:${color};font-size:1.1rem;margin-bottom:0.3rem;display:block;"></i>
            <div style="font-size:1.4rem;font-weight:800;color:${color};">${value || 0}</div>
            <div style="font-size:10px;color:#64748b;font-weight:600;">${label}</div>
        </div>`;
    }

    // ─── Notifications Tab ───────────────────────────────────
    async function saLoadNotifications() {
        const agent = window._saCurrentAgent;
        if (!agent) return;
        const list = document.getElementById('sa-notifications-list');
        if (!list) return;
        list.innerHTML = `<div style="padding:1rem;text-align:center;color:#94a3b8;font-size:12px;"><i class="fas fa-spinner fa-spin"></i></div>`;
        try {
            const data  = await apexGet(`agents/${agent.ID}/notifications`);
            const notifs = data.items || [];
            if (notifs.length === 0) {
                list.innerHTML = `<div style="padding:2rem;text-align:center;color:#94a3b8;font-size:12px;">No notifications.</div>`;
                return;
            }
            const SEV_STYLE = {
                INFO:  { bg: '#eff6ff', color: '#1d4ed8', icon: 'fa-info-circle' },
                WARN:  { bg: '#fef9c3', color: '#a16207', icon: 'fa-exclamation-triangle' },
                ERROR: { bg: '#fee2e2', color: '#b91c1c', icon: 'fa-times-circle' }
            };
            list.innerHTML = notifs.map(n => {
                const s = SEV_STYLE[n.SEVERITY] || SEV_STYLE.INFO;
                return `<div style="background:${s.bg};border-radius:8px;padding:0.6rem 0.9rem;display:flex;gap:0.6rem;align-items:flex-start;">
                    <i class="fas ${s.icon}" style="color:${s.color};margin-top:2px;flex-shrink:0;"></i>
                    <div>
                        <div style="font-size:11px;font-weight:700;color:${s.color};">${esc(n.NOTIFICATION_TYPE)}</div>
                        <div style="font-size:11px;color:#374151;">${esc(n.MESSAGE)}</div>
                        <div style="font-size:10px;color:#94a3b8;">${n.TRIP_ID ? `Trip: ${esc(n.TRIP_ID)}` : ''} ${n.ORDER_NUMBER ? `· Order: ${esc(n.ORDER_NUMBER)}` : ''} · ${saFormatDate(n.SENT_DATE)}</div>
                    </div>
                </div>`;
            }).join('');
        } catch(e) {
            list.innerHTML = `<div style="color:#dc2626;font-size:12px;">${e.message}</div>`;
        }
    }

    // ─── Agent Controls ──────────────────────────────────────
    // Run config per trip: { [tripId]: { enabled, task1, task2, task3 } }
    window._saAgentRunConfig = window._saAgentRunConfig || {};

    window.saStartAgent = async function() {
        const agent = window._saCurrentAgent;
        if (!agent) return;

        document.getElementById('sa-start-dlg')?.remove();

        const trips = (window._saAgentTrips && window._saAgentTrips[agent.ID]) || [];

        // Build trip rows HTML
        const tripRows = trips.length === 0
            ? '<div style="color:#94a3b8;font-size:11px;padding:0.5rem;">No trips assigned to this agent.</div>'
            : trips.map(t => {
                const tid = esc(t.TRIP_ID);
                const tname = esc(t.TRIP_NAME || t.TRIP_ID);
                const tdate = t.TRIP_DATE ? esc(t.TRIP_DATE.split('T')[0]) : '';
                return `
                <div id="sa-dlg-trip-${tid}" style="border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;margin-bottom:0.5rem;">
                    <label style="display:flex;align-items:center;gap:0.5rem;padding:0.5rem 0.75rem;background:#f8fafc;cursor:pointer;font-weight:700;font-size:12px;color:#1e293b;">
                        <input type="checkbox" id="sa-dlg-trip-chk-${tid}" checked
                            onchange="saStartDlgToggleTrip('${tid}')"
                            style="width:15px;height:15px;accent-color:#7c3aed;">
                        <i class="fas fa-truck" style="color:#7c3aed;"></i>
                        ${tname}
                        ${tdate ? `<span style="font-weight:400;color:#64748b;font-size:10px;">— ${tdate}</span>` : ''}
                    </label>
                    <div id="sa-dlg-tasks-${tid}" style="padding:0.4rem 0.75rem 0.5rem 2.2rem;display:flex;flex-direction:column;gap:4px;background:white;">
                        ${[
                            ['task1','fa-search','Check Shipment Lines','Fetches latest shipment line statuses from Oracle Fusion'],
                            ['task2','fa-exclamation-triangle','Check Scheduled / Manual Reservations','Detects order lines stuck in Scheduled or Manual Reservations'],
                            ['task3','fa-print','Auto-Print Interfaced Orders','Downloads and prints PDFs for orders with Interfaced status']
                        ].map(([key,icon,label,desc]) => `
                        <label style="display:flex;align-items:flex-start;gap:0.5rem;cursor:pointer;font-size:11px;color:#334155;">
                            <input type="checkbox" id="sa-dlg-${key}-${tid}" checked
                                style="margin-top:2px;width:13px;height:13px;accent-color:#7c3aed;">
                            <span>
                                <i class="fas ${icon}" style="color:#7c3aed;width:12px;"></i>
                                <strong>${label}</strong>
                                <span style="color:#94a3b8;display:block;font-size:9px;margin-top:1px;">${desc}</span>
                            </span>
                        </label>`).join('')}
                    </div>
                </div>`;
            }).join('');

        const dlg = document.createElement('div');
        dlg.id = 'sa-start-dlg';
        dlg.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:99999;display:flex;align-items:center;justify-content:center;';
        dlg.innerHTML = `
            <div style="background:white;border-radius:14px;width:480px;max-height:85vh;display:flex;flex-direction:column;box-shadow:0 24px 80px rgba(0,0,0,0.35);overflow:hidden;">
                <div style="padding:0.9rem 1.2rem;background:#0f172a;display:flex;justify-content:space-between;align-items:center;flex-shrink:0;">
                    <span style="font-weight:800;font-size:14px;color:#a78bfa;"><i class="fas fa-play-circle"></i> Start Agent — ${esc(agent.NAME)}</span>
                    <button onclick="document.getElementById('sa-start-dlg').remove()" style="background:none;border:none;color:#94a3b8;font-size:18px;cursor:pointer;">×</button>
                </div>

                <div style="overflow-y:auto;padding:1rem 1.2rem;flex:1;">

                    <!-- SECTION 1: Interval -->
                    <div style="margin-bottom:1rem;">
                        <div style="font-size:10px;font-weight:800;color:#7c3aed;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:0.5rem;">
                            <i class="fas fa-clock"></i> &nbsp;1 — Refresh Interval
                        </div>
                        <div style="display:flex;gap:0.4rem;flex-wrap:wrap;">
                            ${[['5 min',300],['10 min',600],['15 min',900],['30 min',1800],['60 min',3600]].map(([label,secs]) => `
                            <button id="sa-dlg-int-${secs}" onclick="saStartDlgSelectInterval(${secs})"
                                style="padding:0.4rem 0.8rem;border:2px solid #e2e8f0;border-radius:8px;background:white;cursor:pointer;font-size:11px;font-weight:700;color:#475569;transition:all 0.15s;">
                                ${label}
                            </button>`).join('')}
                        </div>
                        <div id="sa-dlg-int-warn" style="font-size:9px;color:#ef4444;margin-top:4px;display:none;">Please select an interval.</div>
                    </div>

                    <!-- SECTION 2: Trips & Tasks -->
                    <div>
                        <div style="font-size:10px;font-weight:800;color:#7c3aed;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:0.5rem;">
                            <i class="fas fa-truck"></i> &nbsp;2 — Trips &amp; Tasks
                        </div>
                        ${tripRows}
                    </div>

                </div>

                <div style="padding:0.75rem 1.2rem;border-top:1px solid #f1f5f9;display:flex;justify-content:flex-end;gap:0.5rem;flex-shrink:0;background:#fafafa;">
                    <button onclick="document.getElementById('sa-start-dlg').remove()"
                        style="padding:0.45rem 1rem;border:1px solid #e2e8f0;border-radius:8px;background:white;cursor:pointer;font-size:12px;font-weight:600;color:#64748b;">
                        Cancel
                    </button>
                    <button onclick="saConfirmStartAgent()"
                        style="padding:0.45rem 1.2rem;border:none;border-radius:8px;background:#7c3aed;cursor:pointer;font-size:12px;font-weight:700;color:white;">
                        <i class="fas fa-play"></i> Start Agent
                    </button>
                </div>
            </div>`;
        document.body.appendChild(dlg);

        // Pre-select 5min interval
        saStartDlgSelectInterval(300);
    };

    window._saStartDlgInterval = 300;

    window.saStartDlgSelectInterval = function(secs) {
        window._saStartDlgInterval = secs;
        [300,600,900,1800,3600].forEach(s => {
            const btn = document.getElementById(`sa-dlg-int-${s}`);
            if (!btn) return;
            if (s === secs) {
                btn.style.borderColor = '#7c3aed';
                btn.style.background  = '#f5f3ff';
                btn.style.color       = '#7c3aed';
            } else {
                btn.style.borderColor = '#e2e8f0';
                btn.style.background  = 'white';
                btn.style.color       = '#475569';
            }
        });
        document.getElementById('sa-dlg-int-warn').style.display = 'none';
    };

    window.saStartDlgToggleTrip = function(tripId) {
        const enabled = document.getElementById(`sa-dlg-trip-chk-${tripId}`)?.checked;
        const tasksDiv = document.getElementById(`sa-dlg-tasks-${tripId}`);
        if (tasksDiv) {
            tasksDiv.style.opacity  = enabled ? '1' : '0.35';
            tasksDiv.style.pointerEvents = enabled ? '' : 'none';
        }
    };

    window.saConfirmStartAgent = async function() {
        const agent = window._saCurrentAgent;
        if (!agent) return;

        const intervalSeconds = window._saStartDlgInterval || 300;
        if (!intervalSeconds) {
            document.getElementById('sa-dlg-int-warn').style.display = 'block';
            return;
        }

        // Build run config from dialog checkboxes
        const trips = (window._saAgentTrips && window._saAgentTrips[agent.ID]) || [];
        window._saAgentRunConfig = {};
        trips.forEach(t => {
            const tid = t.TRIP_ID;
            window._saAgentRunConfig[tid] = {
                enabled : !!(document.getElementById(`sa-dlg-trip-chk-${tid}`)?.checked),
                task1   : !!(document.getElementById(`sa-dlg-task1-${tid}`)?.checked),
                task2   : !!(document.getElementById(`sa-dlg-task2-${tid}`)?.checked),
                task3   : !!(document.getElementById(`sa-dlg-task3-${tid}`)?.checked),
            };
        });

        document.getElementById('sa-start-dlg').remove();

        try {
            await apexPut(`agents/${agent.ID}/status`, { status: 'RUNNING', checkIntervalSeconds: intervalSeconds });
            agent.STATUS = 'RUNNING';
            agent.CHECK_INTERVAL_SECONDS = intervalSeconds;
            saUpdateDetailStatusBadge('RUNNING');
            saRenderCards(window._saAgents);
            saStartAgentLoop(agent, intervalSeconds);
            const intervalLabel = intervalSeconds >= 3600 ? intervalSeconds/3600+'h' : intervalSeconds/60+'min';
            showNotification(`Agent "${agent.NAME}" started — every ${intervalLabel}.`, 'success');
            saShowControlPanel(agent);
        } catch(e) {
            showNotification('Failed to start agent: ' + e.message, 'error');
        }
    };

    window.saPauseAgent = async function() {
        const agent = window._saCurrentAgent;
        if (!agent) return;
        try {
            await apexPut(`agents/${agent.ID}/status`, { status: 'PAUSED' });
            agent.STATUS = 'PAUSED';
            saUpdateDetailStatusBadge('PAUSED');
            saStopAgentLoop(agent.ID);
            saRenderCards(window._saAgents);
            showNotification(`Agent "${agent.NAME}" paused.`, 'success');
        } catch(e) {
            showNotification('Failed to pause agent: ' + e.message, 'error');
        }
    };

    window.saStopAgent = async function() {
        const agent = window._saCurrentAgent;
        if (!agent) return;
        if (!confirm(`Stop agent "${agent.NAME}"? This will set it to IDLE.`)) return;
        try {
            await apexPut(`agents/${agent.ID}/status`, { status: 'IDLE' });
            agent.STATUS = 'IDLE';
            saUpdateDetailStatusBadge('IDLE');
            saStopAgentLoop(agent.ID);
            saRenderCards(window._saAgents);
            showNotification(`Agent "${agent.NAME}" stopped.`, 'success');
        } catch(e) {
            showNotification('Failed to stop agent: ' + e.message, 'error');
        }
    };

    window.saShowCloseAgentApiInfo = function() {
        const agent = window._saCurrentAgent;
        const agentId = agent ? agent.ID : ':agentId';
        const url = `${APEX_BASE}/agents/${agentId}/close`;
        saShowApiInfo('Close Agent API', 'POST', url, '{}', 'URI Template: agents/:agentId/close\nSets AGENT_STATUS=CLOSED permanently in wms_agents');
    };

    window.saCloseAgent = async function() {
        const agent = window._saCurrentAgent;
        if (!agent) return;
        const closeUrl = `${APEX_BASE}/agents/${agent.ID}/close`;
        console.log('[ShippingAgent] Close agent URL:', closeUrl);
        if (!confirm(`Close agent "${agent.NAME}"?\n\nThis will permanently set its status to CLOSED. It will no longer appear in the active agents list.\n\nYou can still view its history but it cannot be restarted.`)) return;
        try {
            await apexPost(`agents/${agent.ID}/close`, {});
            agent.AGENT_STATUS = 'CLOSED';
            agent.STATUS       = 'IDLE';
            saStopAgentLoop(agent.ID);
            // Update Close button to reflect closed state
            const closeBtn = document.getElementById('sa-btn-close-agent');
            if (closeBtn) {
                closeBtn.disabled = true;
                closeBtn.style.opacity = '0.5';
                closeBtn.innerHTML = '<i class="fas fa-times-circle"></i> Closed';
            }
            saUpdateDetailStatusBadge('IDLE');
            saRenderCards(window._saAgents);
            await saRefreshDashboard();
            showNotification(`Agent "${agent.NAME}" has been closed.`, 'success');
        } catch(e) {
            showNotification(`Failed to close agent: ${e.message} | URL: ${closeUrl}`, 'error');
            console.error('[ShippingAgent] Close agent failed:', closeUrl, e);
        }
    };

    // Per-trip pause state: { tripId: true/false }
    window._saPausedTrips = window._saPausedTrips || {};

    // ─── Control Panel ───────────────────────────────────────
    window.saShowControlPanel = async function(agent) {
        const existing = document.getElementById('sa-control-panel');
        if (existing) existing.remove();

        const trips = (window._saAgentTrips && window._saAgentTrips[agent.ID]) || [];
        const intervalSec = agent.CHECK_INTERVAL_SECONDS || 60;
        const intervalLabel = intervalSec >= 3600 ? intervalSec/3600+'h' : intervalSec/60+'min';

        const panel = document.createElement('div');
        panel.id = 'sa-control-panel';
        panel.style.cssText = 'position:fixed;bottom:0;left:0;right:0;background:#0f172a;color:#e2e8f0;z-index:9999;border-top:2px solid #7c3aed;font-size:11px;';
        panel.innerHTML = `
            <div style="display:flex;align-items:center;gap:1rem;padding:0.5rem 1rem;border-bottom:1px solid #1e293b;flex-wrap:wrap;">
                <span style="font-weight:800;color:#a78bfa;font-size:12px;"><i class="fas fa-robot"></i> ${esc(agent.NAME)}</span>
                <span id="sa-cp-status" style="background:#059669;color:white;padding:1px 8px;border-radius:8px;font-size:10px;font-weight:700;">RUNNING</span>
                <span style="color:#64748b;font-size:10px;"><i class="fas fa-clock"></i> Every ${intervalLabel}</span>
                <span id="sa-cp-countdown" style="color:#f59e0b;font-size:10px;font-weight:700;"></span>
                <span id="sa-cp-last-tick" style="color:#64748b;font-size:9px;"></span>
                <span id="sa-cp-task" style="color:#38bdf8;font-size:9px;font-style:italic;"></span>
                <div style="margin-left:auto;display:flex;gap:0.4rem;">
                    <button onclick="saPauseAgent()" style="background:#d97706;color:white;border:none;padding:3px 10px;border-radius:6px;font-size:10px;cursor:pointer;font-weight:700;"><i class="fas fa-pause"></i> Pause All</button>
                    <button onclick="saStopAgent()" style="background:#dc2626;color:white;border:none;padding:3px 10px;border-radius:6px;font-size:10px;cursor:pointer;font-weight:700;"><i class="fas fa-stop"></i> Stop</button>
                    <button onclick="document.getElementById('sa-control-panel').remove()" style="background:#334155;color:#94a3b8;border:none;padding:3px 8px;border-radius:6px;font-size:10px;cursor:pointer;">▼ Hide</button>
                </div>
            </div>
            <div style="display:flex;gap:0;overflow-x:auto;" id="sa-cp-trips">
                ${trips.length === 0
                    ? '<div style="padding:0.75rem 1rem;color:#64748b;font-size:11px;">No trips assigned</div>'
                    : trips.map(t => saRenderCpTrip(t, agent.ID)).join('')}
            </div>`;
        document.body.appendChild(panel);

        // Start countdown timer
        saStartCpCountdown(agent);

        // Immediately fetch fresh print status for each active trip, then refresh KPIs
        const runCfg = window._saAgentRunConfig || {};
        for (const t of trips) {
            const cfg = runCfg[t.TRIP_ID] || { enabled: true };
            if (!cfg.enabled) continue;
            const tripInst = t.INSTANCE_NAME || t.instance_name || agent.INSTANCE_NAME || 'PROD';
            try { await saGetPrintStatus(t.TRIP_ID, tripInst); } catch(e) { /* non-fatal */ }
        }
        saUpdateCpKpis();
    };

    function saRenderCpTrip(t, agentId) {
        const paused = window._saPausedTrips[t.TRIP_ID];
        const kpi = saCpComputeKpi(t.TRIP_ID);
        const agent = window._saCurrentAgent;
        const instance = t.INSTANCE_NAME || t.instance_name || (agent && agent.INSTANCE_NAME) || 'PROD';
        const printUrl = `${APEX_BASE}/printjobs/trip/${encodeURIComponent(t.TRIP_ID)}`;
        return `<div id="sa-cp-trip-${esc(t.TRIP_ID)}" style="border-right:1px solid #1e293b;padding:0.5rem 0.8rem;min-width:240px;flex-shrink:0;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.35rem;gap:4px;">
                <span style="font-weight:700;color:#e2e8f0;font-size:11px;"><i class="fas fa-truck" style="color:#7c3aed;"></i> ${esc(t.TRIP_NAME || t.TRIP_ID)}</span>
                <div style="display:flex;gap:3px;align-items:center;">
                    <button onclick="saCpRefreshTrip('${esc(t.TRIP_ID)}','${esc(instance)}')" title="Refresh print status"
                        style="background:#1e40af;color:white;border:none;padding:1px 6px;border-radius:5px;font-size:9px;cursor:pointer;" id="sa-cp-refresh-${esc(t.TRIP_ID)}">
                        <i class="fas fa-sync-alt"></i>
                    </button>
                    <button onclick="saShowApiInfo('Print Status API','GET','${esc(printUrl)}',null,'printjobs/trip/:tripId\\nReturns all orders with print_total and print_printed for the trip')"
                        title="API info" style="background:#0e7490;color:white;border:none;padding:1px 6px;border-radius:5px;font-size:9px;cursor:pointer;">
                        <i class="fas fa-plug"></i>
                    </button>
                    <button onclick="saToggleTripPause('${esc(t.TRIP_ID)}')" id="sa-cp-pause-${esc(t.TRIP_ID)}"
                        style="background:${paused?'#059669':'#d97706'};color:white;border:none;padding:1px 7px;border-radius:5px;font-size:9px;cursor:pointer;font-weight:700;">
                        ${paused ? '<i class="fas fa-play"></i> Resume' : '<i class="fas fa-pause"></i> Pause'}
                    </button>
                </div>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:2px;" id="sa-cp-kpi-${esc(t.TRIP_ID)}">
                ${saRenderCpKpis(kpi)}
            </div>
        </div>`;
    }

    window.saCpRefreshTrip = async function(tripId, instance) {
        const btn = document.getElementById(`sa-cp-refresh-${tripId}`);
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>'; }
        try {
            await saGetPrintStatus(tripId, instance);
            console.log(`[ShippingAgent] CP refresh — cache for ${tripId}:`, JSON.stringify(window._saPrintCache[tripId]));
            const kpiEl = document.getElementById(`sa-cp-kpi-${tripId}`);
            if (kpiEl) kpiEl.innerHTML = saRenderCpKpis(saCpComputeKpi(tripId));
        } catch(e) { console.error('[ShippingAgent] CP refresh failed:', e); }
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-sync-alt"></i>'; }
    };

    function saRenderCpKpis(kpi) {
        const chip = (label, val, color) =>
            `<div style="background:#1e293b;border-radius:4px;padding:3px 5px;">
                <div style="font-size:8px;color:#64748b;">${label}</div>
                <div style="font-weight:700;color:${color};font-size:11px;">${val}</div>
            </div>`;
        const done = (a, b) => b > 0 && a === b;
        return chip('Interfaced',  done(kpi.interfaced,kpi.total) ? '✓ '+kpi.total : `${kpi.interfaced}/${kpi.total}`, done(kpi.interfaced,kpi.total)?'#4ade80':'#f59e0b')
             + chip('Downloaded', done(kpi.printed,kpi.total)    ? '✓ '+kpi.total : `${kpi.printed}/${kpi.total}`,    done(kpi.printed,kpi.total)?'#4ade80':'#94a3b8')
             + chip('Ifc Lines', done(kpi.ifcLines,kpi.totalLines) ? '✓ '+kpi.totalLines : `${kpi.ifcLines}/${kpi.totalLines}`, done(kpi.ifcLines,kpi.totalLines)?'#4ade80':'#38bdf8')
             + chip('To Cancel', `${kpi.toCancel}`, kpi.toCancel>0?'#f87171':'#4ade80');
    }

    function saCpComputeKpi(tripId) {
        const container = document.getElementById(`sa-trip-orders-${tripId}`);
        let total=0, interfaced=0, ifcLines=0, totalLines=0, toCancel=0;
        const orderNumbers = [];
        if (container) {
            container.querySelectorAll('tr[id^="sa-order-row-"]').forEach(row => {
                total++;
                const on  = row.id.replace(`sa-order-row-${tripId}-`, '');
                if (on) orderNumbers.push(on);
                const st  = (row.querySelector('[data-col="status"]')?.textContent || '').trim();
                const ifc = parseInt(row.querySelector('[data-col="shipping"]')?.textContent?.match(/\d+/)?.[0] || 0);
                const tl  = parseInt(row.querySelector('[data-col="shipping"]')?.textContent?.match(/\/(\d+)/)?.[1] || 0);
                if ((st.includes('Interfaced') || st.includes('Shipped')) && !st.includes('/')) interfaced++;
                ifcLines  += ifc;
                totalLines += tl;
                toCancel  += parseInt(row.querySelector('[data-col="backorder"]')?.textContent?.match(/\d+/)?.[0] || 0);
            });
        }
        // Use cached print data from API — presence in wms_print_jobs = downloaded = done
        const printMap = window._saPrintCache && window._saPrintCache[tripId] || {};
        let printed = 0;
        orderNumbers.forEach(on => {
            const info = printMap[on];
            if (info && info.total > 0) printed++; // downloaded = done
        });
        console.log(`[ShippingAgent] KPI trip=${tripId} domOrders=${JSON.stringify(orderNumbers.slice(0,3))} cacheKeys=${JSON.stringify(Object.keys(printMap).slice(0,3))} printed=${printed}`);
        // If no orders in DOM yet but cache has data, use cache length as total
        const printTotal = Object.keys(printMap).length;
        const printPrinted = Object.values(printMap).filter(v => v.total > 0).length;
        if (total === 0 && printTotal > 0) {
            return { total: printTotal, interfaced: 0, printed: printPrinted, ifcLines: 0, totalLines: 0, toCancel: 0 };
        }
        return { total, interfaced, printed, ifcLines, totalLines, toCancel };
    }

    window.saToggleTripPause = function(tripId) {
        window._saPausedTrips = window._saPausedTrips || {};
        window._saPausedTrips[tripId] = !window._saPausedTrips[tripId];
        const paused = window._saPausedTrips[tripId];
        const btn = document.getElementById(`sa-cp-pause-${tripId}`);
        if (btn) {
            btn.style.background = paused ? '#059669' : '#d97706';
            btn.innerHTML = paused ? '<i class="fas fa-play"></i> Resume' : '<i class="fas fa-pause"></i> Pause';
        }
        showNotification(`Trip ${tripId} ${paused ? 'paused' : 'resumed'}.`, 'info');
    };

    async function saUpdateCpKpis() {
        const agent = window._saCurrentAgent;
        if (!agent) return;
        const trips = (window._saAgentTrips && window._saAgentTrips[agent.ID]) || [];
        const instance = agent.INSTANCE_NAME || 'PROD';
        const runCfg = window._saAgentRunConfig || {};
        // Refresh print cache from API for each active trip
        for (const t of trips) {
            const cfg = runCfg[t.TRIP_ID] || { enabled: true };
            if (!cfg.enabled) continue;
            const tripInst = t.INSTANCE_NAME || t.instance_name || agent.INSTANCE_NAME || 'PROD';
            try { await saGetPrintStatus(t.TRIP_ID, tripInst); } catch(e) { /* non-fatal */ }
        }
        trips.forEach(t => {
            const kpiEl = document.getElementById(`sa-cp-kpi-${t.TRIP_ID}`);
            if (kpiEl) kpiEl.innerHTML = saRenderCpKpis(saCpComputeKpi(t.TRIP_ID));
        });
    }

    function saStartCpCountdown(agent) {
        clearInterval(window._saCpCountdown);
        const totalSec = agent.CHECK_INTERVAL_SECONDS || 60;
        let remaining = totalSec;
        window._saCpCountdown = setInterval(() => {
            remaining--;
            if (remaining <= 0) remaining = totalSec;
            const el = document.getElementById('sa-cp-countdown');
            if (el) el.textContent = `Next tick in ${remaining}s`;
        }, 1000);
    }

    function saCpSetTask(msg) {
        const el = document.getElementById('sa-cp-task');
        if (el) el.textContent = msg ? `▶ ${msg}` : '';
    }

    // Check if all trips are done (all orders Interfaced + all printed)
    function saCheckAllDone(agent) {
        const trips = (window._saAgentTrips && window._saAgentTrips[agent.ID]) || [];
        if (trips.length === 0) return false;
        let allDone = true;
        for (const t of trips) {
            if (window._saPausedTrips && window._saPausedTrips[t.TRIP_ID]) continue;
            const kpi = saCpComputeKpi(t.TRIP_ID);
            if (kpi.total === 0) { allDone = false; break; }
            if (kpi.interfaced < kpi.total || kpi.printed < kpi.total) { allDone = false; break; }
        }
        return allDone;
    }

    // ─── Agent Loop ──────────────────────────────────────────
    function saStartAgentLoop(agent, overrideIntervalSeconds) {
        saStopAgentLoop(agent.ID); // clear any existing
        const intervalMs = Math.max((overrideIntervalSeconds || agent.CHECK_INTERVAL_SECONDS || 300), 300) * 1000;
        agent.CHECK_INTERVAL_SECONDS = Math.round(intervalMs / 1000);
        window._saLoops[agent.ID] = setInterval(() => {
            saAgentTick(agent); // saAgentTick calls saUpdateCpKpis internally
        }, intervalMs);
        console.log(`[ShippingAgent] Loop started for agent ${agent.ID}, interval ${intervalMs}ms`);
        // Run immediately
        saAgentTick(agent);
    }

    function saStopAgentLoop(agentId) {
        if (window._saLoops[agentId]) {
            clearInterval(window._saLoops[agentId]);
            delete window._saLoops[agentId];
            console.log(`[ShippingAgent] Loop stopped for agent ${agentId}`);
        }
    }

    async function saAgentTick(agent) {
        const tickTime = new Date().toLocaleTimeString();
        console.log(`[ShippingAgent] ⏱ Tick at ${tickTime} for agent ${agent.ID} (${agent.NAME})`);
        const el = document.getElementById('sa-cp-last-tick');
        if (el) el.textContent = `Last tick: ${tickTime}`;

        const trips = (window._saAgentTrips && window._saAgentTrips[agent.ID]) || [];

        for (const trip of trips) {
            const cfg = (window._saAgentRunConfig && window._saAgentRunConfig[trip.TRIP_ID]) || { enabled:true, task1:true, task2:true, task3:true };
            if (!cfg.enabled) {
                console.log(`[ShippingAgent] Trip ${trip.TRIP_ID} not in run config — skipping`);
                continue;
            }
            if (window._saPausedTrips && window._saPausedTrips[trip.TRIP_ID]) {
                console.log(`[ShippingAgent] Trip ${trip.TRIP_ID} is paused — skipping`);
                continue;
            }
            // Use trip's own instance name (PROD/TEST), fall back to agent's
            const instance = trip.INSTANCE_NAME || trip.instance_name || agent.INSTANCE_NAME || 'PROD';
            await saProcessTripTick(agent, trip, instance, cfg);
        }

        await saUpdateCpKpis();
        saCpSetTask('');

        if (window._saCurrentAgent && window._saCurrentAgent.ID === agent.ID) {
            const actTab = document.getElementById('sa-tab-activity');
            if (actTab && actTab.style.display !== 'none') saRefreshActivity();
        }

        // Auto-stop if all work is done
        if (saCheckAllDone(agent)) {
            saStopAgentLoop(agent.ID);
            clearInterval(window._saCpCountdown);
            saCpSetTask('✅ All tasks completed');
            const statusEl = document.getElementById('sa-cp-status');
            if (statusEl) { statusEl.textContent = 'COMPLETED'; statusEl.style.background = '#059669'; }
            const countdownEl = document.getElementById('sa-cp-countdown');
            if (countdownEl) countdownEl.textContent = '';
            try { await apexPut(`agents/${agent.ID}/status`, { status: 'IDLE' }); agent.STATUS = 'IDLE'; saUpdateDetailStatusBadge('IDLE'); saRenderCards(window._saAgents); } catch(e) {}
            saShowCompletionDialog(agent);
        }
    }

    function saShowCompletionDialog(agent) {
        document.getElementById('sa-completion-dlg')?.remove();

        const trips = (window._saAgentTrips && window._saAgentTrips[agent.ID]) || [];
        const runCfg = window._saAgentRunConfig || {};
        const completedAt = new Date().toLocaleTimeString();

        const tripSummaryRows = trips.map(t => {
            const cfg = runCfg[t.TRIP_ID] || { enabled:true, task1:true, task2:true, task3:true };
            if (!cfg.enabled) return '';
            const kpi = saCpComputeKpi(t.TRIP_ID);
            const tasksDone = [
                cfg.task1 ? `<span style="color:#4ade80;"><i class="fas fa-check"></i> Shipment Lines checked (${kpi.ifcLines}/${kpi.totalLines} interfaced)</span>` : '',
                cfg.task2 ? `<span style="color:#4ade80;"><i class="fas fa-check"></i> Scheduled / Manual Reservations checked</span>` : '',
                cfg.task3 ? `<span style="color:#4ade80;"><i class="fas fa-check"></i> All ${kpi.printed} order(s) printed</span>` : '',
            ].filter(Boolean).join('<br>');
            return `
                <div style="border:1px solid #1e293b;border-radius:8px;padding:0.6rem 0.8rem;margin-bottom:0.5rem;background:#0f172a;">
                    <div style="font-weight:700;color:#a78bfa;font-size:11px;margin-bottom:0.35rem;">
                        <i class="fas fa-truck"></i> Trip ${esc(t.TRIP_NAME || t.TRIP_ID)}
                        <span style="color:#4ade80;margin-left:0.5rem;font-size:10px;">✓ ${kpi.interfaced}/${kpi.total} Interfaced &nbsp; ✓ ${kpi.printed}/${kpi.total} Printed</span>
                    </div>
                    <div style="font-size:10px;line-height:1.9;">${tasksDone}</div>
                </div>`;
        }).join('');

        const dlg = document.createElement('div');
        dlg.id = 'sa-completion-dlg';
        dlg.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:99999;display:flex;align-items:center;justify-content:center;';
        dlg.innerHTML = `
            <div style="background:#1e293b;border-radius:14px;width:460px;max-height:80vh;display:flex;flex-direction:column;box-shadow:0 24px 80px rgba(0,0,0,0.5);overflow:hidden;border:2px solid #4ade80;">
                <div style="padding:1rem 1.2rem;background:#0f172a;display:flex;align-items:center;gap:0.75rem;">
                    <span style="font-size:22px;">🎉</span>
                    <div>
                        <div style="font-weight:800;font-size:13px;color:#4ade80;">All Tasks Completed — Agent Stopped</div>
                        <div style="font-size:10px;color:#64748b;margin-top:2px;">${esc(agent.NAME)} &nbsp;·&nbsp; Completed at ${completedAt}</div>
                    </div>
                </div>
                <div style="overflow-y:auto;padding:1rem;">
                    <div style="font-size:10px;color:#94a3b8;margin-bottom:0.75rem;">
                        The following tasks were completed for all active trips. The agent has been stopped automatically.
                    </div>
                    ${tripSummaryRows || '<div style="color:#64748b;font-size:11px;">No active trips.</div>'}
                </div>
                <div style="padding:0.75rem 1.2rem;border-top:1px solid #0f172a;display:flex;justify-content:flex-end;gap:0.5rem;background:#0f172a;">
                    <button onclick="document.getElementById('sa-completion-dlg').remove()"
                        style="padding:0.45rem 1.2rem;border:none;border-radius:8px;background:#4ade80;cursor:pointer;font-size:12px;font-weight:700;color:#0f172a;">
                        <i class="fas fa-check"></i> OK
                    </button>
                </div>
            </div>`;
        document.body.appendChild(dlg);
    }

    async function saProcessTripTick(agent, trip, instance, cfg) {
        cfg = cfg || { task1:true, task2:true, task3:true };
        const tripId  = trip.TRIP_ID;
        const t0      = Date.now();
        console.log(`[ShippingAgent] Processing trip ${tripId}`);

        // Collect order rows from the rendered table
        const container = document.getElementById(`sa-trip-orders-${tripId}`);
        if (!container || container.dataset.loaded !== '1') {
            console.log(`[ShippingAgent] Trip ${tripId} orders not loaded yet — skipping`);
            return;
        }
        const orderRows = Array.from(container.querySelectorAll('tr[id^="sa-order-row-"]'));
        if (orderRows.length === 0) return;

        // ── TASK 1: Check Shipment Lines (Fusion) ───────────
        if (!cfg.task1) { console.log(`[ShippingAgent] Task 1 disabled for trip ${tripId}`); }
        else {
        saCpSetTask(`Task 1: Checking shipment lines — Trip ${tripId}`);
        console.log(`[ShippingAgent] Task 1: Get Shipment Lines for trip ${tripId}`);
        try {
            await saGetAllShipmentLines(tripId, instance);
            await saLogActivity(agent.ID, tripId, null, 'CHECK_STATUS', 'SUCCESS', orderRows.length,
                `Shipment lines checked for ${orderRows.length} order(s)`, null, Date.now()-t0);
        } catch(e) {
            await saLogActivity(agent.ID, tripId, null, 'CHECK_STATUS', 'FAILED', 1, e.message, null, Date.now()-t0);
        }

        } // end task1

        // ── TASK 2: Check Order Lines for Scheduled / Manual Reservations ──
        if (!cfg.task2) { console.log(`[ShippingAgent] Task 2 disabled for trip ${tripId}`); }
        else {
        saCpSetTask(`Task 2: Checking order lines for Scheduled/Manual Reservations — Trip ${tripId}`);
        console.log(`[ShippingAgent] Task 2: Check order line statuses for trip ${tripId}`);

        // Collect all lines needing cancellation grouped by order
        const cancelGroups = {}; // { orderNumber: [ line, ... ] }
        for (const row of orderRows) {
            const orderNumber = row.id.replace(`sa-order-row-${tripId}-`, '');
            if (!orderNumber) continue;
            saCpSetTask(`Task 2: Fetching lines for ${orderNumber}`);
            try {
                const olData = await apexGet(`trip/orders/getsalesorderlines/${encodeURIComponent(orderNumber)}?P_INSTANCE_NAME=${instance}`);
                const lines  = (olData.items || []);
                const toCancel = lines.filter(l => {
                    const s = (l.LINE_STATUS || l.line_status || l.STATUS || l.status || '').toString().toUpperCase();
                    return s.includes('SCHEDULED') || s.includes('MANUAL') || s.includes('RESERVATION');
                });
                if (toCancel.length > 0) {
                    cancelGroups[orderNumber] = toCancel;
                    await saLogActivity(agent.ID, tripId, orderNumber, 'ANOMALY_DETECT', 'SUCCESS', toCancel.length,
                        `Order ${orderNumber}: ${toCancel.length} line(s) need cancellation (Scheduled/Manual Reservations)`, null, null);
                }
            } catch(e) { console.warn(`[ShippingAgent] Task 2 error for ${orderNumber}:`, e.message); }
        }

        const totalToCancel = Object.values(cancelGroups).reduce((s, arr) => s + arr.length, 0);
        if (totalToCancel > 0) {
            await saLogNotification(agent.ID, tripId, null, 'ANOMALY',
                `Trip ${tripId}: ${totalToCancel} line(s) across ${Object.keys(cancelGroups).length} order(s) need cancellation`, 'WARN');
            // Show review dialog — user confirms before cancellation runs
            saCpSetTask(`Task 2: ⚠ ${totalToCancel} line(s) need cancellation — review dialog open`);
            await saShowCancelReviewDialog(agent, tripId, instance, cancelGroups);
        }

        } // end task2

        // ── TASK 3: Auto-Print Interfaced Orders ─────────────
        if (!cfg.task3) { console.log(`[ShippingAgent] Task 3 disabled for trip ${tripId}`); }
        else {
        saCpSetTask(`Task 3: Auto-printing interfaced orders — Trip ${tripId}`);
        console.log(`[ShippingAgent] Task 3: Auto-print interfaced orders for trip ${tripId}`);
        let autoPrinted = 0;
        for (const row of orderRows) {
            const orderNumber = row.id.replace(`sa-order-row-${tripId}-`, '');
            if (!orderNumber) continue;
            const statusText = (row.querySelector('[data-col="status"]')?.textContent || '').trim();
            const printText  = (row.querySelector('[data-col="print"]')?.textContent  || '').trim();

            // Parse print_printed / print_total from cell (format: "X/Y" or "No Jobs" or "Printed X/X")
            const printMatch = printText.match(/(\d+)\/(\d+)/);
            const printTotal   = printMatch ? parseInt(printMatch[2]) : 0;
            const printPrinted = printMatch ? parseInt(printMatch[1]) : 0;

            // Skip if already downloaded (print_total > 0 means PDF exists in wms_print_jobs)
            if (printTotal > 0) {
                console.log(`[ShippingAgent] Order ${orderNumber} already downloaded (${printPrinted}/${printTotal}) — skipping download`);
                continue;
            }

            // Only print if fully Interfaced or Shipped and not yet downloaded/printed
            const readyToPrint = statusText === 'Interfaced' || statusText === 'Shipped' || statusText.includes('Shipped');
            if (readyToPrint) {
                console.log(`[ShippingAgent] Auto-printing interfaced order ${orderNumber}`);
                saCpSetTask(`Task 3: Printing ${orderNumber} — Trip ${tripId}`);
                try {
                    await saPrintOrder(orderNumber, tripId, '', instance, true); // silent=true
                    autoPrinted++;
                    await saLogActivity(agent.ID, tripId, orderNumber, 'AUTO_PRINT', 'SUCCESS', 1,
                        `Auto-printed interfaced order ${orderNumber}`, null, null);
                } catch(e) {
                    await saLogActivity(agent.ID, tripId, orderNumber, 'AUTO_PRINT', 'FAILED', 1,
                        `Auto-print failed for ${orderNumber}: ${e.message}`, null, null);
                }
            }
        }
        if (autoPrinted > 0) {
            await saGetPrintStatus(tripId, instance);  // refresh print column after batch print
            showNotification(`Auto-printed ${autoPrinted} order(s) for trip ${tripId}.`, 'success');
        }
        } // end task3
    }

    // ─── Cancel Review Dialog ─────────────────────────────────
    // Shows lines needing cancellation grouped by order. User reviews and confirms.
    // cancelGroups: { orderNumber: [ lineObj, ... ] }
    function saShowCancelReviewDialog(agent, tripId, instance, cancelGroups) {
        return new Promise(resolve => {
            document.getElementById('sa-cancel-review-dlg')?.remove();

            const orders = Object.keys(cancelGroups).sort();
            const totalLines = orders.reduce((s, o) => s + cancelGroups[o].length, 0);
            const cancelUrl = (orderNumber) =>
                `${APEX_BASE}/trip/orders/cancelscheduledlines/${encodeURIComponent(orderNumber)}?P_INSTANCE_NAME=${instance}`;

            const orderRows = orders.map(orderNumber => {
                const lines = cancelGroups[orderNumber];
                const lineRows = lines.map(l => {
                    const lineNum   = l.LINE_NUMBER   || l.line_number   || l.LINE_ID   || l.line_id   || '—';
                    const item      = l.ITEM_NUMBER   || l.item_number   || l.ITEM      || l.item      || '—';
                    const desc      = l.ITEM_DESC     || l.item_desc     || l.DESCRIPTION || l.description || '';
                    const status    = l.LINE_STATUS   || l.line_status   || l.STATUS    || l.status    || '—';
                    const qty       = l.ORDERED_QTY   || l.ordered_qty   || l.QTY       || l.qty       || '—';
                    const fulfillId = l.SOURCE_FULFILLMENT_LINE_ID || l.source_fulfillment_line_id ||
                                      l.FULFILLMENT_LINE_ID || l.fulfillment_line_id || '—';
                    return `<tr style="border-bottom:1px solid #1e293b;">
                        <td style="padding:4px 6px;color:#f59e0b;font-size:10px;">${esc(String(lineNum))}</td>
                        <td style="padding:4px 6px;font-size:10px;">${esc(String(item))}</td>
                        <td style="padding:4px 6px;font-size:9px;color:#94a3b8;max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(String(desc))}</td>
                        <td style="padding:4px 6px;font-size:10px;"><span style="background:#7f1d1d;color:#fca5a5;padding:1px 6px;border-radius:4px;">${esc(String(status))}</span></td>
                        <td style="padding:4px 6px;font-size:10px;text-align:right;">${esc(String(qty))}</td>
                        <td style="padding:4px 6px;font-size:9px;color:#64748b;">${esc(String(fulfillId))}</td>
                    </tr>`;
                }).join('');

                return `<div style="margin-bottom:0.75rem;border:1px solid #1e293b;border-radius:8px;overflow:hidden;">
                    <div style="background:#0f172a;padding:0.4rem 0.75rem;display:flex;justify-content:space-between;align-items:center;">
                        <span style="font-weight:700;color:#a78bfa;font-size:11px;"><i class="fas fa-file-invoice"></i> Order ${esc(orderNumber)}</span>
                        <span style="font-size:9px;color:#f87171;">${lines.length} line(s) to cancel</span>
                    </div>
                    <table style="width:100%;border-collapse:collapse;background:#0a0f1e;">
                        <thead>
                            <tr style="background:#1e293b;">
                                <th style="padding:3px 6px;font-size:9px;color:#64748b;text-align:left;">Line#</th>
                                <th style="padding:3px 6px;font-size:9px;color:#64748b;text-align:left;">Item</th>
                                <th style="padding:3px 6px;font-size:9px;color:#64748b;text-align:left;">Description</th>
                                <th style="padding:3px 6px;font-size:9px;color:#64748b;text-align:left;">Status</th>
                                <th style="padding:3px 6px;font-size:9px;color:#64748b;text-align:right;">Qty</th>
                                <th style="padding:3px 6px;font-size:9px;color:#64748b;text-align:left;">FulfillmentLineId</th>
                            </tr>
                        </thead>
                        <tbody>${lineRows}</tbody>
                    </table>
                    <div style="padding:0.35rem 0.75rem;background:#0f172a;font-size:9px;color:#64748b;">
                        <i class="fas fa-plug" style="color:#0e7490;"></i> Cancel endpoint: <code style="color:#38bdf8;">${esc(cancelUrl(orderNumber))}</code>
                    </div>
                </div>`;
            }).join('');

            const dlg = document.createElement('div');
            dlg.id = 'sa-cancel-review-dlg';
            dlg.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.65);z-index:99999;display:flex;align-items:center;justify-content:center;';
            dlg.innerHTML = `
                <div style="background:#1e293b;border-radius:14px;width:700px;max-height:85vh;display:flex;flex-direction:column;box-shadow:0 24px 80px rgba(0,0,0,0.5);overflow:hidden;border:2px solid #f87171;">
                    <div style="padding:0.9rem 1.2rem;background:#0f172a;display:flex;align-items:center;gap:0.75rem;flex-shrink:0;">
                        <span style="font-size:20px;">⚠️</span>
                        <div>
                            <div style="font-weight:800;font-size:13px;color:#f87171;">Lines Requiring Cancellation — Trip ${esc(tripId)}</div>
                            <div style="font-size:10px;color:#64748b;margin-top:2px;">${orders.length} order(s) · ${totalLines} line(s) in Scheduled / Manual Reservations status</div>
                        </div>
                        <button onclick="document.getElementById('sa-cancel-review-dlg').remove()" style="margin-left:auto;background:none;border:none;color:#94a3b8;font-size:18px;cursor:pointer;">×</button>
                    </div>
                    <div style="overflow-y:auto;padding:1rem;flex:1;color:#e2e8f0;">
                        <div style="font-size:10px;color:#94a3b8;margin-bottom:0.75rem;">
                            Review the lines below. Click <strong style="color:#f87171;">Cancel All Listed Lines</strong> to proceed with cancellation order by order,
                            or <strong style="color:#64748b;">Skip</strong> to leave them as-is this tick.
                        </div>
                        ${orderRows}
                    </div>
                    <div style="padding:0.75rem 1.2rem;border-top:1px solid #0f172a;display:flex;justify-content:flex-end;gap:0.5rem;background:#0f172a;flex-shrink:0;">
                        <button id="sa-cancel-skip-btn" onclick="document.getElementById('sa-cancel-review-dlg').remove()"
                            style="padding:0.45rem 1rem;border:1px solid #334155;border-radius:8px;background:#1e293b;cursor:pointer;font-size:12px;font-weight:600;color:#94a3b8;">
                            Skip This Tick
                        </button>
                        <button id="sa-cancel-confirm-btn"
                            style="padding:0.45rem 1.2rem;border:none;border-radius:8px;background:#dc2626;cursor:pointer;font-size:12px;font-weight:700;color:white;">
                            <i class="fas fa-ban"></i> Cancel All Listed Lines (${totalLines})
                        </button>
                    </div>
                </div>`;
            document.body.appendChild(dlg);

            // Confirm button — runs cancellation order by order
            document.getElementById('sa-cancel-confirm-btn').onclick = async () => {
                const confirmBtn = document.getElementById('sa-cancel-confirm-btn');
                const skipBtn   = document.getElementById('sa-cancel-skip-btn');
                confirmBtn.disabled = true;
                skipBtn.disabled    = true;
                confirmBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Cancelling...';

                let successCount = 0, failCount = 0;
                for (const orderNumber of orders) {
                    try {
                        await new Promise((res, rej) => {
                            sendMessageToCSharp({
                                action  : 'executePost',
                                fullUrl : cancelUrl(orderNumber),
                                payload : {}
                            }, (err, data) => err ? rej(new Error(err)) : res(data));
                        });
                        successCount++;
                        await saLogActivity(agent.ID, tripId, orderNumber, 'CANCEL_LINES', 'SUCCESS', cancelGroups[orderNumber].length,
                            `Cancelled ${cancelGroups[orderNumber].length} Scheduled/Manual Reservations line(s)`, null, null);
                    } catch(e) {
                        failCount++;
                        await saLogActivity(agent.ID, tripId, orderNumber, 'CANCEL_LINES', 'FAILED', 1, e.message, null, null);
                    }
                }

                document.getElementById('sa-cancel-review-dlg')?.remove();
                if (failCount === 0) {
                    showNotification(`✅ Cancelled lines for ${successCount} order(s) successfully.`, 'success');
                } else {
                    showNotification(`⚠ Cancelled ${successCount} OK, ${failCount} failed — check activity log.`, 'warning');
                }
                resolve();
            };

            // Skip closes and resolves
            document.getElementById('sa-cancel-skip-btn').addEventListener('click', resolve, { once: true });
        });
    }

    async function saDetectAnomalies(agent, trip, orders, instance) {
        // Simple anomaly: check if any shipment lines saved in APEX have mismatched statuses
        // This is a placeholder — extend with real business logic
        const lines = [];
        for (const order of orders.slice(0, 5)) { // limit to first 5 orders per tick
            try {
                const data = await apexGet(`orders/shipmentlines/${encodeURIComponent(order)}?P_INSTANCE_NAME=${instance}`);
                if (data.items) lines.push(...data.items);
            } catch(e) { /* ignore */ }
        }
        const cancelled = lines.filter(l => l.LINE_STATUS_CODE === 'CANCELLED').length;
        const backOrdered = lines.filter(l => l.LINE_STATUS_CODE === 'BACKORDERED').length;
        if (cancelled > 0 || backOrdered > 0) {
            return `Trip ${trip.TRIP_ID}: ${cancelled} cancelled line(s), ${backOrdered} backordered line(s) detected.`;
        }
        return null;
    }

    async function saRunAiAnalysis(agent, trip, orders) {
        const prompt = `You are a WMS Shipping Agent AI. Analyse trip ${trip.TRIP_ID} with ${orders.length} order(s): ${orders.slice(0,5).join(', ')}. Orders processed: ${trip.ORDERS_PROCESSED}/${trip.ORDERS_TOTAL}. Anomalies found: ${trip.ANOMALIES_FOUND}. Give a 1-sentence status summary and 1 action recommendation.`;

        return new Promise((resolve) => {
            const requestId = 'sa-ai-' + Date.now();
            window.pendingRequests = window.pendingRequests || {};
            window.pendingRequests[requestId] = async (response) => {
                const msg = response?.content?.[0]?.text || 'Analysis complete.';
                await saLogActivity(agent.ID, trip.TRIP_ID, null, 'AI_ANALYSIS', 'SUCCESS', 1, msg.substring(0, 500), null, null);
                await saLogNotification(agent.ID, trip.TRIP_ID, null, 'COMPLETION', msg.substring(0, 500), 'INFO');
                resolve(msg);
            };
            if (window.chrome && window.chrome.webview) {
                window.chrome.webview.postMessage(JSON.stringify({
                    action: 'claudeChat',
                    requestId,
                    message: prompt,
                    conversationHistory: []
                }));
            } else {
                delete window.pendingRequests[requestId];
                resolve('AI not available in browser mode.');
            }
        });
    }

    // ─── Log helpers ─────────────────────────────────────────
    async function saLogActivity(agentId, tripId, orderNumber, activityType, status, attempt, message, detailJson, durationMs) {
        try {
            await apexPost('agents/activity/log', {
                agentId, tripId, orderNumber, activityType, status,
                attempt: attempt || 1, message: (message || '').substring(0, 2000),
                detailJson: detailJson ? JSON.stringify(detailJson) : null,
                durationMs
            });
        } catch(e) {
            console.warn('[ShippingAgent] Failed to log activity:', e);
        }
    }

    async function saLogNotification(agentId, tripId, orderNumber, notifType, message, severity) {
        try {
            await apexPost('agents/notifications/log', {
                agentId, tripId, orderNumber, notifType,
                message: (message || '').substring(0, 2000),
                severity: severity || 'INFO'
            });
        } catch(e) {
            console.warn('[ShippingAgent] Failed to log notification:', e);
        }
    }

    // ─── Auto-generate agent name ────────────────────────────
    function saGenerateAgentName() {
        const now  = new Date();
        const days = ['SUN','MON','TUE','WED','THU','FRI','SAT'];
        const pad  = n => String(n).padStart(2,'0');
        const date = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}`;
        const day  = days[now.getDay()];
        // Sequence: count existing agents + 1
        const seq  = String((window._saAgents || []).length + 1).padStart(3,'0');
        return `${date} ${day} #${seq}`;
    }

    // ─── Create Agent Modal ──────────────────────────────────
    window.saOpenCreateModal = function() {
        const instance  = (document.getElementById('current-instance-display')?.textContent || 'PROD').trim();
        const agentName = saGenerateAgentName();

        // Build the preview POST body for the API info panel
        const previewBody = {
            name: agentName,
            description: 'Shipping agent description',
            instanceName: instance,
            capabilities: 'MONITOR,PRINT,PICK_RELEASE,NOTIFY,ANOMALY,AI_ANALYSIS',
            checkIntervalSeconds: 60,
            maxRetries: 3,
            createdBy: localStorage.getItem('loggedInUser') || 'WMS_USER'
        };
        const previewUrl  = `${APEX_BASE}/agents/create`;
        const previewJson = JSON.stringify(previewBody, null, 2);

        const html = `
        <div id="sa-create-modal" style="position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:10000;display:flex;align-items:center;justify-content:center;">
            <div style="background:white;border-radius:14px;padding:2rem;width:540px;max-width:95vw;box-shadow:0 20px 60px rgba(0,0,0,0.3);">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1.25rem;">
                    <h3 style="margin:0;font-size:1.1rem;color:#1e293b;"><i class="fas fa-user-cog" style="color:#7c3aed;"></i> Create Shipping Agent</h3>
                    <div style="display:flex;gap:0.5rem;align-items:center;">
                        <button id="sa-create-api-btn" onclick="saShowCreateApiInfo()"
                            style="background:linear-gradient(135deg,#667eea,#764ba2);color:white;border:none;padding:4px 10px;border-radius:6px;font-size:11px;cursor:pointer;display:flex;align-items:center;gap:4px;"
                            title="View POST call and JSON body">
                            <i class="fas fa-code"></i> API
                        </button>
                        <button onclick="document.getElementById('sa-create-modal').remove()" style="background:none;border:none;font-size:1.4rem;cursor:pointer;color:#64748b;">&times;</button>
                    </div>
                </div>

                <div style="display:flex;flex-direction:column;gap:0.85rem;">
                    <div>
                        <label style="font-size:11px;font-weight:700;color:#374151;display:block;margin-bottom:4px;">Agent Name <span style="color:#94a3b8;font-weight:400;">(auto-generated)</span></label>
                        <input id="sa-new-name" type="text" value="${esc(agentName)}" oninput="saUpdateApiPreview()" style="width:100%;padding:0.5rem;border:1px solid #7c3aed;border-radius:6px;font-size:13px;box-sizing:border-box;font-weight:600;color:#7c3aed;">
                    </div>
                    <div>
                        <label style="font-size:11px;font-weight:700;color:#374151;display:block;margin-bottom:4px;">Description</label>
                        <input id="sa-new-desc" type="text" placeholder="Optional description" oninput="saUpdateApiPreview()" style="width:100%;padding:0.5rem;border:1px solid #cbd5e1;border-radius:6px;font-size:13px;box-sizing:border-box;">
                    </div>
                    <div style="display:flex;gap:1rem;">
                        <div style="flex:1;">
                            <label style="font-size:11px;font-weight:700;color:#374151;display:block;margin-bottom:4px;">Instance</label>
                            <select id="sa-new-instance" onchange="saUpdateApiPreview()" style="width:100%;padding:0.5rem;border:1px solid #cbd5e1;border-radius:6px;font-size:13px;">
                                <option value="PROD" ${instance==='PROD'?'selected':''}>PROD</option>
                                <option value="TEST" ${instance==='TEST'?'selected':''}>TEST</option>
                            </select>
                        </div>
                        <div style="flex:1;">
                            <label style="font-size:11px;font-weight:700;color:#374151;display:block;margin-bottom:4px;">Check Interval (secs)</label>
                            <input id="sa-new-interval" type="number" value="60" min="10" max="3600" oninput="saUpdateApiPreview()" style="width:100%;padding:0.5rem;border:1px solid #cbd5e1;border-radius:6px;font-size:13px;box-sizing:border-box;">
                        </div>
                        <div style="flex:1;">
                            <label style="font-size:11px;font-weight:700;color:#374151;display:block;margin-bottom:4px;">Max Retries</label>
                            <input id="sa-new-retries" type="number" value="3" min="1" max="10" oninput="saUpdateApiPreview()" style="width:100%;padding:0.5rem;border:1px solid #cbd5e1;border-radius:6px;font-size:13px;box-sizing:border-box;">
                        </div>
                    </div>
                    <div>
                        <label style="font-size:11px;font-weight:700;color:#374151;display:block;margin-bottom:8px;">Capabilities</label>
                        <div style="display:flex;flex-wrap:wrap;gap:0.5rem;">
                            ${[
                                ['MONITOR',      'Monitor Orders',   '#0891b2', 'fa-eye'],
                                ['PRINT',        'Auto Print',       '#7c3aed', 'fa-print'],
                                ['PICK_RELEASE', 'Pick Release',     '#059669', 'fa-shipping-fast'],
                                ['NOTIFY',       'Notify Pickers',   '#d97706', 'fa-bell'],
                                ['ANOMALY',      'Anomaly Detect',   '#dc2626', 'fa-exclamation-triangle'],
                                ['AI_ANALYSIS',  'AI Analysis',      '#6d28d9', 'fa-brain']
                            ].map(([val, label, color, icon]) => `
                                <label style="display:flex;align-items:center;gap:0.4rem;background:${color}12;border:1px solid ${color}30;padding:5px 10px;border-radius:8px;cursor:pointer;font-size:11px;font-weight:600;color:${color};">
                                    <input type="checkbox" name="sa-cap" value="${val}" checked onchange="saUpdateApiPreview()" style="cursor:pointer;">
                                    <i class="fas ${icon}"></i> ${label}
                                </label>`).join('')}
                        </div>
                    </div>
                </div>

                <div style="display:flex;justify-content:flex-end;gap:0.75rem;margin-top:1.5rem;">
                    <button onclick="document.getElementById('sa-create-modal').remove()" style="background:#f1f5f9;color:#374151;border:none;padding:0.5rem 1.25rem;border-radius:6px;cursor:pointer;font-size:12px;font-weight:600;">Cancel</button>
                    <button onclick="saSubmitCreate()" style="background:linear-gradient(135deg,#7c3aed,#5b21b6);color:white;border:none;padding:0.5rem 1.5rem;border-radius:6px;cursor:pointer;font-size:12px;font-weight:700;"><i class="fas fa-plus"></i> Create Agent</button>
                </div>
            </div>
        </div>`;
        document.body.insertAdjacentHTML('beforeend', html);
        document.getElementById('sa-new-name').focus();
    };

    // Build current form body for API preview
    function saGetCreateBody() {
        const caps = [...document.querySelectorAll('input[name="sa-cap"]:checked')].map(c => c.value).join(',');
        return {
            name:                 document.getElementById('sa-new-name')?.value || '',
            description:          document.getElementById('sa-new-desc')?.value || '',
            instanceName:         document.getElementById('sa-new-instance')?.value || 'PROD',
            capabilities:         caps,
            checkIntervalSeconds: parseInt(document.getElementById('sa-new-interval')?.value || 60),
            maxRetries:           parseInt(document.getElementById('sa-new-retries')?.value || 3),
            createdBy:            localStorage.getItem('loggedInUser') || 'WMS_USER'
        };
    }

    // Show popup with live form values
    window.saShowCreateApiInfo = function() {
        saShowApiInfo('POST', `${APEX_BASE}/agents/create`, saGetCreateBody());
    };

    // No-op kept for backward compat (oninput still calls this)
    window.saUpdateApiPreview = function() {};

    window.saSubmitCreate = async function() {
        const name = document.getElementById('sa-new-name')?.value?.trim();
        if (!name) { showNotification('Agent name is required.', 'error'); return; }

        const caps = [...document.querySelectorAll('input[name="sa-cap"]:checked')].map(c => c.value).join(',');
        const body = {
            name,
            description: document.getElementById('sa-new-desc')?.value || '',
            instanceName: document.getElementById('sa-new-instance')?.value || 'PROD',
            capabilities: caps,
            checkIntervalSeconds: parseInt(document.getElementById('sa-new-interval')?.value || 60),
            maxRetries: parseInt(document.getElementById('sa-new-retries')?.value || 3),
            createdBy: localStorage.getItem('loggedInUser') || 'WMS_USER'
        };

        try {
            const result = await apexPost('agents/create', body);
            document.getElementById('sa-create-modal')?.remove();
            showNotification(`Agent "${name}" created successfully.`, 'success');
            await saRefreshDashboard();
        } catch(e) {
            showNotification('Failed to create agent: ' + e.message, 'error');
        }
    };

    // ─── Assign Trip Modal ───────────────────────────────────
    window.saOpenAssignTripModal = function(preselectedAgentId) {
        const agent = window._saCurrentAgent;
        if (!agent && !preselectedAgentId) {
            showNotification('Please select an agent first.', 'error');
            return;
        }

        // Build trip options from tripOrdersStore or any available trip data
        const tripOptions = saGetAvailableTrips();
        const agentSelect = preselectedAgentId
            ? `<input type="hidden" id="sa-assign-agent-id" value="${preselectedAgentId}">`
            : `<input type="hidden" id="sa-assign-agent-id" value="${agent.ID}">`;

        const html = `
        <div id="sa-assign-modal" style="position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:10000;display:flex;align-items:center;justify-content:center;">
            <div style="background:white;border-radius:14px;padding:2rem;width:440px;max-width:95vw;box-shadow:0 20px 60px rgba(0,0,0,0.3);">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1.25rem;">
                    <h3 style="margin:0;font-size:1.1rem;color:#1e293b;"><i class="fas fa-truck" style="color:#0891b2;"></i> Assign Trip to Agent</h3>
                    <button onclick="document.getElementById('sa-assign-modal').remove()" style="background:none;border:none;font-size:1.4rem;cursor:pointer;color:#64748b;">&times;</button>
                </div>
                ${agentSelect}
                <div style="display:flex;flex-direction:column;gap:0.85rem;">
                    <div>
                        <label style="font-size:11px;font-weight:700;color:#374151;display:block;margin-bottom:4px;">Trip ID *</label>
                        <input id="sa-assign-trip-id" type="text" placeholder="e.g. 1042" list="sa-trip-datalist" style="width:100%;padding:0.5rem;border:1px solid #cbd5e1;border-radius:6px;font-size:13px;box-sizing:border-box;">
                        <datalist id="sa-trip-datalist">${tripOptions.map(t => `<option value="${esc(t.id)}">`).join('')}</datalist>
                    </div>
                    <div>
                        <label style="font-size:11px;font-weight:700;color:#374151;display:block;margin-bottom:4px;">Trip Name</label>
                        <input id="sa-assign-trip-name" type="text" placeholder="Optional display name" style="width:100%;padding:0.5rem;border:1px solid #cbd5e1;border-radius:6px;font-size:13px;box-sizing:border-box;">
                    </div>
                </div>
                <div style="display:flex;justify-content:flex-end;gap:0.75rem;margin-top:1.5rem;">
                    <button onclick="document.getElementById('sa-assign-modal').remove()" style="background:#f1f5f9;color:#374151;border:none;padding:0.5rem 1.25rem;border-radius:6px;cursor:pointer;font-size:12px;font-weight:600;">Cancel</button>
                    <button onclick="saSubmitAssignTrip()" style="background:linear-gradient(135deg,#0891b2,#0e7490);color:white;border:none;padding:0.5rem 1.5rem;border-radius:6px;cursor:pointer;font-size:12px;font-weight:700;"><i class="fas fa-plus"></i> Assign Trip</button>
                </div>
            </div>
        </div>`;
        document.body.insertAdjacentHTML('beforeend', html);
        document.getElementById('sa-assign-trip-id').focus();
    };

    window.saSubmitAssignTrip = async function() {
        const agentId  = document.getElementById('sa-assign-agent-id')?.value;
        const tripId   = document.getElementById('sa-assign-trip-id')?.value?.trim();
        const tripName = document.getElementById('sa-assign-trip-name')?.value?.trim() || tripId;
        if (!tripId) { showNotification('Trip ID is required.', 'error'); return; }

        const agent = window._saAgents.find(a => a.ID == agentId) || window._saCurrentAgent;
        const instanceName = agent?.INSTANCE_NAME || 'PROD';

        try {
            await apexPost(`agents/${agentId}/trips`, { tripId, tripName, instanceName });
            document.getElementById('sa-assign-modal')?.remove();
            showNotification(`Trip "${tripName}" assigned to agent.`, 'success');
            if (window._saCurrentAgent && window._saCurrentAgent.ID == agentId) {
                await saLoadTrips();
            }
            await saRefreshDashboard();
        } catch(e) {
            showNotification('Failed to assign trip: ' + e.message, 'error');
        }
    };

    function saGetAvailableTrips() {
        const trips = [];
        if (window.tripOrdersStore) {
            Object.keys(window.tripOrdersStore).forEach(id => trips.push({ id }));
        }
        return trips;
    }

    // ─── "Add to Agent" from Trip Management ────────────────
    window.saAddTripToAgent = async function(tripId, tripName, instanceName) {
        // Always fetch fresh list of ACTIVE agents only
        let activeAgents = [];
        try {
            const data = await apexGet('agents/active');
            activeAgents = (data.items || []).map(a => ({
                ID:           a.ID   || a.id,
                NAME:         a.NAME || a.name,
                INSTANCE_NAME: a.INSTANCE_NAME || a.instance_name || '',
                STATUS:       a.STATUS || a.status || 'IDLE',
                TRIP_COUNT:   a.TRIP_COUNT || a.trip_count || 0
            }));
        } catch(e) {
            showNotification('Failed to load active agents: ' + e.message, 'error');
            return;
        }

        if (activeAgents.length === 0) {
            showNotification('No active agents found. Create one in Shipping Agents page first.', 'error');
            return;
        }

        const options = activeAgents.map(a =>
            `<option value="${a.ID}">${esc(a.NAME)} (${esc(a.INSTANCE_NAME)}) — ${a.TRIP_COUNT} trip(s) · ${esc(a.STATUS)}</option>`
        ).join('');

        const html = `
        <div id="sa-addto-modal" style="position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:10000;display:flex;align-items:center;justify-content:center;">
            <div style="background:white;border-radius:14px;padding:1.75rem;width:420px;max-width:95vw;box-shadow:0 20px 60px rgba(0,0,0,0.3);">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;">
                    <h3 style="margin:0;font-size:1rem;color:#1e293b;"><i class="fas fa-user-cog" style="color:#7c3aed;"></i> Assign Trip to Agent</h3>
                    <button onclick="document.getElementById('sa-addto-modal').remove()" style="background:none;border:none;font-size:1.4rem;cursor:pointer;color:#64748b;">&times;</button>
                </div>
                <div style="background:#f0f9ff;border-radius:8px;padding:0.6rem 0.9rem;margin-bottom:1rem;font-size:12px;color:#0369a1;">
                    <i class="fas fa-truck" style="margin-right:5px;"></i>
                    Assigning <strong>Trip ${esc(tripId)}</strong> ${tripName !== `Trip ${tripId}` ? `(${esc(tripName)})` : ''} to a Shipping Agent
                </div>
                <label style="font-size:11px;font-weight:700;color:#374151;display:block;margin-bottom:6px;">Select Active Agent (${activeAgents.length} available)</label>
                <select id="sa-addto-agent-select" style="width:100%;padding:0.5rem;border:1px solid #7c3aed;border-radius:6px;font-size:12px;margin-bottom:1rem;outline:none;">
                    ${options}
                </select>
                <div style="display:flex;justify-content:flex-end;gap:0.75rem;">
                    <button onclick="document.getElementById('sa-addto-modal').remove()" style="background:#f1f5f9;color:#374151;border:none;padding:0.5rem 1.25rem;border-radius:6px;cursor:pointer;font-size:12px;font-weight:600;">Cancel</button>
                    <button onclick="saSubmitAddTo('${esc(tripId)}','${esc(tripName||tripId)}','${esc(instanceName||'PROD')}')" style="background:linear-gradient(135deg,#7c3aed,#5b21b6);color:white;border:none;padding:0.5rem 1.25rem;border-radius:6px;cursor:pointer;font-size:12px;font-weight:700;"><i class="fas fa-link"></i> Assign</button>
                </div>
            </div>
        </div>`;
        document.body.insertAdjacentHTML('beforeend', html);
    };

    window.saSubmitAddTo = async function(tripId, tripName, instanceName) {
        const agentId = document.getElementById('sa-addto-agent-select')?.value;
        if (!agentId) return;
        try {
            await apexPost(`agents/${agentId}/trips`, { tripId, tripName, instanceName });
            document.getElementById('sa-addto-modal')?.remove();
            showNotification(`Trip "${tripName}" assigned to agent.`, 'success');
            await saRefreshDashboard();
        } catch(e) {
            showNotification('Failed to assign trip: ' + e.message, 'error');
        }
    };

    // ─── Page show hook ──────────────────────────────────────
    // Called when user navigates to shipping-agents page
    document.addEventListener('DOMContentLoaded', function() {
        const orig = window.showPage;
        window.showPage = function(page) {
            if (typeof orig === 'function') orig(page);
            if (page === 'shipping-agents') {
                setTimeout(saInitPage, 100);
            }
        };
    });

    // ─── CSS animation ───────────────────────────────────────
    const style = document.createElement('style');
    style.textContent = `
        @keyframes saPulse {
            0%, 100% { opacity: 1; transform: scale(1); }
            50%       { opacity: 0.5; transform: scale(1.3); }
        }
    `;
    document.head.appendChild(style);

    // ─── Utility ─────────────────────────────────────────────
    function esc(s) {
        return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }

    function setText(id, val) {
        const el = document.getElementById(id);
        if (el) el.textContent = val;
    }

    function saFormatDate(d) {
        if (!d) return '—';
        try { return new Date(d).toLocaleString(); } catch(e) { return d; }
    }

    function saTimeAgo(d) {
        if (!d) return 'never';
        const diff = Date.now() - new Date(d).getTime();
        if (diff < 60000)   return 'just now';
        if (diff < 3600000) return Math.floor(diff/60000) + 'm ago';
        if (diff < 86400000)return Math.floor(diff/3600000) + 'h ago';
        return Math.floor(diff/86400000) + 'd ago';
    }

})();

// ============================================================
// SHIPPING AGENTS — WMS Module
// ============================================================

(function() {
    'use strict';

    const APEX_BASE = 'https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/TRIPMANAGEMENT';

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
        try {
            await saRefreshDashboard();
        } catch(e) {
            console.error('[ShippingAgent] Init error:', e);
        }
    };

    // ─── Dashboard ──────────────────────────────────────────
    window.saRefreshDashboard = async function() {
        const icon = document.getElementById('sa-refresh-icon');
        if (icon) icon.classList.add('fa-spin');
        const listUrl = `${APEX_BASE}/agents/list`;
        try {
            const data = await apexGet('agents/list');
            const agents = data.items || [];
            window._saAgents = agents;
            saRenderCards(agents);
            saUpdateStats(agents);
        } catch(e) {
            console.error('[ShippingAgent] Refresh error:', e);
            showNotification(`Failed to load agents: ${e.message} | URL: ${listUrl}`, 'error');
        } finally {
            if (icon) icon.classList.remove('fa-spin');
        }
    };

    // Called from the API icon on the page header
    window.saShowPageApiInfo = function() {
        saShowApiInfo('GET', `${APEX_BASE}/agents/list`, null);
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
                    <span style="background:${st.bg};color:${st.color};padding:2px 8px;border-radius:10px;font-size:10px;font-weight:700;white-space:nowrap;margin-left:6px;">${agent.STATUS}</span>
                </div>
                <div style="font-size:10px;color:#64748b;margin-bottom:0.5rem;">${esc(agent.INSTANCE_NAME)} · ${esc(agent.DESCRIPTION || '')}</div>
                <div style="display:flex;gap:0.4rem;flex-wrap:wrap;margin-bottom:0.5rem;">${saCapabilityChips(agent.CAPABILITIES)}</div>
                <div style="display:flex;gap:0.75rem;font-size:10px;color:#94a3b8;">
                    <span><i class="fas fa-truck" style="color:#0891b2;"></i> ${agent.TRIP_COUNT || 0} trip(s)</span>
                    <span><i class="fas fa-bolt" style="color:#d97706;"></i> ${agent.ACTIONS_TODAY || 0} today</span>
                    <span><i class="fas fa-clock"></i> ${saTimeAgo(agent.LAST_ACTIVE_DATE)}</span>
                </div>`;
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
        document.getElementById('sa-detail-meta').innerHTML =
            `<span style="color:#7c3aed;font-weight:600;">${esc(agent.INSTANCE_NAME)}</span> &nbsp;·&nbsp; Interval: ${agent.CHECK_INTERVAL_SECONDS}s &nbsp;·&nbsp; Max retries: ${agent.MAX_RETRIES} &nbsp;·&nbsp; Created: ${saFormatDate(agent.CREATED_DATE)}`;

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
    async function saLoadTrips() {
        const agent = window._saCurrentAgent;
        if (!agent) return;
        const list = document.getElementById('sa-trips-list');
        if (!list) return;
        list.innerHTML = `<div style="padding:1rem;text-align:center;color:#94a3b8;font-size:12px;"><i class="fas fa-spinner fa-spin"></i> Loading trips...</div>`;
        try {
            const data  = await apexGet(`agents/${agent.ID}/trips`);
            const trips = data.items || [];
            if (trips.length === 0) {
                list.innerHTML = `<div style="padding:2rem;text-align:center;color:#94a3b8;font-size:12px;">No trips assigned yet.<br>Click <strong>Assign Trip</strong> to add one.</div>`;
                return;
            }
            list.innerHTML = trips.map(t => {
                const st  = TRIP_STATUS_STYLE[t.STATUS] || TRIP_STATUS_STYLE.PENDING;
                const pct = t.ORDERS_TOTAL > 0 ? Math.round((t.ORDERS_PROCESSED / t.ORDERS_TOTAL) * 100) : 0;
                return `
                <div style="background:#f8fafc;border-radius:8px;padding:0.75rem 1rem;border:1px solid #e2e8f0;">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.4rem;">
                        <span style="font-size:12px;font-weight:700;color:#1e293b;">${esc(t.TRIP_NAME || t.TRIP_ID)}</span>
                        <div style="display:flex;gap:0.4rem;align-items:center;">
                            <span style="background:${st.bg};color:${st.color};padding:2px 8px;border-radius:8px;font-size:10px;font-weight:700;">${t.STATUS}</span>
                            <button onclick="saUnassignTrip(${agent.ID},'${esc(t.TRIP_ID)}')" style="background:none;border:none;cursor:pointer;color:#94a3b8;font-size:11px;padding:2px 4px;" title="Remove trip" onmouseover="this.style.color='#dc2626'" onmouseout="this.style.color='#94a3b8'"><i class="fas fa-times"></i></button>
                        </div>
                    </div>
                    <div style="display:flex;gap:1rem;font-size:10px;color:#64748b;margin-bottom:0.5rem;">
                        <span><i class="fas fa-box"></i> ${t.ORDERS_PROCESSED}/${t.ORDERS_TOTAL} orders</span>
                        <span><i class="fas fa-print" style="color:#7c3aed;"></i> ${t.ORDERS_PRINTED} printed</span>
                        <span><i class="fas fa-exclamation-triangle" style="color:#d97706;"></i> ${t.ANOMALIES_FOUND} anomalies</span>
                    </div>
                    <div style="background:#e2e8f0;border-radius:4px;height:5px;overflow:hidden;">
                        <div style="background:linear-gradient(90deg,#7c3aed,#5b21b6);height:100%;width:${pct}%;transition:width 0.4s;border-radius:4px;"></div>
                    </div>
                    ${t.NOTES ? `<div style="font-size:10px;color:#94a3b8;margin-top:0.3rem;">${esc(t.NOTES)}</div>` : ''}
                </div>`;
            }).join('');
        } catch(e) {
            list.innerHTML = `<div style="padding:1rem;color:#dc2626;font-size:12px;">${e.message}</div>`;
        }
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

    // ─── Activity Log Tab ────────────────────────────────────
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
                const info   = ACTIVITY_ICON[a.ACTIVITY_TYPE] || { icon: 'fa-circle', color: '#64748b' };
                const isOk   = a.STATUS === 'SUCCESS';
                const isRetry= a.STATUS === 'RETRY';
                const statusColor = isOk ? '#059669' : isRetry ? '#d97706' : a.STATUS === 'SKIPPED' ? '#94a3b8' : '#dc2626';
                return `
                <div style="display:flex;gap:0.6rem;align-items:flex-start;padding:5px 6px;border-radius:6px;background:${a.STATUS==='FAILED'?'#fff5f5':a.STATUS==='RETRY'?'#fefce8':'#f8fafc'}">
                    <i class="fas ${info.icon}" style="color:${info.color};margin-top:2px;width:14px;flex-shrink:0;"></i>
                    <div style="flex:1;min-width:0;">
                        <div style="display:flex;justify-content:space-between;gap:0.4rem;flex-wrap:wrap;">
                            <span style="font-weight:700;color:#1e293b;">${a.ACTIVITY_TYPE}</span>
                            <span style="font-size:10px;color:${statusColor};font-weight:700;">${a.STATUS}${a.ATTEMPT_NUMBER > 1 ? ` #${a.ATTEMPT_NUMBER}` : ''}</span>
                        </div>
                        <div style="color:#64748b;margin-top:1px;">${esc(a.MESSAGE || '')}</div>
                        <div style="color:#94a3b8;margin-top:1px;">${a.TRIP_ID ? `Trip: ${esc(a.TRIP_ID)}` : ''} ${a.ORDER_NUMBER ? `· Order: ${esc(a.ORDER_NUMBER)}` : ''} ${a.DURATION_MS ? `· ${a.DURATION_MS}ms` : ''} · ${saFormatDate(a.CREATED_DATE)}</div>
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
    window.saStartAgent = async function() {
        const agent = window._saCurrentAgent;
        if (!agent) return;
        try {
            await apexPut(`agents/${agent.ID}/status`, { status: 'RUNNING' });
            agent.STATUS = 'RUNNING';
            saUpdateDetailStatusBadge('RUNNING');
            saRenderCards(window._saAgents);
            saStartAgentLoop(agent);
            showNotification(`Agent "${agent.NAME}" started.`, 'success');
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

    // ─── Agent Loop ──────────────────────────────────────────
    function saStartAgentLoop(agent) {
        saStopAgentLoop(agent.ID); // clear any existing
        const intervalMs = Math.max((agent.CHECK_INTERVAL_SECONDS || 60), 10) * 1000;
        window._saLoops[agent.ID] = setInterval(() => saAgentTick(agent), intervalMs);
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
        console.log(`[ShippingAgent] Tick for agent ${agent.ID} (${agent.NAME})`);
        const capabilities = (agent.CAPABILITIES || '').split(',').map(c => c.trim());
        const instance     = agent.INSTANCE_NAME || 'PROD';

        let trips = [];
        try {
            const data = await apexGet(`agents/${agent.ID}/trips`);
            trips = (data.items || []).filter(t => t.STATUS === 'ACTIVE' || t.STATUS === 'PENDING');
        } catch(e) {
            console.error('[ShippingAgent] Failed to load trips for tick:', e);
            return;
        }

        for (const trip of trips) {
            await saProcessTrip(agent, trip, capabilities, instance);
        }

        // Refresh activity feed if currently viewing this agent's activity tab
        if (window._saCurrentAgent && window._saCurrentAgent.ID === agent.ID) {
            const actTab = document.getElementById('sa-tab-activity');
            if (actTab && actTab.style.display !== 'none') {
                saRefreshActivity();
            }
        }
    }

    async function saProcessTrip(agent, trip, capabilities, instance) {
        const fusionBase = instance.toUpperCase() === 'PROD'
            ? 'https://efmh.fa.em3.oraclecloud.com'
            : 'https://efmh-test.fa.em3.oraclecloud.com';

        // Get orders for this trip from APEX (stored trip data)
        let orders = [];
        if (window.tripOrdersStore && window.tripOrdersStore[trip.TRIP_ID]) {
            const tripData = window.tripOrdersStore[trip.TRIP_ID];
            orders = [...new Set((tripData || []).map(o => o.ORDER_NUMBER).filter(Boolean))];
        }

        const t0 = Date.now();

        // ── MONITOR: Check shipment line statuses ────────────
        if (capabilities.includes('MONITOR') && orders.length > 0) {
            let stuck = 0;
            for (const order of orders) {
                try {
                    const url = `${fusionBase}/fscmRestApi/resources/11.13.18.05/shipmentLines?q=Order=${order}&limit=500`;
                    await saLogActivity(agent.ID, trip.TRIP_ID, order, 'CHECK_STATUS', 'SUCCESS', 1,
                        `Checked shipment lines for order ${order}`, null, Date.now() - t0);
                } catch(e) {
                    await saLogActivity(agent.ID, trip.TRIP_ID, order, 'CHECK_STATUS', 'FAILED', 1, e.message, null, Date.now() - t0);
                }
            }
        }

        // ── ANOMALY: Detect mismatches ───────────────────────
        if (capabilities.includes('ANOMALY') && orders.length > 0) {
            try {
                const anomalyMsg = await saDetectAnomalies(agent, trip, orders, instance);
                if (anomalyMsg) {
                    await saLogActivity(agent.ID, trip.TRIP_ID, null, 'ANOMALY_DETECT', 'SUCCESS', 1, anomalyMsg, null, Date.now() - t0);
                    await saLogNotification(agent.ID, trip.TRIP_ID, null, 'ANOMALY', anomalyMsg, 'WARN');
                }
            } catch(e) {
                await saLogActivity(agent.ID, trip.TRIP_ID, null, 'ANOMALY_DETECT', 'FAILED', 1, e.message, null, Date.now() - t0);
            }
        }

        // ── AI_ANALYSIS: Summarise trip status ───────────────
        if (capabilities.includes('AI_ANALYSIS') && orders.length > 0) {
            try {
                await saRunAiAnalysis(agent, trip, orders);
            } catch(e) {
                await saLogActivity(agent.ID, trip.TRIP_ID, null, 'AI_ANALYSIS', 'FAILED', 1, e.message, null, Date.now() - t0);
            }
        }
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
        const agents = window._saAgents;
        if (!agents || agents.length === 0) {
            try {
                const data = await apexGet('agents/list');
                window._saAgents = data.items || [];
            } catch(e) {
                showNotification('Failed to load agents. Go to Shipping Agents page first.', 'error');
                return;
            }
        }

        if (window._saAgents.length === 0) {
            showNotification('No agents found. Create one in Shipping Agents page first.', 'error');
            return;
        }

        const html = `
        <div id="sa-addto-modal" style="position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:10000;display:flex;align-items:center;justify-content:center;">
            <div style="background:white;border-radius:14px;padding:1.75rem;width:380px;max-width:95vw;box-shadow:0 20px 60px rgba(0,0,0,0.3);">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;">
                    <h3 style="margin:0;font-size:1rem;color:#1e293b;"><i class="fas fa-user-cog" style="color:#7c3aed;"></i> Add Trip to Agent</h3>
                    <button onclick="document.getElementById('sa-addto-modal').remove()" style="background:none;border:none;font-size:1.4rem;cursor:pointer;color:#64748b;">&times;</button>
                </div>
                <p style="font-size:12px;color:#64748b;margin:0 0 1rem;">Assign trip <strong>${esc(tripName || tripId)}</strong> to a Shipping Agent:</p>
                <select id="sa-addto-agent-select" style="width:100%;padding:0.5rem;border:1px solid #cbd5e1;border-radius:6px;font-size:13px;margin-bottom:1rem;">
                    ${window._saAgents.map(a => `<option value="${a.ID}">${esc(a.NAME)} (${esc(a.INSTANCE_NAME)})</option>`).join('')}
                </select>
                <div style="display:flex;justify-content:flex-end;gap:0.75rem;">
                    <button onclick="document.getElementById('sa-addto-modal').remove()" style="background:#f1f5f9;color:#374151;border:none;padding:0.5rem 1.25rem;border-radius:6px;cursor:pointer;font-size:12px;font-weight:600;">Cancel</button>
                    <button onclick="saSubmitAddTo('${esc(tripId)}','${esc(tripName||tripId)}','${esc(instanceName||'PROD')}')" style="background:linear-gradient(135deg,#7c3aed,#5b21b6);color:white;border:none;padding:0.5rem 1.25rem;border-radius:6px;cursor:pointer;font-size:12px;font-weight:700;">Assign</button>
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

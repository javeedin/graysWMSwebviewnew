/**
 * Gray's WMS — RAG (AI Knowledge Base) Module
 * ─────────────────────────────────────────────
 * Communicates with the local Python RAG service at http://127.0.0.1:8765
 * Provides:
 *   • Data sync panel  — choose date range → ingest into ChromaDB
 *   • Query panel      — ask natural-language questions about WMS data
 *   • Status bar       — shows service health + document count
 */

(function () {
    'use strict';

    const RAG_API = 'http://127.0.0.1:8765';

    // ─────────────────────────────────────────
    //  State
    // ─────────────────────────────────────────
    let syncPollInterval = null;
    let ragServiceOnline = false;

    // ─────────────────────────────────────────
    //  API helpers (plain fetch — direct to Python service)
    // ─────────────────────────────────────────
    async function ragGet(path) {
        const resp = await fetch(`${RAG_API}${path}`, { method: 'GET' });
        return resp.json();
    }

    async function ragPost(path, body) {
        const resp = await fetch(`${RAG_API}${path}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        return resp.json();
    }

    async function ragDelete(path) {
        const resp = await fetch(`${RAG_API}${path}`, { method: 'DELETE' });
        return resp.json();
    }

    // ─────────────────────────────────────────
    //  Service health check
    // ─────────────────────────────────────────
    async function checkServiceHealth() {
        const dot  = document.getElementById('rag-service-dot');
        const text = document.getElementById('rag-service-text');
        const docCount = document.getElementById('rag-doc-count');
        const syncBtn  = document.getElementById('rag-sync-btn');
        const askBtn   = document.getElementById('rag-ask-btn');

        try {
            const data = await ragGet('/status');
            ragServiceOnline = true;
            if (dot)  { dot.style.background = '#10b981'; dot.title = 'Service online'; }
            if (text) text.textContent = 'RAG Service Online';
            if (docCount) docCount.textContent = `${(data.documents_in_db || 0).toLocaleString()} records in knowledge base`;
            if (syncBtn) syncBtn.disabled = false;
            if (askBtn)  askBtn.disabled  = false;
        } catch {
            ragServiceOnline = false;
            if (dot)  { dot.style.background = '#ef4444'; dot.title = 'Service offline'; }
            if (text) text.textContent = 'RAG Service Offline — start rag_service.exe';
            if (docCount) docCount.textContent = '';
            if (syncBtn) syncBtn.disabled = true;
            if (askBtn)  askBtn.disabled  = true;
        }
    }

    // ─────────────────────────────────────────
    //  Quick-date helpers
    // ─────────────────────────────────────────
    function toInputDate(d) {
        return d.toISOString().split('T')[0];          // YYYY-MM-DD for <input type=date>
    }

    function toApexDate(inputVal) {
        const [y, m, d] = inputVal.split('-');
        return `${d}-${m}-${y}`;                       // DD-MM-YYYY for APEX
    }

    function applyQuickRange(days) {
        const to   = new Date();
        const from = new Date();
        from.setDate(to.getDate() - days + 1);
        const fi = document.getElementById('rag-sync-from');
        const ti = document.getElementById('rag-sync-to');
        if (fi) fi.value = toInputDate(from);
        if (ti) ti.value = toInputDate(to);
    }

    // ─────────────────────────────────────────
    //  Sync
    // ─────────────────────────────────────────
    async function startSync() {
        const fromInput = document.getElementById('rag-sync-from');
        const toInput   = document.getElementById('rag-sync-to');
        const instance  = document.getElementById('rag-sync-instance')?.value || 'PROD';

        if (!fromInput?.value || !toInput?.value) {
            ragNotify('Please select a date range.', 'error');
            return;
        }

        const dateFrom = toApexDate(fromInput.value);
        const dateTo   = toApexDate(toInput.value);

        if (fromInput.value > toInput.value) {
            ragNotify('From date must be before To date.', 'error');
            return;
        }

        try {
            const result = await ragPost('/sync', { date_from: dateFrom, date_to: dateTo, instance });
            if (!result.success) {
                ragNotify(result.message || 'Failed to start sync.', 'error');
                return;
            }
            ragNotify('Sync started…', 'info');
            showSyncProgress();
            startSyncPolling();
        } catch (e) {
            ragNotify('Cannot reach RAG service. Is rag_service.exe running?', 'error');
        }
    }

    function showSyncProgress() {
        const box = document.getElementById('rag-sync-progress-box');
        if (box) box.style.display = 'block';
    }

    function hideSyncProgress() {
        const box = document.getElementById('rag-sync-progress-box');
        if (box) box.style.display = 'none';
    }

    function startSyncPolling() {
        if (syncPollInterval) clearInterval(syncPollInterval);
        syncPollInterval = setInterval(pollSyncProgress, 1500);
    }

    async function pollSyncProgress() {
        try {
            const p = await ragGet('/sync/progress');
            updateProgressUI(p);
            if (!p.running && p.finished) {
                clearInterval(syncPollInterval);
                syncPollInterval = null;
                ragNotify(`Sync complete — ${p.total_docs.toLocaleString()} records indexed.`, 'success');
                checkServiceHealth();
                setTimeout(hideSyncProgress, 5000);
            }
        } catch { /* service may be briefly busy */ }
    }

    function updateProgressUI(p) {
        const bar    = document.getElementById('rag-progress-bar');
        const label  = document.getElementById('rag-progress-label');
        const detail = document.getElementById('rag-progress-detail');

        const pct = p.percent || 0;
        if (bar)    bar.style.width = `${pct}%`;
        if (label)  label.textContent = `${pct}%`;
        if (detail) {
            if (p.running) {
                detail.textContent = `Processing ${p.current_date} — Day ${p.done_days} of ${p.total_days} — ${p.total_docs.toLocaleString()} records so far`;
            } else if (p.finished) {
                detail.textContent = `Done — ${p.total_docs.toLocaleString()} records indexed`;
                if (bar) bar.style.background = 'linear-gradient(90deg, #10b981, #059669)';
            }
        }

        // Show errors if any
        const errBox = document.getElementById('rag-sync-errors');
        if (errBox && p.errors && p.errors.length > 0) {
            errBox.style.display = 'block';
            errBox.innerHTML = `<strong>Warnings (${p.errors.length}):</strong><br>` +
                p.errors.slice(-5).map(e => `• ${e}`).join('<br>');
        }
    }

    async function cancelSync() {
        try {
            await ragPost('/sync/cancel', {});
            clearInterval(syncPollInterval);
            syncPollInterval = null;
            hideSyncProgress();
            ragNotify('Sync cancelled.', 'info');
        } catch (e) {
            ragNotify('Could not cancel sync.', 'error');
        }
    }

    async function clearKnowledgeBase() {
        if (!confirm('This will delete ALL synced WMS data from the knowledge base. Are you sure?')) return;
        try {
            const r = await ragDelete('/collection');
            if (r.success) {
                ragNotify('Knowledge base cleared.', 'success');
                checkServiceHealth();
            } else {
                ragNotify(r.message || 'Failed to clear.', 'error');
            }
        } catch (e) {
            ragNotify('Cannot reach RAG service.', 'error');
        }
    }

    // ─────────────────────────────────────────
    //  Query
    // ─────────────────────────────────────────
    async function submitQuery() {
        const input   = document.getElementById('rag-query-input');
        const question = input?.value?.trim();
        if (!question) { ragNotify('Please enter a question.', 'error'); return; }

        const apiKey = document.getElementById('rag-claude-key')?.value?.trim() ||
                       localStorage.getItem('claudeApiKey') || '';

        setQueryLoading(true);
        clearAnswer();

        try {
            const result = await ragPost('/query', {
                question,
                top_k: 10,
                claude_api_key: apiKey,
            });

            if (result.success) {
                renderAnswer(result.answer, result.sources || []);
            } else {
                renderError(result.answer || 'Query failed.');
            }
        } catch (e) {
            renderError('Cannot reach RAG service. Is rag_service.exe running?');
        } finally {
            setQueryLoading(false);
        }
    }

    function setQueryLoading(loading) {
        const btn  = document.getElementById('rag-ask-btn');
        const spin = document.getElementById('rag-ask-spinner');
        if (btn)  btn.disabled = loading;
        if (spin) spin.style.display = loading ? 'inline-block' : 'none';
    }

    function clearAnswer() {
        const box = document.getElementById('rag-answer-box');
        if (box) box.innerHTML = '';
    }

    function renderAnswer(answer, sources) {
        const box = document.getElementById('rag-answer-box');
        if (!box) return;

        // Convert newlines to HTML
        const htmlAnswer = answer
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\n/g, '<br>');

        let sourcesHtml = '';
        if (sources.length > 0) {
            const rows = sources.slice(0, 8).map(s => `
                <div style="display:flex;gap:12px;padding:6px 0;border-bottom:1px solid #f1f5f9;flex-wrap:wrap;">
                    <span style="color:#6366f1;font-weight:600;min-width:70px;">Trip ${s.trip_id}</span>
                    <span style="color:#64748b;font-size:12px;">${s.trip_date}</span>
                    <span style="color:#1e293b;font-size:12px;">${s.order_number}</span>
                    <span style="color:#64748b;font-size:12px;">${s.customer}</span>
                    ${s.picker ? `<span style="color:#10b981;font-size:12px;">👤 ${s.picker}</span>` : ''}
                    ${s.status ? `<span style="background:#f1f5f9;color:#475569;font-size:11px;padding:1px 6px;border-radius:4px;">${s.status}</span>` : ''}
                </div>`).join('');

            sourcesHtml = `
                <div style="margin-top:16px;border-top:2px solid #e2e8f0;padding-top:12px;">
                    <div style="font-size:12px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:8px;">
                        <i class="fas fa-database"></i> Sources (${sources.length} records)
                    </div>
                    ${rows}
                </div>`;
        }

        box.innerHTML = `
            <div style="background:#f0fdf4;border-left:4px solid #10b981;padding:16px;border-radius:0 8px 8px 0;margin-bottom:4px;">
                <div style="font-size:13px;line-height:1.7;color:#1e293b;">${htmlAnswer}</div>
            </div>
            ${sourcesHtml}`;
    }

    function renderError(msg) {
        const box = document.getElementById('rag-answer-box');
        if (box) box.innerHTML = `
            <div style="background:#fef2f2;border-left:4px solid #ef4444;padding:16px;border-radius:0 8px 8px 0;color:#dc2626;font-size:13px;">
                <i class="fas fa-exclamation-circle"></i> ${msg}
            </div>`;
    }

    function fillPrompt(text) {
        const input = document.getElementById('rag-query-input');
        if (input) {
            input.value = text;
            input.focus();
        }
    }

    // ─────────────────────────────────────────
    //  Notification toast
    // ─────────────────────────────────────────
    function ragNotify(msg, type = 'info') {
        const colors = { success: '#10b981', error: '#ef4444', info: '#6366f1' };
        const toast = document.createElement('div');
        toast.style.cssText = `
            position:fixed;top:80px;right:20px;z-index:99999;
            background:${colors[type] || colors.info};color:white;
            padding:12px 20px;border-radius:8px;font-size:13px;font-weight:600;
            box-shadow:0 4px 12px rgba(0,0,0,0.2);max-width:360px;`;
        toast.innerHTML = `<i class="fas fa-${type === 'success' ? 'check-circle' : type === 'error' ? 'exclamation-circle' : 'info-circle'}"></i> ${msg}`;
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 4000);
    }

    // ─────────────────────────────────────────
    //  Page init
    // ─────────────────────────────────────────
    window.initRagPage = function () {
        // Set default date range to last 15 days
        applyQuickRange(15);

        // Start health polling
        checkServiceHealth();
        setInterval(checkServiceHealth, 15000);

        // Save Claude API key to localStorage when typed
        const keyInput = document.getElementById('rag-claude-key');
        if (keyInput) {
            const saved = localStorage.getItem('claudeApiKey') || '';
            keyInput.value = saved;
            keyInput.addEventListener('input', () => {
                localStorage.setItem('claudeApiKey', keyInput.value.trim());
            });
        }

        // Allow Enter key in query box to submit
        const qInput = document.getElementById('rag-query-input');
        if (qInput) {
            qInput.addEventListener('keydown', e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    submitQuery();
                }
            });
        }
    };

    // ─────────────────────────────────────────
    //  Expose to window (called from HTML)
    // ─────────────────────────────────────────
    window.ragStartSync    = startSync;
    window.ragCancelSync   = cancelSync;
    window.ragClearDB      = clearKnowledgeBase;
    window.ragSubmitQuery  = submitQuery;
    window.ragFillPrompt   = fillPrompt;
    window.ragApplyRange   = applyQuickRange;

})();

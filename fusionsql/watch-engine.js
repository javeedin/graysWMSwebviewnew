/* ═══════════════════════════════════════════════════════════════
   Fusion SQL — Watchdog engine (pure: no DOM, no host; runs in node)

   A watchdog runs a query on a schedule and turns it into one number
   (row count, or a value column). It learns what "normal" is from its
   own history and alerts only when the number is unusual:

   AUTO   : robust baseline (median ± k × MAD) from earlier runs at the
            same weekday and time of day when there are enough of them,
            otherwise from all recent runs. Needs MIN_HISTORY runs first
            (status LEARNING until then).
   ABOVE / BELOW n : fixed limits.   CHANGE n : moved more than n % since the last run.
   ═══════════════════════════════════════════════════════════════ */
(function (root) {
    'use strict';

    var MIN_HISTORY = 5;          // runs before AUTO may alert
    var SEASON_MIN = 4;           // same weekday + hour runs needed to use the seasonal baseline
    var K = { LOW: 4, MEDIUM: 3, HIGH: 2.2 };   // sensitivity → how many robust deviations count as unusual
    var DAYS = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'];

    function median(a) {
        if (!a.length) return NaN;
        var s = a.slice().sort(function (x, y) { return x - y; }), m = s.length >> 1;
        return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
    }
    function fmt(v) {
        if (v == null || isNaN(v)) return '—';
        var a = Math.abs(v);
        return a >= 1000 ? Math.round(v).toLocaleString('en-US') : a >= 10 ? String(Math.round(v * 10) / 10) : String(Math.round(v * 100) / 100);
    }
    function hourDist(a, b) { var d = Math.abs(a - b) % 24; return Math.min(d, 24 - d); }

    /** Which earlier runs describe "normal" for a run at time t. */
    function baselineRuns(history, t) {
        var d = new Date(t), wd = d.getDay(), h = d.getHours();
        var ok = (history || []).filter(function (r) { return r && isFinite(r.v) && r.t < t; })
            .sort(function (a, b) { return b.t - a.t; }).slice(0, 200);
        var season = ok.filter(function (r) { var x = new Date(r.t); return x.getDay() === wd && hourDist(x.getHours(), h) <= 1; });
        if (season.length >= SEASON_MIN) return { runs: season.slice(0, 12), seasonal: true, label: DAYS[wd] + ' around ' + String(h).padStart(2, '0') + ':00' };
        return { runs: ok.slice(0, 30), seasonal: false, label: 'recent runs' };
    }

    /**
     * history: [{t: ms, v: number}] earlier successful runs (any order)
     * value:   this run's number;  t: this run's time (ms)
     * cfg:     {rule: AUTO|ABOVE|BELOW|CHANGE, threshold, direction: UP|DOWN|BOTH, sensitivity: LOW|MEDIUM|HIGH, unit}
     * → {status: LEARNING|OK|ALERT, expected, low, high, score, message, basis}
     */
    function evaluate(history, value, t, cfg) {
        cfg = cfg || {};
        var rule = String(cfg.rule || 'AUTO').toUpperCase(), dir = String(cfg.direction || 'BOTH').toUpperCase();
        var unit = cfg.unit || 'rows', v = +value, thr = +cfg.threshold;
        var prev = (history || []).filter(function (r) { return r && isFinite(r.v) && r.t < t; }).sort(function (a, b) { return b.t - a.t; })[0];
        var out = { status: 'OK', expected: null, low: null, high: null, score: 0, message: '', basis: '' };

        if (rule === 'ABOVE' || rule === 'BELOW') {
            var bad = rule === 'ABOVE' ? v > thr : v < thr;
            out.status = bad ? 'ALERT' : 'OK';
            if (rule === 'ABOVE') out.high = thr; else out.low = thr;
            out.message = fmt(v) + ' ' + unit + (bad ? (rule === 'ABOVE' ? ' — above the limit of ' : ' — below the limit of ') : (rule === 'ABOVE' ? ' — within the limit of ' : ' — above the minimum of ')) + fmt(thr);
            out.basis = 'fixed limit';
            return out;
        }
        if (rule === 'CHANGE') {
            if (!prev) { out.status = 'LEARNING'; out.message = fmt(v) + ' ' + unit + ' — first run, nothing to compare yet'; return out; }
            var pct = (v - prev.v) / Math.max(Math.abs(prev.v), 1) * 100;
            var hit = Math.abs(pct) >= thr && (dir === 'BOTH' || (dir === 'UP' ? pct > 0 : pct < 0));
            out.status = hit ? 'ALERT' : 'OK'; out.expected = prev.v; out.score = pct;
            out.message = fmt(v) + ' ' + unit + ' — ' + (pct >= 0 ? 'up ' : 'down ') + fmt(Math.abs(pct)) + '% since the last run (' + fmt(prev.v) + ')';
            out.basis = 'change since last run';
            return out;
        }

        // AUTO
        var all = (history || []).filter(function (r) { return r && isFinite(r.v) && r.t < t; });
        if (all.length < MIN_HISTORY) {
            out.status = 'LEARNING';
            out.message = fmt(v) + ' ' + unit + ' — learning what is normal (' + all.length + ' / ' + MIN_HISTORY + ' runs)';
            return out;
        }
        var b = baselineRuns(history, t), vals = b.runs.map(function (r) { return r.v; });
        var med = median(vals);
        var mad = median(vals.map(function (x) { return Math.abs(x - med); })) * 1.4826;
        // Flat history (MAD 0): allow 10 % of the level (at least 1) before calling a change unusual
        var spread = Math.max(mad, Math.abs(med) * 0.10, 1);
        var k = K[String(cfg.sensitivity || 'MEDIUM').toUpperCase()] || K.MEDIUM;
        out.expected = med; out.low = Math.max(med - k * spread, Math.min.apply(null, vals) < 0 ? -Infinity : 0); out.high = med + k * spread;
        out.score = (v - med) / spread;
        var up = v > out.high, down = v < out.low;
        var alert = (up && dir !== 'DOWN') || (down && dir !== 'UP');
        out.status = alert ? 'ALERT' : 'OK';
        out.basis = b.label;
        var ratio = med ? v / med : null;
        out.message = fmt(v) + ' ' + unit + ' — usual for ' + b.label + ' is ' + fmt(out.low) + '–' + fmt(out.high) + ' (median ' + fmt(med) + ')' +
            (alert ? (ratio && ratio >= 1.5 ? ', ' + fmt(ratio) + '× higher' : ratio != null && ratio <= 0.67 ? ', ' + fmt(med ? (1 - ratio) * 100 : 0) + '% lower' : up ? ', higher than usual' : ', lower than usual') : '');
        return out;
    }

    /** Alert again only when the watchdog newly turns ALERT, or after the cool-down while it stays ALERT. */
    function shouldNotify(prevStatus, newStatus, lastAlertMs, now, cooldownHours) {
        if (newStatus !== 'ALERT') return false;
        if (prevStatus !== 'ALERT') return true;
        var cd = (cooldownHours == null ? 6 : +cooldownHours) * 3600000;
        return lastAlertMs == null || isNaN(lastAlertMs) || now - lastAlertMs >= cd;
    }

    /** Next run time: every N minutes, aligned to the minute. */
    function nextRun(now, everyMin) {
        var m = Math.max(5, +everyMin || 60) * 60000;
        return Math.floor((now + m) / 60000) * 60000;
    }

    /** SQL that turns the watchdog query into one number V. */
    function metricSql(sql, metric, column) {
        var body = String(sql || '').trim().replace(/;\s*$/, '');
        if (String(metric || 'ROWS').toUpperCase() === 'ROWS') return 'SELECT COUNT(*) AS V FROM (\n' + body + '\n)';
        return body;
    }
    /** Reads the number from a query result {columns, rows}. */
    function metricValue(result, metric, column) {
        var rows = (result && result.rows) || [], cols = (result && result.columns) || [];
        if (!rows.length) return String(metric || 'ROWS').toUpperCase() === 'ROWS' ? 0 : NaN;
        var row = rows[0];
        var get = function (c) { if (Array.isArray(row)) return row[cols.indexOf(c)]; return row[c] != null ? row[c] : row[String(c).toUpperCase()]; };
        if (String(metric || 'ROWS').toUpperCase() === 'ROWS') return +get(cols.indexOf('V') >= 0 ? 'V' : cols[0]);
        var c = column && cols.indexOf(String(column).toUpperCase()) >= 0 ? String(column).toUpperCase() : column && cols.indexOf(column) >= 0 ? column : null;
        if (!c) c = cols.filter(function (x) { return isFinite(parseFloat(get(x))); })[0];
        var n = parseFloat(String(get(c)).replace(/,/g, ''));
        return isFinite(n) ? n : NaN;
    }

    var api = { evaluate: evaluate, shouldNotify: shouldNotify, nextRun: nextRun, metricSql: metricSql, metricValue: metricValue,
        baselineRuns: baselineRuns, median: median, fmt: fmt, MIN_HISTORY: MIN_HISTORY };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.WD_ENGINE = api;
})(this);

/* Oracle BIP Reporting · engine tests (node, no browser). Run: node bip/tests/bip-engine.test.js */
'use strict';
const E = require('../bip-engine.js');
let n = 0, bad = 0;
function check(name, ok, extra) { n++; if (!ok) { bad++; console.log('FAIL ' + name + (extra !== undefined ? ' — ' + JSON.stringify(extra).slice(0, 300) : '')); } else console.log('ok   ' + name); }

// parameter kinds
check('kind: date by dataType', E.kind({ name: 'P_FROM_DATE', dataType: 'Date' }) === 'date');
check('kind: date by format string', E.kind({ name: 'P_X', dataType: 'String', dateFormatString: 'MM-dd-yyyy' }) === 'date');
check('kind: menu by LOV labels', E.kind({ name: 'P_BU', dataType: 'String', lovLabels: ['A', 'B'] }) === 'menu');
check('kind: hidden', E.kind({ name: 'P_H', uiType: 'Hidden' }) === 'hidden');
check('kind: number', E.kind({ name: 'P_N', dataType: 'Integer' }) === 'number');
check('kind: text', E.kind({ name: 'P_T', dataType: 'String' }) === 'text');
const params = [{ name: 'P_ORG', dataType: 'String', lovLabels: ['GIC', 'VAN'], multiValuesAllowed: true },
    { name: 'P_FROM_DATE', dataType: 'Date', dateFormatString: 'MM-dd-yyyy' }, { name: 'P_TO_DATE', dataType: 'Date', dateFormatString: 'MM-dd-yyyy' },
    { name: 'P_CUSTOMER', dataType: 'String' }, { name: 'P_FLAG', dataType: 'Boolean' }];
check('datePairs: FROM / TO found', JSON.stringify(E.datePairs(params)) === JSON.stringify([{ from: 'P_FROM_DATE', to: 'P_TO_DATE' }]));
check('datePairs: START / END with a stem', JSON.stringify(E.datePairs([{ name: 'P_START_DATE', dataType: 'Date' }, { name: 'P_END_DATE', dataType: 'Date' }])) === JSON.stringify([{ from: 'P_START_DATE', to: 'P_END_DATE' }]));
check('datePairs: two plain dates fall back to first / second', E.datePairs([{ name: 'P_D1', dataType: 'Date' }, { name: 'P_D2', dataType: 'Date' }])[0].to === 'P_D2');
check('datePairs: one date → none', E.datePairs([{ name: 'P_AS_OF', dataType: 'Date' }]).length === 0);

// dates
check('toDate: ISO', E.iso(E.toDate('2026-03-05')) === '2026-03-05');
check('toDate: dd-mm-yyyy', E.iso(E.toDate('05-03-2026')) === '2026-03-05');
check('toDate: dd-MMM-yyyy', E.iso(E.toDate('05-Mar-2026')) === '2026-03-05');
check('format: MM-dd-yyyy', E.format('2026-03-05', 'MM-dd-yyyy') === '03-05-2026');
check('format: dd-MMM-yyyy', E.format('2026-03-05', 'dd-MMM-yyyy') === '05-Mar-2026');
check('format: yyyy-MM-dd HH:mm:ss', E.format('2026-03-05', 'yyyy-MM-dd HH:mm:ss') === '2026-03-05 00:00:00');
check('format: default ISO', E.format('2026-03-05') === '2026-03-05');
check('parse: with the parameter pattern', E.iso(E.parse('03-05-2026', 'MM-dd-yyyy')) === '2026-03-05');
check('parse: dd/MM/yy', E.iso(E.parse('05/03/26', 'dd/MM/yy')) === '2026-03-05');
check('parse: falls back to ISO', E.iso(E.parse('2026-03-05', 'MM-dd-yyyy')) === '2026-03-05');

// buckets
const d7 = E.buckets({ from: '2026-01-01', to: '2026-01-20', by: 'days', n: 7 });
check('buckets: 7 days → 3 ranges, consecutive, inclusive', d7.length === 3 && d7[0].from === '2026-01-01' && d7[0].to === '2026-01-07' && d7[1].from === '2026-01-08' && d7[2].to === '2026-01-20', d7);
const mo = E.buckets({ from: '2026-01-15', to: '2026-04-10', by: 'month' });
check('buckets: month → partial first, whole middles, partial last', mo.length === 4 && mo[0].to === '2026-01-31' && mo[1].label === 'Feb 2026' && mo[3].from === '2026-04-01' && mo[3].to === '2026-04-10', mo);
const wk = E.buckets({ from: '2026-01-01', to: '2026-01-14', by: 'week' });
check('buckets: week ends on Sunday', wk[0].from === '2026-01-01' && wk[0].to === '2026-01-04' && wk[1].to === '2026-01-11' && wk[2].to === '2026-01-14', wk);
const q = E.buckets({ from: '2025-01-01', to: '2025-12-31', by: 'quarter' });
check('buckets: quarters labelled', q.length === 4 && q[0].label === 'Q1 2025' && q[3].to === '2025-12-31', q);
const y = E.buckets({ from: '2024-06-01', to: '2026-02-01', by: 'year' });
check('buckets: years', y.length === 3 && y[1].label === '2025' && y[2].to === '2026-02-01', y);
check('buckets: none → one range', E.buckets({ from: '2026-01-01', to: '2026-01-31', by: 'none' }).length === 1);
check('buckets: swapped dates are put in order', E.buckets({ from: '2026-01-31', to: '2026-01-01', by: 'days', n: 10 })[0].from === '2026-01-01');
check('buckets: a bad date → nothing', E.buckets({ from: 'x', to: '2026-01-01', by: 'days' }).length === 0);

// encode
const enc = E.encode(params, { P_ORG: ['GIC', 'VAN'], P_FROM_DATE: '2026-01-01', P_TO_DATE: '2026-01-31', P_CUSTOMER: 'Acme', P_FLAG: true });
check('encode: dates in the parameter format', enc.P_FROM_DATE[0] === '01-01-2026' && enc.P_TO_DATE[0] === '01-31-2026', enc);
check('encode: multi-value menu stays a list', enc.P_ORG.length === 2 && enc.P_ORG[1] === 'VAN');
check('encode: text and boolean', enc.P_CUSTOMER[0] === 'Acme' && enc.P_FLAG[0] === 'true');
check('encode: an empty value is left out', E.encode(params, { P_CUSTOMER: '' }).P_CUSTOMER === undefined);
check('encode: All on a menu → *', E.encode(params, { P_ORG: ['__ALL__'] }).P_ORG[0] === '*');
check('encode: All with useNullForAll → omitted', E.encode([{ name: 'P_X', lovLabels: ['a'], useNullForAll: true }], { P_X: '__ALL__' }).P_X === undefined);

// plan
const plan = E.plan({ params, dateBucket: { fromParam: 'P_FROM_DATE', toParam: 'P_TO_DATE', by: 'month', from: '2026-01-01', to: '2026-02-28' } });
check('plan: one run per month with the dates in the parameter format', plan.length === 2 && plan[0].params.P_FROM_DATE[0] === '01-01-2026' && plan[1].params.P_TO_DATE[0] === '02-28-2026', plan);
const plan2 = E.plan({ params, dateBucket: { fromParam: 'P_FROM_DATE', toParam: 'P_TO_DATE', by: 'month', from: '2026-01-01', to: '2026-02-28' }, valueBucket: { param: 'P_ORG', values: ['GIC', 'VAN'] } });
check('plan: dates × values = 4 runs, labelled', plan2.length === 4 && plan2[1].label === 'Jan 2026 · VAN' && plan2[1].params.P_ORG[0] === 'VAN' && plan2[3].params.P_FROM_DATE[0] === '02-01-2026', plan2);
check('plan: values alone', E.plan({ params, valueBucket: { param: 'P_ORG', values: ['A', 'B', ''] } }).length === 2);
check('plan: nothing to split → no buckets', E.plan({ params }).length === 0);

// search
const items = [{ absolutePath: '/Custom/Finance/AR Aging.xdo', displayName: 'AR Aging', type: 'Report' }, { absolutePath: '/Custom/Finance', displayName: 'Finance', type: 'Folder' },
    { absolutePath: '/Custom/SCM/Aging of stock.xdo', displayName: 'Aging of stock', type: 'Report' }, { absolutePath: '/Custom/SCM/Aging of stock DM.xdm', displayName: 'Aging of stock DM', type: 'DataModel' }];
const s1 = E.search(items, 'aging');
check('search: reports first, by name', s1.length === 3 && s1[0].type === 'Report' && s1[2].type === 'DataModel', s1.map(x => x.displayName));
check('search: every word must match', E.search(items, 'aging finance').length === 1 && E.search(items, 'aging finance')[0].displayName === 'AR Aging');
check('search: empty → nothing', E.search(items, '').length === 0);

// data helpers
const rows = [{ BU: 'A', AMT: 10, D: '2026-01-01' }, { BU: 'A', AMT: 5.5, D: '2026-01-02' }, { BU: 'B', AMT: null, D: '' }];
const sum = E.summary(rows, ['BU', 'AMT', 'D']);
check('summary: kinds and sums', sum[0].kind === 'text' && sum[0].distinct === 2 && sum[1].kind === 'number' && sum[1].sum === 15.5 && sum[1].nulls === 1 && sum[2].kind === 'date', sum);
const ag = E.agg(rows, { groupBy: 'BU', valueCol: 'AMT', fn: 'sum' });
check('agg: sum by group sorted desc', ag[0].key === 'A' && ag[0].value === 15.5 && ag[1].key === 'B' && ag[1].value === 0, ag);
check('agg: count', E.agg(rows, { groupBy: 'BU', fn: 'count' })[0].value === 2);
check('cardValue: count / sum / first', E.cardValue(rows, { mode: 'count' }) === 3 && E.cardValue(rows, { mode: 'sum', column: 'AMT' }) === 15.5 && E.cardValue(rows, { mode: 'first', column: 'BU' }) === 'A');
check('fmtNum', E.fmtNum(1234567.891) === (1234568).toLocaleString() && E.fmtNum(12.5) === (12.5).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
check('fmtMs / fmtBytes', E.fmtMs(125000) === '2 min 5 s' && E.fmtBytes(2048) === '2 KB');
check('csvOf quotes', E.csvOf([{ a: 'x,y', b: 1 }], ['a', 'b']) === 'a,b\n"x,y",1');

console.log((bad ? 'FAILED ' + bad + ' of ' : 'ok ') + n + ' BIP engine checks');
process.exit(bad ? 1 : 0);

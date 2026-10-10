/* Field Apps · the CLOB helpers of fa-store.js (node, no browser): Oracle counts code points and the gateway fetches text
 * into a 4,000-byte buffer, so pieces must never split a surrogate pair, never exceed the byte limits, and every
 * length sent to Oracle must be a code-point count. Run: node fieldapps/tests/clob.test.js */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const win = { chrome: null, addEventListener() { } };
const ctx = { window: win, localStorage: { getItem: () => null }, sessionStorage: { getItem: () => null }, crypto: require('crypto').webcrypto, TextEncoder, atob: s => Buffer.from(s, 'base64').toString('binary'), console };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'fa-store.js'), 'utf8'), ctx);
const FAS = win.FAS;
let n = 0, bad = 0;
function check(name, ok, extra) { n++; if (!ok) { bad++; console.log('FAIL ' + name + (extra !== undefined ? ' — ' + JSON.stringify(extra).slice(0, 200) : '')); } else console.log('ok   ' + name); }
const utf8 = s => Buffer.byteLength(s, 'utf8');

// code points vs UTF-16 units
check('cpLen: ASCII', FAS.cpLen('abc') === 3);
check('cpLen: an emoji is one character to Oracle', FAS.cpLen('a🧾b') === 3 && 'a🧾b'.length === 4);
check('cpLen: box drawing is one character', FAS.cpLen('── x ──') === 7);
check('utf8Len matches Buffer', ['abc', 'a🧾b', '── x ──', 'é à ç', 'x\u0000y', ''].every(s => FAS.utf8Len(s) === utf8(s)));

// pieces: never inside a surrogate pair, never over the limits
const banner = '// ── sale helpers ' + '─'.repeat(60) + '\n';
const text = (banner + "var s = 'it''s'; /* 🧾 🛒 */ " + 'x'.repeat(937)).repeat(40) + '🧾'.repeat(1500) + "'".repeat(2500);
const ps = FAS.pieces(text, 1000, 3800, true);
check('pieces: joined back, nothing lost', ps.join('') === text);
check('pieces: at most 1,000 code points each', ps.every(p => FAS.cpLen(p) <= 1000), ps.map(p => FAS.cpLen(p)).filter(x => x > 1000));
check('pieces: at most 3,800 bytes each with quotes doubled', ps.every(p => utf8(p.replace(/'/g, "''")) <= 3800), ps.map(p => utf8(p.replace(/'/g, "''"))).filter(x => x > 3800));
check('pieces: no piece starts or ends with half a surrogate pair', ps.every(p => !/^[\uDC00-\uDFFF]/.test(p) && !/[\uD800-\uDBFF]$/.test(p)));
check('pieces: a piece of only emoji is cut by bytes (3,800 / 4 = 950)', FAS.pieces('🧾'.repeat(1200), 1000, 3800, true)[0].length === 950 * 2);
check("pieces: 2,500 quotes → pieces of 1,000 characters (2,000 bytes doubled)", FAS.pieces("'".repeat(2500), 1000, 3800, true).map(p => p.length).join(',') === '1000,1000,500');
const rp = FAS.pieces(text, FAS.CLOB_READ);
check('read pieces: 600 characters → at most 3,600 bytes even if every one were escaped as \\uXXXX', rp.every(p => FAS.cpLen(p) <= 600) && FAS.CLOB_READ * 6 <= 4000);
check('pieces: empty text → no pieces', FAS.pieces('', 1000, 3800, true).length === 0);

// SQL literals
check("clob: TO_CLOB literals joined by ||, quotes doubled", FAS.clob("it's") === "TO_CLOB('it''s')");
check('clob: a long text becomes several literals', (FAS.clob(text).match(/TO_CLOB\('/g) || []).length === ps.length);
check('clob: NULL for nothing', FAS.clob('') === 'NULL' && FAS.clob(null) === 'NULL');
check('lit: a cut never leaves half a surrogate pair', FAS.lit('ab🧾', 3) === "'ab'" && FAS.lit('ab🧾', 4) === "'ab🧾'");

// first difference
check('firstDiff: same → null', FAS.firstDiff('abc\ndef', 'abc\ndef') === null);
const d = FAS.firstDiff('abc\ndef\nghi', 'abc\ndeX\nghi');
check('firstDiff: position, line and context', d && d.at === 6 && d.line === 2 && d.expected.slice(0, 1) === 'f' && d.got.slice(0, 1) === 'X', d);
check('firstDiff: a cut tail', (() => { const x = FAS.firstDiff('a🧾bcd', 'a🧾b'); return x && x.at === 3 && x.lenA === 5 && x.lenB === 3; })());

console.log((bad ? 'FAILED ' + bad + ' of ' : 'ok ') + n + ' CLOB checks');
process.exit(bad ? 1 : 0);

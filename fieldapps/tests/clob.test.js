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
check('cpLen: an emoji is one code point', FAS.cpLen('a🧾b') === 3 && 'a🧾b'.length === 4);
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

// no emoji in a CLOB: escapes that mean the same thing (an AL32UTF8 CLOB counts an emoji as 2 UTF-16 units)
const man = JSON.stringify({ id: 'picker-tasks', name: 'Picker Tasks', icon: '🧩', settings: { tenders: ['💵 Cash', 'Card'] } });
const manS = FAS.bmpJson(man);
check('bmpJson: no surrogate pair left', !FAS.hasAstral(manS) && FAS.hasAstral(man));
check('bmpJson: parses to exactly the same object', JSON.stringify(JSON.parse(manS)) === man);
check('bmpJson: ASCII-safe length = code points = UTF-16 units', FAS.cpLen(manS) === manS.length);
check('bmpJson: idempotent and a no-op without emoji', FAS.bmpJson(manS) === manS && FAS.bmpJson('{"a":1}') === '{"a":1}');
const page = '<!doctype html><html><head><title>Sale 🧾</title><style>.r::before{content:"🧾"}</style></head><body title="👤">Hi 👥 <b>x</b>' +
  '<script>var L = { cash: "💵 Cash", re: /🔄/ }; window.__out = L.cash + "|" + "🧾".length + "|" + L.re.test("a🔄b"); // 🖨 comment\n</script></body></html>';
const pageS = FAS.bmpHtml(page);
check('bmpHtml: no surrogate pair left', !FAS.hasAstral(pageS), pageS);
check('bmpHtml: HTML text and attributes become entities', /Sale &#x1F9FE;/.test(pageS) && /title="&#x1F464;"/.test(pageS) && /Hi &#x1F465;/.test(pageS));
check('bmpHtml: CSS gets a CSS escape', /content:"\\1F9FE "/.test(pageS), pageS);
const scr = /<script>([\s\S]*?)<\/script>/.exec(pageS)[1], sb = {}; vm.runInNewContext(scr, { window: sb });
check('bmpHtml: the escaped script gives exactly the same strings', sb.__out === '💵 Cash|2|true', sb.__out);
check('bmpHtml: idempotent', FAS.bmpHtml(pageS) === pageS);
const launcher = JSON.stringify({ type: 'apex', url: 'https://x.oraclecloudapps.com/ords/f?p=1', hosts: [], toolbar: true, note: '🧩' });
check('bmpCode: a JSON launcher keeps JSON (escapes, still parses the same)', JSON.parse(FAS.bmpCode(launcher)).note === '🧩' && !FAS.hasAstral(FAS.bmpCode(launcher)));
const pos = fs.readFileSync(path.join(__dirname, '..', 'apps', 'pos.app.js'), 'utf8');
const posCode = (() => { const w = {}; vm.runInNewContext(pos, { window: w }); const a = w.FA_APPS && w.FA_APPS.pos; return a && a.code; })();
check('the built-in POS: has emoji, stored without them', !!posCode && FAS.hasAstral(posCode) && !FAS.hasAstral(FAS.bmpCode(posCode)));
check('the built-in POS: every script still parses after the escapes', (() => { const re = /<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi; let m, ok = true; const t = FAS.bmpCode(posCode); while ((m = re.exec(t))) { try { new vm.Script(m[1]); } catch (e) { ok = false; console.log(e.message); } } return ok; })());
check('sameLen: Oracle counting code points or UTF-16 units both pass', FAS.sameLen('a🧩b', 3) && FAS.sameLen('a🧩b', 4) && !FAS.sameLen('a🧩b', 5));
check('the reported case: 1,612 code points with one emoji = 1,613 UTF-16 units → accepted', (() => { const t = '🧩' + 'x'.repeat(1611); return FAS.cpLen(t) === 1612 && FAS.sameLen(t, 1613); })());

console.log((bad ? 'FAILED ' + bad + ' of ' : 'ok ') + n + ' CLOB checks');
process.exit(bad ? 1 : 0);

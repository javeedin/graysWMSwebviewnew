// node fieldapps/tests/fa-apex.test.js — APEX apps in Field Apps: the signed launcher, address checks, placeholders, navigation
'use strict';
var X = require('../runtime/fa-apex.js');
var n = 0, bad = 0;
function ok(c, m) { n++; if (!c) { bad++; console.log('FAIL ' + m); } }
function eq(a, b, m) { ok(JSON.stringify(a) === JSON.stringify(b), m + ' — got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b)); }

var H = 'https://g09254cbbf8e7af-apextestdb.adb.eu-frankfurt-1.oraclecloudapps.com';
var app = H + '/ords/r/grays/picker-tasks/home?session=308118241944842&debug=YES&p1_x=5';
var c = X.check(app);
ok(c.ok, 'a friendly APEX URL is accepted');
eq(c.url, H + '/ords/r/grays/picker-tasks/home?p1_x=5', 'the session and debug parts are dropped, item values kept');
eq(X.normalize(H + '/ords/f?p=145:10:308118241944842::NO:::'), H + '/ords/f?p=145:10', 'f?p keeps app:page, drops the session');
eq(X.normalize(H + '/ords/f?p=145'), H + '/ords/f?p=145', 'f?p with the app alone');
ok(!X.check(H + '/ords/r/apex/workspace-sign-in/select-workspace?p20_workspace=&session=1').ok, 'the workspace sign-in is not an app');
ok(/App Builder/.test(X.check(H + '/ords/f?p=4550:1').why), 'App Builder (4550) is refused with a reason');
ok(!X.check('http://x.oraclecloudapps.com/ords/r/a/b').ok, 'http is refused');
ok(!X.check('https://evil.example.com/ords/r/a/b').ok, 'another host is refused');
ok(X.check('https://apex.grays.mu/ords/r/a/b', ['apex.grays.mu']).ok, 'another host when listed');
ok(!X.check('https://x.oraclecloudapps.com/apex/r/a').ok, 'no /ords/ → refused');
ok(!X.check('not a url').ok, 'garbage refused');

var code = X.code({ url: c.url, hosts: ['Login.MicrosoftOnline.com', 'login.microsoftonline.com', ''] });
eq(JSON.parse(code), { type: 'apex', url: c.url, hosts: ['login.microsoftonline.com'], toolbar: true }, 'launcher JSON: lower-case hosts, no duplicates');
eq(X.code({ url: c.url }), X.code({ url: c.url + '' }), 'same app → same bytes (stable signature)');
eq(X.read(code).url, c.url, 'read back');
ok(X.read('<html></html>') === null, 'an HTML app is not an APEX launcher');
ok(X.isApex({ kind: 'APEX' }) && X.isApex({ code: code }) && !X.isApex({ kind: 'CODE', code: '<html>' }), 'isApex');

eq(X.fill(H + '/ords/f?p=145:1::::::P0_USER,P0_POD:{{USER}},{{POD}}', { user: 'ravi k', pod: 'PROD' }), H + '/ords/f?p=145:1::::::P0_USER,P0_POD:ravi%20k,PROD', 'placeholders filled and encoded');
eq(X.fill('{{DEVICE}}|{{APP}}|{{NOPE}}', { device: 'd1', appId: 'a' }), 'd1|a|{{NOPE}}', 'unknown placeholders stay');

ok(X.mayNavigate(H + '/ords/r/grays/picker-tasks/page2', c.url, []), 'same host may be navigated');
ok(X.mayNavigate('https://login.microsoftonline.com/x', c.url, ['login.microsoftonline.com']), 'listed SSO host');
ok(!X.mayNavigate('https://login.microsoftonline.com/x', c.url, []), 'unlisted SSO host refused');
ok(!X.mayNavigate('https://example.com', c.url, []), 'elsewhere refused');
ok(X.mayNavigate('about:blank', c.url, []) && !X.mayNavigate('javascript:alert(1)', c.url, []), 'about: yes, javascript: no');
eq(X.urlFromApp('https://h.oraclecloudapps.com/ords/WKSP_GRAYSAPP', { APPLICATION_ID: 145, ALIAS: 'PICKER' }), 'https://h.oraclecloudapps.com/ords/f?p=PICKER', 'URL from an APEX_APPLICATIONS row (alias)');
eq(X.urlFromApp('https://h.oraclecloudapps.com/ords/WKSP_GRAYSAPP', { APPLICATION_ID: 145 }), 'https://h.oraclecloudapps.com/ords/f?p=145', '… or the id');
ok(!X.check(X.DEFAULT_BUILDER).ok, 'the default builder address is the builder, not an app');

console.log((n - bad) + ' / ' + n + ' passed');
if (bad) process.exit(1);

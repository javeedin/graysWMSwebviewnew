#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════════
// BUILD mobile/ — the FCPos picker app (javeedin/reerpPOSMobileApp, an Expo / React Native app) as a static web build that
// the WMS desktop embeds on its "Picker app" page (wms/picker-app.js). Run it again whenever the mobile app changes:
//
//   node tools/mobile/build-mobile.js                       clone the branch into a work folder, npm ci, export, write mobile/
//   node tools/mobile/build-mobile.js --src C:\dev\FCPos    use an existing checkout (its node_modules too; --skip-install)
//   options: --repo URL  --branch NAME  --work DIR  --out DIR  --skip-install  --keep-work
//
// Steps: 1 get the source  2 apply the launch fix (src/services/wmsService.js lists getBipExceptionId and
// closeShippingException in its `export default {…}` block before those constants exist — Hermes on Android allows it,
// a browser throws "Cannot access … before initialization"; the block is moved to the end of the file, and restored
// after the export when --src is a checkout of yours)  3 npm ci  4 npx expo export -p web  5 write mobile/: the
// exported bundle and assets with RELATIVE paths (the WMS pages are file:// pages), index.html with build-info.js and
// bridge.js (tools/mobile/bridge.js — routes the app's Oracle calls through the WMS host) loaded before the app.
// Needs Node 18+ and git. Nothing is pushed anywhere.
// ═══════════════════════════════════════════════════════════════════════════════
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const args = process.argv.slice(2);
function opt(name, def) { const i = args.indexOf('--' + name); return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : def; }
const flag = name => args.includes('--' + name);
const REPO = opt('repo', 'https://github.com/javeedin/reerpPOSMobileApp.git');
const BRANCH = opt('branch', 'claude/general-session-ZWv1c');
const OUT = path.resolve(opt('out', path.join(ROOT, 'mobile')));
const SRC_GIVEN = opt('src', '');
const WORK = path.resolve(opt('work', path.join(os.tmpdir(), 'grayswms-mobile-build')));
const SKIP_INSTALL = flag('skip-install');
const win = process.platform === 'win32';

function log(s) { console.log('[build-mobile] ' + s); }
function run(cmd, cmdArgs, cwd, env) {
    log(cmd + ' ' + cmdArgs.join(' ') + '   (in ' + cwd + ')');
    const r = spawnSync(win ? cmd + (cmd === 'git' ? '' : '.cmd') : cmd, cmdArgs, { cwd, stdio: 'inherit', shell: win, env: Object.assign({}, process.env, env || {}) });
    if (r.status !== 0) throw new Error(cmd + ' failed with exit code ' + r.status);
}
function rmrf(p) { fs.rmSync(p, { recursive: true, force: true }); }
function copyDir(from, to) { fs.mkdirSync(to, { recursive: true }); for (const e of fs.readdirSync(from, { withFileTypes: true })) { const a = path.join(from, e.name), b = path.join(to, e.name); if (e.isDirectory()) copyDir(a, b); else fs.copyFileSync(a, b); } }

// ── 1 source ──
let src = SRC_GIVEN ? path.resolve(SRC_GIVEN) : path.join(WORK, 'src');
if (SRC_GIVEN) {
    if (!fs.existsSync(path.join(src, 'package.json'))) throw new Error('--src has no package.json: ' + src);
    log('using the checkout at ' + src);
} else {
    if (fs.existsSync(path.join(src, '.git'))) {
        log('updating ' + src);
        run('git', ['-C', src, 'fetch', '--depth', '1', 'origin', BRANCH], ROOT);
        run('git', ['-C', src, 'checkout', '-q', '-B', 'build', 'FETCH_HEAD'], ROOT);
    } else {
        rmrf(src); fs.mkdirSync(WORK, { recursive: true });
        run('git', ['clone', '--depth', '1', '--branch', BRANCH, REPO, src], ROOT, { GIT_LFS_SKIP_SMUDGE: '1' });
    }
}
const commit = (() => { const r = spawnSync('git', ['-C', src, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8', shell: win }); return r.status === 0 ? r.stdout.trim() : ''; })();
const appJson = JSON.parse(fs.readFileSync(path.join(src, 'app.json'), 'utf8'));
const appVersion = (appJson.expo && appJson.expo.version) || '';
const appName = (appJson.expo && appJson.expo.name) || 'FCPos';
log('app ' + appName + ' ' + appVersion + ' · branch ' + BRANCH + ' · commit ' + (commit || '?'));

// ── 2 the launch fix (restored afterwards when the checkout is yours) ──
const svcPath = path.join(src, 'src', 'services', 'wmsService.js');
let svcOriginal = null;
if (fs.existsSync(svcPath)) {
    const s = fs.readFileSync(svcPath, 'utf8');
    const m = /\r?\nexport default \{[\s\S]*?\r?\n\};\r?\n/.exec(s);
    if (m && !/export default WMS_DEFAULT_EXPORT/.test(s)) {
        svcOriginal = s;
        const block = m[0].replace('export default {', 'const WMS_DEFAULT_EXPORT = {');
        fs.writeFileSync(svcPath, s.slice(0, m.index) + s.slice(m.index + m[0].length).replace(/\s+$/, '') + '\n' + block.replace(/\s+$/, '') + '\nexport default WMS_DEFAULT_EXPORT;\n');
        log('launch fix applied to src/services/wmsService.js (the default export now follows the constants it lists)');
    } else log('launch fix: ' + (m ? 'already applied' : 'default export block not found — nothing changed'));
}

try {
    // ── 3 install ──
    if (!SKIP_INSTALL) {
        const env = { ELECTRON_SKIP_BINARY_DOWNLOAD: '1', PUPPETEER_SKIP_DOWNLOAD: '1', PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1' };
        const hasLock = fs.existsSync(path.join(src, 'package-lock.json'));
        try { run('npm', [hasLock ? 'ci' : 'install', '--no-audit', '--no-fund', '--loglevel=error'], src, env); }
        catch (e) { if (!hasLock) throw e; log('npm ci failed, trying npm install'); run('npm', ['install', '--no-audit', '--no-fund', '--loglevel=error'], src, env); }
    } else log('npm install skipped');

    // ── 4 export ──
    const dist = path.join(WORK, 'dist-web');
    rmrf(dist); fs.mkdirSync(WORK, { recursive: true });
    run('npx', ['expo', 'export', '-p', 'web', '--output-dir', dist], src, { CI: '1', EXPO_NO_TELEMETRY: '1' });
    const webDir = path.join(dist, '_expo', 'static', 'js', 'web');
    const entry = fs.readdirSync(webDir).find(f => /^AppEntry-.*\.js$/.test(f));
    if (!entry) throw new Error('no AppEntry bundle in ' + webDir);

    // ── 5 mobile/ ──
    rmrf(OUT); fs.mkdirSync(OUT, { recursive: true });
    copyDir(path.join(dist, '_expo'), path.join(OUT, '_expo'));
    if (fs.existsSync(path.join(dist, 'assets'))) copyDir(path.join(dist, 'assets'), path.join(OUT, 'assets'));
    if (fs.existsSync(path.join(dist, 'favicon.ico'))) fs.copyFileSync(path.join(dist, 'favicon.ico'), path.join(OUT, 'favicon.ico'));
    let patched = 0;
    for (const f of fs.readdirSync(path.join(OUT, '_expo', 'static', 'js', 'web'))) {
        const p = path.join(OUT, '_expo', 'static', 'js', 'web', f); let js = fs.readFileSync(p, 'utf8');
        const before = js.length; js = js.replace(/"\/assets\//g, '"assets/').replace(/"\/_expo\//g, '"_expo/');
        if (js.length !== before || true) { fs.writeFileSync(p, js); patched++; }
    }
    let html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8')
        .replace(/(src|href)="\/(_expo|assets|favicon)/g, '$1="$2')
        .replace(/<title>[^<]*<\/title>/, '<title>' + appName + '</title>');
    const inject = '<script src="build-info.js"></script><script src="bridge.js"></script>';
    html = /<script src="_expo/.test(html) ? html.replace('<script src="_expo', inject + '<script src="_expo') : html.replace('</body>', inject + '</body>');
    fs.writeFileSync(path.join(OUT, 'index.html'), html);
    fs.copyFileSync(path.join(__dirname, 'bridge.js'), path.join(OUT, 'bridge.js'));
    const info = { app: appName, version: appVersion, repo: REPO, branch: BRANCH, commit, builtAt: new Date().toISOString(), entry };
    fs.writeFileSync(path.join(OUT, 'build-info.js'), '// written by tools/mobile/build-mobile.js — do not edit\nwindow.WMS_MOBILE_BUILD = ' + JSON.stringify(info, null, 2) + ';\n');
    fs.writeFileSync(path.join(OUT, 'README.md'), '# mobile/\n\nThe FCPos picker app (' + REPO + ', branch `' + BRANCH + '`) as a static web build, embedded by the WMS desktop\'s **Picker app** page (`wms/picker-app.js`). Generated by `node tools/mobile/build-mobile.js` — do not edit by hand; `bridge.js` comes from `tools/mobile/bridge.js`.\n\n' + 'Built ' + info.builtAt + ' from commit ' + (commit || '?') + ' (app version ' + appVersion + ').\n');
    const size = (function walk(d) { let n = 0; for (const e of fs.readdirSync(d, { withFileTypes: true })) n += e.isDirectory() ? walk(path.join(d, e.name)) : fs.statSync(path.join(d, e.name)).size; return n; })(OUT);
    log('wrote ' + OUT + ' — ' + (size / 1e6).toFixed(1) + ' MB, entry ' + entry + ', ' + patched + ' bundle(s) made relative');
    if (!flag('keep-work') && !SRC_GIVEN) log('work folder kept at ' + WORK + ' (reused next time; delete it to start clean)');
} finally {
    if (svcOriginal !== null && SRC_GIVEN) { fs.writeFileSync(svcPath, svcOriginal); log('launch fix removed again from your checkout (' + path.relative(src, svcPath) + ' restored)'); }
}

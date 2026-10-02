// ESLint (flat config) for the AI Agent page. Run: npx eslint@9 -c aiagent/eslint.config.mjs aiagent
// Plain <script> files share globals (no modules), so the cross-file names are declared here; no-undef then catches typos.
const shared = ['AG', 'AGF', 'VOICE', 'PHONE', 'CAM', 'TECH', 'CODE', 'AG_APEX', 'AG_ORDS', 'AG_MRA_CHECK', 'AG_FUSION', '$', 'esc', 'hasHost', 'appUser', 'ls', 'lsSet', 'lit', 'vlit', 'clob', 'money', 'ago', 'hex16', 'sleep',
    'toast', 'openModal', 'closeModal', 'host', 'hostOk', 'hub', 'apex', 'rows', 'dbWrite', 'md', 'isNum', 'numv', 'fmt', 'curData', 'sqlPreview',
    'agItems', 'agF', 'agKey', 'agAddDays', 'agTripLines', 'agPool', 'sendMessageToCSharp', 'FileReader', 'LocalJobs', 'agDmy', 'agToday', 'agInst'];
const globals = Object.fromEntries(shared.map((g) => [g, 'writable']));
Object.assign(globals, {
    window: 'readonly', document: 'readonly', localStorage: 'readonly', sessionStorage: 'readonly', navigator: 'readonly', location: 'readonly', console: 'readonly',
    setTimeout: 'readonly', clearTimeout: 'readonly', setInterval: 'readonly', clearInterval: 'readonly', Promise: 'readonly', URL: 'readonly', Blob: 'readonly',
    ClipboardItem: 'readonly', crypto: 'readonly', Uint8Array: 'readonly', confirm: 'readonly', encodeURIComponent: 'readonly', Chart: 'readonly', JSON: 'readonly', MutationObserver: 'readonly', DOMParser: 'readonly', Audio: 'readonly', SpeechSynthesisUtterance: 'readonly', speechSynthesis: 'readonly', btoa: 'readonly', Float32Array: 'readonly', Int16Array: 'readonly', ArrayBuffer: 'readonly', DataView: 'readonly', Image: 'readonly', performance: 'readonly'
});
export default [{
    files: ['**/*.js'],
    languageOptions: { ecmaVersion: 2018, sourceType: 'script', globals },
    rules: {
        'no-undef': 'error', 'no-unused-vars': ['warn', { vars: 'local', args: 'none', caughtErrors: 'none' }], 'no-dupe-keys': 'error', 'no-duplicate-case': 'error',
        'no-unreachable': 'error', 'no-redeclare': ['error', { builtinGlobals: false }], 'no-func-assign': 'error', 'no-self-assign': 'error', 'no-cond-assign': ['error', 'except-parens'],
        'use-isnan': 'error', 'valid-typeof': 'error', 'no-constant-condition': ['error', { checkLoops: false }], 'eqeqeq': ['warn', 'smart']
    }
}];

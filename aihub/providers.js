/* AI Hub › Providers: switch each provider on, give it keys (sent once to the hub → Windows Credential Manager, never
   shown again), choose region / models / allowed data classes, Discover models and Test. */
var AWS_REGIONS = ['us-east-1', 'us-east-2', 'us-west-1', 'us-west-2', 'ca-central-1', 'eu-central-1', 'eu-central-2', 'eu-west-1', 'eu-west-2', 'eu-west-3',
    'eu-north-1', 'eu-south-1', 'eu-south-2', 'ap-south-1', 'ap-south-2', 'ap-northeast-1', 'ap-northeast-2', 'ap-northeast-3', 'ap-southeast-1', 'ap-southeast-2',
    'ap-southeast-3', 'ap-southeast-4', 'me-central-1', 'il-central-1', 'af-south-1', 'sa-east-1', 'ca-west-1'];
var PROV_META = {
    bedrock: { logo: 'AWS', bg: '#232f3e', help: 'Claude in Amazon Bedrock — the Messages API on AWS infrastructure (bedrock-mantle). Needs model access in the Bedrock console and an IAM principal allowed <code>bedrock-mantle:CreateInference</code>, or a short-term Bedrock API key (bearer). Model ids carry the <code>anthropic.</code> prefix.' },
    'bedrock-converse': { logo: 'AWS', bg: '#ff9900', help: 'Other Bedrock models (Amazon Nova, Meta Llama, Mistral …) through the Converse API. Press <b>Discover</b> to list what your account can call (IAM <code>bedrock:ListFoundationModels</code> + <code>bedrock:InvokeModel</code>).' },
    'claude-aws': { logo: 'AWS', bg: '#0f766e', help: 'Claude Platform on AWS — operated by Anthropic, billed through AWS Marketplace, same features as the Claude API on the day they ship. Needs the workspace ID and SigV4 credentials (or a short-term API key). Bare model ids.' },
    anthropic: { logo: 'A', bg: '#d97757', help: 'Claude on the Claude API directly. Use <b>Copy app Claude key</b> to reuse the key saved in this app\'s AI settings.' },
    nvidia: { logo: 'NV', bg: '#76b900', help: 'NVIDIA NIM on NVIDIA\'s hosted API (build.nvidia.com → Get API key, <code>nvapi-…</code>; free credits to start). OpenAI-compatible. Press <b>Discover</b> to list the models. Allowed only public data by default.' },
    demo: { logo: 'D', bg: '#64748b', help: 'Offline and free: answers come from simple rules. Keeps every screen and the Pipeline Doctor working without any cloud key.' }
};
var PV = { test: {}, disc: {} };

function provRender() {
    var el = $('page-providers');
    if (AH.need(el)) return;
    el.innerHTML = '<div class="empty"><i class="fa-solid fa-spinner fa-spin"></i> Loading providers…</div>';
    AH.loadConfig(true).then(provDraw).catch(function (e) { el.innerHTML = '<div class="card err">' + esc(e) + '</div>'; });
}
function provDraw() {
    var el = $('page-providers'), dcs = (AH.cfg && AH.cfg.data_classes) || ['public', 'internal', 'fusion-data', 'personal'];
    el.innerHTML = '<h2><i class="fa-solid fa-cloud"></i> Providers</h2><p class="lead">AWS first: Claude in Amazon Bedrock, Claude Platform on AWS and the other Bedrock models. NVIDIA NIM for open models. Keys go to the hub once and live in this PC\'s Windows Credential Manager — this page never shows them again.</p>' +
        '<div class="grid g2">' + AH.providers.map(function (p) {
            var m = PROV_META[p.id] || { logo: '?', bg: '#64748b', help: '' }, aws = /^(bedrock|bedrock_converse|claude_aws)$/.test(p.type), t = PV.test[p.id];
            var sec = function (name, label, ph) { return '<label class="f">' + label + ' ' + (p.secrets && p.secrets[name] ? '<span class="saved"><i class="fa-solid fa-lock"></i> saved</span>' : '') +
                '<input type="password" autocomplete="new-password" data-secret="' + name + '" placeholder="' + (p.secrets && p.secrets[name] ? '•••••• leave empty to keep' : ph) + '"></label>'; };
            var f = '';
            if (aws) {
                f += '<label class="f">Region<select data-k="region">' + AWS_REGIONS.map(function (r) { return '<option' + (p.region === r ? ' selected' : '') + '>' + r + '</option>'; }).join('') + '</select></label>';
                f += '<label class="f">Sign in with<select data-k="auth" onchange="provAuth(this)">' + [['keys', 'Access key + secret (SigV4)'], ['bearer', 'API key (bearer token)'], ['profile', 'AWS profile on this PC']]
                    .map(function (a) { return '<option value="' + a[0] + '"' + ((p.auth || 'keys') === a[0] ? ' selected' : '') + '>' + a[1] + '</option>'; }).join('') + '</select></label>';
                if (p.type === 'claude_aws') f += '<label class="f">Workspace ID<input type="text" data-k="workspace_id" value="' + esc(p.workspace_id || '') + '"></label>';
                f += '<div class="auth-keys"' + ((p.auth || 'keys') !== 'keys' ? ' hidden' : '') + ' style="display:contents">' + sec('aws_access_key', 'Access key ID', 'AKIA…') + sec('aws_secret_key', 'Secret access key', '') + '</div>';
                f += '<div class="auth-bearer"' + (p.auth !== 'bearer' ? ' hidden' : '') + ' style="display:contents">' + sec('api_key', 'API key (bearer)', 'short-term token') + '</div>';
                f += '<div class="auth-profile"' + (p.auth !== 'profile' ? ' hidden' : '') + ' style="display:contents"><label class="f">Profile<input type="text" data-k="profile" value="' + esc(p.profile || '') + '" placeholder="default"></label></div>';
            } else if (p.type === 'anthropic') f += sec('api_key', 'Claude API key', 'sk-ant-…');
            else if (p.type === 'nvidia') f += sec('api_key', 'NVIDIA API key', 'nvapi-…') + '<label class="f">Endpoint<input type="text" data-k="base_url" value="' + esc(p.base_url || '') + '"></label>';
            var models = (p.models || []).map(function (x) { return '<span class="mchip">' + esc(x) + (p.type !== 'demo' ? '<button title="Remove" onclick="provModel(\'' + p.id + '\',\'' + esc(x) + '\',false)"><i class="fa-solid fa-xmark"></i></button>' : '') + '</span>'; }).join('') || '<span class="muted sm">no model yet</span>';
            var disc = PV.disc[p.id];
            return '<div class="card prov" data-pid="' + p.id + '"><div class="prov-h"><div class="plogo" style="background:' + m.bg + '">' + m.logo + '</div><div class="grow"><b>' + esc(p.label) + '</b><div class="sm">' +
                (p.enabled ? (p.configured ? '<span class="chip on"><span class="dot"></span>ready</span>' : '<span class="chip mid"><span class="dot"></span>' + esc(p.missing) + '</span>') : '<span class="chip off"><span class="dot"></span>off</span>') + '</div></div>' +
                '<label class="switch" title="On / off"><input type="checkbox" ' + (p.enabled ? 'checked' : '') + ' onchange="provSave(\'' + p.id + '\', {enabled: this.checked})"><span></span></label></div>' +
                '<p class="muted sm">' + m.help + '</p>' + (f ? '<div class="fields">' + f + '</div>' : '') +
                '<div><div class="row" style="margin-bottom:5px"><b class="sm">Models</b><span class="grow"></span>' + (p.type !== 'demo' ? '<input type="text" class="sm" placeholder="add a model id" style="width:200px" onkeydown="if(event.key===\'Enter\'){provModel(\'' + p.id + '\', this.value, true)}">' : '') +
                (/bedrock_converse|nvidia/.test(p.type) ? '<button class="btn sm" onclick="provDiscover(\'' + p.id + '\')"><i class="fa-solid fa-magnifying-glass"></i> Discover</button>' : '') + '</div><div class="models">' + models + '</div>' +
                (disc ? '<div style="margin-top:6px;max-height:160px;overflow:auto" class="models">' + (disc.error ? '<span class="err sm">' + esc(disc.error) + '</span>' : disc.models.slice(0, 120).map(function (x) {
                    return '<span class="mchip" style="cursor:pointer;background:#fff" title="' + esc((x.vendor || '') + (x.on_demand === false ? ' · needs provisioned throughput / inference profile' : '')) + '" onclick="provModel(\'' + p.id + '\',\'' + esc(x.id) + '\',true)"><i class="fa-solid fa-plus"></i>' + esc(x.id) + '</span>'; }).join('')) + '</div>' : '') + '</div>' +
                '<div><b class="sm">May see</b><div class="dclass">' + dcs.map(function (d) { return '<label><input type="checkbox" data-dc="' + d + '" ' + ((p.data_classes || []).indexOf(d) >= 0 ? 'checked' : '') + '> ' + d + '</label>'; }).join('') + '</div></div>' +
                (t ? '<div class="testres ' + (t.ok ? 'ok' : 'bad') + '">' + (t.ok ? '<i class="fa-solid fa-check"></i> ' + esc(t.model) + ' answered in ' + t.ms + ' ms: “' + esc(t.reply) + '”' : '<i class="fa-solid fa-xmark"></i> ' + esc(t.error)) + '</div>' : '') +
                '<div class="row">' + (p.type !== 'demo' ? '<button class="btn primary" onclick="provSaveCard(\'' + p.id + '\')"><i class="fa-solid fa-floppy-disk"></i> Save</button>' : '') +
                '<button class="btn" onclick="provTest(\'' + p.id + '\')"' + (p.enabled ? '' : ' disabled title="Switch it on first"') + '><i class="fa-solid fa-vial"></i> Test</button>' +
                (p.type === 'anthropic' && AH.st && AH.st.hasAppClaudeKey ? '<button class="btn" onclick="AH.copyKey();setTimeout(provRender,1500)"><i class="fa-solid fa-key"></i> Copy app Claude key</button>' : '') + '</div></div>';
        }).join('') + '</div>';
}
function provAuth(sel) {
    var card = sel.closest('.prov');
    ['keys', 'bearer', 'profile'].forEach(function (a) { var x = card.querySelector('.auth-' + a); if (x) x.hidden = sel.value !== a; });
}
function provSave(pid, body) {
    return hub('PUT', '/providers/' + pid, body).then(function () { return AH.loadConfig(true); }).then(provDraw).catch(function (e) { toast(String(e), 'err'); });
}
/** Settings + any typed secrets (one PUT each; the inputs are cleared). */
function provSaveCard(pid) {
    var card = document.querySelector('.prov[data-pid="' + pid + '"]'), body = {}, secrets = [];
    card.querySelectorAll('[data-k]').forEach(function (i) { body[i.dataset.k] = i.value.trim(); });
    body.data_classes = Array.prototype.map.call(card.querySelectorAll('[data-dc]:checked'), function (i) { return i.dataset.dc; });
    card.querySelectorAll('[data-secret]').forEach(function (i) { if (i.value.trim() && !i.closest('[hidden]')) secrets.push({ name: i.dataset.secret, value: i.value.trim() }); i.value = ''; });
    var p = hub('PUT', '/providers/' + pid, body);
    secrets.forEach(function (s) { p = p.then(function () { return hub('PUT', '/providers/' + pid + '/secret', s); }); });
    p.then(function () { toast('Saved' + (secrets.length ? ' (' + secrets.length + ' key' + (secrets.length > 1 ? 's' : '') + ' → Credential Manager)' : ''), 'ok'); return AH.loadConfig(true); })
        .then(provDraw).catch(function (e) { toast(String(e), 'err'); });
}
function provModel(pid, id, add) {
    id = String(id || '').trim(); if (!id) return;
    var p = AH.providers.filter(function (x) { return x.id === pid; })[0];
    var list = (p.models || []).filter(function (x) { return x !== id; });
    if (add) list.push(id);
    provSave(pid, { models: list });
}
function provDiscover(pid) {
    PV.disc[pid] = { models: [], error: null };
    toast('Asking the provider which models you can use…');
    hub('GET', '/providers/' + pid + '/models').then(function (r) { PV.disc[pid] = r.ok ? { models: r.models } : { error: r.error, models: [] }; provDraw(); })
        .catch(function (e) { PV.disc[pid] = { error: String(e), models: [] }; provDraw(); });
}
function provTest(pid) {
    toast('Testing ' + AH.provName(pid) + '…');
    hub('POST', '/providers/' + pid + '/test', {}).then(function (r) { PV.test[pid] = r; provDraw(); }).catch(function (e) { PV.test[pid] = { ok: false, error: String(e) }; provDraw(); });
}

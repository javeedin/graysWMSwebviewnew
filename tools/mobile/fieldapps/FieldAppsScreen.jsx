/* Field Apps screen for the FCPos mobile app — REFERENCE CODE for the mobile repo (javeedin/reerpPOSMobileApp).
 * This file is not built here. Copy it into the app as src/screens/FieldAppsScreen.js (rename .jsx → .js), register it in
 * src/navigation/AppNavigator.js (PickerStack and MainStack) and add a tile on WMSHomeScreen, then copy
 * fieldapps/runtime/shell.html + fa-apex.js + fa-shell.js into the app's assets (Android: android/app/src/main/assets/fieldapps/;
 * iOS: the bundle) so the shell is trusted code shipped with the app, not downloaded.
 *
 * What it does (see docs/FIELD_APPS.md › Host protocol):
 *   - pairs the phone once with the QR / code the desktop shows (POST field/pair → device key, kept in AsyncStorage)
 *   - lists the apps published to this login (GET field/apps), caches bundles per version
 *   - runs one app in react-native-webview on the shell and answers its ops: hello, bundle, query, submit, upload,
 *     photo (expo-camera), scan (expo-camera barcode), gps (expo-location), print (printerService ESC/POS), log
 *   - pushes events: online/offline, hardware back → 'back'
 *   - APEX apps (kind APEX — a native Oracle APEX application built in App Builder): the shell verifies the signed launcher and
 *     asks 'launch' {url, hosts}; this screen then shows that APEX address full screen in its own WebView (only the app's host,
 *     the signed extra hosts and Oracle APEX hosts may be navigated to), with a small back / reload / close bar; APEX signs the
 *     user in with the app's own authentication and keeps its session cookie in the WebView
 * Packages used: react-native-webview, expo-camera (already in the app), @react-native-async-storage/async-storage,
 * expo-location (optional — gps answers null without it), expo-file-system (optional, bundle cache on disk). */
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, FlatList, StyleSheet, Alert, BackHandler, TextInput, Modal, Platform } from 'react-native';
import { WebView } from 'react-native-webview';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { getInstance, getUserData } from '../services/api';
import printerService from '../services/printerService';

const BASE = 'https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/WAREHOUSEMANAGEMENT';
const SHELL = Platform.OS === 'android' ? 'file:///android_asset/fieldapps/shell.html' : 'fieldapps/shell.html';
const K_DEVICE = 'fieldapps.device';       // { deviceId, key, username, keys: [{keyId, spki}] }
const K_BUNDLE = id => 'fieldapps.bundle.' + id;
// same rule as fieldapps/runtime/fa-apex.js FAX.mayNavigate: https only; the app's host, the signed extra hosts, Oracle APEX hosts
const APEX_SUFFIXES = ['.oraclecloudapps.com', '.oraclecloud.com'];
function hostOf(u) { const m = /^https:\/\/([^\/?#:]+)/i.exec(String(u || '')); return m ? m[1].toLowerCase() : null; }
function mayNavigate(target, appUrl, hosts) {
    if (/^(about:|data:|blob:)/i.test(String(target || ''))) return true;
    const h = hostOf(target); if (!h) return false;
    if (h === hostOf(appUrl)) return true;
    if (APEX_SUFFIXES.some(x => h.endsWith(x))) return true;
    return (hosts || []).some(x => { x = String(x || '').toLowerCase().replace(/^\*\./, '.'); return x && (x[0] === '.' ? h.endsWith(x) : h === x); });
}

async function api(path, opts) {
    const dev = JSON.parse((await AsyncStorage.getItem(K_DEVICE)) || 'null');
    const sep = path.indexOf('?') >= 0 ? '&' : '?';
    const url = BASE + '/' + path + (dev && dev.key ? sep + 'k=' + encodeURIComponent(dev.key) : '');
    const r = await fetch(url, opts);
    const text = await r.text();
    let j = null; try { j = JSON.parse(text); } catch (e) { }
    if (!r.ok || (j && j.ok === false)) throw new Error((j && j.error) || ('HTTP ' + r.status));
    return j;
}

export default function FieldAppsScreen({ navigation }) {
    const [device, setDevice] = useState(null);
    const [apps, setApps] = useState([]);
    const [open, setOpen] = useState(null);           // app id running in the WebView
    const [apex, setApex] = useState(null);           // { url, hosts, toolbar, name } — an APEX app opened full screen
    const [pairing, setPairing] = useState(false);
    const [code, setCode] = useState('');
    const [camera, setCamera] = useState(null);       // { mode: 'photo' | 'scan' | 'pair', resolve }
    const [permission, requestPermission] = useCameraPermissions();
    const web = useRef(null);
    const cam = useRef(null);
    const user = useRef(null);

    useEffect(() => { (async () => { user.current = await getUserData(); setDevice(JSON.parse((await AsyncStorage.getItem(K_DEVICE)) || 'null')); })(); }, []);
    const refresh = useCallback(async () => {
        try { const r = await api('field/apps'); setApps(r.items || []); if (r.keys) { const d = JSON.parse((await AsyncStorage.getItem(K_DEVICE)) || '{}'); d.keys = r.keys; await AsyncStorage.setItem(K_DEVICE, JSON.stringify(d)); setDevice(d); } }
        catch (e) { if (/pair this phone/i.test(e.message)) { await AsyncStorage.removeItem(K_DEVICE); setDevice(null); } else Alert.alert('Field Apps', e.message); }
    }, []);
    useEffect(() => { if (device && device.key) { refresh(); const t = setInterval(refresh, 60000); return () => clearInterval(t); } }, [device, refresh]);
    useEffect(() => { const sub = BackHandler.addEventListener('hardwareBackPress', () => { if (apex) { if (web.current) web.current.goBack(); return true; } if (open) { deliver({ faHost: 1, event: 'back', data: {} }); return true; } return false; }); return () => sub.remove(); }, [open, apex]);

    // ── pairing ──────────────────────────────────────────────────
    async function pair(codeText) {
        try {
            const r = await fetch(BASE + '/field/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: codeText, label: (user.current && user.current.username) + ' · ' + Platform.OS, platform: Platform.OS, appVersion: '1.1.9' }) });
            const j = await r.json();
            if (!j.ok) throw new Error(j.error || 'Pairing failed');
            const d = { deviceId: j.deviceId, key: j.key, username: j.username, keys: j.keys || [] };
            await AsyncStorage.setItem(K_DEVICE, JSON.stringify(d)); setDevice(d); setPairing(false); setCode('');
        } catch (e) { Alert.alert('Pairing', e.message); }
    }
    function onPairScan(data) { let c = data; try { const j = JSON.parse(data); if (j && j.t === 'fieldapps') c = j.code; } catch (e) { } setCamera(null); pair(String(c).trim()); }

    // ── the shell's host ops ─────────────────────────────────────
    function deliver(reply) { if (web.current) web.current.injectJavaScript('window.__faDeliver(' + JSON.stringify(JSON.stringify(reply)) + '); true;'); }
    async function handle(msg) {
        const a = msg.args || {};
        switch (msg.op) {
            case 'hello': return { user: device.username, device: device.deviceId, pod: (await getInstance()) || 'PROD', platform: Platform.OS, keys: device.keys || [], online: true, allowUnsigned: false, params: {}, settings: {}, appId: open };
            case 'bundle': {
                const meta = apps.find(x => x.appId === open);
                const cached = JSON.parse((await AsyncStorage.getItem(K_BUNDLE(open))) || 'null');
                if (cached && meta && String(cached.version) === String(meta.version) && cached.codeSha256 === meta.codeSha256) return cached;
                const b = await api('field/apps/' + encodeURIComponent(open));
                await AsyncStorage.setItem(K_BUNDLE(open), JSON.stringify(b));
                return b;
            }
            case 'query': return (await api('field/query', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ app: open, name: a.name, params: a.params || {} }) })).items || [];
            case 'submit': return await api('field/submit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subId: a.subId, app: open, kind: a.kind, ref: a.ref, amount: a.amount, doc: a.doc }) });
            case 'upload': {
                const ph = a.photo || {}, meta = Object.assign({ app: open }, a.meta || {}, { width: ph.width, height: ph.height, taken: ph.at });
                const b64 = String(ph.dataUrl || '').split(',')[1] || '';
                const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
                return await api('field/photos?m=' + encodeURIComponent(JSON.stringify(meta)), { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: bytes });
            }
            case 'photo': return await new Promise(resolve => { setCamera({ mode: 'photo', resolve }); });
            case 'scan': return await new Promise(resolve => { setCamera({ mode: 'scan', resolve }); });
            case 'gps': { try { const Location = require('expo-location'); const { status } = await Location.requestForegroundPermissionsAsync(); if (status !== 'granted') return null; const p = await Location.getCurrentPositionAsync({}); return { lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy }; } catch (e) { return null; } }
            case 'print': { for (let i = 0; i < (a.copies || 1); i++) await printerService.printText(a.text || '', { title: a.title }); return true; }   // adapt to printerService's API
            case 'log': return true;
            case 'appReady': return true;
            case 'launch': setApex({ url: a.url, hosts: a.hosts || [], toolbar: a.toolbar !== false, name: a.name }); return { handled: true };
            case 'appError': Alert.alert('App', a.error || 'error'); return true;
            default: throw new Error('Unknown op ' + msg.op);
        }
    }
    async function onMessage(ev) {
        let msg; try { msg = JSON.parse(ev.nativeEvent.data); } catch (e) { return; }
        if (!msg || msg.faHost !== 1) return;
        try { const data = await handle(msg); deliver({ faHost: 1, id: msg.id, ok: true, data: data === undefined ? null : data }); }
        catch (e) { deliver({ faHost: 1, id: msg.id, ok: false, error: e.message }); }
    }
    async function snap() {
        if (!cam.current || !camera) return;
        const p = await cam.current.takePictureAsync({ quality: 0.8, base64: true, skipProcessing: true });
        const r = camera.resolve; setCamera(null);
        r({ dataUrl: 'data:image/jpeg;base64,' + p.base64, width: p.width, height: p.height, at: new Date().toISOString().slice(0, 19), gps: null });
    }

    // ── screens ──────────────────────────────────────────────────
    if (!device || !device.key) return (
        <View style={s.center}>
            <Text style={s.h1}>Field Apps</Text>
            <Text style={s.p}>Pair this phone once: on the desktop open Field Apps › Devices › Pair a phone, then scan the QR or type the code.</Text>
            <TouchableOpacity style={s.btn} onPress={async () => { if (!permission || !permission.granted) await requestPermission(); setCamera({ mode: 'pair', resolve: null }); }}><Text style={s.btnT}>Scan the QR</Text></TouchableOpacity>
            <TextInput style={s.input} placeholder="or type the 8-letter code" autoCapitalize="characters" value={code} onChangeText={setCode} />
            <TouchableOpacity style={[s.btn, s.btn2]} onPress={() => pair(code)}><Text style={s.btnT}>Pair</Text></TouchableOpacity>
            {cameraModal()}
        </View>
    );
    if (open && apex) return (
        <View style={{ flex: 1 }}>
            {apex.toolbar ? <View style={s.abar}>
                <TouchableOpacity onPress={() => web.current && web.current.goBack()}><Text style={s.abtn}>‹</Text></TouchableOpacity>
                <Text style={s.atitle} numberOfLines={1}>{apex.name || 'APEX app'}</Text>
                <TouchableOpacity onPress={() => web.current && web.current.reload()}><Text style={s.abtn}>⟳</Text></TouchableOpacity>
                <TouchableOpacity onPress={() => { setApex(null); setOpen(null); }}><Text style={s.abtn}>✕</Text></TouchableOpacity>
            </View> : null}
            <WebView ref={web} source={{ uri: apex.url }} javaScriptEnabled domStorageEnabled sharedCookiesEnabled thirdPartyCookiesEnabled setSupportMultipleWindows={false}
                onShouldStartLoadWithRequest={r => mayNavigate(r.url, apex.url, apex.hosts)} />
            {!apex.toolbar ? <TouchableOpacity style={s.close} onPress={() => { setApex(null); setOpen(null); }}><Text style={s.closeT}>✕</Text></TouchableOpacity> : null}
        </View>
    );
    if (open) return (
        <View style={{ flex: 1 }}>
            <WebView ref={web} source={{ uri: SHELL + '#app=' + encodeURIComponent(open) }} onMessage={onMessage} originWhitelist={['*']} allowFileAccess allowFileAccessFromFileURLs domStorageEnabled javaScriptEnabled
                mediaPlaybackRequiresUserAction={false} setSupportMultipleWindows={false} onShouldStartLoadWithRequest={r => r.url.startsWith('file:') || r.url.startsWith('about:')} />
            <TouchableOpacity style={s.close} onPress={() => setOpen(null)}><Text style={s.closeT}>✕</Text></TouchableOpacity>
            {cameraModal()}
        </View>
    );
    return (
        <View style={{ flex: 1, backgroundColor: '#f3f5f9' }}>
            <View style={s.top}><Text style={s.topT}>Field Apps</Text><Text style={s.topS}>{device.username} · {device.deviceId}</Text></View>
            <FlatList data={apps} keyExtractor={x => x.appId} refreshing={false} onRefresh={refresh}
                ListEmptyComponent={<Text style={s.p}>No app published to you yet — the desktop publishes them.</Text>}
                renderItem={({ item }) => (
                    <TouchableOpacity style={s.tile} onPress={() => setOpen(item.appId)}>
                        <Text style={s.icon}>{item.icon || '📱'}</Text>
                        <View style={{ flex: 1 }}><Text style={s.name}>{item.name}</Text><Text style={s.meta}>{item.kind === 'APEX' ? 'APEX app · ' : ''}v{item.version} · {item.expiresAt ? 'until ' + item.expiresAt.slice(0, 10) : 'no expiry'}</Text></View>
                    </TouchableOpacity>
                )} />
            <TouchableOpacity style={s.forget} onPress={async () => { await AsyncStorage.removeItem(K_DEVICE); setDevice(null); }}><Text style={s.meta}>Unpair this phone</Text></TouchableOpacity>
        </View>
    );
    function cameraModal() {
        if (!camera) return null;
        return (
            <Modal visible animationType="slide" onRequestClose={() => { const r = camera.resolve; setCamera(null); if (r) r(null); }}>
                <CameraView ref={cam} style={{ flex: 1 }} facing="back" barcodeScannerSettings={camera.mode === 'photo' ? undefined : { barcodeTypes: ['qr', 'ean13', 'ean8', 'code128', 'code39', 'upc_a', 'upc_e', 'itf14', 'datamatrix'] }}
                    onBarcodeScanned={camera.mode === 'photo' ? undefined : (e) => { if (camera.mode === 'pair') onPairScan(e.data); else { const r = camera.resolve; setCamera(null); r({ code: e.data, format: e.type }); } }} />
                <View style={s.camBar}>
                    {camera.mode === 'photo' ? <TouchableOpacity style={s.shutter} onPress={snap} /> : <Text style={s.camT}>Point at the {camera.mode === 'pair' ? 'QR on the desktop' : 'barcode'}</Text>}
                    <TouchableOpacity onPress={() => { const r = camera.resolve; setCamera(null); if (r) r(null); }}><Text style={s.camX}>Cancel</Text></TouchableOpacity>
                </View>
            </Modal>
        );
    }
}
const s = StyleSheet.create({
    center: { flex: 1, padding: 24, justifyContent: 'center', backgroundColor: '#f3f5f9' },
    h1: { fontSize: 24, fontWeight: '800', color: '#0f172a', marginBottom: 8 }, p: { color: '#64748b', marginBottom: 16, padding: 8 },
    btn: { backgroundColor: '#1e3a8a', borderRadius: 12, padding: 14, alignItems: 'center', marginTop: 8 }, btn2: { backgroundColor: '#0ea5e9' }, btnT: { color: '#fff', fontWeight: '700', fontSize: 16 },
    input: { backgroundColor: '#fff', borderRadius: 12, padding: 14, marginTop: 16, fontSize: 18, letterSpacing: 4, textAlign: 'center' },
    top: { backgroundColor: '#13315c', padding: 16 }, topT: { color: '#fff', fontSize: 18, fontWeight: '800' }, topS: { color: '#cbd5e1', fontSize: 12 },
    tile: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', margin: 10, marginBottom: 0, padding: 14, borderRadius: 14, elevation: 2 },
    icon: { fontSize: 30, marginRight: 14 }, name: { fontSize: 16, fontWeight: '700', color: '#0f172a' }, meta: { fontSize: 12, color: '#64748b' },
    forget: { padding: 16, alignItems: 'center' },
    abar: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#13315c', paddingHorizontal: 8, paddingVertical: 6 }, abtn: { color: '#fff', fontSize: 22, paddingHorizontal: 12 }, atitle: { flex: 1, color: '#fff', fontWeight: '700' },
    close: { position: 'absolute', top: 8, left: 8, backgroundColor: 'rgba(15,23,42,.6)', borderRadius: 16, width: 32, height: 32, alignItems: 'center', justifyContent: 'center' }, closeT: { color: '#fff', fontWeight: '700' },
    camBar: { position: 'absolute', bottom: 0, left: 0, right: 0, padding: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: 'rgba(0,0,0,.4)' },
    shutter: { width: 64, height: 64, borderRadius: 32, backgroundColor: '#fff', borderWidth: 4, borderColor: '#cbd5e1' }, camT: { color: '#fff', fontWeight: '600' }, camX: { color: '#fff', fontWeight: '700', padding: 10 }
});

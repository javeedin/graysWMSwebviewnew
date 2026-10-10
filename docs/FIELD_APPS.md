# Field Apps — apps made on the desktop, running on the pickers' phones

Field Apps is the channel between the Gray's WMS desktop and the FCPos mobile app. A supervisor makes an
app on the desktop (the built-in POS, an HTML file, something the AI Agent wrote), signs it, and publishes
it to chosen mobile logins. The phones see it within a minute, run it offline, and send back sales, counts,
reports and photos. The desktop reads them, counts the photos with its vision worker, and keeps the POS
books.

```
desktop (fieldapps/)                       APEX (WKSP_GRAYSAPP)                         FCPos (phone)
┌──────────────────────┐   gateway SQL    ┌──────────────────────────┐   field/* ORDS   ┌──────────────────────┐
│ Apps · Preview       │ ───────────────▶ │ WMS_FIELD_APPS (signed)  │ ◀─────────────── │ Field Apps screen    │
│ Results · Photos     │ ◀─────────────── │ WMS_FIELD_SUBMISSIONS    │ ───────────────▶ │ runtime/shell.html   │
│ POS · Devices · Setup│                  │ WMS_FIELD_PHOTOS (BLOB)  │                  │   └ app (sealed)     │
│ host: sign, fetch    │                  │ WMS_POS_*                │                  │ camera · scanner     │
└──────────────────────┘                  └──────────────────────────┘                  └──────────────────────┘
```

## What is where

| Piece | Path |
|---|---|
| Desktop page | `fieldapps/index.html`, `fa-core.js` (screens), `fa-store.js` (APEX), `fa-host.js` (host of the preview), `fieldapps.css` |
| Host | `classes/Form1_FieldAppHandlers.cs` — `fieldAppKeys`, `fieldAppSign`, `fieldAppFetch`, `fieldAppUpload` |
| Runtime shell | `fieldapps/runtime/shell.html` + `fa-shell.js` — embedded by the desktop preview and by FCPos |
| POS app | `fieldapps/apps/pos/` (manifest, engine, screens, styles) → built into `fieldapps/apps/pos.app.js` |
| Build | `node fieldapps/build-app.js` (`--check` in CI) |
| APEX | `apex_sql/97_field_apps.sql` — tables (the page creates them too), procedures, ORDS handlers |
| FCPos reference | `tools/mobile/fieldapps/FieldAppsScreen.jsx` — the screen to add to the mobile repo |
| Tests | `fieldapps/tests/pos-engine.test.js`, `fieldapps/tests/clob.test.js` |

## Setup, once

1. Open **Field Apps › Setup** inside the WMS. The tables are created on first use.
2. Run `apex_sql/97_field_apps.sql` in SQL Developer or APEX SQL Workshop as the workspace schema. It adds the
   procedures and the `field/*` handlers the phones call. The gateway cannot do this (it refuses PL/SQL), so
   Setup only tells you whether `field/ping` answers.
3. Publish an app once as an AI admin. That creates this PC's signing key
   (`%APPDATA%\GraysWMS\FieldApps\signing.key`, DPAPI) and puts its public key into
   `WMS_FIELD_SETTINGS.signing_keys`. Every other admin PC gets its own key the same way.
4. **POS › Import items** and **Import customers** for the pod the tills sell on (paste from Excel, or an
   APEX SQL returning the Order Pad's price-list columns). Discount rules come from `WMS_OM_DISCOUNTS`.

## Publishing an app

Apps › *New app from a built-in* (the POS), *from an HTML file*, or *Blank app*. The editor holds the
name, icon, pod, expiry, **who gets it** (mobile logins from `GR_MOBILE_USER`, or everyone), the settings
JSON the app reads as `FA.ctx.settings`, the **queries** it may ask for by name, and the code.

*Save & publish* = version + 1, the code and manifest written to APEX and **read back**: only a copy APEX kept
exactly (same SHA-256) is signed — the host's ECDSA P-256 signature over `appId.version.codeSha.manifestSha` —
the public key published, the row set to PUBLISHED. A copy that comes back different leaves the app a draft
and the message names the first character that differs. **Check** on an app card reads it back exactly as a
phone would (code, hash, key, signature) and says whether the phones will run it. *Kill* hides the app on every
phone at its next check. An expired app stops the same way.

CLOBs through the gateway: Oracle counts characters (code points) where JavaScript counts UTF-16 units, and the
query gateway fetches every text column into a 4,000-**byte** buffer — a 3,900-character piece of code with
box-drawing banners or accents came back cut short and the published app died with syntax errors. `fa-store.js`
therefore writes `TO_CLOB` literals of at most 1,000 characters / 3,800 bytes (never cut inside a surrogate
pair), reads pieces of 600 characters as columns of one query, and checks every write and read against
`LENGTH()`; a CLOB that does not round-trip throws instead of running damaged.

**Preview** runs the app in a phone frame with this page as the host: the queries go through the gateway,
the submissions land in APEX exactly as a phone's would, photos come from the webcam or a file and go
through `field/photos` with the desktop's own device key, the console shows every host call, and the
*online* switch queues what the app sends until it is ticked again.

## APEX apps

An **APEX app** is a real Oracle APEX application, built and run by APEX itself — not HTML made here. Field Apps
only publishes it: it decides who gets the tile and signs the address, and the phone opens the app full screen.

1. **Build it in APEX.** Apps › **APEX App Builder** opens the workspace sign-in in your browser. The address is
   set in Setup › *APEX App Builder* (shared setting `apex_builder` in `WMS_FIELD_SETTINGS`); the default is the
   Grays `apextestdb` workspace. You sign in with your own APEX workspace login — no password is kept anywhere in
   the WMS. In App Builder: *Create › New Application*, Universal Theme, tick *Install Progressive Web App*, and
   choose how people sign in (APEX accounts, or the same login as the WMS).
2. **Register it.** Apps › **New APEX app** creates a draft of kind `APEX`. The editor takes the address of the
   *running* app — `https://…/ords/r/<workspace>/<app>/home` or `…/ords/f?p=<app>` — pasted, or chosen with
   *Pick from APEX* (`APEX_APPLICATIONS` of the gateway's workspace; APEX's own internal and builder apps are
   left out).
   - The address is checked: https, an Oracle APEX host (`*.oraclecloudapps.com` / `*.oraclecloud.com`, or a
     host you list), `/ords/` in the path, and not the App Builder / workspace sign-in.
   - The `session=` / debug parts of a copied address are dropped.
   - `{{USER}}`, `{{POD}}`, `{{DEVICE}}` and `{{APP}}` may be passed as page items for context (e.g.
     `…/f?p=145:1::::::P0_POD:{{POD}}`). They are never a sign-in: the APEX app's own authentication decides who
     gets in.
   - *Other hosts* allows a single sign-on hop (e.g. `login.microsoftonline.com`).
3. **Save & publish.** The app's "code" is a small launcher, `{"type":"apex","url":…,"hosts":[…],"toolbar":true}`
   (`runtime/fa-apex.js` `FAX.code`). It is signed like any app, so nobody can point the tile elsewhere without
   a new signature — the shell refuses a changed address.
4. **On the phone** the shell verifies the launcher and asks the host to `launch` it. FCPos opens the address in
   its own WebView, full screen, with a back / reload / close bar. It may only navigate to the app's host, the
   listed hosts and Oracle APEX hosts (`FAX.mayNavigate`).

Changes made in APEX show at once. Publish again only to change the address, the hosts or who gets the app.

In **Preview** the phone frame goes to the APEX address. If it stays blank, the app refuses frames (*Shared
Components › Security › Browser Security › Embed in Frames*). The phone is not affected — use *Open in a window*.

## Pairing a phone

Devices › *Pair a phone*: choose the mobile login, a label, and show the QR (or the 8-letter code). In FCPos,
*Field Apps › Add app* scans it. The phone posts the code to `field/pair` and gets its device key once; the
key is kept hashed in `WMS_FIELD_DEVICES`. *Revoke* cuts a phone off at once.

## The app contract

An app is one HTML file. The shell seals it (sandboxed frame, CSP with no network), so bundle every library
the app needs. The SDK `FA` is injected before the app's code:

```js
FA.ready(function (ctx) { /* ctx: appId, version, user, device, pod, platform, online, settings, manifest, signed */ });
FA.query('items', { POD: ctx.pod })          // rows of the app's stored query "items" (upper-case keys)
FA.submit('stock_count', doc, { ref, amount }) // → { ok, subId, queued }   queued = kept on the device while offline
FA.photo({ title }).then(p => FA.upload(p, { trip, bay, ref1, ref2, note, expected }))  // p = { dataUrl, width, height, at, gps }
FA.scan()        // → { code, format } | null       FA.gps() // → { lat, lng, acc } | null
FA.print({ text, html, copies, title })        // ESC/POS text and HTML; the host prints
FA.store.get(k) / set(k, v) / del(k) / keys()  // this device, this app
FA.toast(msg), FA.close(), FA.open(appId), FA.log(...)
FA.on('barcode' | 'online' | 'back' | 'ctx', fn)
```

Queries are SQL stored in APEX by the desktop (`WMS_FIELD_QUERIES`): a single SELECT or WITH;
`{{POD}}`, `{{USER}}`, `{{DEVICE}}` and the parameters the app passes become quoted literals. The phone never
sends SQL. Submissions are stored raw in `WMS_FIELD_SUBMISSIONS`; the kinds `pos_sale` and `pos_shift` are
unpacked into the POS tables by the handler (and by the desktop's *Process new* for anything left NEW).

## Host protocol (what FCPos implements)

The shell (`runtime/shell.html#app=<id>`) talks to its host with `{ faHost: 1, id, op, args, app }` and
expects `{ faHost: 1, id, ok, data | error }`. In react-native-webview: `onMessage` receives the shell's
messages (`window.ReactNativeWebView.postMessage`), and the screen answers with
`injectJavaScript('window.__faDeliver(' + JSON.stringify(reply) + ')')`. Events go the same way:
`{ faHost: 1, event: 'barcode' | 'online' | 'back' | 'ctx', data }`.

| op | args | answer |
|---|---|---|
| `hello` | `{ app, shell }` | `{ user, device, pod, platform, keys: [{keyId, spki}], online, allowUnsigned: false, params, settings, appId }` |
| `bundle` | `{ app }` | the row of `field/apps/:id` (cached on the phone per version) |
| `query` | `{ app, name, params }` | rows of `field/query` |
| `submit` | `{ app, subId, kind, ref, amount, doc }` | `field/submit` |
| `upload` | `{ app, photo: {dataUrl, width, height, at}, meta }` | `field/photos` → `{ ok, photoId }` |
| `photo` | `{ title }` | expo-camera → `{ dataUrl, width, height, at, gps }` (resized to ~1600 px) |
| `scan` | `{}` | the barcode scanner → `{ code, format }` |
| `gps` | `{}` | `{ lat, lng, acc }` |
| `print` | `{ text, html, copies, title }` | the receipt printer (ESC/POS text) |
| `launch` | `{ url, hosts, toolbar, name, appId }` | APEX apps only: open `url` full screen in the host's own WebView and answer `{ handled: true }`; an older host that answers *Unknown op* gets the shell navigating there itself |
| `log`, `appReady`, `appError` | | fire and forget |

The shell verifies the bundle's signature with the `keys` the host hands over (from `field/apps` or pairing)
before anything runs. A bundle that does not verify, or has expired, never runs on a phone.

## The POS

A till for vans and shop counters, priced by the Order Pad's engine so the shop, the van and Fusion agree:
customer + marketing + additional discounts, VAT by tax code, deposits, crates (`om/om-engine.js`). Shift
with a float, sales, returns at the price paid, cash / card / mobile money / on account, change, parked
sales, receipts on the printer, X report and close with a cash count. Everything is kept on the device and
sent to APEX; offline sales are queued and flushed. The desktop's POS tab shows sales, tenders and shifts
per pod and day, each sale with its lines and payments, and imports the catalogue.

Settings the maker edits in the manifest: `currency`, `precision`, `cashRounding` (0 = none, 0.05, 1),
`maxDiscountPct`, `allowPriceEdit`, `allowReturns`, `receiptCols` (32 / 42 / 48), `receiptCopies`,
`catalogueHours`, `numberPrefix`, `taxRates`, `tenders`, `quickCash`, `language` (en / fr), `shop` (name,
address, phone, brn, vat, footer).

Not in this version: real-time MRA from the van (the sale is stored with `mra.status = PENDING` for the
existing MRA paths), card terminal SDKs, cash drawer control.

## Security

- The database is not the trust boundary; the signature is. Only AI admins can sign (`fieldAppSign`), it is
  audited, and the private key never leaves the PC.
- Apps run sealed: no network from the app, no access to the shell or the phone's storage beyond `FA.store`.
- The phone holds a device key (hashed in APEX), never Oracle credentials; every handler checks it; revoke
  cuts it off.
- Queries are stored SQL chosen by the desktop, read-only, with parameters as literals.

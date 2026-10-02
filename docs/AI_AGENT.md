# AI Agent — what it is and how it replaces the AI Digital Employee

The **AI Agent** (Home › AI Agent, beta) is a team of AI specialists that work inside the WMS app:

| Specialist | Does | Typical tools |
|---|---|---|
| Fusion Analyst | answers questions with Fusion data | company knowledge, dictionary, dry run → run (confirm), analyse, chart, save query, watchdog |
| WMS Operator | trips, printing, MRA | trips, orders on a trip, print jobs, printers, MRA status, send to MRA (confirm), AI inbox |
| Order Desk | sales orders | find / explain orders, live Fusion status, prepare an order in the Order Pad (confirm) |
| Data Loader | FBDI and REST loads | FBDI templates, loads, REST fields / records |
| Reporter | reports and schedules | Fusion Model measures and reports, report builder, scheduled jobs (confirm) |

Everything the **AI Digital Employee** can do is available too, with the same knowledge (schema catalog, Fusion REST
catalog, trained processes) and the same policies: WMS database reads and writes, Fusion REST, ORDS helpers, printers and
order PDFs, the intake folder (it can read PDFs and images), e-mail, background jobs (DB and LOCAL lane — LOCAL jobs also
run while the AI Agent page is open), WMS API forms, interactive lists, saved reports, DLLs, the Fusion Model, MRA and the
Daily Tasks board (left side: *Today's tasks* → ▶ works one and logs every step). Attach files with the paperclip.

A supervisor picks the specialist (or pin one on the left, or start with `@wms`, `@orders`, `@fbdi`, `@report`).

## Rich answers and formatting

Answers are rendered by `aiagent/format.js` (`AGF.md`), so the agent can write real Markdown:

- headings, **bold** / *italic* / ==highlight== / ~~strike~~, nested, numbered and task lists, quotes, rules and tables (`|---:|` = right-aligned);
- links that work: `[text](https://…)` and bare URLs open in the user's browser (host `openExternalUrl`, http/https only), `[text](ask:question)` sends a follow-up question, `[text](page:fusionsql)` opens an app page, `[text](result:<id>)` shows a result, `mailto:` opens the mail app;
- status badges `[[ok:Printed]]` `[[warn:Pending]]` `[[bad:Failed]]` `[[info:PROD]]`, callouts (`> [!NOTE]`, `[!TIP]`, `[!WARNING]`, `[!DANGER]`), code with a Copy button, inline charts (a ```chart JSON block, drawn with Chart.js — a table when it cannot load) and ```html blocks.

HTML always goes through the allow-list sanitizer `AGF.clean` (no scripts, event handlers, iframes, forms, `javascript:` links, `url()` styles or fixed positioning). Three tools build on it:

| Tool | What it does |
|---|---|
| `format_result` | formats any result in the panel without a new query: per column `link` (URL template with `{VALUE}` / `{OTHER_COLUMN}`), `email`, `number`, `money` (currency), `percent`, `date`, `datetime`, `badge`, `bar` (in-cell data bar), `bool`, `bytes`, `duration`, value rules and colours, coloured rows, hidden / ordered columns, sort, a title and a note. **Copy formatted** pastes the same look into Outlook, Teams, Word or Excel. |
| `render` | a formatted document (letter, e-mail draft, checklist, comparison …) in the results panel with Print / PDF, Copy formatted and Save .html |
| `open_url` | opens a web page in the user's browser and leaves a clickable link in the chat |

The `grid` tool takes the same column formats (`formats`).

## Voice mode and phone calls

**Talk to it.** Press the microphone next to Send (or Ctrl+Shift+V). The agent listens, answers out loud in short natural sentences and listens again — talk over it to interrupt, say "stop" to silence it, "goodbye" to end. Lists and data still go to the results panel. Answer question cards by voice; anything that changes data still needs a click on its card.

Voice settings (slider icon in the voice bar): pick the **language** (English US / UK, French, Hindi, Arabic, German, Spanish, Chinese — the agent then answers in it) and **Female / Male**, then how natural it should sound. "Natural — free, runs on this PC" needs one click (also offered in the voice bar as **Natural voice (free)**); "Windows voices" are the old robotic ones.

| | Most natural | Also good | Free |
|---|---|---|---|
| Voice you hear | ElevenLabs (`eleven_flash_v2_5`) | Azure neural, Amazon Polly generative | Piper (natural, on this PC) · browser (Windows, robotic) |
| Listening | ElevenLabs Scribe | Azure Speech | local Whisper (`pip install faster-whisper` in the AI Hub's `.venv`) |

**Phone calls (Twilio).** Header › phone icon › Settings:
1. A Twilio account and number; paste the Account SID, auth token (kept in the hub's Credential Manager) and number.
2. On the AI Hub PC run `cloudflared tunnel --url http://localhost:8101` and paste the https address; tick "Phone calls on", Save, restart the AI Hub, then "Point the Twilio number here".
3. Known numbers: number → app user + PIN. Callers who type their PIN (then #) get read-only answers as that user (keep the AI Agent open on their PC); everybody else can leave a message.

Ask the agent "call +230 5xxx xxxx and confirm tomorrow's 10:00 delivery for SO1234" — it shows a confirm card, then talks with the person itself. Live transcripts, messages and summaries are in the Calls dialog. On every call the agent says it is an AI and that the call is transcribed, and it cannot change anything during a call. Check the rules for recording / AI calls in the countries you call.

## Track tech — what answered your prompt

Tick **Track tech** (bottom line of the chat). Every answer then gets a layers icon; it opens the path of that answer: your page (WebView2) → the C# host (kill switch, audit) → the AI Hub (FastAPI) → **LangGraph** (which nodes ran, how often it paused for tools or your confirm) → **LangChain** (`GatewayChatModel`, tools offered) → the AI Hub router → the provider SDK (Anthropic SDK for Claude on Bedrock / AWS / direct, boto3 for other Bedrock models, httpx for NVIDIA) → the model, with times, tokens and cost per model call, every tool with the technology behind it, and the installed versions.

## Code tab — run Python, C#, JavaScript, PowerShell or HTML

The **Code** tab (next to **Chat**) is a small workspace: write or paste code, pick the language, press **Run** (Ctrl+Enter). Give it a result as `input.csv`, print what you need, write `output.csv` for a table (one click puts it in the results panel) and save a `.png` for a chart. **Save** (Ctrl+S) keeps it in APEX with a name and description so you — or the agent — can run it again later. A missing language is one **Install** click (Python from python.org, the .NET SDK from Microsoft, Node.js), installed for your Windows user only.

The agent can write and run code itself (`run_code`), but always shows you the full code on a confirm card first. Only AI admins can run code; every run is audited. Code runs with your Windows rights in its own process and folder — read it before you approve.

**HTML / CSS / JS** is different: it is not run on Windows but shown live under the editor in a sealed frame (no access to the app, your files, other pages or Windows), so anyone can preview pages, forms and mock-ups. `console.log` and script errors appear in the **Console** tab, `localStorage` works for the life of the preview, the picked result is `window.INPUT = { columns, rows }`, and **Full screen** / **Save .html** take it further.

**Data** (button next to the time limit) adds up to three read-only queries — Fusion SQL on this page's pod, PROD or TEST, or APEX SQL — that run right before each run (one-click starters: Fusion customers, items, warehouses, WMS trips). **Test** shows rows and columns; results are kept 5 minutes while you edit (**Fresh data next run** reloads). HTML reads them as `DATA.customers.rows` / `DATA.customers.columns` (the first one is also `INPUT`); Python, C#, Node and PowerShell get `customers.csv` in their folder. The queries are saved with the code. While an HTML preview holds data it has no network: no fetch, no outside images or forms, no popups, and the app cancels any attempt to navigate the frame away — so a pasted page can show your Fusion data but cannot send it anywhere.

## Vision tab — OpenCV, YOLO, gestures and skeletons

**Photo · OpenCV.** Put pictures in the tray (files, drag & drop, Ctrl+V, *From chat*, camera snapshots), pick an operation, press **Run**:

| Operation | What it does |
|---|---|
| Detect (YOLO) | Finds and names objects (people, trucks, bottles … 80 kinds) with counts; outlines (-seg), people skeletons (-pose), or your own trained model |
| Count anything | Type what to count — people, chickens, cars, bottles … (YOLO) — or drag a box around ONE example (a remote key, a carton, a bottle top) and it counts everything like it. Click a mark to remove it, an empty spot to add one; save the marked picture, send the list to the results panel or the chat |
| Scan document | Finds the page in a photo, flattens it, colour / gray / black-and-white |
| Read barcodes | Every format — Code 128 / 39, EAN, UPC, QR, DataMatrix, PDF417 … |
| Count objects | Cartons, bottles, tops (touching ones are split; *round things* for caps and coins) |
| Compare | Before / after: aligns the photos, % similar, marks what changed |
| Find | Where a label or logo (2nd picture) appears in a scene (1st) |
| Enhance · Photo check · Edges · Resize | Clean up, sharp or blurry / too dark, outline, smaller copy |

Results show the annotated pictures, the numbers, and tables you can send to the results panel or ask the agent about. An AI admin sets it up once per PC (**Set up**, ~100 MB; **YOLO + PyTorch**, ~600 MB more). Your own YOLO models (`.pt` trained on pallets, cartons, forklifts …) go in the **Models** folder. Photos are deleted from the work folder after each run.

> [!WARNING]
> Ultralytics YOLO is licensed **AGPL-3.0**. Using it inside a product you distribute commercially needs an Ultralytics Enterprise licence. OpenCV, zxing-cpp, PyTorch and MediaPipe are permissive (Apache / BSD).

**Live · gestures & skeleton.** Start the camera: hands (21 points each) with gestures, body skeleton with elbow / knee angles, face mesh and — with YOLO set up — live object boxes, drawn as a sci-fi HUD. It runs in the app window with Google MediaPipe (the models download once); no picture leaves the PC unless you send one. Hold a gesture for about a second to trigger what you chose (pausing is only the **Pause** button): 👍 take a photo, ✌️ scan barcodes, 🤟 send a photo to the chat, or YOLO / voice on and off. **Barcode scanner (continuous)** reads codes straight from the camera about three times a second at full HD: each code is outlined, beeps once and goes into the *Scanned codes* list (copy it or send it to the results panel). If a barcode is in view but cannot be read yet, an amber box says why — usually *move closer*: each bar needs about 3 pixels, so hold it at roughly a third of the picture's width, steady and flat. **Posture coach** watches lifting: bending the back with straight knees shows *BEND YOUR KNEES* and is counted.

**The agent** has a `vision` tool for the same operations on pictures in the conversation — "read the barcode on this label", "how many cartons are on this pallet?", "what changed between these two photos?" — and answers from the exact numbers.

## Camera

Press the camera next to the paperclip (or ask: "take a picture of this delivery note"). A live preview opens in the chat; you press **Take picture** (or Space), add more pages if needed, then **Use**. The photos go to the model, which reads text, tables, labels and handwriting — ask it to turn them into text, a table in the results panel, or to match a delivery note against an order. The agent never takes a picture by itself, and the camera is off as soon as the card closes. If Windows blocks it: Settings › Privacy & security › Camera, and check the laptop's camera shutter key.

## Safety model

* **Read first, act second.** Read tools run at once; anything that runs a big query, changes data or sends something
  (Fusion run, MRA, save, watchdog, order draft, schedule) shows a confirm card.
* **The app enforces it, not the prompt.** The C# host registers each card (fingerprint of the tool, the exact input
  and the pod) and refuses the action without it. Policies (AI Digital Employee › Policies) can make an action AUTO
  (small runs only) or DENY it. The AI kill switch stops everything. Every action is audited (source `AIAGENT`).
* **Fusion SQL is always dry-run.** The graph refuses `fusion_sql_run` unless exactly that SQL passed a dry run
  (row count + sample) in the same conversation.
* **Credentials never leave the app.** Fusion, APEX and MRA calls run in the host / page with the app's own
  credentials; the AI Hub (where the agent's brain runs) never sees them. Memory never stores passwords.

## Roll-out

1. **Beta** (now): both modules side by side. Users try the AI Agent; 👍 / 👎 on answers are recorded.
2. **Evidence**: AI Agent › Roll-out › *Run evals* on the model you plan to use (Auto = the AI Hub router). The
   scoreboard shows routing, tool use, safety and cost per run. Aim for all cases passing, safety ok.
3. **Switch**: an AI admin sets the mode to **PRIMARY** (reason required). The AI Digital Employee page then sends
   its users to the AI Agent with a banner. **OFF** closes the AI Agent for non-admins.
4. **Retire**: when nobody needs the old page, leave `aianalysis` out of the release (Admin › Create ZIP › modules).

## Running the evals without the app

```
cd ai-hub
python -m ai_hub eval-agent                                   # offline demo planner (CI does this)
python -m ai_hub eval-agent --provider bedrock --model anthropic.claude-sonnet-5-5 --all
```

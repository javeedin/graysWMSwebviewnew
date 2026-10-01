# Gray's WMS — AI Hub

A small Python service next to the WMS app (`127.0.0.1:8100`) that is the **only** place holding cloud keys and the
only thing that talks to model providers. The WMS page **AI Hub** installs, starts and drives it; nothing to do by hand.

```
 WMS pages ──► host relay (token · AI kill switch · WMS_AI_AUDIT) ──► AI Hub ──► Claude in Amazon Bedrock
                                                                     │  router   Claude Platform on AWS
                                                                     │  ledger   Amazon Bedrock Converse (Nova, Llama, Mistral …)
                                                                     │  evals    Claude API (direct)
                                                                     └ agents   NVIDIA NIM (hosted)
```

## What it does

| Piece | File | What |
|---|---|---|
| Providers | `ai_hub/providers.py` | `bedrock` = Claude in Amazon Bedrock (`anthropic.AnthropicBedrockMantle`, ids `anthropic.claude-…`); `claude_aws` = Claude Platform on AWS (`anthropic.AnthropicAWS`, bare ids + workspace id); `bedrock_converse` = other Bedrock models through boto3 Converse (models discovered with `ListFoundationModels`); `anthropic` = Claude API; `nvidia` = NVIDIA NIM hosted API (OpenAI-compatible REST, models discovered); `demo` = offline rules. Auth for AWS: access key + secret (SigV4), a Bedrock API key (bearer) or a local AWS profile. A `refusal` stop reason counts as a failure, so the router moves on. |
| Router | `ai_hub/gateway.py` | task → ordered candidates (`fusion_sql`, `pipeline_doctor`, `default`, `cheap`, your own); skips providers that are off, not configured or not allowed the task's **data class** (public / internal / fusion-data / personal); a **monthly budget** stops paid models; every attempt goes to the ledger. `compare()` sends one prompt to up to 6 models at once. |
| Ledger | `ai_hub/usage.py` | SQLite `data\usage.db`: one row per attempt (task, provider, model, ok, ms, tokens, cost, user, fallback). Prices per model in the config (Claude list prices filled in, others editable). |
| LangChain | `ai_hub/lc.py` | `GatewayChatModel` — the router as a LangChain `BaseChatModel`: any LangChain / LangGraph code gets routing, fallback, budget and the ledger. |
| LangGraph | `ai_hub/agents/pipeline_doctor.py` | **Pipeline Doctor**: `triage → diagnose → verify ⏸ → propose → approval ⏸ → apply ⏸ → report`, SQLite checkpointer (`data\agents.db`) so a thread waits for days and survives restarts. The three ⏸ are interrupts the WMS page answers: run the test SQL on the task's source (read-only), a person approves / rejects / edits the patch, the page writes the patch to `WMS_PIPE_TASKS` and queues a re-run. Only the fields in `PATCHABLE` can be changed. |
| API | `ai_hub/api.py` | Bearer token. `/health`, `/config`, `/providers` (+ `PUT /providers/{id}`, `PUT …/secret`, `POST …/test`, `GET …/models`), `PUT /routes`, `POST /v1/chat`, `/v1/compare`, `/v1/route-preview`, `GET /usage`, `/agents/doctor/graph · start · threads · {id} · {id}/resume`. |

Keys: Windows Credential Manager (`keyring`, service `GraysAiHub`, names `<provider>.aws_access_key | aws_secret_key | api_key`).
They are sent once from the page (or, for the Claude key, copied by the app through stdin) and never returned by the API.
The API token is made by the WMS app and kept DPAPI-encrypted in `%APPDATA%\GraysWMS\AiHub\hub.json`; the hub stores only its SHA-256.

## Run

From the app: **AI Hub › Overview › Install** (copies the files to `C:\fusion\ai-hub`, private Python 3.12 unless 3.11+ exists,
`.venv`, `pip install -r requirements.txt`, settings, optional Claude key) → **Start** (tick *show its window* to watch it).
By hand: `.venv\Scripts\python -m ai_hub run` (`start-hub.bat`). Logs: `data\logs\hub.log`.

Tests (any OS): `pip install -r requirements.txt pytest && python -m pytest` — routing / fallback / refusal / budget / data
policy, the Bedrock client wiring, NVIDIA over a mocked HTTP transport, the LangChain adapter, the Doctor graph (interrupts,
a restart in the middle, reject, advice-only) and the API.

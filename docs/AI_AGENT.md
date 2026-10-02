# AI Agent — what it is and how it replaces the AI Digital Employee

The **AI Agent** (Home › AI Agent, beta) is a team of AI specialists that work inside the WMS app:

| Specialist | Does | Typical tools |
|---|---|---|
| Fusion Analyst | answers questions with Fusion data | company knowledge, dictionary, dry run → run (confirm), analyse, chart, save query, watchdog |
| WMS Operator | trips, printing, MRA | trips, orders on a trip, print jobs, printers, MRA status, send to MRA (confirm), AI inbox |
| Order Desk | sales orders | find / explain orders, live Fusion status, prepare an order in the Order Pad (confirm) |
| Data Loader | FBDI and REST loads | FBDI templates, loads, REST fields / records |
| Reporter | reports and schedules | Fusion Model measures and reports, report builder, scheduled jobs (confirm) |

A supervisor picks the specialist (or pin one on the left, or start with `@wms`, `@orders`, `@fbdi`, `@report`).

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

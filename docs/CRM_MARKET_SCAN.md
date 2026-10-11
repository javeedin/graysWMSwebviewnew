# CRM market scan — what comparable products do, and what we could add

Context: Gray's Customer CRM (`crm/`) for a B2B FMCG distributor in Mauritius on Oracle Fusion (OM, AR, Inventory) + our WMS.
Researched 2026-10 from web search results (vendor sites and third-party write-ups); feature claims are as the vendors state
them — check in a demo before relying on one. *(gk)* = general knowledge, not a cited source.

## Products looked at

| # | Product | Fits whom | Stand-out features for us |
|---|---|---|---|
| 1 | **Oracle Fusion CX** (Sales, Service, Field Service) + Fusion **Advanced Collections** | Oracle ERP shops | Native Fusion data; CPQ quotes → orders; collector workbench, collection strategies, dunning, promise to pay; Digital Assistant chatbot; assisted field scheduling. Heavy and per-user licensed; no FMCG retail execution |
| 2 | **Salesforce** Sales Cloud, Agentforce Service, **Consumer Goods Cloud** | Mid / large, integrator budget | Retail execution: visit planning on maps, in-store tasks, offline order capture, image recognition for planogram / out-of-stock; WhatsApp / SMS, AI replies; Oracle only via MuleSoft |
| 3 | **Microsoft Dynamics 365** Sales, Customer Service / Contact Center, Field Service | Microsoft 365 shops (we use Outlook) | Sequences (call → e-mail cadences), relationship health, predictive scoring, Copilot summaries, WhatsApp through Azure, schedule board |
| 4 | **SAP Sales / Service Cloud** (consumer products) | SAP ERP shops | "Perfect store" action plans, AI visit prioritisation and weekly route planning, store audits |
| 5 | **Zoho CRM + Zoho Desk** | SMB / mid-market, low cost | Territories, Blueprint processes, WhatsApp with SLA, Zia anomaly alerts and best time to contact |
| 6 | **HubSpot** Sales / Service Hub | SMB | Customer-success workspace, health scores with alerts, AI help desk |
| 7 | **Freshworks** Freshdesk Omni, Freshcaller, Freshsales | Value contact centre | Cloud telephony (IVR, queues, wallboards), WhatsApp, Freddy AI copilot |
| 8 | **Zendesk** | Service-first | Intelligent triage (intent, sentiment, language, entities), voice triage from transcripts, side conversations |
| 9 | **HighRadius / Esker / Billtrust / Upflow / Chaser** | Collections & AR | Predicted pay dates, AI worklists, dunning ladders with payment links, dialer with transcription, credit reviews, payment portals, cash application, deductions |
| 10 | **Pepperi / Ivy Mobility / Bizom / Repsly** | FMCG route-to-market | Offline van sales and order taking, beat / route planning, suggested orders, shelf photo audits, distributor management |

## Where we stand

● strong / native · ◐ partial · ○ none

| Area | Oracle CX | Salesforce | D365 | SAP | Zoho | HubSpot | Freshworks | Zendesk | Collections tools | RTM tools | **Gray's** |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Customer 360 | ● | ● | ● | ● | ● | ● | ◐ | ◐ | ◐ | ◐ | **●** (Fusion + AR + OM + DFF) |
| Pipeline / quotes | ● | ● | ● | ● | ● | ● | ◐ | ○ | ○ | ◐ | **○** |
| Account plans / targets | ◐ | ● | ◐ | ● | ◐ | ◐ | ○ | ○ | ○ | ● | **○** |
| Visit / beat planning | ◐ | ● | ◐ | ● | ◐ | ○ | ○ | ○ | ○ | ● | **○** |
| Mobile offline orders | ◐ | ● | ● | ● | ◐ | ◐ | ◐ | ◐ | ○ | ● | **◐** (Field Apps / FCPos) |
| Ticketing / SLA / portal | ● | ● | ● | ● | ● | ● | ● | ● | ○ | ○ | **●** |
| WhatsApp / SMS | ◐ | ● | ● | ● | ● | ◐ | ● | ● | ◐ | ◐ | **○** |
| Voice / contact centre | ◐ | ● | ● | ◐ | ◐ | ◐ | ● | ● | ◐ | ○ | **◐** (softphone, CTI, recording) |
| Collections / dunning / credit | ● | ◐ | ◐ | ◐ | ○ | ○ | ○ | ○ | ● | ◐ | **●** (statements, promises, disputes) |
| Online payment portal | ◐ | ◐ | ◐ | ◐ | ◐ | ◐ | ○ | ○ | ● | ◐ | **○** |
| Marketing / campaigns | ● | ● | ● | ● | ● | ● | ◐ | ○ | ○ | ◐ | **○** |
| AI (triage, drafts, prediction) | ● | ● | ● | ● | ◐ | ● | ● | ● | ● | ◐ | **◐** (ML.NET, Customer Desk agent) |
| Oracle Fusion integration | ● | ◐ | ◐ | ○ | ◐ | ○ | ○ | ○ | ◐ | ◐ | **●** |

On service, collections and Fusion depth we are already at or above Zoho / Freshworks / Zendesk. The gaps:
route-to-market (visits, mobile orders, suggested orders), messaging (WhatsApp / SMS), customer payments, predictive
collections, and sales / account planning.

## Candidate features (ranked by value ÷ effort)

Value for a B2B FMCG distributor H / M / L · our effort S / M / L.

| # | Feature | What it does | Seen in | Value | Effort | Uses what we have |
|---|---|---|---|---|---|---|
| 1 | Lapsed-item / whitespace alerts | Items a customer stopped buying, or that similar customers buy and this one doesn't | Bizom, SAP, SF CG | H | S | `CRME.itemTrends` (STOPPED / SLOWING) + peers by segment / profit centre |
| 2 | Order-drop churn alert | Order frequency / value below the customer's own norm → a call task | HubSpot, D365 | H | S | Sales by month, health score, Needs you, the bell |
| 3 | Delivery & POD in the 360 | Trip, lorry, ETA, delivered / returned, POD on the order and in tickets | RTM tools | H | S | WMS trips (`w2_mri_*`), `editTripOrder` — answers "where is my order" |
| 4 | SMS notifications | Payment due, promise reminder, order dispatched, ticket updates | Freshworks, Zendesk, SF, D365 | H | S | Promises, WMS trip status, ticket events; needs an SMS gateway |
| 5 | Proactive service rules | Auto-ticket / notify on backorder, short-ship, cancelled lines, failed MRA, bounced cheque | SF / D365 workflows, Zendesk triggers | H | S | Cancellation autopilot, WMS alerts, AR bounced cheques |
| 6 | Call transcription + summary | Transcribe recorded calls into the log / ticket, flag sentiment | Zendesk, D365, HighRadius | M | S | Recordings + the AI Hub's local Whisper |
| 7 | AI reply drafting on tickets | Draft replies from the customer's context and similar tickets | SF, Freshdesk, HubSpot, D365 | M | S | Customer Desk agent, similar tickets, canned replies |
| 8 | Supervisor wallboard | Live queue, SLA at risk, calls waiting, call-backs due | Freshcaller, Zendesk, D365 | M | S | SLA engine, call log, CTI events, the bell |
| 9 | Outreach sequences | Planned call → e-mail → visit cadences (collections, win-back) | D365, HubSpot | M | S | Debtors activities / follow-ups |
| 10 | Territories & ownership | Rep / collector territories, reassignment, coverage KPIs | Zoho, SF, Bizom | M | S | Collectors list, routing rules |
| 11 | Dunning ladder | Reminders by days overdue × risk: friendly → firm → stop-supply → credit-hold proposal | Fusion Advanced Collections, HighRadius, Esker, Upflow | H | M | Statement cycles, AR ageing, promise history; credit hold as an approval |
| 12 | Predicted pay date / AI worklist | Predict per invoice when it will be paid; ranked collector list | HighRadius, Esker, Billtrust | H | M | AR applications (days to pay), rating A–E, ML.NET regression |
| 13 | WhatsApp Business | Two-way WhatsApp into tickets; statements, invoices, order confirmations | SF, D365, Zoho, Freshdesk, Zendesk | H | M | Ticket conversation, messages, statement PDFs; Meta Cloud API via the host |
| 14 | Suggested order | Next order from buying cycle, season and stock → Order Pad / Fusion | Pepperi, Ivy, SF CG | H | M | Items bought, Fusion on-hand, `omFusionPayload` |
| 15 | Customer hierarchy roll-up | Chains / hotel groups: consolidated AR, sales, tickets, head-office payer | All major CRMs; Esker / Billtrust | H | M | HZ relationships, "paid by another account" |
| 16 | Dispute / deduction root cause | Reason codes tied to invoice, trip and credit note; resolution SLA | HighRadius, Esker | H | M | Debtors disputes, returns, WMS trip lines, credit memos |
| 17 | Return (RMA) from a ticket | Return authorisation, pickup on a trip, credit note tracking | SF / D365, Pepperi | H | M | Fusion OM returns, WMS trips, credit memos |
| 18 | Credit limit review workflow | Scored reviews, approvals, limit / hold updates | Esker, Billtrust, Fusion Credit | H | M | Rating, limit use, bounced cheques, approval cards |
| 19 | Mobile cash collection | Collector records cash / cheque on the phone, receipt, feeds AR follow-up | Pepperi, Ivy | H | M | Field Apps (FCPos) + promises |
| 20 | Account plans & targets | Annual targets by profit centre / supplier, progress, QBR notes | SF, SAP, Bizom | M | M | Buying trends by profit centre / supplier |
| 21 | Opportunities / pipeline | New listings, hotel contracts, tenders | All CRMs | M | M | Order Pad quotes, price lists |
| 22 | Quotes / price proposals | Customer price / discount proposal PDF → order | Oracle CPQ, SF, D365 | M | M | OM discount engine, price lists |
| 23 | Promotions per customer | Which promos apply and their uplift | SF CG / TPM, Ivy, Pepperi | M | M | WMS_OM_DISCOUNTS, BOGO, sales |
| 24 | Retail execution & photo audits | Visit checklists, shelf photos, out-of-stock | SF CG, SAP, Repsly, Ivy | M | M | Field Apps photos + Vision (YOLO / count / OCR) |
| 25 | Volume rebates / loyalty | Tiers, progress, rebate statements | SF, SAP, Pepperi | M | M | Sales by customer × supplier |
| 26 | Segments & campaigns | E-mail / WhatsApp campaigns by channel, region, grade | Zoho, HubSpot, SF, D365 | M | M | Customer master + DFFs, mail host |
| 27 | Smarter triage | Sentiment, language (EN / FR / Creole), order / invoice numbers auto-linked | Zendesk, D365 | M | S | ML.NET + regex |
| 28 | Outlook activity capture | Log customer e-mails / meetings on the timeline; book visits | D365, SF, HubSpot | M | M | Outlook COM / Graph (FinanceMail) |
| 29 | Customer onboarding / KYC | BRN / VAT checks, documents, credit application, create in Fusion | Esker, Billtrust | M | M | Portal + Fusion customer REST |
| 30 | Pay-by-link / payment portal | Customers see invoices / statements and pay online | Esker, Billtrust, Upflow, HighRadius | H | L | Customer pages (`crm/t`, `dc/resp`); a payment provider + cash application |
| 31 | Visit / beat planning on a map | Weekly journey plans, GPS check-in / out | SF CG, SAP, Bizom, Repsly | H | L | Addresses, priority, AR due, buying cycle; Field Apps on phones |
| 32 | IVR / queues / ACD | Menus, skill queues, overflow to call-back | Freshcaller, Zendesk, D365 | M | L | Depends on the PBX; CTI listener exists |
| 33 | Cash application assist | Match remittances to invoices, propose Fusion receipt applications | Esker, Billtrust, HighRadius | M | L | AR open items, Fusion receipts REST |
| 34 | NPS surveys | Periodic NPS into the health score | HubSpot, Zendesk, Freshworks | L | S | Health score, mail |
| 35 | Leaderboards | Collected vs target, promises kept, tickets solved | HighRadius, Freshworks | L | S | Debtors activities + receipts |
| 36 | Data-quality checks | Duplicates, missing e-mail / phone, bad addresses | SF, Zoho, D365 | L | S | `w2_crm_customers`, DFF contacts |

**Suggested order**
1. Quick wins: 1, 2, 3, 5, 4, 6, 7, 8, 9, 10 — they reuse engines we already have.
2. Next wave: 11, 12, 13, 14, 15, 16, 17, 18, 19 — closes the gap with collections and route-to-market tools.
3. Strategic: 30 (payments), 31 (visit planning on Field Apps), 32 (contact centre), 33 (cash application).

## Sources

Oracle: docs.oracle.com (CX Sales 25A what's new; CPQ business flows; OIC CPQ → order recipe; Advanced Collections guides) ·
oracle.com B2B service brief · Salesforce: salesforce.com Consumer Goods Cloud overview, FAQ and pricing; Service Cloud ·
Microsoft: learn.microsoft.com (cases, WhatsApp via ACS, Field Service 2024 wave 2) · SAP: sap.com Sales Cloud features ·
Zoho: edition comparison PDF · HubSpot comparisons · Freshdesk / Freddy pricing write-ups (featurebase, eesel) · Zendesk:
support.zendesk.com AI overview, voice triage · HighRadius product pages · Esker credit / AR pages · Billtrust and Chaser on
fitgap / erpresearch / capterra · Pepperi (pepperi.com, Oracle mobile sales page), Ivy Mobility, Bizom, Repsly on rfp.wiki /
getapp / softwareadvice.

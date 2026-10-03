-- ============================================================
-- AGENT FLOW - DB-STORED AGENTIC FLOWS (LangGraph-style)
-- ============================================================
-- One row = one flow. The definition column holds the ENTIRE
-- flow as one JSON document: nodes (Start / Agent / Query /
-- Write / HTTP / Condition / SetVar / Approve / Email / End),
-- their positions and config, and the edges connecting them.
--
-- Designed on a visual canvas in the Agent Flow module and run
-- by agentflow/flow.js, which drives Claude (aiChatSend), the
-- guarded SQL gateways (executequery / executewrite), HTTP and
-- email through the existing WebView <-> C# bridge.
--
-- Run in SQL Workshop > SQL Commands.
-- ============================================================

CREATE TABLE wms_ai_flows (
    id           NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    flow_key     VARCHAR2(100)  NOT NULL UNIQUE,
    name         VARCHAR2(200)  NOT NULL,
    description  VARCHAR2(1000),
    definition   CLOB           NOT NULL,   -- the full flow as JSON (nodes + edges)
    active       VARCHAR2(1)    DEFAULT 'Y' NOT NULL,
    created_by   VARCHAR2(100)  DEFAULT USER,
    created_on   DATE           DEFAULT SYSDATE,
    updated_by   VARCHAR2(100),
    updated_on   DATE
);

-- Optional: log each flow run (handy for observability / audit).
CREATE TABLE wms_ai_flow_runs (
    id           NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    flow_key     VARCHAR2(100),
    run_by       VARCHAR2(100),
    started_on   TIMESTAMP DEFAULT SYSTIMESTAMP,
    status       VARCHAR2(20),               -- OK / FAILED / STOPPED
    steps        NUMBER,
    trace        CLOB                        -- JSON run trace (node -> output)
);

-- ── Demo flow: a tiny 3-node flow that works out of the box ──
-- Start -> Agent (ask Claude) -> End
INSERT INTO wms_ai_flows (flow_key, name, description, definition, active)
VALUES (
  'demo.hello.flow',
  'Hello Flow (demo)',
  'Minimal demo: collect a topic, ask Claude to summarise it, show the result.',
  '{
    "nodes": [
      { "id": "n1", "type": "start", "title": "Start", "x": 80,  "y": 80,
        "config": { "inputs": [ { "key": "topic", "label": "Topic", "default": "warehouse safety" } ] } },
      { "id": "n2", "type": "agent", "title": "Summarise", "x": 80, "y": 240,
        "config": { "system": "You are a concise assistant.", "prompt": "Give 3 bullet points about {topic}.", "outputVar": "summary" } },
      { "id": "n3", "type": "end", "title": "End", "x": 80, "y": 400,
        "config": { "outputVar": "summary" } }
    ],
    "edges": [
      { "id": "e1", "from": "n1", "to": "n2" },
      { "id": "e2", "from": "n2", "to": "n3" }
    ]
  }',
  'Y'
);

COMMIT;

-- VERIFY: SELECT flow_key, name, LENGTH(definition) FROM wms_ai_flows;

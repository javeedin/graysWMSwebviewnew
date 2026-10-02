-- 83_ai_code_snippets.sql — saved code of the AI Agent's Code tab (aiagent/code.js).
-- The page creates this table on first use; this script is for a manual setup or a review.
-- Code runs only on the PC (classes/CodeRunner.cs), never in the database; only AI admins can run it.
CREATE TABLE wms_ai_code_snippets (
    id            NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name          VARCHAR2(200)  NOT NULL,
    language      VARCHAR2(20)   NOT NULL,      -- python | csharp | javascript | powershell
    description   VARCHAR2(1000),
    code          CLOB,
    packages      VARCHAR2(1000),               -- pip / NuGet packages, comma separated
    created_by    VARCHAR2(100),
    created_date  DATE DEFAULT SYSDATE,
    changed_by    VARCHAR2(100),
    changed_date  DATE,                         -- not "updated_": the ai/executequery gateway refuses reads containing UPDATE
    last_run      DATE,
    run_count     NUMBER DEFAULT 0,
    CONSTRAINT wms_ai_code_snippets_uk UNIQUE (name)
);

-- ============================================================================
-- CHECK PROCEDURE CURSOR COLUMNS
-- ============================================================================
-- Run these queries to see what columns the procedure actually returns
-- ============================================================================

-- Method 1: Check the procedure source code
SELECT TEXT
FROM USER_SOURCE
WHERE NAME = 'RR_APEX_ENDPOINT_PKG'
  AND TYPE = 'PACKAGE BODY'
ORDER BY LINE;

-- Method 2: If there's a table, check its structure
DESC RR_ENDPOINTS;
-- or
DESC RR_APEX_ENDPOINTS;

-- Method 3: Check all tables starting with RR_
SELECT TABLE_NAME
FROM USER_TABLES
WHERE TABLE_NAME LIKE 'RR%'
ORDER BY TABLE_NAME;

-- Method 4: Check the columns of a specific table (replace TABLE_NAME)
SELECT
    COLUMN_NAME,
    DATA_TYPE,
    DATA_LENGTH,
    NULLABLE
FROM USER_TAB_COLUMNS
WHERE TABLE_NAME = 'RR_ENDPOINTS'  -- or 'RR_APEX_ENDPOINTS'
ORDER BY COLUMN_ID;

-- Method 5: Look at package spec
SELECT TEXT
FROM USER_SOURCE
WHERE NAME = 'RR_APEX_ENDPOINT_PKG'
  AND TYPE = 'PACKAGE'
ORDER BY LINE;

-- ============================================================================
-- INSTRUCTIONS
-- ============================================================================
/*
1. Run these queries in SQL Workshop > SQL Commands
2. Share the results with me
3. This will show us the exact column types the procedure returns

Especially important:
- Look for the SELECT statement inside RR_GET_ALL_ENDPOINTS procedure
- Check which table it queries
- Check the column types of that table
*/

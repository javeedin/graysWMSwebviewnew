# APEX REST Handler Parameter Configuration

## Problem
Getting error: `{"status":"ERROR","message":"Module code is required"}`

This means APEX_JSON.get_varchar2() is returning NULL because the JSON body is not being parsed.

---

## Solution: Configure Handler Parameters in APEX

### Method 1: Use Handler Parameters (Recommended)

This makes APEX automatically parse JSON fields into bind variables.

#### Steps:

1. **Go to your POST Handler** in APEX RESTful Services
2. **Find the "Parameters" section** (usually below the Source code)
3. **Click "Create Parameter"** and add each field:

| Parameter Name | Bind Variable | Source Type | Access Method | Data Type | Required |
|----------------|---------------|-------------|---------------|-----------|----------|
| module_code | module_code | Request Body | IN | STRING | Yes |
| feature_name | feature_name | Request Body | IN | STRING | Yes |
| http_method | http_method | Request Body | IN | STRING | Yes |
| workspace_url | workspace_url | Request Body | IN | STRING | Yes |
| endpoint_path | endpoint_path | Request Body | IN | STRING | Yes |
| page_name | page_name | Request Body | IN | STRING | No |
| workspace_id | workspace_id | Request Body | IN | INT | No |
| description | description | Request Body | IN | STRING | No |
| is_active | is_active | Request Body | IN | STRING | No |
| created_by | created_by | Request Body | IN | INT | No |

4. **After adding parameters**, use this handler code:

```sql
DECLARE
    v_endpoint_id   NUMBER;
    v_status        VARCHAR2(100);
    v_message       VARCHAR2(4000);
BEGIN
    RR_APEX_ENDPOINT_PKG.RR_CREATE_ENDPOINT(
        p_module_code    => :module_code,
        p_feature_name   => :feature_name,
        p_http_method    => :http_method,
        p_workspace_url  => :workspace_url,
        p_endpoint_path  => :endpoint_path,
        p_page_name      => :page_name,
        p_workspace_id   => :workspace_id,
        p_description    => :description,
        p_is_active      => NVL(:is_active, 'Y'),
        p_created_by     => NVL(:created_by, 1),
        p_endpoint_id    => v_endpoint_id,
        p_status         => v_status,
        p_message        => v_message
    );

    HTP.p('{"status":"' || v_status || '",' ||
          '"message":"' || REPLACE(v_message, '"', '\"') || '"');

    IF v_status = 'SUCCESS' THEN
        HTP.p(',"data":{"endpoint_id":' || v_endpoint_id || '}}');
    ELSE
        HTP.p('}');
    END IF;

EXCEPTION
    WHEN OTHERS THEN
        HTP.p('{"status":"ERROR","message":"' || REPLACE(SQLERRM, '"', '\"') || '"}');
END;
```

---

### Method 2: Use Request Body as CLOB Parameter

If Method 1 is too tedious, create ONE parameter for the entire body:

1. **Create Parameter:**
   - Parameter Name: `body`
   - Bind Variable: `body`
   - Source Type: `Request Body`
   - Access Method: `IN`
   - Data Type: `STRING` or `CLOB`

2. **Use this handler code:**

```sql
DECLARE
    v_endpoint_id   NUMBER;
    v_status        VARCHAR2(100);
    v_message       VARCHAR2(4000);
    v_body          CLOB;
BEGIN
    v_body := :body;
    APEX_JSON.parse(v_body);

    RR_APEX_ENDPOINT_PKG.RR_CREATE_ENDPOINT(
        p_module_code    => APEX_JSON.get_varchar2(p_path => 'module_code'),
        p_feature_name   => APEX_JSON.get_varchar2(p_path => 'feature_name'),
        p_http_method    => APEX_JSON.get_varchar2(p_path => 'http_method'),
        p_workspace_url  => APEX_JSON.get_varchar2(p_path => 'workspace_url'),
        p_endpoint_path  => APEX_JSON.get_varchar2(p_path => 'endpoint_path'),
        p_page_name      => APEX_JSON.get_varchar2(p_path => 'page_name'),
        p_workspace_id   => APEX_JSON.get_number(p_path => 'workspace_id'),
        p_description    => APEX_JSON.get_varchar2(p_path => 'description'),
        p_is_active      => NVL(APEX_JSON.get_varchar2(p_path => 'is_active'), 'Y'),
        p_created_by     => NVL(APEX_JSON.get_number(p_path => 'created_by'), 1),
        p_endpoint_id    => v_endpoint_id,
        p_status         => v_status,
        p_message        => v_message
    );

    HTP.p('{"status":"' || v_status || '",' ||
          '"message":"' || REPLACE(v_message, '"', '\"') || '"');

    IF v_status = 'SUCCESS' THEN
        HTP.p(',"data":{"endpoint_id":' || v_endpoint_id || '}}');
    ELSE
        HTP.p('}');
    END IF;

EXCEPTION
    WHEN OTHERS THEN
        HTP.p('{"status":"ERROR","message":"' || REPLACE(SQLERRM, '"', '\"') || '"}');
END;
```

---

### Method 3: Check Handler Configuration

Make sure your handler has these settings:

1. **Method**: POST
2. **Source Type**: PL/SQL
3. **Content Type**: Leave blank (or set to `application/json`)
4. **MIME Types Allowed**: `application/json`

---

## Screenshots Guide

### Where to Find Parameters Section:

```
SQL Workshop
  └─ RESTful Services
       └─ Modules
            └─ rr.endpoints
                 └─ [Your Template]
                      └─ POST Handler
                           ├─ Settings (Method, Source Type, etc.)
                           ├─ Source (Your PL/SQL code)
                           └─ Parameters ← ADD PARAMETERS HERE
```

---

## Quick Test

Before adding all parameters, test with just one:

1. **Create one parameter:**
   - Name: `body`
   - Source: Request Body
   - Type: STRING

2. **Use this test code:**

```sql
DECLARE
    v_body CLOB;
BEGIN
    v_body := :body;
    HTP.p('{"received_body":"' || SUBSTR(v_body, 1, 100) || '"}');
EXCEPTION
    WHEN OTHERS THEN
        HTP.p('{"error":"' || SQLERRM || '"}');
END;
```

3. **Test in Postman** - you should see your JSON echoed back

---

## Alternative: Use ORDS Native REST

If APEX REST continues to be problematic, you can use ORDS directly:

```sql
BEGIN
    ORDS.ENABLE_OBJECT(
        p_enabled => TRUE,
        p_schema => 'YOUR_SCHEMA',
        p_object => 'RR_APEX_ENDPOINTS',
        p_object_type => 'TABLE',
        p_object_alias => 'rr_endpoints'
    );
END;
/
```

This auto-generates working REST endpoints for your table.

---

## Summary

The issue is that **:body bind variable doesn't exist** until you create it as a parameter.

**Choose one method:**
1. Create individual parameters for each JSON field (most explicit)
2. Create one `body` parameter for entire JSON (simpler)
3. Try the TRY_ALL_BODY_METHODS.sql diagnostic

Try Method 2 first (single body parameter) - it's the easiest!

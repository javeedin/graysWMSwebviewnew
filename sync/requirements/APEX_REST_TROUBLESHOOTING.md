# APEX REST Handler Troubleshooting - 555 Error

## Problem
- PL/SQL code works in SQL Commands ✓
- But POST endpoint returns 555 error in Postman ✗

## Cause
555 error means the **APEX REST handler has a compilation error**. Something about the handler syntax is preventing it from compiling.

---

## Solution: Step-by-Step Testing

### Step 1: Verify REST Module Setup

Go to: **SQL Workshop → RESTful Services**

Check your module:
- ✓ Module exists: `rr.endpoints`
- ✓ Base Path: `/rr/endpoints/`
- ✓ Status: Published
- ✓ Template exists (can be blank)
- ✓ Handler exists: Method = POST

### Step 2: Test Minimal Handler

**Replace your POST handler source with this:**

```sql
BEGIN
    OWA_UTIL.mime_header('application/json', FALSE);
    HTP.p('{"status":"SUCCESS","message":"REST handler is working!"}');
END;
```

**Test in Postman:**
```
POST https://apex.oracle.com/pls/apex/grays/api/rr/endpoints/
Headers: Content-Type: application/json
Body: {}
```

**Expected:** `{"status":"SUCCESS","message":"REST handler is working!"}`

**If this fails with 555:**
- Check that the handler is saved properly
- Check that OWA_UTIL and HTP packages are available
- Try clicking "Validate" in APEX handler editor

---

### Step 3: Test JSON Parsing

**If Step 2 works, replace handler with:**

```sql
DECLARE
    v_body CLOB;
    v_module_code VARCHAR2(100);
BEGIN
    v_body := :body;
    APEX_JSON.parse(v_body);
    v_module_code := APEX_JSON.get_varchar2(p_path => 'module_code');

    OWA_UTIL.mime_header('application/json', FALSE);
    HTP.p('{"status":"SUCCESS","module_code":"' || v_module_code || '"}');
END;
```

**Test with:**
```json
{
  "module_code": "GL"
}
```

**Expected:** `{"status":"SUCCESS","module_code":"GL"}`

---

### Step 4: Test Package Call with Hardcoded Values

**If Step 3 works, replace handler with:**

```sql
DECLARE
    v_endpoint_id   NUMBER;
    v_status        VARCHAR2(100);
    v_message       VARCHAR2(4000);
BEGIN
    RR_APEX_ENDPOINT_PKG.RR_CREATE_ENDPOINT(
        p_module_code    => 'GL',
        p_feature_name   => 'Hardcoded Test',
        p_http_method    => 'GET',
        p_workspace_url  => 'https://apex.oracle.com/pls/apex/grays/',
        p_endpoint_path  => 'api/test',
        p_created_by     => 1,
        p_endpoint_id    => v_endpoint_id,
        p_status         => v_status,
        p_message        => v_message
    );

    OWA_UTIL.mime_header('application/json', FALSE);
    HTP.p('{"status":"' || v_status || '","endpoint_id":' || v_endpoint_id || '}');
END;
```

**Test with any JSON body.**

**Expected:** `{"status":"SUCCESS","endpoint_id":5}`

---

### Step 5: Full Handler with JSON Parsing

**If Step 4 works, use this complete handler:**

```sql
DECLARE
    v_endpoint_id   NUMBER;
    v_status        VARCHAR2(100);
    v_message       VARCHAR2(4000);
    v_body          CLOB;
    v_response      CLOB;
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

    v_response := '{"status":"' || v_status || '","message":"' || v_message || '"';
    IF v_status = 'SUCCESS' THEN
        v_response := v_response || ',"data":{"endpoint_id":' || v_endpoint_id || '}';
    ELSE
        v_response := v_response || ',"data":null';
    END IF;
    v_response := v_response || '}';

    OWA_UTIL.mime_header('application/json', FALSE);
    HTP.p(v_response);

EXCEPTION
    WHEN OTHERS THEN
        OWA_UTIL.mime_header('application/json', FALSE);
        HTP.p('{"status":"ERROR","message":"' || SQLERRM || '","data":null}');
END;
```

---

## Common Issues

### Issue 1: `:body` not recognized
**Solution:** Check APEX version. Older versions might use `:body_text` instead.

Try this:
```sql
BEGIN
    v_body := :body;
EXCEPTION
    WHEN OTHERS THEN
        v_body := :body_text;
END;
```

### Issue 2: HTP not available
**Solution:** Use APEX_JSON.write instead:

```sql
APEX_JSON.open_object;
APEX_JSON.write('status', v_status);
APEX_JSON.write('message', v_message);
APEX_JSON.close_object;
```

### Issue 3: Handler shows as "Invalid"
**Solution:**
1. Delete the handler
2. Create a new one
3. Start with minimal test (Step 2)

### Issue 4: Content-Type header issues
**Solution:** In APEX handler settings:
- MIME Types Allowed: `application/json`
- Check "Requires Secure Access" is appropriate

---

## Quick Fix: Auto-Generated Handler

**Alternative approach - Let APEX generate it:**

1. In SQL Workshop → Object Browser
2. Find your table: RR_APEX_ENDPOINTS
3. Click "REST Enable"
4. Let APEX auto-generate handlers
5. Customize as needed

This creates working handlers automatically.

---

## Debug Checklist

- [ ] Module is published (not draft)
- [ ] Handler method is POST (not GET)
- [ ] Handler source type is PL/SQL (not SQL)
- [ ] No compilation errors shown in handler editor
- [ ] :body bind variable is available
- [ ] OWA_UTIL and HTP packages are available
- [ ] Package RR_APEX_ENDPOINT_PKG compiles successfully
- [ ] Postman sends Content-Type: application/json header
- [ ] URL is correct (check /api/rr/endpoints/ vs /rr/endpoints/)

---

## Test Your URL

Your URL should be one of these formats:

```
https://apex.oracle.com/pls/apex/grays/rr/endpoints/
https://apex.oracle.com/pls/apex/grays/api/rr/endpoints/
```

Check your module's Base Path in APEX to confirm.

---

## If All Else Fails

1. Export your module definition
2. Delete the module
3. Re-create from scratch using Step 2 (minimal handler)
4. Gradually add complexity

Or use APEX's auto-generated REST services (REST Enable Table).

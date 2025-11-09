# APEX Handler Parameters Configuration Checklist

## Instructions
For each parameter below, go to your POST Handler in APEX and click "Create Parameter"

Location: **SQL Workshop → RESTful Services → rr.endpoints → POST Handler → Parameters**

---

## Required Parameters (5)

### ✓ 1. module_code
- **Bind Variable**: `module_code`
- **Source Type**: Request Body
- **Access Method**: IN
- **Data Type**: STRING
- **Required**: Yes

### ✓ 2. feature_name
- **Bind Variable**: `feature_name`
- **Source Type**: Request Body
- **Access Method**: IN
- **Data Type**: STRING
- **Required**: Yes

### ✓ 3. http_method
- **Bind Variable**: `http_method`
- **Source Type**: Request Body
- **Access Method**: IN
- **Data Type**: STRING
- **Required**: Yes

### ✓ 4. workspace_url
- **Bind Variable**: `workspace_url`
- **Source Type**: Request Body
- **Access Method**: IN
- **Data Type**: STRING
- **Required**: Yes

### ✓ 5. endpoint_path
- **Bind Variable**: `endpoint_path`
- **Source Type**: Request Body
- **Access Method**: IN
- **Data Type**: STRING
- **Required**: Yes

---

## Optional Parameters (23)

### Page and Organization

#### ✓ 6. page_name
- **Bind Variable**: `page_name`
- **Source Type**: Request Body
- **Data Type**: STRING

#### ✓ 7. workspace_id
- **Bind Variable**: `workspace_id`
- **Source Type**: Request Body
- **Data Type**: STRING

### Description and Metadata

#### ✓ 8. description
- **Bind Variable**: `description`
- **Source Type**: Request Body
- **Data Type**: STRING

#### ✓ 9. notes
- **Bind Variable**: `notes`
- **Source Type**: Request Body
- **Data Type**: STRING

#### ✓ 10. tags
- **Bind Variable**: `tags`
- **Source Type**: Request Body
- **Data Type**: STRING

### Request/Response Fields

#### ✓ 11. request_params
- **Bind Variable**: `request_params`
- **Source Type**: Request Body
- **Data Type**: STRING

#### ✓ 12. sample_request_body
- **Bind Variable**: `sample_request_body`
- **Source Type**: Request Body
- **Data Type**: STRING

#### ✓ 13. sample_response
- **Bind Variable**: `sample_response`
- **Source Type**: Request Body
- **Data Type**: STRING

#### ✓ 14. response_format
- **Bind Variable**: `response_format`
- **Source Type**: Request Body
- **Data Type**: STRING

#### ✓ 15. content_type
- **Bind Variable**: `content_type`
- **Source Type**: Request Body
- **Data Type**: STRING

### Authentication

#### ✓ 16. requires_auth
- **Bind Variable**: `requires_auth`
- **Source Type**: Request Body
- **Data Type**: STRING

#### ✓ 17. auth_type
- **Bind Variable**: `auth_type`
- **Source Type**: Request Body
- **Data Type**: STRING

#### ✓ 18. auth_header_name
- **Bind Variable**: `auth_header_name`
- **Source Type**: Request Body
- **Data Type**: STRING

#### ✓ 19. auth_value_encrypted
- **Bind Variable**: `auth_value_encrypted`
- **Source Type**: Request Body
- **Data Type**: STRING

### Performance

#### ✓ 20. timeout_seconds
- **Bind Variable**: `timeout_seconds`
- **Source Type**: Request Body
- **Data Type**: STRING

#### ✓ 21. retry_count
- **Bind Variable**: `retry_count`
- **Source Type**: Request Body
- **Data Type**: STRING

#### ✓ 22. cache_enabled
- **Bind Variable**: `cache_enabled`
- **Source Type**: Request Body
- **Data Type**: STRING

#### ✓ 23. cache_duration_seconds
- **Bind Variable**: `cache_duration_seconds`
- **Source Type**: Request Body
- **Data Type**: STRING

### Co-Pilot

#### ✓ 24. copilot_enabled
- **Bind Variable**: `copilot_enabled`
- **Source Type**: Request Body
- **Data Type**: STRING

#### ✓ 25. copilot_prompt
- **Bind Variable**: `copilot_prompt`
- **Source Type**: Request Body
- **Data Type**: STRING

#### ✓ 26. copilot_parameters
- **Bind Variable**: `copilot_parameters`
- **Source Type**: Request Body
- **Data Type**: STRING

### Status and Audit

#### ✓ 27. is_active
- **Bind Variable**: `is_active`
- **Source Type**: Request Body
- **Data Type**: STRING

#### ✓ 28. created_by
- **Bind Variable**: `created_by`
- **Source Type**: Request Body
- **Data Type**: STRING

---

## Quick Copy-Paste Format

For faster configuration, here's a list you can reference:

```
1.  module_code            - STRING - REQUIRED
2.  feature_name           - STRING - REQUIRED
3.  http_method            - STRING - REQUIRED
4.  workspace_url          - STRING - REQUIRED
5.  endpoint_path          - STRING - REQUIRED
6.  page_name              - STRING - Optional
7.  workspace_id           - STRING - Optional
8.  description            - STRING - Optional
9.  notes                  - STRING - Optional
10. tags                   - STRING - Optional
11. request_params         - STRING - Optional
12. sample_request_body    - STRING - Optional
13. sample_response        - STRING - Optional
14. response_format        - STRING - Optional
15. content_type           - STRING - Optional
16. requires_auth          - STRING - Optional
17. auth_type              - STRING - Optional
18. auth_header_name       - STRING - Optional
19. auth_value_encrypted   - STRING - Optional
20. timeout_seconds        - STRING - Optional
21. retry_count            - STRING - Optional
22. cache_enabled          - STRING - Optional
23. cache_duration_seconds - STRING - Optional
24. copilot_enabled        - STRING - Optional
25. copilot_prompt         - STRING - Optional
26. copilot_parameters     - STRING - Optional
27. is_active              - STRING - Optional
28. created_by             - STRING - Optional
```

---

## Test JSON Payloads

### Minimal Test (Required Fields Only)
```json
{
  "module_code": "GL",
  "feature_name": "Test Endpoint",
  "http_method": "GET",
  "workspace_url": "https://apex.oracle.com/pls/apex/grays/",
  "endpoint_path": "api/gl/test"
}
```

### Full Test (All Fields)
```json
{
  "module_code": "GL",
  "feature_name": "Get Account Balances",
  "page_name": "Account Inquiry",
  "http_method": "GET",
  "workspace_id": 1,
  "workspace_url": "https://apex.oracle.com/pls/apex/grays/",
  "endpoint_path": "api/gl/account-balances",
  "request_params": "{\"account_id\": 12345}",
  "sample_request_body": null,
  "sample_response": "{\"success\": true, \"balance\": 15000.00}",
  "response_format": "JSON",
  "content_type": "application/json",
  "requires_auth": "Y",
  "auth_type": "BEARER",
  "auth_header_name": "Authorization",
  "auth_value_encrypted": "encrypted_token",
  "timeout_seconds": 45,
  "retry_count": 3,
  "cache_enabled": "Y",
  "cache_duration_seconds": 300,
  "copilot_enabled": "Y",
  "copilot_prompt": "Help me check account balances",
  "copilot_parameters": "{\"context\": \"inquiry\"}",
  "description": "Retrieves account balances for specified period",
  "notes": "Used in GL Account Inquiry screen",
  "tags": "GL,ACCOUNTS,BALANCES",
  "is_active": "Y",
  "created_by": 1
}
```

---

## Priority for Adding Parameters

If you want to add parameters gradually:

### Phase 1: Core (Start Here)
1. module_code
2. feature_name
3. http_method
4. workspace_url
5. endpoint_path
6. description
7. created_by

### Phase 2: Enhanced
8. page_name
9. workspace_id
10. request_params
11. sample_response
12. response_format
13. content_type

### Phase 3: Advanced
14-28: Authentication, caching, co-pilot, etc.

---

## Verification

After adding parameters, verify:
- [ ] Handler source code matches COMPLETE_WORKING_POST_HANDLER.sql
- [ ] All 28 parameters added (or at least Phase 1)
- [ ] Test with minimal JSON payload works
- [ ] Test with full JSON payload works
- [ ] Check data in RR_APEX_ENDPOINTS table

---

## Total Count
- **Required**: 5 parameters
- **Optional**: 23 parameters
- **Total**: 28 parameters

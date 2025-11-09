# RR_APEX_ENDPOINTS - REST API Specification

## Base URL
```
https://apex.oracle.com/pls/apex/grays/api/rr/endpoints
```

## Authentication
All endpoints require authentication:
- **Type**: Bearer Token or Basic Auth
- **Header**: `Authorization: Bearer <token>`

---

## 1. CREATE ENDPOINT (POST)

### Endpoint
```
POST /api/rr/endpoints
```

### Request Headers
```
Content-Type: application/json
Authorization: Bearer <token>
```

### Request Body
```json
{
  "module_code": "GL",
  "feature_name": "Get Journal Batches",
  "page_name": "Journal Entry",
  "http_method": "GET",
  "workspace_id": 1,
  "workspace_url": "https://apex.oracle.com/pls/apex/grays/",
  "endpoint_path": "api/gl/journal-batches",
  "request_params": "{\"batch_id\": 12345, \"status\": \"POSTED\"}",
  "sample_request_body": null,
  "sample_response": "{\"success\": true, \"batches\": [{\"batch_id\": 12345, \"name\": \"BATCH-001\"}]}",
  "response_format": "JSON",
  "content_type": "application/json",
  "requires_auth": "Y",
  "auth_type": "BEARER",
  "auth_header_name": "Authorization",
  "auth_value_encrypted": "encrypted_token_here",
  "timeout_seconds": 30,
  "retry_count": 3,
  "cache_enabled": "N",
  "cache_duration_seconds": null,
  "copilot_enabled": "Y",
  "copilot_prompt": "Help me retrieve journal batches",
  "copilot_parameters": "{\"context\": \"journal_entry\"}",
  "description": "Retrieves journal batches from APEX",
  "notes": "Used for GL module journal entry screens",
  "tags": "GL,JOURNALS,BATCHES",
  "is_active": "Y",
  "created_by": 1
}
```

### Response (Success)
```json
{
  "status": "SUCCESS",
  "message": "Endpoint created successfully with ID: 4",
  "data": {
    "endpoint_id": 4
  }
}
```

### Response (Error)
```json
{
  "status": "ERROR",
  "message": "Duplicate endpoint: GL - Get Journal Batches - GET already exists",
  "data": null
}
```

### HTTP Status Codes
- `201` - Created successfully
- `400` - Bad request (validation error)
- `401` - Unauthorized
- `409` - Conflict (duplicate endpoint)
- `500` - Internal server error

---

## 2. GET ENDPOINT BY ID (GET)

### Endpoint
```
GET /api/rr/endpoints/{endpoint_id}
```

### Request Headers
```
Authorization: Bearer <token>
```

### URL Parameters
- `endpoint_id` (required) - The ID of the endpoint

### Example Request
```
GET /api/rr/endpoints/1
```

### Response (Success)
```json
{
  "status": "SUCCESS",
  "message": "Endpoint retrieved successfully",
  "data": {
    "endpoint_id": 1,
    "module_code": "GL",
    "feature_name": "Get Journals",
    "page_name": "Journal Inquiry",
    "workspace_id": 1,
    "workspace_name": "Grays WMS - Production",
    "environment": "PROD",
    "workspace_url": "https://apex.oracle.com/pls/apex/grays/",
    "endpoint_path": "api/gl/journals",
    "http_method": "GET",
    "request_params": "{\"journal_id\": 0, \"status\": \"ALL\"}",
    "sample_request_body": null,
    "sample_response": "{\"success\": true, \"journals\": []}",
    "response_format": "JSON",
    "content_type": "application/json",
    "requires_auth": "Y",
    "auth_type": "BEARER",
    "timeout_seconds": 30,
    "retry_count": 0,
    "cache_enabled": "N",
    "copilot_enabled": "Y",
    "copilot_prompt": "Help me search and filter journal entries",
    "is_active": "Y",
    "description": "Get all journal entries with filtering",
    "tags": "GL,JOURNALS,QUERY",
    "test_count": 5,
    "last_test_date": "2025-11-09T10:30:00Z",
    "last_test_status": "SUCCESS",
    "created_date": "2025-11-08T09:00:00Z",
    "created_by": 1,
    "last_update_date": "2025-11-09T10:30:00Z",
    "last_updated_by": 1
  }
}
```

### Response (Error)
```json
{
  "status": "ERROR",
  "message": "Endpoint ID 999 not found",
  "data": null
}
```

### HTTP Status Codes
- `200` - Success
- `401` - Unauthorized
- `404` - Endpoint not found
- `500` - Internal server error

---

## 3. GET ALL ENDPOINTS (GET)

### Endpoint
```
GET /api/rr/endpoints
```

### Request Headers
```
Authorization: Bearer <token>
```

### Query Parameters
- `module_code` (optional) - Filter by module (GL, AP, AR, etc.)
- `is_active` (optional) - Filter by active status (Y/N), default: Y
- `limit` (optional) - Number of records per page, default: 100
- `offset` (optional) - Number of records to skip, default: 0

### Example Requests
```
GET /api/rr/endpoints
GET /api/rr/endpoints?module_code=GL
GET /api/rr/endpoints?module_code=GL&is_active=Y&limit=10&offset=0
GET /api/rr/endpoints?is_active=Y&limit=20&offset=20
```

### Response (Success)
```json
{
  "status": "SUCCESS",
  "message": "Endpoints retrieved successfully. Total: 15",
  "data": {
    "total_count": 15,
    "limit": 10,
    "offset": 0,
    "endpoints": [
      {
        "endpoint_id": 1,
        "module_code": "GL",
        "feature_name": "Get Journals",
        "page_name": "Journal Inquiry",
        "workspace_name": "Grays WMS - Production",
        "environment": "PROD",
        "workspace_url": "https://apex.oracle.com/pls/apex/grays/",
        "endpoint_path": "api/gl/journals",
        "http_method": "GET",
        "description": "Get all journal entries with filtering",
        "is_active": "Y",
        "test_count": 5,
        "last_test_status": "SUCCESS",
        "last_test_date": "2025-11-09T10:30:00Z"
      },
      {
        "endpoint_id": 2,
        "module_code": "GL",
        "feature_name": "Create Journal",
        "page_name": "Journal Entry",
        "workspace_name": "Grays WMS - Production",
        "environment": "PROD",
        "workspace_url": "https://apex.oracle.com/pls/apex/grays/",
        "endpoint_path": "api/gl/journals",
        "http_method": "POST",
        "description": "Create new journal batch with headers and lines",
        "is_active": "Y",
        "test_count": 3,
        "last_test_status": "SUCCESS",
        "last_test_date": "2025-11-09T09:15:00Z"
      }
    ]
  }
}
```

### HTTP Status Codes
- `200` - Success
- `401` - Unauthorized
- `500` - Internal server error

---

## 4. UPDATE ENDPOINT (PATCH)

### Endpoint
```
PATCH /api/rr/endpoints/{endpoint_id}
```

### Request Headers
```
Content-Type: application/json
Authorization: Bearer <token>
```

### URL Parameters
- `endpoint_id` (required) - The ID of the endpoint to update

### Request Body (Partial Update - Only include fields to update)
```json
{
  "description": "Updated description for journal retrieval",
  "timeout_seconds": 60,
  "is_active": "Y",
  "copilot_enabled": "Y",
  "copilot_prompt": "Updated co-pilot prompt",
  "last_updated_by": 1
}
```

### Full Update Example
```json
{
  "feature_name": "Get All Journal Batches",
  "page_name": "Journal Entry - Updated",
  "workspace_id": 1,
  "workspace_url": "https://apex.oracle.com/pls/apex/grays/",
  "endpoint_path": "api/gl/journal-batches/all",
  "http_method": "GET",
  "request_params": "{\"status\": \"POSTED\", \"period_name\": \"JAN-25\"}",
  "sample_response": "{\"success\": true, \"count\": 50}",
  "response_format": "JSON",
  "content_type": "application/json",
  "requires_auth": "Y",
  "auth_type": "BEARER",
  "timeout_seconds": 45,
  "description": "Comprehensive journal batch retrieval",
  "is_active": "Y",
  "last_updated_by": 1
}
```

### Response (Success)
```json
{
  "status": "SUCCESS",
  "message": "Endpoint updated successfully",
  "data": {
    "endpoint_id": 1
  }
}
```

### Response (Error)
```json
{
  "status": "ERROR",
  "message": "Endpoint ID 999 not found",
  "data": null
}
```

### HTTP Status Codes
- `200` - Updated successfully
- `400` - Bad request (validation error)
- `401` - Unauthorized
- `404` - Endpoint not found
- `500` - Internal server error

---

## 5. DELETE ENDPOINT (DELETE)

### Endpoint
```
DELETE /api/rr/endpoints/{endpoint_id}
```

### Request Headers
```
Authorization: Bearer <token>
```

### URL Parameters
- `endpoint_id` (required) - The ID of the endpoint to delete

### Request Body
```json
{
  "deleted_by": 1
}
```

### Example Request
```
DELETE /api/rr/endpoints/10
```

### Response (Success)
```json
{
  "status": "SUCCESS",
  "message": "Endpoint deleted successfully",
  "data": {
    "endpoint_id": 10
  }
}
```

### Response (Error)
```json
{
  "status": "ERROR",
  "message": "Endpoint ID 999 not found",
  "data": null
}
```

### HTTP Status Codes
- `200` - Deleted successfully
- `401` - Unauthorized
- `404` - Endpoint not found
- `500` - Internal server error

---

## 6. TEST ENDPOINT (POST)

### Endpoint
```
POST /api/rr/endpoints/{endpoint_id}/test
```

### Request Headers
```
Content-Type: application/json
Authorization: Bearer <token>
```

### URL Parameters
- `endpoint_id` (required) - The ID of the endpoint to test

### Request Body
```json
{
  "tested_by": 1
}
```

### Example Request
```
POST /api/rr/endpoints/1/test
```

### Response (Success)
```json
{
  "status": "SUCCESS",
  "message": "Test record created with ID: 45",
  "data": {
    "test_id": 45,
    "endpoint_id": 1,
    "test_status": "SUCCESS",
    "http_status_code": 200,
    "response_time_ms": 245,
    "response_received": "{\"success\": true, \"journals\": [{\"journal_id\": 1, \"name\": \"JE-001\"}]}",
    "error_message": null,
    "test_date": "2025-11-09T11:45:23Z"
  }
}
```

### Response (Test Failed)
```json
{
  "status": "SUCCESS",
  "message": "Test record created with ID: 46",
  "data": {
    "test_id": 46,
    "endpoint_id": 1,
    "test_status": "FAILED",
    "http_status_code": 500,
    "response_time_ms": 1200,
    "response_received": null,
    "error_message": "Connection timeout after 1200ms",
    "test_date": "2025-11-09T11:46:30Z"
  }
}
```

### HTTP Status Codes
- `200` - Test executed (check test_status for actual result)
- `401` - Unauthorized
- `404` - Endpoint not found
- `500` - Internal server error

---

## 7. GET TEST HISTORY (GET)

### Endpoint
```
GET /api/rr/endpoints/{endpoint_id}/tests
```

### Request Headers
```
Authorization: Bearer <token>
```

### URL Parameters
- `endpoint_id` (required) - The ID of the endpoint

### Query Parameters
- `limit` (optional) - Number of records, default: 50
- `offset` (optional) - Skip records, default: 0

### Example Request
```
GET /api/rr/endpoints/1/tests?limit=10&offset=0
```

### Response (Success)
```json
{
  "status": "SUCCESS",
  "message": "Test history retrieved successfully. Total: 25",
  "data": {
    "total_count": 25,
    "limit": 10,
    "offset": 0,
    "tests": [
      {
        "test_id": 45,
        "endpoint_id": 1,
        "test_date": "2025-11-09T11:45:23Z",
        "test_status": "SUCCESS",
        "http_status_code": 200,
        "response_time_ms": 245,
        "request_sent": "{\"batch_id\": 12345}",
        "response_received": "{\"success\": true}",
        "error_message": null,
        "tested_by": 1
      },
      {
        "test_id": 44,
        "endpoint_id": 1,
        "test_date": "2025-11-09T10:30:15Z",
        "test_status": "FAILED",
        "http_status_code": 500,
        "response_time_ms": 1200,
        "request_sent": "{\"batch_id\": 12345}",
        "response_received": null,
        "error_message": "Connection timeout",
        "tested_by": 1
      }
    ]
  }
}
```

---

## Common Response Format

All endpoints follow this structure:

```json
{
  "status": "SUCCESS|ERROR",
  "message": "Human-readable message",
  "data": {
    // Response data or null
  }
}
```

---

## Error Codes

| HTTP Code | Status | Description |
|-----------|--------|-------------|
| 200 | SUCCESS | Request completed successfully |
| 201 | SUCCESS | Resource created successfully |
| 400 | ERROR | Bad request - validation failed |
| 401 | ERROR | Unauthorized - invalid token |
| 403 | ERROR | Forbidden - insufficient permissions |
| 404 | ERROR | Resource not found |
| 409 | ERROR | Conflict - duplicate resource |
| 500 | ERROR | Internal server error |

---

## APEX REST Handler Implementation

### Create APEX REST Handler Module

```sql
-- Module: rr_endpoints
-- Base Path: /rr/endpoints/
-- Source Type: PL/SQL

-- Handler: POST /
BEGIN
  RR_APEX_ENDPOINT_PKG.RR_CREATE_ENDPOINT(
    p_module_code           => :module_code,
    p_feature_name          => :feature_name,
    p_http_method           => :http_method,
    -- ... other parameters
    p_endpoint_id           => :endpoint_id,
    p_status                => :status,
    p_message               => :message
  );

  -- Return JSON response
  :status_code := CASE WHEN :status = 'SUCCESS' THEN 201 ELSE 400 END;
END;

-- Handler: GET /:endpoint_id
-- Handler: GET /
-- Handler: PATCH /:endpoint_id
-- Handler: DELETE /:endpoint_id
-- Handler: POST /:endpoint_id/test
```

---

## JavaScript Usage Examples

### 1. Create Endpoint
```javascript
async function createEndpoint(endpointData) {
  const response = await fetch('/api/rr/endpoints', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + token
    },
    body: JSON.stringify(endpointData)
  });

  return await response.json();
}

// Usage
const newEndpoint = {
  module_code: 'GL',
  feature_name: 'Get Journal Batches',
  http_method: 'GET',
  workspace_url: 'https://apex.oracle.com/pls/apex/grays/',
  endpoint_path: 'api/gl/journal-batches',
  description: 'Retrieve all journal batches',
  created_by: 1
};

const result = await createEndpoint(newEndpoint);
console.log('Endpoint ID:', result.data.endpoint_id);
```

### 2. Get All Endpoints
```javascript
async function getEndpoints(moduleCode, page = 0, limit = 10) {
  const params = new URLSearchParams({
    module_code: moduleCode,
    is_active: 'Y',
    limit: limit,
    offset: page * limit
  });

  const response = await fetch(`/api/rr/endpoints?${params}`, {
    headers: {
      'Authorization': 'Bearer ' + token
    }
  });

  return await response.json();
}

// Usage
const endpoints = await getEndpoints('GL', 0, 10);
console.log('Total:', endpoints.data.total_count);
console.log('Endpoints:', endpoints.data.endpoints);
```

### 3. Update Endpoint
```javascript
async function updateEndpoint(endpointId, updates) {
  const response = await fetch(`/api/rr/endpoints/${endpointId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + token
    },
    body: JSON.stringify({
      ...updates,
      last_updated_by: currentUserId
    })
  });

  return await response.json();
}

// Usage
const result = await updateEndpoint(1, {
  description: 'Updated description',
  timeout_seconds: 60
});
```

### 4. Test Endpoint
```javascript
async function testEndpoint(endpointId) {
  const response = await fetch(`/api/rr/endpoints/${endpointId}/test`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + token
    },
    body: JSON.stringify({
      tested_by: currentUserId
    })
  });

  const result = await response.json();

  if (result.data.test_status === 'SUCCESS') {
    console.log('✓ Test passed:', result.data.response_time_ms + 'ms');
  } else {
    console.log('✗ Test failed:', result.data.error_message);
  }

  return result;
}

// Usage
const testResult = await testEndpoint(1);
```

### 5. Delete Endpoint
```javascript
async function deleteEndpoint(endpointId) {
  const response = await fetch(`/api/rr/endpoints/${endpointId}`, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + token
    },
    body: JSON.stringify({
      deleted_by: currentUserId
    })
  });

  return await response.json();
}

// Usage
const result = await deleteEndpoint(10);
```

---

## Validation Rules

### Module Codes (Valid Values)
- GL (General Ledger)
- AP (Accounts Payable)
- AR (Accounts Receivable)
- FA (Fixed Assets)
- WMS (Warehouse Management)
- SYNC (Synchronization)
- PO (Purchase Orders)
- OM (Order Management)
- CA (Cash Management)
- POS (Point of Sale)

### HTTP Methods (Valid Values)
- GET
- POST
- PUT
- PATCH
- DELETE

### Response Formats (Valid Values)
- JSON (default)
- XML
- TEXT
- HTML

### Auth Types (Valid Values)
- NONE
- BASIC
- BEARER
- API_KEY
- OAUTH2

### Boolean Fields (Y/N)
- is_active
- requires_auth
- cache_enabled
- copilot_enabled

---

## Complete Example: Full Lifecycle

```javascript
// 1. Create endpoint
const createResult = await createEndpoint({
  module_code: 'GL',
  feature_name: 'Get Account Balance',
  http_method: 'GET',
  workspace_url: 'https://apex.oracle.com/pls/apex/grays/',
  endpoint_path: 'api/gl/account-balance',
  request_params: '{"account_id": 12345}',
  description: 'Get account balance by ID',
  requires_auth: 'Y',
  auth_type: 'BEARER',
  created_by: 1
});

const endpointId = createResult.data.endpoint_id;
console.log('Created endpoint:', endpointId);

// 2. Test endpoint
const testResult = await testEndpoint(endpointId);
console.log('Test status:', testResult.data.test_status);

// 3. Update if needed
if (testResult.data.test_status === 'FAILED') {
  await updateEndpoint(endpointId, {
    timeout_seconds: 60,
    retry_count: 3
  });

  // Re-test
  await testEndpoint(endpointId);
}

// 4. Get endpoint details
const endpoint = await fetch(`/api/rr/endpoints/${endpointId}`, {
  headers: { 'Authorization': 'Bearer ' + token }
}).then(r => r.json());

console.log('Endpoint details:', endpoint.data);

// 5. Get all GL endpoints
const allEndpoints = await getEndpoints('GL');
console.log('Total GL endpoints:', allEndpoints.data.total_count);
```

---

## Notes

1. **Authentication**: All endpoints require valid authentication token
2. **PATCH vs PUT**: Use PATCH for partial updates (only send changed fields)
3. **Pagination**: Use limit/offset for large result sets
4. **Test History**: Automatically tracked with cascade delete
5. **Validation**: Server-side validation on all fields
6. **Co-Pilot Ready**: All endpoints include co-pilot integration fields
7. **Workspace Abstraction**: Supports multiple APEX workspaces
8. **Audit Trail**: Created/Updated dates and user IDs tracked automatically

---

## Generated: November 9, 2025
## Version: 1.0

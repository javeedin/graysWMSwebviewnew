# GET Handlers Setup Guide

## Overview
You need to create **TWO GET handlers**:
1. **GET by ID** - Retrieve a single endpoint
2. **GET all** - List endpoints with filtering

---

## Handler #1: GET by ID

### APEX Configuration

#### Step 1: Create Resource Template
1. Go to your module: `rr.endpoints`
2. Click **"Create Template"**
3. **URI Template**: `:endpoint_id`
4. Click **"Create Template"**

#### Step 2: Create GET Handler
1. Under the `:endpoint_id` template, click **"Create Handler"**
2. Configure:
   - **Method**: GET
   - **Source Type**: PL/SQL
   - **Source**: Copy from `GET_HANDLER_BY_ID.sql`

#### Step 3: Add Parameter
1. Scroll to **"Parameters"** section
2. Click **"Create Parameter"**

**Parameter Configuration:**
- **Parameter Name**: `endpoint_id`
- **Bind Variable**: `endpoint_id`
- **Source Type**: **URI** (not Request Body!)
- **Access Method**: IN
- **Data Type**: STRING
- **Required**: Yes

#### Step 4: Save and Test

**Test URL:**
```
GET https://apex.oracle.com/pls/apex/grays/api/rr/endpoints/1
```

**Expected Response:**
```json
{
  "status": "SUCCESS",
  "message": "Endpoint retrieved successfully",
  "data": {
    "endpoint_id": 1,
    "module_code": "GL",
    "feature_name": "Get Journals",
    "workspace_url": "https://apex.oracle.com/pls/apex/grays/",
    "endpoint_path": "api/gl/journals",
    "http_method": "GET",
    ...
  }
}
```

---

## Handler #2: GET All (with filtering)

### APEX Configuration

#### Step 1: Use Root Template
1. Go to your module: `rr.endpoints`
2. Find the **root template** (blank URI template)
3. If it doesn't exist, create one with URI Template: (leave blank)

#### Step 2: Create GET Handler
1. Under the root template, click **"Create Handler"**
2. Configure:
   - **Method**: GET
   - **Source Type**: PL/SQL
   - **Source**: Copy from `GET_HANDLER_ALL.sql`

#### Step 3: Add Query Parameters (4 optional)
All parameters are optional for filtering/pagination.

**Parameter 1: module_code**
- **Parameter Name**: `module_code`
- **Bind Variable**: `module_code`
- **Source Type**: **URI** (query parameter)
- **Access Method**: IN
- **Data Type**: STRING
- **Required**: No

**Parameter 2: is_active**
- **Parameter Name**: `is_active`
- **Bind Variable**: `is_active`
- **Source Type**: **URI**
- **Access Method**: IN
- **Data Type**: STRING
- **Required**: No

**Parameter 3: limit**
- **Parameter Name**: `limit`
- **Bind Variable**: `limit`
- **Source Type**: **URI**
- **Access Method**: IN
- **Data Type**: STRING
- **Required**: No

**Parameter 4: offset**
- **Parameter Name**: `offset`
- **Bind Variable**: `offset`
- **Source Type**: **URI**
- **Access Method**: IN
- **Data Type**: STRING
- **Required**: No

#### Step 4: Save and Test

**Test URLs:**

1. **Get all endpoints:**
```
GET https://apex.oracle.com/pls/apex/grays/api/rr/endpoints/
```

2. **Get GL endpoints only:**
```
GET https://apex.oracle.com/pls/apex/grays/api/rr/endpoints/?module_code=GL
```

3. **Get first 10 endpoints:**
```
GET https://apex.oracle.com/pls/apex/grays/api/rr/endpoints/?limit=10&offset=0
```

4. **Get next 10 (pagination):**
```
GET https://apex.oracle.com/pls/apex/grays/api/rr/endpoints/?limit=10&offset=10
```

**Expected Response:**
```json
{
  "status": "SUCCESS",
  "message": "Endpoints retrieved successfully. Total: 15",
  "data": {
    "total_count": 15,
    "limit": 100,
    "offset": 0,
    "endpoints": [
      {
        "endpoint_id": 1,
        "module_code": "GL",
        "feature_name": "Get Journals",
        ...
      },
      {
        "endpoint_id": 2,
        ...
      }
    ]
  }
}
```

---

## Summary of Handlers

| Handler | Method | URI Template | Parameters | Purpose |
|---------|--------|--------------|------------|---------|
| GET by ID | GET | `:endpoint_id` | endpoint_id (URI) | Get single endpoint |
| GET all | GET | (blank) | module_code, is_active, limit, offset (URI) | List endpoints |
| POST | POST | (blank) | 28 body parameters | Create endpoint |

---

## Parameter Source Types

**Important distinction:**

- **POST handler parameters**: Source Type = **Request Body** (JSON data)
- **GET handler parameters**: Source Type = **URI** (URL parameters)

---

## Testing Checklist

### GET by ID
- [ ] Template `:endpoint_id` created
- [ ] GET handler created under template
- [ ] Parameter `endpoint_id` added (Source: URI)
- [ ] Test: `GET /endpoints/1` returns single endpoint
- [ ] Test: `GET /endpoints/999` returns error for non-existent ID

### GET All
- [ ] Root template exists (blank URI)
- [ ] GET handler created under root template
- [ ] 4 parameters added (all Source: URI, all optional)
- [ ] Test: `GET /endpoints/` returns all endpoints
- [ ] Test: `GET /endpoints/?module_code=GL` filters by GL
- [ ] Test: `GET /endpoints/?limit=5&offset=0` returns 5 records
- [ ] Test: `GET /endpoints/?is_active=Y` returns only active

---

## Common Issues

### Issue 1: "No data found" for GET by ID
**Cause**: endpoint_id parameter not configured or wrong source type
**Solution**: Ensure parameter source is **URI** (not Request Body)

### Issue 2: Query parameters not working (GET all)
**Cause**: Parameters configured as Request Body instead of URI
**Solution**: Change all 4 parameters to Source Type: **URI**

### Issue 3: Both handlers conflict
**Cause**: Both handlers on same template
**Solution**:
- GET by ID → Template: `:endpoint_id`
- GET all → Template: (blank/root)

### Issue 4: JSON parsing errors in response
**Cause**: Cursor not fetching all columns
**Solution**: Ensure FETCH statement matches package output

---

## Files Reference

| File | Purpose |
|------|---------|
| GET_HANDLER_BY_ID.sql | Handler code for single endpoint retrieval |
| GET_HANDLER_ALL.sql | Handler code for list with filtering |
| GET_HANDLERS_SETUP_GUIDE.md | This setup guide |

---

## Next Steps

After GET handlers are working:
1. **PATCH handler** - Update endpoints
2. **DELETE handler** - Remove endpoints
3. **POST /test handler** - Test endpoint connectivity

---

## Quick Reference

**Endpoints after setup:**

```
POST   /api/rr/endpoints/           - Create endpoint
GET    /api/rr/endpoints/           - List all endpoints
GET    /api/rr/endpoints/:id        - Get single endpoint
PATCH  /api/rr/endpoints/:id        - Update endpoint (future)
DELETE /api/rr/endpoints/:id        - Delete endpoint (future)
POST   /api/rr/endpoints/:id/test   - Test endpoint (future)
```

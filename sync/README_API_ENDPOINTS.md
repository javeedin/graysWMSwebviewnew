# API Endpoints Configuration Page

## Overview

This is the API Endpoints Configuration page for the Sync module. It allows you to manage Oracle Fusion REST API endpoints used for data synchronization.

## Features

✅ **View All Endpoints** - Display all configured endpoints in a table
✅ **Create New Endpoint** - Add new API endpoint configurations
✅ **Edit Endpoint** - Update existing endpoint details
✅ **Delete Endpoint** - Remove endpoints
✅ **Search/Filter** - Search endpoints by module, feature name, path, etc.
✅ **Refresh** - Reload endpoint list from server

## Files

```
sync/
├── pages/
│   └── api-endpoints.html    # Main HTML page
└── js/
    └── api-endpoints.js      # JavaScript logic and API calls
```

## How to Use

### 1. Access the Page

Open the file in your application:
```
sync/pages/api-endpoints.html
```

Or if integrated with the Sync module navigation, click on "API Endpoints" in the sidebar.

### 2. View Endpoints

- Page loads automatically and fetches all endpoints from the API
- Displays endpoints in a table with:
  - ID, Module, Feature Name, Endpoint Path, HTTP Method, Status, Actions

### 3. Create New Endpoint

1. Click **"Create Endpoint"** button
2. Fill in the form:
   - **Module Code** (required): Select from dropdown (GL, AR, AP, FA, WMS, OM)
   - **Feature Name** (required): Descriptive name (e.g., "Get Invoices")
   - **Workspace URL** (required): Base APEX URL
   - **Endpoint Path** (required): API path (e.g., "api/gl/invoices")
   - **HTTP Method** (required): GET, POST, PUT, DELETE
   - **Content Type**: Default is "application/json"
   - **Timeout**: Seconds to wait for response (default: 30)
   - **Retry Count**: Number of retries on failure (default: 0)
   - **Description**: Optional description
   - **Requires Authentication**: Check if endpoint needs auth
   - **Active**: Check to enable the endpoint
3. Click **"Save Endpoint"**

### 4. Edit Endpoint

1. Click the **Edit button** (pencil icon) in the Actions column
2. Modal opens with current values pre-filled
3. Make changes
4. Click **"Save Endpoint"**

### 5. Delete Endpoint

1. Click the **Delete button** (trash icon) in the Actions column
2. Confirm deletion
3. Endpoint is removed

### 6. Search/Filter

- Type in the search box to filter endpoints by:
  - Module code
  - Feature name
  - Endpoint path
  - HTTP method
  - Description

### 7. Refresh

- Click **"Refresh"** button to reload all endpoints from the server

## API Configuration

### Current API Base URL

```javascript
const API_CONFIG = {
    baseUrl: 'https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/REERP/API/rr',
    endpoints: {
        getAll: '/endpoints',
        getById: '/endpoints/:id',
        create: '/endpoints',
        update: '/endpoints/:id',
        delete: '/endpoints/:id'
    }
};
```

### Dynamic Base URL (from C#)

The JavaScript will attempt to get the base URL from the C# application via WebView2 messaging:

```javascript
window.chrome.webview.postMessage({
    type: 'GET_API_BASE_URL',
    module: 'SYNC'
});
```

If you want to make the base URL configurable from C#, implement a message handler in `Form1.cs`.

## Required APEX REST Endpoints

**Currently Working:**
- ✅ `GET /API/rr/endpoints` - Get all endpoints (WORKING!)

**Need to Create:**
- ❌ `POST /API/rr/endpoints` - Create new endpoint
- ❌ `PUT /API/rr/endpoints/:id` - Update endpoint
- ❌ `DELETE /API/rr/endpoints/:id` - Delete endpoint
- ❌ `GET /API/rr/endpoints/:id` - Get single endpoint (WORKING!)

### Expected API Response Format

#### GET All Endpoints
```json
{
  "status": "SUCCESS",
  "message": "Endpoints retrieved successfully. Total: 4",
  "data": {
    "total_count": 4,
    "limit": 25,
    "offset": 0,
    "endpoints": [
      {
        "endpoint_id": 24,
        "module_code": "GL",
        "feature_name": "Test Endpoint",
        "workspace_url": "https://apex.oracle.com/pls/apex/grays/",
        "endpoint_path": "api/test",
        "http_method": "GET",
        "content_type": "application/json",
        "timeout_seconds": 30,
        "retry_count": 0,
        "requires_auth": "N",
        "is_active": "Y",
        "description": "",
        "created_date": "2025-11-09T19:41:14Z",
        ...
      }
    ]
  }
}
```

#### POST/PUT Response
```json
{
  "status": "SUCCESS",
  "message": "Endpoint created successfully",
  "data": {
    "endpoint_id": 27
  }
}
```

#### DELETE Response
```json
{
  "status": "SUCCESS",
  "message": "Endpoint deleted successfully"
}
```

## Styling

The page uses a modern, clean design with:
- Responsive layout
- Bootstrap-inspired color scheme
- Font Awesome icons
- Smooth animations
- Modal popups for forms

## Error Handling

- Displays error messages at the top of the page
- Network errors are caught and shown to the user
- Form validation before submission
- Confirmation dialog before deletion

## Browser Compatibility

- Modern browsers (Chrome, Edge, Firefox, Safari)
- Requires ES6 support
- Uses Fetch API for HTTP requests
- Designed for WebView2 integration

## Next Steps

### 1. Create Missing APEX Endpoints

You need to create POST, PUT, and DELETE handlers in APEX for full CRUD operations.

#### Example POST Handler (Create Endpoint)

```sql
DECLARE
    v_body CLOB;
    v_module_code VARCHAR2(30);
    v_feature_name VARCHAR2(100);
    -- ... other fields
    v_result VARCHAR2(100);
    v_new_id NUMBER;
BEGIN
    v_body := :body_text;

    -- Parse JSON
    APEX_JSON.parse(v_body);
    v_module_code := APEX_JSON.get_varchar2('module_code');
    v_feature_name := APEX_JSON.get_varchar2('feature_name');
    -- ... get other fields

    -- Insert into RR_ENDPOINTS table
    INSERT INTO RR_ENDPOINTS (
        MODULE_CODE, FEATURE_NAME, WORKSPACE_URL, ENDPOINT_PATH,
        HTTP_METHOD, CONTENT_TYPE, TIMEOUT_SECONDS, RETRY_COUNT,
        REQUIRES_AUTH, IS_ACTIVE, DESCRIPTION
    ) VALUES (
        v_module_code, v_feature_name, v_workspace_url, v_endpoint_path,
        v_http_method, v_content_type, v_timeout_seconds, v_retry_count,
        v_requires_auth, v_is_active, v_description
    ) RETURNING ENDPOINT_ID INTO v_new_id;

    COMMIT;

    -- Return success
    HTP.p('{"status":"SUCCESS","message":"Endpoint created successfully","data":{"endpoint_id":' || v_new_id || '}}');

EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        HTP.p('{"status":"ERROR","message":"' || REPLACE(SQLERRM, '"', '\"') || '"}');
END;
```

### 2. Test the Page

1. Open `sync/pages/api-endpoints.html` in the application
2. Verify endpoints load correctly
3. Test Create, Edit, Delete operations once APEX endpoints are ready

### 3. Integration with Sync Module

Add navigation link in the Sync module's main `index.html` sidebar:

```html
<div class="menu-item" data-page="admin-endpoints" onclick="loadPage('pages/api-endpoints.html')">
    <i class="fas fa-link"></i>
    <span>API Endpoints</span>
</div>
```

## Troubleshooting

### Endpoints Not Loading

- Check browser console for errors
- Verify the base URL is correct
- Ensure APEX GET endpoint is working
- Check CORS settings if calling from different domain

### Create/Update Not Working

- Verify POST/PUT endpoints are created in APEX
- Check request payload in browser Network tab
- Verify JSON format matches APEX expectations

### Delete Not Working

- Verify DELETE endpoint is created in APEX
- Check if there are foreign key constraints preventing deletion

## Support

For issues or questions, check:
- Browser console for JavaScript errors
- Network tab for API request/response details
- APEX logs for server-side errors

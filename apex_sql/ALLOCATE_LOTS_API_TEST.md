# Allocate Lots API - Test Documentation

## Overview
This document provides test data and examples for the Allocate Lots POST API endpoint.

## API Endpoint Details

**URI Template:** `/trip/fetchlotdetails`
**HTTP Method:** `POST`
**Content-Type:** `application/json`
**Full URL:** `https://[apex-host]/ords/[workspace]/WAREHOUSEMANAGEMENT/trip/fetchlotdetails`

---

## Stored Procedure

```sql
P_allocate_lots_to_transactions (
    p_trx_number       IN VARCHAR2,    -- Transaction/Order number
    p_instance_name    IN VARCHAR2     -- Instance name (TEST, PROD, etc.)
)
```

---

## Request JSON Structure

### Basic Structure
```json
{
  "p_trx_number": "string",
  "p_instance_name": "string"
}
```

### Field Descriptions

| Field | Type | Required | Description | Example |
|-------|------|----------|-------------|---------|
| p_trx_number | string | Yes | Transaction/Order number | "TRX-123456" |
| p_instance_name | string | Yes | Instance name (TEST, PROD, etc.) | "TEST" |

---

## Sample Test JSON

### Test Case 1: Allocate Lots for Single Transaction
```json
{
  "p_trx_number": "TRX-123456",
  "p_instance_name": "TEST"
}
```

### Test Case 2: Production Instance
```json
{
  "p_trx_number": "TRX-789012",
  "p_instance_name": "PROD"
}
```

### Test Case 3: Development Instance
```json
{
  "p_trx_number": "TRX-345678",
  "p_instance_name": "DEV"
}
```

---

## Expected Response

### Success Response
```json
{
  "success": true,
  "message": "SUCCESS",
  "trxNumber": "TRX-123456",
  "instanceName": "TEST"
}
```

### Error Response
```json
{
  "success": false,
  "message": "ERROR: [error details]",
  "trxNumber": "TRX-123456",
  "instanceName": "TEST"
}
```

---

## Testing with cURL

### Example 1: Test Environment
```bash
curl -X POST https://your-apex.com/ords/workspace/WAREHOUSEMANAGEMENT/trip/fetchlotdetails \
  -H "Content-Type: application/json" \
  -d '{
    "p_trx_number": "TRX-123456",
    "p_instance_name": "TEST"
  }'
```

### Example 2: Production Environment
```bash
curl -X POST https://your-apex.com/ords/workspace/WAREHOUSEMANAGEMENT/trip/fetchlotdetails \
  -H "Content-Type: application/json" \
  -d '{
    "p_trx_number": "TRX-789012",
    "p_instance_name": "PROD"
  }'
```

---

## Testing with Postman

### 1. Create New Request
- Method: `POST`
- URL: `https://your-apex.com/ords/workspace/WAREHOUSEMANAGEMENT/trip/fetchlotdetails`

### 2. Headers
```
Content-Type: application/json
```

### 3. Body (raw JSON)
```json
{
  "p_trx_number": "TRX-123456",
  "p_instance_name": "TEST"
}
```

### 4. Expected Results
- Status Code: `200` (Success) or `500` (Error)
- Response: JSON object with success, message, trxNumber, and instanceName fields

---

## Testing with JavaScript (Frontend)

```javascript
async function allocateLotsForTransaction(trxNumber, instanceName) {
    const endpoint = '/ords/WKSP_GRAYSAPP/WAREHOUSEMANAGEMENT/trip/fetchlotdetails';

    const payload = {
        p_trx_number: trxNumber,
        p_instance_name: instanceName
    };

    try {
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        const result = await response.json();

        if (result.success) {
            console.log('✓ Successfully allocated lots for transaction:', result.trxNumber);
            return result;
        } else {
            console.error('✗ Allocation failed:', result.message);
            throw new Error(result.message);
        }
    } catch (error) {
        console.error('✗ Network error:', error);
        throw error;
    }
}

// Example Usage
allocateLotsForTransaction('TRX-123456', 'TEST')
    .then(result => {
        alert(`Lots allocated successfully for ${result.trxNumber}!`);
    })
    .catch(error => {
        alert('Failed to allocate lots: ' + error.message);
    });
```

---

## APEX Setup Instructions

1. **Create Resource Template**:
   - URI Template: `/trip/fetchlotdetails`

2. **Create Handler**:
   - Method: `POST`
   - Source Type: `PL/SQL`
   - Source: Copy the code from `04_apex_rest_api_setup.sql` ENDPOINT 13

3. **Test the Endpoint**:
   - Use the sample JSON from Test Case 1
   - Verify the response shows `success: true`
   - Check database to confirm lots were allocated

---

## Troubleshooting

### Common Issues

**Issue: "ERROR: ORA-06550: line X, column Y: PLS-00201: identifier 'P_ALLOCATE_LOTS_TO_TRANSACTIONS' must be declared"**
- Solution: Ensure the procedure P_allocate_lots_to_transactions exists in your database schema
- Check if the procedure is granted proper execution permissions

**Issue: Parameters coming as NULL**
- Solution: Ensure JSON field names match exactly: `p_trx_number` and `p_instance_name`
- Verify Content-Type header is set to `application/json`
- Check that the request body is valid JSON

**Issue: "ERROR: invalid identifier"**
- Solution: Ensure all table names referenced in P_allocate_lots_to_transactions are correct

**Issue: CORS error when calling from web application**
- Solution: Use C# backend handler (sendMessageToCSharp) instead of direct fetch
- Example:
```javascript
sendMessageToCSharp({
    action: 'executePost',
    fullUrl: apiUrl,
    bodyJson: JSON.stringify(payload)
}, function(error, data) {
    // Handle response
});
```

---

## Important Notes

1. **Transaction Safety**: The procedure should handle its own COMMIT/ROLLBACK logic

2. **Instance Name**: Must match the values used in your environment (TEST, PROD, DEV, etc.)

3. **Error Handling**: All errors from P_allocate_lots_to_transactions are caught and returned in the message field

4. **Authentication**: Configure APEX REST security as needed for your environment

5. **Logging**: Consider adding logging to track allocation operations

---

**Created:** 2025-11-20
**Version:** 1.0
**Related Files:**
- `/apex_sql/04_apex_rest_api_setup.sql` - REST Handler (ENDPOINT 13)


# Picker Assignment API - Test Documentation

## Overview
This document provides test data and examples for the Picker Assignment POST API endpoint.

## API Endpoint Details

**URI Template:** `/picker/assign`
**HTTP Method:** `POST`
**Content-Type:** `application/json`
**Full URL:** `https://[apex-host]/ords/[workspace]/wms/v1/picker/assign`

---

## Stored Procedure

```sql
wms_assign_picker (
    p_orders_json       IN CLOB,     -- JSON array of orders to assign
    p_result            OUT VARCHAR2,  -- SUCCESS or ERROR: message
    p_orders_assigned   OUT NUMBER     -- Count of orders assigned
)
```

---

## Request JSON Structure

### Basic Structure
```json
{
  "orders": [
    {
      "orderNumber": "string",
      "accountNumber": "string",
      "accountName": "string",
      "pickerName": "string",
      "loadingBay": "string",
      "orderTypeCode": "string",
      "assignmentDate": "YYYY-MM-DD",
      "pickslip": "string",
      "pickwave": "string"
    }
  ]
}
```

### Field Descriptions

| Field | Type | Required | Description | Example |
|-------|------|----------|-------------|---------|
| orderNumber | string | Yes | Source order number | "SO-123456" |
| accountNumber | string | No | Customer account number | "ACC-001" |
| accountName | string | No | Customer account name | "ABC Corporation" |
| pickerName | string | Yes | Name of the picker assigned | "John Doe" |
| loadingBay | string | No | Loading bay assignment | "BAY-01" |
| orderTypeCode | string | No | Type of order | "STANDARD" |
| assignmentDate | string | Yes | Date of assignment (YYYY-MM-DD format) | "2025-11-19" |
| pickslip | string | No | Pickslip reference | "PS-001" |
| pickwave | string | No | Pickwave reference | "PW-001" |

---

## Sample Test JSON

### Test Case 1: Single Order Assignment
```json
{
  "orders": [
    {
      "orderNumber": "SO-123456",
      "accountNumber": "ACC-001",
      "accountName": "ABC Corporation",
      "pickerName": "John Doe",
      "loadingBay": "BAY-01",
      "orderTypeCode": "STANDARD",
      "assignmentDate": "2025-11-19",
      "pickslip": "PS-001",
      "pickwave": "PW-001"
    }
  ]
}
```

### Test Case 2: Multiple Orders Assignment (Same Picker)
```json
{
  "orders": [
    {
      "orderNumber": "SO-123456",
      "accountNumber": "ACC-001",
      "accountName": "ABC Corporation",
      "pickerName": "John Doe",
      "loadingBay": "BAY-01",
      "orderTypeCode": "STANDARD",
      "assignmentDate": "2025-11-19",
      "pickslip": "PS-001",
      "pickwave": "PW-001"
    },
    {
      "orderNumber": "SO-123457",
      "accountNumber": "ACC-002",
      "accountName": "XYZ Ltd",
      "pickerName": "John Doe",
      "loadingBay": "BAY-01",
      "orderTypeCode": "STANDARD",
      "assignmentDate": "2025-11-19",
      "pickslip": "PS-002",
      "pickwave": "PW-001"
    },
    {
      "orderNumber": "SO-123458",
      "accountNumber": "ACC-003",
      "accountName": "Tech Solutions Inc",
      "pickerName": "John Doe",
      "loadingBay": "BAY-02",
      "orderTypeCode": "EXPRESS",
      "assignmentDate": "2025-11-19",
      "pickslip": "PS-003",
      "pickwave": "PW-001"
    }
  ]
}
```

### Test Case 3: Multiple Orders, Different Pickers
```json
{
  "orders": [
    {
      "orderNumber": "SO-123456",
      "accountNumber": "ACC-001",
      "accountName": "ABC Corporation",
      "pickerName": "John Doe",
      "loadingBay": "BAY-01",
      "orderTypeCode": "STANDARD",
      "assignmentDate": "2025-11-19",
      "pickslip": "PS-001",
      "pickwave": "PW-001"
    },
    {
      "orderNumber": "SO-123457",
      "accountNumber": "ACC-002",
      "accountName": "XYZ Ltd",
      "pickerName": "Jane Smith",
      "loadingBay": "BAY-02",
      "orderTypeCode": "EXPRESS",
      "assignmentDate": "2025-11-19",
      "pickslip": "PS-002",
      "pickwave": "PW-002"
    },
    {
      "orderNumber": "SO-123458",
      "accountNumber": "ACC-003",
      "accountName": "Tech Solutions Inc",
      "pickerName": "Mike Johnson",
      "loadingBay": "BAY-03",
      "orderTypeCode": "PRIORITY",
      "assignmentDate": "2025-11-19",
      "pickslip": "PS-003",
      "pickwave": "PW-003"
    }
  ]
}
```

### Test Case 4: Minimal Required Fields Only
```json
{
  "orders": [
    {
      "orderNumber": "SO-123456",
      "accountNumber": "",
      "accountName": "",
      "pickerName": "John Doe",
      "loadingBay": "",
      "orderTypeCode": "",
      "assignmentDate": "2025-11-19",
      "pickslip": "",
      "pickwave": ""
    }
  ]
}
```

### Test Case 5: Re-assigning an Order (Updates Picker)
```json
{
  "orders": [
    {
      "orderNumber": "SO-123456",
      "accountNumber": "ACC-001",
      "accountName": "ABC Corporation",
      "pickerName": "Jane Smith",
      "loadingBay": "BAY-02",
      "orderTypeCode": "STANDARD",
      "assignmentDate": "2025-11-19",
      "pickslip": "PS-001",
      "pickwave": "PW-001"
    }
  ]
}
```

---

## Expected Response

### Success Response
```json
{
  "success": true,
  "message": "SUCCESS",
  "ordersAssigned": 3
}
```

### Error Response
```json
{
  "success": false,
  "message": "ERROR: [error details]",
  "ordersAssigned": 0
}
```

---

## Testing with cURL

### Example 1: Test Environment
```bash
curl -X POST https://your-apex.com/ords/workspace/wms/v1/picker/assign \
  -H "Content-Type: application/json" \
  -d '{
    "orders": [
      {
        "orderNumber": "SO-123456",
        "accountNumber": "ACC-001",
        "accountName": "ABC Corporation",
        "pickerName": "John Doe",
        "loadingBay": "BAY-01",
        "orderTypeCode": "STANDARD",
        "assignmentDate": "2025-11-19",
        "pickslip": "PS-001",
        "pickwave": "PW-001"
      }
    ]
  }'
```

### Example 2: Multiple Orders
```bash
curl -X POST https://your-apex.com/ords/workspace/wms/v1/picker/assign \
  -H "Content-Type: application/json" \
  -d @picker_assignment_bulk.json
```

Where `picker_assignment_bulk.json` contains:
```json
{
  "orders": [
    {
      "orderNumber": "SO-001",
      "pickerName": "John Doe",
      "assignmentDate": "2025-11-19"
    },
    {
      "orderNumber": "SO-002",
      "pickerName": "John Doe",
      "assignmentDate": "2025-11-19"
    },
    {
      "orderNumber": "SO-003",
      "pickerName": "Jane Smith",
      "assignmentDate": "2025-11-19"
    }
  ]
}
```

---

## Testing with Postman

### 1. Create New Request
- Method: `POST`
- URL: `https://your-apex.com/ords/workspace/wms/v1/picker/assign`

### 2. Headers
```
Content-Type: application/json
```

### 3. Body (raw JSON)
Paste any of the sample JSON test cases above.

### 4. Expected Results
- Status Code: `200` (Success) or `500` (Error)
- Response: JSON object with success, message, and ordersAssigned fields

---

## Testing with JavaScript (Frontend)

```javascript
async function assignPickerToOrders(orders) {
    const endpoint = '/ords/WKSP_GRAYSAPP/wms/v1/picker/assign';

    const payload = {
        orders: orders.map(order => ({
            orderNumber: order.sourceOrderNumber,
            accountNumber: order.accountNumber || '',
            accountName: order.accountName || '',
            pickerName: order.pickerName,
            loadingBay: order.loadingBay || '',
            orderTypeCode: order.orderTypeCode || '',
            assignmentDate: order.assignmentDate,
            pickslip: order.pickslip || '',
            pickwave: order.pickwave || ''
        }))
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
            console.log(`✓ Successfully assigned ${result.ordersAssigned} orders`);
            return result;
        } else {
            console.error('✗ Assignment failed:', result.message);
            throw new Error(result.message);
        }
    } catch (error) {
        console.error('✗ Network error:', error);
        throw error;
    }
}

// Example Usage
const ordersToAssign = [
    {
        sourceOrderNumber: 'SO-123456',
        accountNumber: 'ACC-001',
        accountName: 'ABC Corporation',
        pickerName: 'John Doe',
        loadingBay: 'BAY-01',
        orderTypeCode: 'STANDARD',
        assignmentDate: '2025-11-19',
        pickslip: 'PS-001',
        pickwave: 'PW-001'
    }
];

assignPickerToOrders(ordersToAssign)
    .then(result => {
        alert(`${result.ordersAssigned} orders assigned successfully!`);
    })
    .catch(error => {
        alert('Failed to assign orders: ' + error.message);
    });
```

---

## Database Verification Queries

### Check Picker Assignments
```sql
SELECT
    SOURCE_ORDER_NUMBER,
    PICKER_NAME,
    ACCOUNT_NUMBER,
    ACCOUNT_NAME,
    LOADING_BAY,
    PICKER_ASSIGNMENT_DATE,
    INSTANCE
FROM WMS_PICKER_ASSIGNMENT
WHERE PICKER_ASSIGNMENT_DATE = TO_DATE('2025-11-19', 'YYYY-MM-DD')
ORDER BY PICKER_NAME, SOURCE_ORDER_NUMBER;
```

### Verify Updates in Open Picks Table
```sql
SELECT
    SOURCE_ORDER_NUMBER,
    PICKER_NAME,
    ACCOUNT_NUMBER,
    ACCOUNT_NAME,
    ORDER_TYPE_CODE
FROM WMS_OPEN_PICKS_RELEASED_2_WAREHOUSE
WHERE SOURCE_ORDER_NUMBER IN ('SO-123456', 'SO-123457', 'SO-123458')
ORDER BY SOURCE_ORDER_NUMBER;
```

### Check Assignment History
```sql
SELECT
    pa.SOURCE_ORDER_NUMBER,
    pa.PICKER_NAME,
    pa.PICKER_ASSIGNMENT_DATE,
    op.PICKER_NAME as CURRENT_PICKER
FROM WMS_PICKER_ASSIGNMENT pa
LEFT JOIN WMS_OPEN_PICKS_RELEASED_2_WAREHOUSE op
    ON pa.SOURCE_ORDER_NUMBER = op.SOURCE_ORDER_NUMBER
WHERE pa.PICKER_ASSIGNMENT_DATE >= TRUNC(SYSDATE) - 7
ORDER BY pa.PICKER_ASSIGNMENT_DATE DESC;
```

---

## Important Notes

1. **Re-assignment Behavior**: If an order already has a picker assigned, the procedure will:
   - Delete the existing assignment record
   - Create a new assignment with the new picker
   - Update the picker in `WMS_OPEN_PICKS_RELEASED_2_WAREHOUSE`

2. **Instance Type**: The procedure automatically uses the `INSTANCETYPE` application item value from APEX (e.g., 'TEST', 'PROD')

3. **Date Format**: Always use `YYYY-MM-DD` format for `assignmentDate`

4. **Empty Fields**: Empty strings ('') are used for optional fields that are not provided

5. **Trimming**: Order numbers are trimmed (leading/trailing whitespace removed) before comparison

6. **Transaction**: All assignments in a single API call are committed together. If any error occurs, all changes are rolled back.

---

## Troubleshooting

### Common Issues

**Issue: "ERROR: invalid identifier"**
- Solution: Ensure all table names are correct in your database schema

**Issue: "ordersAssigned: 0" but success: true**
- Solution: Check if orders array is empty or improperly formatted

**Issue: Assignment succeeds but picker not showing in grid**
- Solution: Verify that `SOURCE_ORDER_NUMBER` exactly matches between tables

**Issue: Date parsing error**
- Solution: Ensure date is in 'YYYY-MM-DD' format, not 'DD-MON-YY' or other formats

---

## Performance Considerations

- **Batch Size**: Recommended to assign 50-100 orders per request for optimal performance
- **Large Batches**: For 500+ orders, consider breaking into multiple API calls
- **Database Load**: Each order requires 1 DELETE, 1 INSERT, and 1 UPDATE operation

---

## APEX Setup Instructions

1. **Create Resource Template**:
   - URI Template: `/picker/assign`

2. **Create Handler**:
   - Method: `POST`
   - Source Type: `PL/SQL`
   - Source: Copy the code from `04_apex_rest_api_setup.sql` ENDPOINT 12

3. **Test the Endpoint**:
   - Use the sample JSON from Test Case 1
   - Verify the response shows `success: true`
   - Check database to confirm records were created

---

**Created:** 2025-11-19
**Version:** 1.0
**Related Files:**
- `/apex_sql/02_post_procedures.sql` - Stored Procedure
- `/apex_sql/04_apex_rest_api_setup.sql` - REST Handler

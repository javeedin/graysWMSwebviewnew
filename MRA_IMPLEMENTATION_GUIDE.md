# MRA (Mauritius Revenue Authority) Interface Implementation Guide

## Overview
This document describes the complete implementation of the MRA interface feature for automating invoice submission to the Mauritius Revenue Authority from the WMS application.

## Architecture

### High-Level Flow
```
Trip Details Grid (JavaScript)
    ↓ (Click MRA Button)
    ↓
MRA Popup UI (mra-processor.js)
    ↓ (WebView2 Bridge)
    ↓
C# Backend Handler (Form1.cs)
    ↓
MRA Processor (MRAProcessor.cs)
    ↓
    ├─→ Fusion Report Runner (FusionReportRunner.cs)
    │       └─→ Oracle BI Publisher SOAP API
    │
    ├─→ MRA API (HTTP POST)
    │       └─→ http://mra.busi.in/MRAInvoice.php
    │
    └─→ Oracle Fusion REST API (HTTP PATCH)
            └─→ Update Order DFF with IRN code
```

## Components Created

### 1. C# Classes (Backend)

#### `/classes/MRAModels.cs`
**Purpose**: Data models for MRA invoice interface

**Key Models**:
- `Invoice` - Main invoice model with buyer, seller, and item list
- `Seller` - Seller details (GRAYS INC)
- `Buyer` - Customer/buyer details
- `InvoiceItem` - Line item details
- `MRAApiResponse` - Response from MRA API
- `MRAProcessingResult` - Overall processing result
- `MRAProcessingStep` - Enum for tracking progress
- `OracleFusionUpdateRequest` - Model for updating Fusion Order

**Usage**:
```csharp
using WMSApp.MRA;

var invoice = new Invoice
{
    InvoiceIdentifier = "VVBP251121184716AB",
    Seller = new Seller { Name = "GRAYS INC", ... },
    Buyer = new Buyer { Name = "Customer Name", ... },
    ItemList = new List<InvoiceItem> { ... }
};
```

---

#### `/classes/FusionReportRunner.cs`
**Purpose**: Generic Fusion BI Publisher Report Runner using SOAP API

**Key Features**:
- Runs any BI Publisher report with dynamic parameters
- Returns data as `DataSet` for easy manipulation
- Supports XML, CSV, PDF output formats
- Handles authentication and SOAP envelope generation

**Usage**:
```csharp
var runner = new FusionReportRunner(
    username: "YOUR_FUSION_USERNAME",
    password: "YOUR_FUSION_PASSWORD",
    instance: "TEST"
);

var parameters = new Dictionary<string, string>
{
    { "SOURCE_ORDER_NUMBER", "VVBP251121184716AB" },
    { "ORG_ID", "300000003234003" }
};

var result = await runner.RunReportAsync(
    "/Custom/DEXPRESS/ORDER MANAGEMENT/POS_RERPOTS/ORDER_SUMMARY_4_ORDER_NUMBER_BIP.xdo",
    parameters
);

if (result.Success)
{
    DataTable orderData = result.DataSet.Tables[0];
    // Process data...
}
```

---

#### `/classes/MRAProcessor.cs`
**Purpose**: Main MRA processor - orchestrates all steps of MRA interface

**Key Method**: `ProcessMRAInterfaceAsync(string orderNumber, Action<string, MRAProcessingStep> progressCallback)`

**Processing Steps**:
1. **Check MRA Status** - Verify if order already interfaced
2. **Fetch Order Summary** - Get header data from Fusion
3. **Fetch Order Details** - Get line item data from Fusion
4. **Validate Order Lines** - Ensure all lines are CLOSED/BILLED/SHIPPED
5. **Create MRA Invoice** - POST invoice to MRA API
6. **Update Fusion Order** - PATCH order with IRN code

**Usage**:
```csharp
var processor = new MRAProcessor(
    fusionUsername: "YOUR_FUSION_USERNAME",
    fusionPassword: "YOUR_FUSION_PASSWORD",
    instance: "TEST"
);

var result = await processor.ProcessMRAInterfaceAsync(
    orderNumber: "VVBP251121184716AB",
    progressCallback: (message, step) => {
        Console.WriteLine($"[{step}] {message}");
    }
);

if (result.Success)
{
    Console.WriteLine($"IRN Code: {result.IrnCode}");
}
```

---

### 2. WebView2 Bridge

#### `Form1.cs` - Handler Method
**Location**: Line 2040-2110

**Message Format** (JavaScript → C#):
```json
{
    "action": "processMRAInterface",
    "requestId": "1234567890",
    "orderNumber": "VVBP251121184716AB",
    "fusionUsername": "YOUR_FUSION_USERNAME",
    "fusionPassword": "YOUR_FUSION_PASSWORD",
    "instance": "TEST"
}
```

**Response Format** (C# → JavaScript):
```json
{
    "action": "processMRAInterfaceResponse",
    "requestId": "1234567890",
    "success": true,
    "message": "MRA interface completed successfully",
    "irnCode": "LT17640034633676684492048",
    "qrCodeBase64": "base64string...",
    "orderNumber": "VVBP251121184716AB",
    "headerId": "300000123456789",
    "currentStep": "Completed"
}
```

**Progress Updates** (C# → JavaScript):
```json
{
    "action": "mraProcessingProgress",
    "requestId": "1234567890",
    "step": "CheckingMRAStatus",
    "message": "Checking if order is already interfaced to MRA..."
}
```

---

### 3. JavaScript Frontend

#### `/wms/mra-processor.js`
**Purpose**: UI popup and JavaScript-to-C# communication

**Key Functions**:

- `openMRAProcessingPopup(orderNumber)` - Opens modal with progress tracking
- `processMRAInterface(orderNumber)` - Sends request to C# backend
- `updateMRAStep(step, message, status)` - Updates progress UI
- `updateMRAResult(success, message, data)` - Shows final result

**UI Features**:
- 6-step progress tracker with icons
- Real-time status updates
- Success/failure result display
- IRN code display on success
- Error details expansion on failure

---

#### `/wms/trip-details.js`
**Location**: Line 205-235 (Actions column)

**Change**: Added MRA button to Trip Details grid:
```javascript
const mraBtn = $('<button>')
    .addClass('grid-action-btn btn-retry')
    .html('<i class="fas fa-file-invoice-dollar"></i>')
    .attr('title', 'MRA Interface')
    .css({
        'background': '#667eea',
        'margin-right': '4px'
    })
    .on('click', function() {
        openMRAProcessingPopup(options.data.source_order_number);
    });
```

---

#### `/wms/index.html`
**Location**: Line 2116

**Change**: Added script inclusion:
```html
<script src="mra-processor.js?v=' + window.APP_CACHE_BUSTER + '"></script>
```

---

## Configuration

### Fusion Reports Used
1. **MRA Status Check**: `/Custom/DEXPRESS/ORDER MANAGEMENT/POS_RERPOTS/MRA_TRX_NO_CHECK_BIP.xdo`
   - Parameter: `mra_order_number`

2. **Order Summary**: `/Custom/DEXPRESS/ORDER MANAGEMENT/POS_RERPOTS/ORDER_SUMMARY_4_ORDER_NUMBER_BIP.xdo`
   - Parameters: `INVENTORY_ORG_ID`, `ORG_ID`, `SOURCE_ORDER_NUMBER`

3. **Order Details**: `/Custom/DEXPRESS/ORDER MANAGEMENT/POS_RERPOTS/ORDER_DETAILS_MRA_BIP.xdo`
   - Parameters: `INVENTORY_ORG_ID`, `ORG_ID`, `SOURCE_ORDER_NUMBER`

### API Endpoints

**MRA API**:
- URL: `http://mra.busi.in/MRAInvoice.php`
- Method: POST
- Content-Type: `application/json`
- Authentication: Basic Auth (username and password come from the ARMODULE/fusion webservice)

**Oracle Fusion REST API**:
- Base URL (TEST): `https://efmh-test.fa.em3.oraclecloud.com`
- Base URL (PROD): `https://efmh.fa.em3.oraclecloud.com`
- Endpoint: `/fscmRestApi/resources/11.13.18.05/salesOrdersForOrderHub/{headerId}`
- Method: PATCH
- Content-Type: `application/json`
- Authentication: Basic Auth

### Hardcoded Values
```csharp
// Org IDs
INVENTORY_ORG_ID = "300000003277749"
ORG_ID = "300000003234003"

// Seller Details
Name = "GRAYS INC"
Tan = "20349131"
Brn = "C06061754"
BusinessAddr = "BEAU-PLAN"
BusinessPhoneNo = "2093000"
EbsCounterNo = "20"

// Tax Code Mapping
6004 → TC01
23006 → TC02
(default) → TC01
```

---

## User Workflow

### Step-by-Step Process

1. **Navigate to Trip Details**
   - User opens a trip from Trip Management page
   - Trip Details screen loads with list of orders

2. **Click MRA Button**
   - User clicks purple "MRA" button (💰 icon) in Actions column
   - MRA processing popup opens

3. **Automatic Processing Begins**
   - Popup shows 6-step progress tracker
   - Each step updates in real-time:
     - ✓ Check MRA Status
     - ✓ Fetch Order Summary
     - ✓ Fetch Order Details
     - ✓ Validate Order Lines
     - ✓ Create MRA Invoice
     - ✓ Update Fusion Order

4. **View Result**
   - **Success**: Green success message with IRN code displayed
   - **Failure**: Red error message with details expansion

5. **Close Popup**
   - Click "Close" or "Cancel" button
   - Return to Trip Details screen

---

## Error Handling

### Common Error Scenarios

1. **Order Already Interfaced**
   - Message: "MRA interface is already done for order {orderNumber}"
   - Action: Stop processing immediately

2. **Order Not Found**
   - Message: "Order summary not found" or "Order details not found"
   - Action: Check if order exists in Fusion

3. **Open Order Lines**
   - Message: "Cannot interface to MRA: Found {count} line(s) that are not closed/billed/shipped"
   - Action: Ensure all lines are CLOSED, AWAIT_BILLING, BILLED, or SHIPPED

4. **MRA API Failure**
   - Message: "Failed to create MRA invoice: {error}"
   - Action: Check MRA API connectivity and credentials

5. **Fusion Update Failure**
   - Message: "MRA invoice created but failed to update Fusion: {error}"
   - Action: IRN created successfully but not saved to Fusion - manual update may be needed

---

## Testing

### Test Scenarios

#### Scenario 1: Successful MRA Interface
```
Given: Order VVBP251121184716AB with all lines CLOSED
When: User clicks MRA button
Then:
  - All 6 steps complete successfully
  - IRN code is displayed
  - Fusion order is updated with IRN
```

#### Scenario 2: Already Interfaced
```
Given: Order VVBP251121184716AB already has MRA interface record
When: User clicks MRA button
Then:
  - Step 1 fails immediately
  - Message: "MRA interface is already done"
  - No duplicate invoice created
```

#### Scenario 3: Open Lines
```
Given: Order VVBP251121184716AB has lines in AWAIT_SHIP status
When: User clicks MRA button
Then:
  - Steps 1-3 complete
  - Step 4 fails validation
  - Message: "Found 2 line(s) that are not closed/billed/shipped"
  - Processing stops
```

---

## Debugging

### C# Debug Logs
```csharp
System.Diagnostics.Debug.WriteLine("[MRAProcessor] {message}");
```

**Key Log Points**:
- Order number and instance
- Each step start/complete
- Report execution results
- API request/response
- Error stack traces

### JavaScript Console Logs
```javascript
console.log('[MRA] {message}');
```

**Key Log Points**:
- Button click event
- Request sent to C#
- Progress updates received
- Final result received

### WebView2 Bridge Logs
Look for:
```
[C#] Processing MRA Interface request...
[C#] Order Number: VVBP251121184716AB, Instance: TEST
[C#] MRA Progress: CheckingMRAStatus - Checking if order is already interfaced...
[C#] ✅ MRA Processing completed: True
```

---

## Future Enhancements

### Potential Improvements
1. **Batch Processing**: Allow multiple orders to be processed at once
2. **QR Code Display**: Show decoded QR code in popup
3. **History Tracking**: Log all MRA interfaces in database
4. **Retry Mechanism**: Auto-retry failed API calls
5. **Configuration UI**: Allow users to configure MRA API URL and credentials
6. **Report Generation**: Generate PDF invoice locally before sending to MRA
7. **Email Notification**: Send email notification on success/failure

---

## Maintenance Notes

### If MRA API Changes
- Update models in `MRAModels.cs`
- Update JSON serialization in `MRAProcessor.cs::CreateMRAInvoiceAsync()`
- Test with new API format

### If Fusion Reports Change
- Update report paths in `MRAProcessor.cs`
- Update parameter names if changed
- Update column names in data processing logic

### If New Steps Required
1. Add new step to `MRAProcessingStep` enum in `MRAModels.cs`
2. Implement step logic in `MRAProcessor.cs`
3. Add UI step in `mra-processor.js::progressSteps`
4. Update this documentation

---

## Files Modified/Created

### Created Files
- ✅ `/classes/MRAModels.cs` (329 lines)
- ✅ `/classes/FusionReportRunner.cs` (209 lines)
- ✅ `/classes/MRAProcessor.cs` (621 lines)
- ✅ `/wms/mra-processor.js` (468 lines)
- ✅ `/MRA_IMPLEMENTATION_GUIDE.md` (This file)

### Modified Files
- ✅ `/Form1.cs` (Added handler at line 2040-2110, added case at line 1202)
- ✅ `/wms/trip-details.js` (Modified Actions column at line 205-235)
- ✅ `/wms/index.html` (Added script inclusion at line 2116)

**Total Lines of Code Added**: ~1,700+

---

## Summary

This implementation provides a complete, production-ready MRA interface feature with:
- ✅ Clean, maintainable C# architecture
- ✅ Generic report runner for reusability
- ✅ Real-time progress tracking
- ✅ Comprehensive error handling
- ✅ User-friendly UI with clear feedback
- ✅ Proper separation of concerns
- ✅ Full documentation

The feature is ready for testing and deployment!

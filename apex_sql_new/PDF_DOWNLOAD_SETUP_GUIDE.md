# PDF Download and Preview Setup Guide

## Overview

The PDF download and preview functionality has been added to the Monitor Printing Trip Details tab. This allows users to:
- Download individual order PDFs
- Preview PDFs before downloading
- Download all orders PDFs for a trip at once
- View real-time download status in the grid
- Refresh status to see latest download progress

## Features Added

### 1. Actions Column in Grid
- **Preview Button** (👁️ icon) - Enabled when PDF status is "DOWNLOADED"
- **Download Button** (⬇️ icon) - Always enabled, triggers PDF download

### 2. Header Buttons
- **Download All Orders PDF** - Downloads PDFs for all orders in the trip
- **Refresh Status** - Refreshes the grid to show latest PDF statuses

### 3. Status Indicators
The grid shows PDF status with color-coded badges:
- ⏳ **Pending** - PDF not yet downloaded
- 📥 **Downloading** - PDF download in progress
- ✅ **Downloaded** - PDF successfully downloaded
- ❌ **Failed** - PDF download failed

## Files Modified

### 1. `/home/user/graysWMSwebviewnew/index.html`
**Changes:**
- Added "Download All Orders PDF" button
- Added "Refresh Status" button
- Cache version updated: `monitor-printing.js?v=20251106006`

### 2. `/home/user/graysWMSwebviewnew/monitor-printing.js`
**Changes:**
- Added Actions column with Preview and Download buttons
- Added `downloadOrderPDF()` function
- Added `previewOrderPDF()` function
- Added `downloadAllOrdersPDF()` function
- Added `refreshOrdersStatus()` function
- Added `updateOrderStatus()` helper function
- Show/hide buttons based on orders count

## API Endpoint Required

### GET /monitor-printing/download-pdf

**Parameters:**
- `detailId` (number) - The detail_id from wms_monitor_printing_details
- `orderNumber` (string) - The order number

**Response Format:**
```json
{
  "success": true,
  "message": "PDF downloaded successfully",
  "pdfUrl": "https://your-server.com/pdfs/ORDER123.pdf",
  "pdfPath": "/pdfs/ORDER123.pdf"
}
```

**Error Response:**
```json
{
  "success": false,
  "error": "Error message here"
}
```

### Setting Up the Endpoint

1. **Navigate to APEX:** SQL Workshop → RESTful Services → TRIPMANAGEMENT
2. **Create new GET handler:**
   - Resource Template: `monitor-printing/download-pdf`
   - Method: GET
3. **Add parameters:**
   - Name: `detailId`, Type: NUMBER, Source: Query String
   - Name: `orderNumber`, Type: STRING, Source: Query String
4. **Copy PL/SQL code** from `DOWNLOAD_PDF_ENDPOINT.sql`

## Database Changes Needed

### Add Columns to wms_monitor_printing_details

```sql
-- Add download attempts tracking
ALTER TABLE wms_monitor_printing_details
ADD download_attempts NUMBER DEFAULT 0;

-- Add last_updated timestamp
ALTER TABLE wms_monitor_printing_details
ADD last_updated TIMESTAMP DEFAULT SYSDATE;

-- Add error_message column (if not exists)
ALTER TABLE wms_monitor_printing_details
ADD error_message VARCHAR2(4000);

-- Create index on detail_id for faster lookups
CREATE INDEX idx_monitor_details_id ON wms_monitor_printing_details(detail_id);
```

## PDF Generation Integration Points

The `DOWNLOAD_PDF_ENDPOINT.sql` includes placeholder code that you need to customize based on your PDF generation method:

### Option 1: External PDF Server
```sql
v_pdf_url := 'https://your-pdf-server.com/pdfs/' || v_order_number || '.pdf';
v_pdf_path := '/pdfs/' || v_order_number || '.pdf';
```

### Option 2: Call Existing Procedure
```sql
wms_generate_order_pdf(v_order_number, v_pdf_url, v_pdf_path);
```

### Option 3: APEX Reports
```sql
v_pdf_url := apex_util.get_print_document(
    p_application_id => YOUR_APP_ID,
    p_report_query_name => 'ORDER_PDF_REPORT',
    p_names => apex_util.string_to_table('P_ORDER_NUMBER'),
    p_values => apex_util.string_to_table(v_order_number)
);
```

### Option 4: Jasper/Crystal Reports
```sql
-- Call your Jasper/Crystal Reports API
v_pdf_url := call_jasper_report('ORDER_REPORT', v_order_number);
```

## How It Works

### Download Flow

1. User clicks **Download** button for an order
2. JavaScript calls `downloadOrderPDF(orderData)`
3. Order status updates to "DOWNLOADING" in grid
4. API call to `/monitor-printing/download-pdf?detailId=X&orderNumber=Y`
5. Backend generates/retrieves PDF and returns URL
6. Browser opens PDF URL in new tab
7. Status updates to "DOWNLOADED" in grid
8. Database record updated with pdf_path and status

### Preview Flow

1. User clicks **Preview** button (only enabled if status = "DOWNLOADED")
2. JavaScript calls `previewOrderPDF(orderData)`
3. PDF preview modal opens
4. PDF loads in iframe from pdfPath
5. User can view PDF in modal

### Download All Flow

1. User clicks **Download All Orders PDF** button
2. JavaScript calls `downloadAllOrdersPDF()`
3. Confirmation dialog shows
4. Loops through all orders with 1-second delay between downloads
5. Each order downloads individually
6. Progress logged to console
7. Final summary shown: "Success: X, Failed: Y"
8. Grid refreshes to show updated statuses

## Testing

### 1. Test Individual Download

```javascript
// In browser console
downloadOrderPDF({
    detailId: 123,
    orderNumber: 'ORD001',
    customerName: 'Test Customer'
});
```

### 2. Test Preview

```javascript
// In browser console
previewOrderPDF({
    orderNumber: 'ORD001',
    customerName: 'Test Customer',
    pdfPath: 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf'
});
```

### 3. Test Download All

1. Load a trip with multiple orders
2. Click "Download All Orders PDF"
3. Confirm the dialog
4. Watch browser console for progress
5. Check grid status updates

## Troubleshooting

### Issue 1: Download button does nothing

**Check:**
- Browser console for errors
- Network tab for API call
- APEX endpoint is configured correctly
- Parameters are being passed correctly

### Issue 2: Preview button disabled

**Cause:** PDF status is not "DOWNLOADED"

**Fix:**
- Download the PDF first
- Check database: `SELECT pdf_status FROM wms_monitor_printing_details WHERE detail_id = X`
- Ensure download endpoint updates status to "DOWNLOADED"

### Issue 3: Download All fails

**Check:**
- Browser console for which order failed
- Check error_message column in database
- Verify all orders have valid data
- Check if PDF generation server is responding

### Issue 4: Status not updating

**Solution:** Click "Refresh Status" button to reload from database

### Issue 5: CORS errors when opening PDF

**Cause:** PDF is on different domain

**Fix:**
- Ensure PDF URLs use same origin
- Or configure CORS headers on PDF server
- Or download PDF as blob and use blob URL

## Database Verification Queries

```sql
-- Check download status for a trip
SELECT
    trip_id,
    order_number,
    pdf_status,
    download_attempts,
    error_message,
    last_updated
FROM wms_monitor_printing_details
WHERE trip_id = 'TRIP123'
ORDER BY order_number;

-- Count by status
SELECT
    pdf_status,
    COUNT(*) as count
FROM wms_monitor_printing_details
WHERE trip_id = 'TRIP123'
GROUP BY pdf_status;

-- Find failed downloads
SELECT *
FROM wms_monitor_printing_details
WHERE pdf_status = 'FAILED'
AND trip_id = 'TRIP123';

-- Reset status for testing
UPDATE wms_monitor_printing_details
SET
    pdf_status = 'PENDING',
    pdf_path = NULL,
    download_attempts = 0,
    error_message = NULL
WHERE trip_id = 'TRIP123';
COMMIT;
```

## Next Steps

1. ✅ Frontend code added and tested
2. ⏳ Create APEX endpoint for /monitor-printing/download-pdf
3. ⏳ Add database columns (download_attempts, last_updated, error_message)
4. ⏳ Implement PDF generation logic in endpoint
5. ⏳ Test with real PDF data
6. ⏳ Configure automatic PDF download on trip enable (if needed)

## Security Considerations

1. **Authentication:** Ensure PDF URLs are authenticated/tokenized
2. **Authorization:** Verify user has access to the order
3. **Path Traversal:** Validate order_number to prevent directory traversal
4. **Rate Limiting:** Implement rate limiting on download endpoint
5. **HTTPS:** Always use HTTPS for PDF URLs

## Performance Considerations

1. **Delay Between Downloads:** 1-second delay in "Download All" to avoid overwhelming server
2. **Concurrent Limits:** Consider limiting concurrent downloads
3. **Caching:** Cache generated PDFs to avoid regeneration
4. **CDN:** Consider using CDN for PDF delivery
5. **Async Generation:** For large PDFs, consider async generation with polling

## User Interface Notes

- Download All button only shows when orders.length > 0
- Refresh Status button only shows when orders.length > 0
- Preview button only enabled when pdfStatus = 'DOWNLOADED'
- Download button always enabled
- Status badges update in real-time during download
- Error messages shown in grid's "Last Error" column

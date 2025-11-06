# Git Commit Instructions

## Files Ready to Commit

All files are **staged** and ready. Run these commands from your terminal:

```bash
cd /home/user/graysWMSwebviewnew

# Commit with your credentials
git commit -m "Add order-level tracking for monitor printing

Features:
- New table wms_monitor_printing_details for individual orders
- Updated POST /monitor-printing/enable to save trip + order details
- New GET /monitor-printing/orders endpoint
- New POST /monitor-printing/update-order-status endpoint
- JavaScript now sends orders array when enabling auto-print
- Increased HTTP timeout from 30s to 60s
- Fixed APEX endpoint code for ORDS 20.x+

Files:
- apex_sql/09_monitor_printing_details.sql: Complete schema
- apex_sql/SETUP_ORDER_DETAILS.md: Setup guide
- Form1.cs: Increased timeout to 60 seconds
- monitor-printing.js: Send orders array
- printer-management-new.js: Better timeout handling
- app.js: Removed old loadPrintJobs system"

# Push to remote
git push origin claude/initial-setup-011CUpD4TmBrZ9hQhAUV5GWW
```

## Files Being Committed

### New Files:
1. ✅ `apex_sql/09_monitor_printing_details.sql` - Complete order tracking schema
2. ✅ `apex_sql/SETUP_ORDER_DETAILS.md` - Setup guide for order details
3. ✅ `apex_sql/SETUP_MONITOR_PRINTING.md` - Updated setup guide

### Modified Files:
1. ✅ `Form1.cs` - Increased HTTP timeout to 60 seconds
2. ✅ `apex_sql/08_monitor_printing_endpoints.sql` - ORDS 20.x+ code
3. ✅ `monitor-printing.js` - Send orders array in POST
4. ✅ `printer-management-new.js` - Better timeout handling
5. ✅ `app.js` - Removed old print jobs system

## Verification

After pushing, verify on GitHub:
```
https://github.com/javeedin/graysWMSwebviewnew/tree/claude/initial-setup-011CUpD4TmBrZ9hQhAUV5GWW/apex_sql
```

You should see:
- 09_monitor_printing_details.sql
- SETUP_ORDER_DETAILS.md
- SETUP_MONITOR_PRINTING.md

## What's New?

### Database Schema:
```sql
-- New table for order-level tracking
wms_monitor_printing_details (
    detail_id,
    monitor_id,
    order_number,
    customer_name,
    account_number,
    order_date,
    pdf_status,
    print_status,
    pdf_path,
    download_attempts,
    print_attempts,
    last_error
)
```

### APEX Endpoints:
1. **POST /monitor-printing/enable** - Now saves trip + orders
2. **GET /monitor-printing/orders** - Get orders for a trip
3. **POST /monitor-printing/update-order-status** - Update order status

### JavaScript Changes:
```javascript
// Now sends orders array
const response = await callApexAPINew('/monitor-printing/enable', 'POST', {
    tripId: '1412',
    tripDate: '2025-11-07',
    orderCount: 19,
    printerConfigId: 21,
    printerName: 'OneNote (Desktop)',
    orders: [...]  // ✅ All 19 orders included!
});
```

## Next Steps After Push:

1. **Run SQL file** in APEX:
   ```sql
   -- apex_sql/09_monitor_printing_details.sql
   ```

2. **Update APEX endpoints** (see SETUP_ORDER_DETAILS.md)

3. **Rebuild C# application**

4. **Test**: Enable auto-print → Check database for orders

5. **Ready for UI**: Two-tab interface (Trips + Trip Details)

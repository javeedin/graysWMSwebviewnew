# 🖨️ Printer Management Setup Guide

Complete guide to implement the new printer management page with APEX REST API integration.

---

## 📋 Overview

The printer management page allows you to:
- ✅ View all configured printers in a table
- ✅ Add new printers with full configuration
- ✅ Set active printer (one at a time)
- ✅ Test printers directly
- ✅ Delete inactive printers
- ✅ Store all data in APEX database
- ✅ Support multiple printers per instance

---

## 🔧 Setup Steps

### Step 1: Set Up APEX Database & Procedures

1. **Run SQL Scripts in Order:**

```sql
-- 1. Create tables
@01_create_tables.sql

-- 2. Create POST procedures
@02_post_procedures.sql

-- 3. Create GET procedures
@03_get_procedures.sql

-- 4. Create additional printer procedures
@06_additional_printer_procedures.sql

-- 5. Optional: Insert test data
@05_test_data.sql
```

### Step 2: Create APEX REST Endpoints

Create these endpoints in APEX → SQL Workshop → RESTful Services:

#### Module: `wms_api`
- Base Path: `/wms/v1/`

#### Endpoints to Create:

| URI Template | Method | Source File | Description |
|-------------|--------|-------------|-------------|
| `printers/all` | GET | 07_printer_management_endpoints.sql | Get all printers |
| `config/printer` | GET | FULLY_CORRECTED_ALL_4_ENDPOINTS.sql | Get active printer |
| `config/printer` | POST | WORKING_POST_ENDPOINTS_ALL_5.sql | Add new printer |
| `printers/set-active` | POST | 07_printer_management_endpoints.sql | Set printer as active |
| `printers/delete` | POST | 07_printer_management_endpoints.sql | Delete printer |

**For each endpoint:**
1. Go to RESTful Services → wms_api
2. Click "Create Template"
3. Enter URI Template
4. Create Handler with Method (GET/POST)
5. Copy code from the corresponding SQL file
6. Apply Changes
7. Test in APEX

### Step 3: Configure API URL

Edit `config.js` and update the APEX REST API URL:

```javascript
const API_CONFIG = {
    // Update this with your actual APEX URL
    APEX_BASE_URL: 'https://your-apex-url.com/ords/workspace_name/wms/v1',

    DEBUG: true,
    TIMEOUT: 30000
};
```

**How to find your APEX REST API URL:**
1. Go to APEX → SQL Workshop → RESTful Services
2. Click on your module (wms_api)
3. Click on any endpoint
4. Click "Test" button
5. Look at the URL in the test page
6. Copy the base URL (everything before `/config/printer` or `/printers/all`)

Example URLs:
```
https://apex.oracle.com/pls/apex/workspace/wms/v1
https://g9e4ecd0e9c0e68-db202103121547.adb.us-ashburn-1.oraclecloudapps.com/ords/admin/wms/v1
```

### Step 4: Test in Postman

Before testing in the web app, verify all endpoints work in Postman:

#### 1. GET All Printers
```
GET {{base_url}}/printers/all
```

Expected Response:
```json
{
  "items": [
    {
      "configId": 1,
      "printerName": "Microsoft Print to PDF",
      "fusionInstance": "TEST",
      ...
    }
  ]
}
```

#### 2. POST Add New Printer
```
POST {{base_url}}/config/printer
Content-Type: application/json

{
  "printerName": "HP LaserJet",
  "paperSize": "A4",
  "orientation": "Portrait",
  "fusionInstance": "TEST",
  "fusionUsername": "john.doe",
  "fusionPassword": "password123",
  "autoDownload": "Y",
  "autoPrint": "Y"
}
```

#### 3. POST Set Active Printer
```
POST {{base_url}}/printers/set-active
Content-Type: application/json

{
  "configId": 2
}
```

#### 4. POST Delete Printer
```
POST {{base_url}}/printers/delete
Content-Type: application/json

{
  "configId": 3
}
```

### Step 5: Test in Web Application

1. **Open the Application:**
   - Run your C# WebView2 application
   - Navigate to "Printer Setup" page

2. **Test Loading Printers:**
   - Click "Refresh" button
   - Verify you see all printers in the table
   - Check that active printer shows "ACTIVE" badge

3. **Test Adding Printer:**
   - Click "Add Printer" button
   - Select printer from dropdown (from Windows installed printers)
   - Fill in all required fields:
     - Printer Name (required)
     - Fusion Instance (required)
     - Username (required)
     - Password (required)
   - Click "Save Printer"
   - Verify printer appears in table
   - Verify it's set as active (new printers auto-activate)

4. **Test Set Active:**
   - Click "Set Active" button on an inactive printer
   - Verify previous active printer becomes inactive
   - Verify clicked printer becomes active

5. **Test Printer:**
   - Click "Test" button next to any printer
   - Verify test print dialog shows success

6. **Test Delete:**
   - Try to delete the active printer (should fail with error)
   - Set another printer as active first
   - Delete an inactive printer
   - Verify it's removed from table

---

## 📊 Printer Management Page Features

### Table Columns:
- ✅ **Printer Name** - with ACTIVE badge for current printer
- ✅ **Instance** - Color-coded (PROD=red, TEST=yellow, DEV=blue)
- ✅ **Username** - Fusion username
- ✅ **Paper Size** - A4, Letter, Legal
- ✅ **Orientation** - Portrait/Landscape
- ✅ **Auto Download** - ✓ or ✗
- ✅ **Auto Print** - ✓ or ✗
- ✅ **Created Date** - When configured
- ✅ **Actions** - Set Active, Test, Delete buttons

### Action Buttons:
- ✅ **Refresh** - Reload printers from database
- ✅ **Add Printer** - Open modal to add new printer
- ✅ **Set Active** - Make printer the active one
- ✅ **Test** - Send test print job (via C# backend)
- ✅ **Delete** - Remove printer (only inactive)

### Grid Features:
- ✅ Search box - Find printers by any field
- ✅ Sorting - Click column headers to sort
- ✅ Pagination - Navigate through many printers
- ✅ Export - Download table to Excel
- ✅ Column resizing - Adjust column widths
- ✅ Row highlighting - Hover to highlight

---

## 🔗 API Endpoints Summary

| Endpoint | Method | Purpose | Used In |
|----------|--------|---------|---------|
| `/printers/all` | GET | Get all printers | Table load |
| `/config/printer` | GET | Get active printer | Trip auto-print |
| `/config/printer` | POST | Add new printer | Add printer modal |
| `/printers/set-active` | POST | Set active printer | Set Active button |
| `/printers/delete` | POST | Delete printer | Delete button |

---

## 🎯 Database Schema

### Table: `wms_printer_config`

| Column | Type | Description |
|--------|------|-------------|
| config_id | NUMBER | Primary key (auto-increment) |
| printer_name | VARCHAR2(200) | Windows printer name |
| paper_size | VARCHAR2(50) | A4, Letter, Legal |
| orientation | VARCHAR2(20) | Portrait, Landscape |
| fusion_instance | VARCHAR2(20) | TEST, PROD, DEV |
| fusion_username | VARCHAR2(100) | Fusion login username |
| fusion_password | VARCHAR2(200) | Fusion login password |
| auto_download | VARCHAR2(1) | Y/N |
| auto_print | VARCHAR2(1) | Y/N |
| is_active | VARCHAR2(1) | Y/N (only one can be Y) |
| created_date | DATE | Auto-populated |
| modified_date | DATE | Auto-updated |
| created_by | VARCHAR2(100) | User who created |
| modified_by | VARCHAR2(100) | User who modified |

---

## 🚀 Workflow

### Adding a New Printer:

1. User clicks "Add Printer"
2. Modal opens with form
3. User selects printer from Windows printers list
4. User fills in Fusion credentials
5. User clicks "Save Printer"
6. JavaScript calls `POST /config/printer` APEX API
7. APEX procedure:
   - Deactivates all existing printers
   - Inserts new printer as active
   - Commits transaction
8. Returns success
9. JavaScript reloads printer table
10. New printer appears as ACTIVE

### Switching Active Printer:

1. User clicks "Set Active" on inactive printer
2. JavaScript confirms action
3. Calls `POST /printers/set-active` with configId
4. APEX procedure:
   - Deactivates all printers
   - Activates selected printer
   - Commits transaction
5. Returns success
6. JavaScript reloads table
7. Active badge moves to new printer

### Using Printer for Auto-Print:

1. User enables auto-print for a trip
2. System calls `GET /config/printer` to get active printer
3. Uses that printer configuration for:
   - Fusion instance to connect to
   - Fusion credentials to authenticate
   - Auto-download setting
   - Auto-print setting
   - Windows printer name for printing
4. Downloads PDFs using Fusion credentials
5. Prints to the active printer

---

## 🐛 Troubleshooting

### Issue: "Failed to load printers"
**Solution:**
- Check `config.js` has correct APEX URL
- Verify APEX endpoint `/printers/all` is created
- Test endpoint in Postman first
- Check browser console for errors
- Verify CORS is enabled in APEX

### Issue: "Printer test failed"
**Solution:**
- Verify printer is installed in Windows
- Check printer name matches exactly
- Ensure C# backend is running
- Check Windows Print Spooler service is running

### Issue: "Cannot delete active printer"
**Solution:**
- This is by design
- Set another printer as active first
- Then delete the old one

### Issue: "No printers in dropdown"
**Solution:**
- Verify C# backend is running
- Check `getInstalledPrinters` action works
- Install at least one printer in Windows

### Issue: "401 Unauthorized from APEX"
**Solution:**
- Check APEX endpoint security settings
- Set "Requires Secure Access" to NO (for testing)
- Verify no authentication is required

---

## 📝 Files Modified/Created

### New Files:
- ✅ `config.js` - API configuration
- ✅ `printer-management.js` - Printer CRUD functions
- ✅ `apex_sql/06_additional_printer_procedures.sql` - New procedures
- ✅ `apex_sql/07_printer_management_endpoints.sql` - Endpoint code
- ✅ `PRINTER_SETUP_GUIDE.md` - This guide

### Modified Files:
- ✅ `index.html` - New printer management page UI
- ✅ Updated printer setup section with table and modal

---

## ✅ Testing Checklist

Before going to production, test these scenarios:

### Basic CRUD:
- [ ] Load all printers
- [ ] Add first printer
- [ ] Add second printer
- [ ] Set first printer as active
- [ ] Set second printer as active
- [ ] Delete inactive printer
- [ ] Try to delete active printer (should fail)

### Data Validation:
- [ ] Try to add printer without name (should fail)
- [ ] Try to add printer without username (should fail)
- [ ] Try to add printer without password (should fail)
- [ ] Verify only one printer is active at a time

### Integration:
- [ ] Test printer with Windows print dialog
- [ ] Verify active printer is used for auto-print
- [ ] Verify Fusion credentials work for login
- [ ] Test with PROD, TEST, and DEV instances

### UI/UX:
- [ ] Search for printers in table
- [ ] Sort by each column
- [ ] Paginate through many printers
- [ ] Export to Excel
- [ ] Resize columns
- [ ] Test on different screen sizes

---

## 🎊 Success Criteria

You've successfully implemented printer management when:

✅ Printers load in table on page open
✅ Can add new printers via modal form
✅ Can set any printer as active
✅ Active printer shows green badge
✅ Can test printer and get confirmation
✅ Can delete inactive printers
✅ Cannot delete active printer
✅ All data persists in APEX database
✅ Auto-print uses active printer configuration
✅ All APEX API calls work without errors

---

## 🔜 Next Steps

After printer management is working:

1. **Implement Trip Auto-Print Integration:**
   - Update trip enable/disable to use printer API
   - Link trips to active printer
   - Use printer config for Fusion connection

2. **Add Print Jobs Monitoring:**
   - Update Monitor Printing page to use APEX APIs
   - Real-time status updates
   - Job history tracking

3. **Add Security:**
   - Enable APEX authentication
   - Encrypt passwords in database
   - Add role-based access control

4. **Add Features:**
   - Edit printer configuration
   - Printer usage statistics
   - Print job retry mechanism
   - Email notifications

---

## 💡 Pro Tips

1. **Always test in Postman first** before testing in the web app
2. **Check browser console** for JavaScript errors
3. **Use APEX SQL Workshop** to test procedures directly
4. **Keep config.js out of git** if it contains sensitive URLs
5. **Document your APEX URL** for team members
6. **Set up multiple printers** to test the active printer switching
7. **Test with real Fusion credentials** to verify end-to-end flow

---

## 📞 Support

If you encounter issues:

1. Check this guide's Troubleshooting section
2. Verify all SQL scripts executed successfully
3. Test APEX endpoints in Postman
4. Check browser console for JavaScript errors
5. Review APEX procedure logs for SQL errors

---

**Good luck with your implementation! 🚀**

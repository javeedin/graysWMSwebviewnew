# APEX SQL Files - Trip ID Support Fix

## 📁 This Folder Contains

### `10_fix_trip_id_support.sql`
Complete SQL solution to fix the trip_id issue in monitor-printing system.

**File Size**: 402 lines, 14 KB
**Created**: November 6, 2025
**Purpose**: Add trip_id column to wms_monitor_printing_details table

---

## 🚀 Quick Start

### Step 1: Run SQL in Oracle
```sql
-- Run in SQL Developer or SQL*Plus
@10_fix_trip_id_support.sql
```

### Step 2: Update APEX Endpoints

**A) POST /monitor-printing/enable**
- Go to APEX → RESTful Services → Your Module
- Update endpoint with code from ENDPOINT 1 in the SQL file

**B) GET /monitor-printing/orders**
- Change parameter: `monitorId` → `trip_id`
- Update endpoint with code from ENDPOINT 2 in the SQL file

---

## 📋 What This File Does

1. ✅ Adds `trip_id` column to `wms_monitor_printing_details`
2. ✅ Creates index for performance
3. ✅ Backfills existing data
4. ✅ Creates new procedure: `wms_enable_monitor_printing_v3`
5. ✅ Creates new procedure: `wms_get_order_details_by_trip`
6. ✅ Provides APEX endpoint code (copy/paste ready)
7. ✅ Includes verification queries
8. ✅ Includes test examples

---

## 🔧 Database Changes

### Before:
```
wms_monitor_printing_details
├── monitor_id (FK only)
└── No direct trip_id
```

### After:
```
wms_monitor_printing_details
├── monitor_id (FK)
├── trip_id (NEW!) ← Can query directly
└── Index: idx_details_trip_id
```

---

## ✅ Testing

### Test POST:
```json
{
  "tripId": "TRIP123",
  "tripDate": "2025-11-06",
  "orderCount": 5,
  "printerConfigId": 1,
  "printerName": "HP LaserJet",
  "orders": [...]
}
```

### Test GET:
```
/monitor-printing/orders?trip_id=TRIP123
```

---

## 📞 Support

**File Location**: `/home/user/graysWMSwebviewnew/apex_sql_new/10_fix_trip_id_support.sql`
**Repository**: javeedin/graysWMSwebviewnew
**Branch**: claude/initial-setup-011CUpD4TmBrZ9hQhAUV5GWW

---

**Ready to use!** Just run the SQL file and update the APEX endpoints. 🎉

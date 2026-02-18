// ============================================================================
// NEW REQUIREMENTS - WMS Requirements Tracker
// ============================================================================
// This file contains all WMS requirements organized by category
// Each requirement has a priority: Must Have, Nice To Have, or 2nd Phase

// Global variables
let requirementsGrid = null;
let allRequirements = [];

// ============================================================================
// REQUIREMENTS DATA
// ============================================================================

const REQUIREMENTS_DATA = [
    // ========================================
    // WAREHOUSE STRUCTURE & LOCATIONS
    // ========================================
    {
        id: 2,
        category: 'Warehouse Structure & Locations',
        requirement: 'Define warehouse zones (e.g., receiving, storage, picking, shipping)',
        priority: 'Must Have',
        notes: ''
    },
    {
        id: 3,
        category: 'Warehouse Structure & Locations',
        requirement: 'Create and manage bin/rack locations',
        priority: 'Must Have',
        notes: ''
    },
    {
        id: 4,
        category: 'Warehouse Structure & Locations',
        requirement: 'Assign location types (e.g., bulk, pick-face, overflow)',
        priority: 'Must Have',
        notes: ''
    },
    {
        id: 5,
        category: 'Warehouse Structure & Locations',
        requirement: 'Enable barcode/QR code generation for locations',
        priority: 'Must Have',
        notes: ''
    },
    {
        id: 6,
        category: 'Warehouse Structure & Locations',
        requirement: 'Support multi-warehouse management',
        priority: '2nd Phase',
        notes: ''
    },

    // ========================================
    // RECEIVING GOODS
    // ========================================
    {
        id: 7,
        category: 'Receiving Goods',
        requirement: 'Record inbound deliveries with PO reference',
        priority: 'Must Have',
        notes: ''
    },
    {
        id: 8,
        category: 'Receiving Goods',
        requirement: 'Scan items during receiving (barcode/QR)',
        priority: 'Must Have',
        notes: ''
    },
    {
        id: 9,
        category: 'Receiving Goods',
        requirement: 'Capture quantity received vs expected',
        priority: 'Must Have',
        notes: ''
    },
    {
        id: 10,
        category: 'Receiving Goods',
        requirement: 'Support blind receiving (no PO details visible)',
        priority: 'Nice To Have',
        notes: ''
    },
    {
        id: 11,
        category: 'Receiving Goods',
        requirement: 'Log receiving discrepancies (damages, shortages)',
        priority: 'Must Have',
        notes: ''
    },
    {
        id: 12,
        category: 'Receiving Goods',
        requirement: 'Print receiving labels on arrival',
        priority: 'Must Have',
        notes: ''
    },
    {
        id: 13,
        category: 'Receiving Goods',
        requirement: 'Support ASN (Advanced Shipping Notice) processing',
        priority: 'Nice To Have',
        notes: ''
    },
    {
        id: 14,
        category: 'Receiving Goods',
        requirement: 'Capture lot/batch and expiry during receiving',
        priority: 'Must Have',
        notes: ''
    },
    {
        id: 15,
        category: 'Receiving Goods',
        requirement: 'Support cross-docking at receiving',
        priority: '2nd Phase',
        notes: ''
    },

    // ========================================
    // QUALITY CONTROL
    // ========================================
    {
        id: 16,
        category: 'Quality Control',
        requirement: 'Allow QC holds on received items',
        priority: 'Must Have',
        notes: ''
    },
    {
        id: 17,
        category: 'Quality Control',
        requirement: 'Define QC inspection checklists',
        priority: 'Nice To Have',
        notes: ''
    },
    {
        id: 18,
        category: 'Quality Control',
        requirement: 'Record pass/fail results',
        priority: 'Must Have',
        notes: ''
    },
    {
        id: 19,
        category: 'Quality Control',
        requirement: 'Route failed items to quarantine zone',
        priority: 'Must Have',
        notes: ''
    },
    {
        id: 20,
        category: 'Quality Control',
        requirement: 'Support sampling-based inspection',
        priority: 'Nice To Have',
        notes: ''
    },

    // ========================================
    // PUT-AWAY
    // ========================================
    {
        id: 21,
        category: 'Put-Away',
        requirement: 'System-directed put-away suggestions',
        priority: 'Must Have',
        notes: ''
    },
    {
        id: 22,
        category: 'Put-Away',
        requirement: 'Manual put-away override',
        priority: 'Must Have',
        notes: ''
    },
    {
        id: 23,
        category: 'Put-Away',
        requirement: 'Support zone-based put-away rules',
        priority: 'Must Have',
        notes: ''
    },
    {
        id: 24,
        category: 'Put-Away',
        requirement: 'Prioritize put-away by item type/class',
        priority: 'Nice To Have',
        notes: ''
    },
    {
        id: 25,
        category: 'Put-Away',
        requirement: 'Confirm put-away via scan',
        priority: 'Must Have',
        notes: ''
    },
    {
        id: 26,
        category: 'Put-Away',
        requirement: 'Track put-away task completion',
        priority: 'Must Have',
        notes: ''
    },
    {
        id: 27,
        category: 'Put-Away',
        requirement: 'Log put-away discrepancies',
        priority: 'Must Have',
        notes: ''
    },
    {
        id: 28,
        category: 'Put-Away',
        requirement: 'Suggest nearest available location',
        priority: 'Must Have',
        notes: ''
    },
    {
        id: 29,
        category: 'Put-Away',
        requirement: 'Support mixed-SKU bin storage',
        priority: 'Nice To Have',
        notes: ''
    },
    {
        id: 30,
        category: 'Put-Away',
        requirement: 'Support pallet-level and case-level put-away',
        priority: 'Must Have',
        notes: ''
    },
    {
        id: 31,
        category: 'Put-Away',
        requirement: 'Support put-away by weight/volume constraints',
        priority: 'Nice To Have',
        notes: ''
    },
    {
        id: 32,
        category: 'Put-Away',
        requirement: 'Automated replenishment triggers from bulk to pick-face',
        priority: 'Must Have',
        notes: ''
    },
    {
        id: 33,
        category: 'Put-Away',
        requirement: 'Handle overstock put-away logic',
        priority: 'Nice To Have',
        notes: ''
    },
    {
        id: 34,
        category: 'Put-Away',
        requirement: 'Allow put-away to temporary staging areas',
        priority: 'Must Have',
        notes: ''
    },
    {
        id: 35,
        category: 'Put-Away',
        requirement: 'Track time per put-away task',
        priority: 'Nice To Have',
        notes: ''
    },
    {
        id: 36,
        category: 'Put-Away',
        requirement: 'Display real-time bin capacity on mobile device',
        priority: '2nd Phase',
        notes: ''
    },

    // ========================================
    // INVENTORY MANAGEMENT
    // ========================================
    {
        id: 37,
        category: 'Inventory Management',
        requirement: 'Real-time stock visibility by location',
        priority: 'Must Have',
        notes: ''
    },
    {
        id: 38,
        category: 'Inventory Management',
        requirement: 'Support cycle counting and stock adjustments',
        priority: 'Must Have',
        notes: ''
    },
    {
        id: 39,
        category: 'Inventory Management',
        requirement: 'Track inventory by SKU, lot, batch, expiry',
        priority: 'Must Have',
        notes: ''
    },
    {
        id: 40,
        category: 'Inventory Management',
        requirement: 'Support stock transfers between locations',
        priority: 'Must Have',
        notes: ''
    },
    {
        id: 41,
        category: 'Inventory Management',
        requirement: 'Enable stock freeze during count',
        priority: 'Nice To Have',
        notes: ''
    },
    {
        id: 42,
        category: 'Inventory Management',
        requirement: 'Display aging inventory reports',
        priority: 'Must Have',
        notes: ''
    },
    {
        id: 43,
        category: 'Inventory Management',
        requirement: 'Track damaged/held/available stock separately',
        priority: 'Must Have',
        notes: ''
    },
    {
        id: 44,
        category: 'Inventory Management',
        requirement: 'Support FIFO/FEFO/LIFO inventory strategies',
        priority: 'Must Have',
        notes: ''
    },
    {
        id: 45,
        category: 'Inventory Management',
        requirement: 'Auto-flag items nearing expiry',
        priority: 'Must Have',
        notes: ''
    },
    {
        id: 46,
        category: 'Inventory Management',
        requirement: 'Enable min/max stock level alerts',
        priority: 'Must Have',
        notes: ''
    },

    // ========================================
    // LOT & BATCH MANAGEMENT
    // ========================================
    {
        id: 48,
        category: 'Lot & Batch Management',
        requirement: 'Assign lot/batch numbers at receiving',
        priority: 'Must Have',
        notes: ''
    },
    {
        id: 49,
        category: 'Lot & Batch Management',
        requirement: 'Track lot/batch through all warehouse movements',
        priority: 'Must Have',
        notes: ''
    },
    {
        id: 50,
        category: 'Lot & Batch Management',
        requirement: 'Support expiry date management (FEFO)',
        priority: 'Must Have',
        notes: ''
    },
    {
        id: 51,
        category: 'Lot & Batch Management',
        requirement: 'Enable lot-based recalls',
        priority: 'Must Have',
        notes: ''
    },
    {
        id: 52,
        category: 'Lot & Batch Management',
        requirement: 'Full traceability: from receiving to dispatch',
        priority: 'Must Have',
        notes: ''
    },
    {
        id: 53,
        category: 'Lot & Batch Management',
        requirement: 'Support lot splitting and merging',
        priority: 'Nice To Have',
        notes: ''
    },
    {
        id: 54,
        category: 'Lot & Batch Management',
        requirement: 'Display lot genealogy/history',
        priority: 'Nice To Have',
        notes: ''
    },

    // ========================================
    // STOCK RESERVATION
    // ========================================
    {
        id: 55,
        category: 'Stock Reservation',
        requirement: 'Reserve stock against sales orders',
        priority: 'Must Have',
        notes: ''
    },
    {
        id: 56,
        category: 'Stock Reservation',
        requirement: 'Prevent double allocation of reserved stock',
        priority: 'Must Have',
        notes: ''
    },
    {
        id: 57,
        category: 'Stock Reservation',
        requirement: 'Support soft reservations (temporary holds)',
        priority: 'Nice To Have',
        notes: ''
    },
    {
        id: 58,
        category: 'Stock Reservation',
        requirement: 'Auto-release expired reservations',
        priority: 'Must Have',
        notes: ''
    },
    {
        id: 59,
        category: 'Stock Reservation',
        requirement: 'Show reserved vs available stock in real-time',
        priority: 'Must Have',
        notes: ''
    },
    {
        id: 60,
        category: 'Stock Reservation',
        requirement: 'Allow manual override of reservations',
        priority: 'Must Have',
        notes: ''
    },
    {
        id: 61,
        category: 'Stock Reservation',
        requirement: 'Reservation priority rules (e.g., VIP customers first)',
        priority: 'Nice To Have',
        notes: ''
    },

    // ========================================
    // ORDER MANAGEMENT
    // ========================================
    {
        id: 62,
        category: 'Order Management',
        requirement: 'Import sales orders from Oracle Fusion',
        priority: 'Must Have',
        notes: ''
    },
    {
        id: 63,
        category: 'Order Management',
        requirement: 'Support manual order entry',
        priority: 'Nice To Have',
        notes: ''
    },
    {
        id: 64,
        category: 'Order Management',
        requirement: 'Order prioritization rules',
        priority: 'Must Have',
        notes: ''
    },
    {
        id: 65,
        category: 'Order Management',
        requirement: 'Order wave planning/grouping',
        priority: 'Must Have',
        notes: ''
    },
    {
        id: 66,
        category: 'Order Management',
        requirement: 'Support backorder management',
        priority: 'Must Have',
        notes: ''
    },
    {
        id: 67,
        category: 'Order Management',
        requirement: 'Split orders across multiple shipments',
        priority: 'Must Have',
        notes: ''
    },
    {
        id: 68,
        category: 'Order Management',
        requirement: 'Track order status in real-time',
        priority: 'Must Have',
        notes: ''
    },
    {
        id: 69,
        category: 'Order Management',
        requirement: 'Allow order cancellation/modification',
        priority: 'Must Have',
        notes: ''
    },

    // ========================================
    // PICKING
    // ========================================
    {
        id: 70,
        category: 'Picking',
        requirement: 'Support wave, batch, and zone picking',
        priority: 'Must Have',
        notes: ''
    },
    {
        id: 71,
        category: 'Picking',
        requirement: 'System-directed pick paths',
        priority: 'Must Have',
        notes: ''
    },
    {
        id: 72,
        category: 'Picking',
        requirement: 'Scan-to-confirm picks',
        priority: 'Must Have',
        notes: ''
    },
    {
        id: 73,
        category: 'Picking',
        requirement: 'Handle short picks and substitutions',
        priority: 'Must Have',
        notes: ''
    },
    {
        id: 74,
        category: 'Picking',
        requirement: 'Support pick-to-cart and pick-to-pallet',
        priority: 'Nice To Have',
        notes: ''
    },
    {
        id: 75,
        category: 'Picking',
        requirement: 'Real-time pick progress tracking',
        priority: 'Must Have',
        notes: ''
    },
    {
        id: 76,
        category: 'Picking',
        requirement: 'Print pick lists',
        priority: 'Must Have',
        notes: ''
    },
    {
        id: 77,
        category: 'Picking',
        requirement: 'Support cluster picking for multiple orders',
        priority: 'Nice To Have',
        notes: ''
    },
    {
        id: 78,
        category: 'Picking',
        requirement: 'Support voice-directed picking',
        priority: '2nd Phase',
        notes: ''
    },

    // ========================================
    // PACKING & STAGING
    // ========================================
    {
        id: 79,
        category: 'Packing & Staging',
        requirement: 'Confirm items packed per order',
        priority: 'Must Have',
        notes: ''
    },
    {
        id: 80,
        category: 'Packing & Staging',
        requirement: 'Support packing slip generation',
        priority: 'Must Have',
        notes: ''
    },
    {
        id: 81,
        category: 'Packing & Staging',
        requirement: 'Capture packing dimensions and weight',
        priority: 'Nice To Have',
        notes: ''
    },
    {
        id: 82,
        category: 'Packing & Staging',
        requirement: 'Stage packed orders by carrier/route',
        priority: 'Must Have',
        notes: ''
    },
    {
        id: 83,
        category: 'Packing & Staging',
        requirement: 'Support multi-box shipments',
        priority: 'Must Have',
        notes: ''
    },
    {
        id: 84,
        category: 'Packing & Staging',
        requirement: 'Verify pack accuracy via scan',
        priority: 'Must Have',
        notes: ''
    },
    {
        id: 85,
        category: 'Packing & Staging',
        requirement: 'Print shipping labels during packing',
        priority: 'Must Have',
        notes: ''
    },

    // ========================================
    // SHIPPING
    // ========================================
    {
        id: 86,
        category: 'Shipping',
        requirement: 'Assign carriers to shipments',
        priority: 'Must Have',
        notes: ''
    },
    {
        id: 87,
        category: 'Shipping',
        requirement: 'Generate waybill/tracking numbers',
        priority: 'Must Have',
        notes: ''
    },
    {
        id: 88,
        category: 'Shipping',
        requirement: 'Record proof of dispatch (signature/photo)',
        priority: 'Nice To Have',
        notes: ''
    },
    {
        id: 89,
        category: 'Shipping',
        requirement: 'Support dock door scheduling',
        priority: 'Nice To Have',
        notes: ''
    },
    {
        id: 90,
        category: 'Shipping',
        requirement: 'Track shipment status post-dispatch',
        priority: 'Must Have',
        notes: ''
    },

    // ========================================
    // RETURNS & REVERSE LOGISTICS
    // ========================================
    {
        id: 91,
        category: 'Returns & Reverse Logistics',
        requirement: 'Create return receipt on arrival',
        priority: 'Must Have',
        notes: ''
    },
    {
        id: 92,
        category: 'Returns & Reverse Logistics',
        requirement: 'Inspect returned items (reusable, damaged, scrap)',
        priority: 'Must Have',
        notes: ''
    },
    {
        id: 93,
        category: 'Returns & Reverse Logistics',
        requirement: 'Restock approved returns to inventory',
        priority: 'Must Have',
        notes: ''
    },
    {
        id: 94,
        category: 'Returns & Reverse Logistics',
        requirement: 'Track return reasons and trends',
        priority: 'Must Have',
        notes: ''
    },
    {
        id: 95,
        category: 'Returns & Reverse Logistics',
        requirement: 'Support supplier returns (RTV - Return to Vendor)',
        priority: 'Must Have',
        notes: ''
    },
    {
        id: 96,
        category: 'Returns & Reverse Logistics',
        requirement: 'Issue credit notes on returns',
        priority: 'Nice To Have',
        notes: ''
    },
    {
        id: 97,
        category: 'Returns & Reverse Logistics',
        requirement: 'Link returns to original order',
        priority: 'Must Have',
        notes: ''
    },
    {
        id: 98,
        category: 'Returns & Reverse Logistics',
        requirement: 'Quarantine returned goods pending inspection',
        priority: 'Must Have',
        notes: ''
    },

    // ========================================
    // PERFORMANCE TRACKING (KPIs)
    // ========================================
    {
        id: 99,
        category: 'Performance Tracking (KPIs)',
        requirement: 'Track picks per hour',
        priority: 'Must Have',
        notes: ''
    },
    {
        id: 100,
        category: 'Performance Tracking (KPIs)',
        requirement: 'Track put-aways per hour',
        priority: 'Must Have',
        notes: ''
    },
    {
        id: 101,
        category: 'Performance Tracking (KPIs)',
        requirement: 'Track receiving accuracy',
        priority: 'Must Have',
        notes: ''
    },
    {
        id: 102,
        category: 'Performance Tracking (KPIs)',
        requirement: 'Track order fulfillment rate',
        priority: 'Must Have',
        notes: ''
    },
    {
        id: 103,
        category: 'Performance Tracking (KPIs)',
        requirement: 'Track cycle count accuracy',
        priority: 'Must Have',
        notes: ''
    },
    {
        id: 104,
        category: 'Performance Tracking (KPIs)',
        requirement: 'Track dock-to-stock time',
        priority: 'Nice To Have',
        notes: ''
    },
    {
        id: 105,
        category: 'Performance Tracking (KPIs)',
        requirement: 'Track on-time dispatch rate',
        priority: 'Must Have',
        notes: ''
    },
    {
        id: 106,
        category: 'Performance Tracking (KPIs)',
        requirement: 'Track returns rate',
        priority: 'Must Have',
        notes: ''
    },
    {
        id: 107,
        category: 'Performance Tracking (KPIs)',
        requirement: 'Track warehouse utilization',
        priority: 'Nice To Have',
        notes: ''
    },
    {
        id: 108,
        category: 'Performance Tracking (KPIs)',
        requirement: 'Track labor productivity per user',
        priority: 'Must Have',
        notes: ''
    },
    {
        id: 109,
        category: 'Performance Tracking (KPIs)',
        requirement: 'Track picking accuracy (wrong item/quantity)',
        priority: 'Must Have',
        notes: ''
    },
    {
        id: 110,
        category: 'Performance Tracking (KPIs)',
        requirement: 'Track order cycle time (order-to-dispatch)',
        priority: 'Must Have',
        notes: ''
    },
    {
        id: 111,
        category: 'Performance Tracking (KPIs)',
        requirement: 'Track cost per order processed',
        priority: 'Nice To Have',
        notes: ''
    },
    {
        id: 112,
        category: 'Performance Tracking (KPIs)',
        requirement: 'Track average storage duration',
        priority: 'Nice To Have',
        notes: ''
    },
    {
        id: 113,
        category: 'Performance Tracking (KPIs)',
        requirement: 'Track fill rate (complete orders vs partial)',
        priority: 'Must Have',
        notes: ''
    },

    // ========================================
    // DASHBOARD & REPORTING
    // ========================================
    {
        id: 114,
        category: 'Dashboard & Reporting',
        requirement: 'Real-time warehouse activity dashboard',
        priority: 'Must Have',
        notes: ''
    },
    {
        id: 115,
        category: 'Dashboard & Reporting',
        requirement: 'Customizable KPI dashboards',
        priority: 'Must Have',
        notes: ''
    },
    {
        id: 116,
        category: 'Dashboard & Reporting',
        requirement: 'Scheduled report generation (email)',
        priority: 'Nice To Have',
        notes: ''
    },
    {
        id: 117,
        category: 'Dashboard & Reporting',
        requirement: 'Export reports to Excel/PDF',
        priority: 'Must Have',
        notes: ''
    },
    {
        id: 118,
        category: 'Dashboard & Reporting',
        requirement: 'Drill-down from dashboard into detail views',
        priority: 'Must Have',
        notes: ''
    },
    {
        id: 119,
        category: 'Dashboard & Reporting',
        requirement: 'Support historical trend analysis',
        priority: 'Nice To Have',
        notes: ''
    },

    // ========================================
    // LABOR MANAGEMENT
    // ========================================
    {
        id: 120,
        category: 'Labor Management',
        requirement: 'Track user login/logout and active time',
        priority: 'Must Have',
        notes: ''
    },
    {
        id: 121,
        category: 'Labor Management',
        requirement: 'Assign tasks per user',
        priority: 'Must Have',
        notes: ''
    },
    {
        id: 122,
        category: 'Labor Management',
        requirement: 'Track productivity per user',
        priority: 'Must Have',
        notes: ''
    },
    {
        id: 123,
        category: 'Labor Management',
        requirement: 'Support shift-based scheduling',
        priority: 'Nice To Have',
        notes: ''
    },
    {
        id: 124,
        category: 'Labor Management',
        requirement: 'Allow supervisor task reallocation',
        priority: 'Must Have',
        notes: ''
    },
    {
        id: 125,
        category: 'Labor Management',
        requirement: 'Display leaderboard for team productivity',
        priority: 'Nice To Have',
        notes: ''
    },
    {
        id: 126,
        category: 'Labor Management',
        requirement: 'Support role-based task assignments',
        priority: 'Must Have',
        notes: ''
    },

    // ========================================
    // TRANSPORT MANAGEMENT
    // ========================================
    {
        id: 127,
        category: 'Transport Management',
        requirement: 'Plan delivery routes',
        priority: 'Must Have',
        notes: ''
    },
    {
        id: 128,
        category: 'Transport Management',
        requirement: 'Assign vehicles to trips',
        priority: 'Must Have',
        notes: ''
    },
    {
        id: 129,
        category: 'Transport Management',
        requirement: 'Track trip progress in real-time',
        priority: 'Must Have',
        notes: ''
    },
    {
        id: 130,
        category: 'Transport Management',
        requirement: 'Capture proof of delivery (POD)',
        priority: 'Must Have',
        notes: ''
    },
    {
        id: 131,
        category: 'Transport Management',
        requirement: 'Support multiple delivery stops per trip',
        priority: 'Must Have',
        notes: ''
    },
    {
        id: 132,
        category: 'Transport Management',
        requirement: 'Log vehicle inspections and conditions',
        priority: 'Nice To Have',
        notes: ''
    },

    // ========================================
    // MOBILE DEVICES & SCANNING
    // ========================================
    {
        id: 133,
        category: 'Mobile Devices & Scanning',
        requirement: 'Support barcode and QR code scanning',
        priority: 'Must Have',
        notes: ''
    },
    {
        id: 134,
        category: 'Mobile Devices & Scanning',
        requirement: 'Mobile-optimized interface for warehouse staff',
        priority: 'Must Have',
        notes: ''
    },
    {
        id: 135,
        category: 'Mobile Devices & Scanning',
        requirement: 'Offline mode support for connectivity issues',
        priority: 'Nice To Have',
        notes: ''
    },
    {
        id: 136,
        category: 'Mobile Devices & Scanning',
        requirement: 'Support multiple device types (Android, iOS, handheld)',
        priority: 'Must Have',
        notes: ''
    },
    {
        id: 137,
        category: 'Mobile Devices & Scanning',
        requirement: 'Push notifications for task assignments',
        priority: 'Nice To Have',
        notes: ''
    },

    // ========================================
    // USER ACCESS & SECURITY
    // ========================================
    {
        id: 138,
        category: 'User Access & Security',
        requirement: 'Role-based access control (RBAC)',
        priority: 'Must Have',
        notes: ''
    },
    {
        id: 139,
        category: 'User Access & Security',
        requirement: 'Audit trail for all user actions',
        priority: 'Must Have',
        notes: ''
    },
    {
        id: 140,
        category: 'User Access & Security',
        requirement: 'Support single sign-on (SSO)',
        priority: 'Nice To Have',
        notes: ''
    },
    {
        id: 141,
        category: 'User Access & Security',
        requirement: 'Password policy enforcement',
        priority: 'Must Have',
        notes: ''
    },
    {
        id: 142,
        category: 'User Access & Security',
        requirement: 'Session timeout and auto-logout',
        priority: 'Must Have',
        notes: ''
    },
    {
        id: 143,
        category: 'User Access & Security',
        requirement: 'Data encryption at rest and in transit',
        priority: 'Must Have',
        notes: ''
    },

    // ========================================
    // SYSTEM INTEGRATION
    // ========================================
    {
        id: 144,
        category: 'System Integration',
        requirement: 'Oracle Fusion ERP integration (bi-directional)',
        priority: 'Must Have',
        notes: ''
    },
    {
        id: 145,
        category: 'System Integration',
        requirement: 'REST API for third-party integrations',
        priority: 'Must Have',
        notes: ''
    },
    {
        id: 146,
        category: 'System Integration',
        requirement: 'Support EDI for supplier/carrier communication',
        priority: 'Nice To Have',
        notes: ''
    },
    {
        id: 147,
        category: 'System Integration',
        requirement: 'Integration with email/SMS notification services',
        priority: 'Must Have',
        notes: ''
    },
    {
        id: 148,
        category: 'System Integration',
        requirement: 'Webhook support for real-time event triggers',
        priority: 'Nice To Have',
        notes: ''
    },

    // ========================================
    // TECHNICAL REQUIREMENTS
    // ========================================
    {
        id: 149,
        category: 'Technical Requirements',
        requirement: '99.9% uptime SLA',
        priority: 'Must Have',
        notes: ''
    },
    {
        id: 150,
        category: 'Technical Requirements',
        requirement: 'Support concurrent users (minimum 50)',
        priority: 'Must Have',
        notes: ''
    },
    {
        id: 151,
        category: 'Technical Requirements',
        requirement: 'Response time < 2 seconds for all operations',
        priority: 'Must Have',
        notes: ''
    },
    {
        id: 152,
        category: 'Technical Requirements',
        requirement: 'Automated backup and disaster recovery',
        priority: 'Must Have',
        notes: ''
    },
    {
        id: 153,
        category: 'Technical Requirements',
        requirement: 'Scalable architecture for future growth',
        priority: 'Must Have',
        notes: ''
    },

    // ========================================
    // IMPLEMENTATION & SUPPORT
    // ========================================
    {
        id: 154,
        category: 'Implementation & Support',
        requirement: 'Phased implementation plan',
        priority: 'Must Have',
        notes: ''
    },
    {
        id: 155,
        category: 'Implementation & Support',
        requirement: 'Data migration from existing systems',
        priority: 'Must Have',
        notes: ''
    },
    {
        id: 156,
        category: 'Implementation & Support',
        requirement: 'User training program',
        priority: 'Must Have',
        notes: ''
    },
    {
        id: 157,
        category: 'Implementation & Support',
        requirement: 'Comprehensive user documentation',
        priority: 'Must Have',
        notes: ''
    },
    {
        id: 158,
        category: 'Implementation & Support',
        requirement: 'On-site go-live support',
        priority: 'Must Have',
        notes: ''
    },
    {
        id: 159,
        category: 'Implementation & Support',
        requirement: 'Post-go-live warranty period (minimum 3 months)',
        priority: 'Must Have',
        notes: ''
    },
    {
        id: 160,
        category: 'Implementation & Support',
        requirement: 'Dedicated support team/contact',
        priority: 'Must Have',
        notes: ''
    },
    {
        id: 161,
        category: 'Implementation & Support',
        requirement: 'Regular system updates and patches',
        priority: 'Must Have',
        notes: ''
    },
    {
        id: 162,
        category: 'Implementation & Support',
        requirement: 'SLA for bug fixes (critical: 4hrs, high: 24hrs)',
        priority: 'Must Have',
        notes: ''
    },

    // ========================================
    // INTEGRATION WITH GRAYS SHOPS
    // ========================================
    {
        id: 163,
        category: 'Integration with Grays Shops',
        requirement: 'Sync product catalog with shops',
        priority: 'Must Have',
        notes: ''
    },
    {
        id: 164,
        category: 'Integration with Grays Shops',
        requirement: 'Real-time stock availability for shop orders',
        priority: 'Must Have',
        notes: ''
    },
    {
        id: 165,
        category: 'Integration with Grays Shops',
        requirement: 'Auto-generate warehouse orders from shop sales',
        priority: 'Must Have',
        notes: ''
    },
    {
        id: 166,
        category: 'Integration with Grays Shops',
        requirement: 'Support shop-specific pricing and promotions',
        priority: 'Nice To Have',
        notes: ''
    },
    {
        id: 167,
        category: 'Integration with Grays Shops',
        requirement: 'Handle shop returns through warehouse',
        priority: 'Must Have',
        notes: ''
    },
    {
        id: 168,
        category: 'Integration with Grays Shops',
        requirement: 'Support inter-shop stock transfers',
        priority: 'Must Have',
        notes: ''
    },
    {
        id: 169,
        category: 'Integration with Grays Shops',
        requirement: 'Consolidated reporting across warehouse and shops',
        priority: 'Must Have',
        notes: ''
    },
    {
        id: 170,
        category: 'Integration with Grays Shops',
        requirement: 'Support click-and-collect orders',
        priority: 'Nice To Have',
        notes: ''
    },
    {
        id: 171,
        category: 'Integration with Grays Shops',
        requirement: 'Priority picking for shop orders',
        priority: 'Must Have',
        notes: ''
    },
    {
        id: 172,
        category: 'Integration with Grays Shops',
        requirement: 'Real-time order status updates to shops',
        priority: 'Must Have',
        notes: ''
    },
    {
        id: 173,
        category: 'Integration with Grays Shops',
        requirement: 'Support multi-shop inventory allocation',
        priority: 'Must Have',
        notes: ''
    }
];

// ============================================================================
// INITIALIZE PAGE
// ============================================================================

function initializeRequirementsPage() {
    console.log('[Requirements] Initializing New Requirements page...');

    allRequirements = [...REQUIREMENTS_DATA];

    // Update summary cards
    updateRequirementsSummary();

    // Populate category filter dropdown
    populateCategoryFilter();

    // Initialize grid
    initializeRequirementsGrid();

    console.log('[Requirements] Page initialized with', allRequirements.length, 'requirements');
}

// ============================================================================
// SUMMARY CARDS
// ============================================================================

function updateRequirementsSummary() {
    const total = REQUIREMENTS_DATA.length;
    const mustHave = REQUIREMENTS_DATA.filter(r => r.priority === 'Must Have').length;
    const niceToHave = REQUIREMENTS_DATA.filter(r => r.priority === 'Nice To Have').length;
    const secondPhase = REQUIREMENTS_DATA.filter(r => r.priority === '2nd Phase').length;
    const categories = [...new Set(REQUIREMENTS_DATA.map(r => r.category))].length;

    document.getElementById('req-total-count').textContent = total;
    document.getElementById('req-must-have-count').textContent = mustHave;
    document.getElementById('req-nice-to-have-count').textContent = niceToHave;
    document.getElementById('req-2nd-phase-count').textContent = secondPhase;
    document.getElementById('req-category-count').textContent = categories;
}

// ============================================================================
// CATEGORY FILTER DROPDOWN
// ============================================================================

function populateCategoryFilter() {
    const categories = [...new Set(REQUIREMENTS_DATA.map(r => r.category))];
    const select = document.getElementById('req-category-filter');

    // Clear existing options except first
    while (select.options.length > 1) {
        select.remove(1);
    }

    categories.forEach(cat => {
        const option = document.createElement('option');
        option.value = cat;
        option.textContent = cat;
        select.appendChild(option);
    });
}

// ============================================================================
// DEVEXTREME GRID
// ============================================================================

function initializeRequirementsGrid() {
    requirementsGrid = $('#requirements-grid').dxDataGrid({
        dataSource: allRequirements,
        showBorders: true,
        showRowLines: true,
        rowAlternationEnabled: true,
        columnAutoWidth: false,
        wordWrapEnabled: true,
        allowColumnResizing: true,
        columnResizingMode: 'widget',
        hoverStateEnabled: true,
        paging: {
            pageSize: 25
        },
        pager: {
            visible: true,
            showPageSizeSelector: true,
            allowedPageSizes: [10, 25, 50, 100, 'all'],
            showInfo: true
        },
        searchPanel: {
            visible: true,
            width: 300,
            placeholder: 'Search requirements...'
        },
        headerFilter: {
            visible: true
        },
        filterRow: {
            visible: false
        },
        groupPanel: {
            visible: true
        },
        grouping: {
            autoExpandAll: true
        },
        export: {
            enabled: true,
            fileName: 'WMS_New_Requirements'
        },
        summary: {
            groupItems: [{
                column: 'requirement',
                summaryType: 'count',
                displayFormat: '{0} requirements'
            }]
        },
        columns: [
            {
                dataField: 'id',
                caption: '#',
                width: 60,
                alignment: 'center',
                cellTemplate: function(container, options) {
                    container.append(
                        $('<span>').css({
                            'font-weight': '600',
                            'color': '#718096',
                            'font-size': '12px'
                        }).text(options.value)
                    );
                }
            },
            {
                dataField: 'category',
                caption: 'Category',
                width: 200,
                groupIndex: 0,
                cellTemplate: function(container, options) {
                    container.append(
                        $('<span>').css({
                            'font-weight': '600',
                            'color': '#4a5568'
                        }).text(options.value)
                    );
                }
            },
            {
                dataField: 'requirement',
                caption: 'Requirement',
                minWidth: 350,
                cellTemplate: function(container, options) {
                    container.append(
                        $('<span>').css({
                            'font-size': '13px',
                            'color': '#2d3748',
                            'line-height': '1.5'
                        }).text(options.value)
                    );
                }
            },
            {
                dataField: 'priority',
                caption: 'Priority',
                width: 140,
                alignment: 'center',
                cellTemplate: function(container, options) {
                    const colors = {
                        'Must Have': { bg: '#c6f6d5', color: '#22543d', icon: 'fa-check-circle' },
                        'Nice To Have': { bg: '#fefcbf', color: '#975a16', icon: 'fa-star' },
                        '2nd Phase': { bg: '#e9d8fd', color: '#553c9a', icon: 'fa-clock' }
                    };
                    const style = colors[options.value] || { bg: '#e2e8f0', color: '#4a5568', icon: 'fa-circle' };

                    container.append(
                        $('<span>').css({
                            'background': style.bg,
                            'color': style.color,
                            'padding': '4px 12px',
                            'border-radius': '12px',
                            'font-size': '11px',
                            'font-weight': '700',
                            'display': 'inline-flex',
                            'align-items': 'center',
                            'gap': '5px',
                            'white-space': 'nowrap'
                        }).html('<i class="fas ' + style.icon + '"></i> ' + options.value)
                    );
                }
            },
            {
                dataField: 'notes',
                caption: 'Notes',
                width: 200,
                cellTemplate: function(container, options) {
                    container.append(
                        $('<span>').css({
                            'font-size': '12px',
                            'color': '#718096',
                            'font-style': options.value ? 'normal' : 'italic'
                        }).text(options.value || '—')
                    );
                }
            }
        ],
        onContentReady: function(e) {
            const count = e.component.totalCount();
            document.getElementById('req-filtered-count').textContent =
                count + ' requirement' + (count !== 1 ? 's' : '');
        }
    }).dxDataGrid('instance');
}

// ============================================================================
// FILTER FUNCTIONS
// ============================================================================

window.filterRequirements = function() {
    const categoryFilter = document.getElementById('req-category-filter').value;
    const priorityFilter = document.getElementById('req-priority-filter').value;

    let filtered = [...REQUIREMENTS_DATA];

    if (categoryFilter) {
        filtered = filtered.filter(r => r.category === categoryFilter);
    }

    if (priorityFilter) {
        filtered = filtered.filter(r => r.priority === priorityFilter);
    }

    if (requirementsGrid) {
        requirementsGrid.option('dataSource', filtered);
        requirementsGrid.refresh();
    }
};

window.resetRequirementsFilters = function() {
    document.getElementById('req-category-filter').value = '';
    document.getElementById('req-priority-filter').value = '';

    if (requirementsGrid) {
        requirementsGrid.option('dataSource', REQUIREMENTS_DATA);
        requirementsGrid.refresh();
    }
};

// ============================================================================
// SUB-TAB SWITCHING
// ============================================================================

window.switchReqSubTab = function(tabName) {
    // Update sub-tab buttons
    document.querySelectorAll('.req-sub-tab').forEach(t => {
        t.classList.remove('active');
        t.style.background = '';
        t.style.color = '#64748b';
        t.style.boxShadow = '';
    });
    const activeTab = document.querySelector('.req-sub-tab[data-req-tab="' + tabName + '"]');
    if (activeTab) {
        activeTab.classList.add('active');
        activeTab.style.background = 'white';
        activeTab.style.color = '#667eea';
        activeTab.style.boxShadow = '0 2px 8px rgba(0,0,0,0.08)';
    }

    // Show/hide sub-tab panes
    document.querySelectorAll('.req-sub-pane').forEach(p => p.style.display = 'none');
    const targetPane = document.getElementById('req-sub-' + tabName);
    if (targetPane) {
        targetPane.style.display = 'block';
    }

    // Lazy-load content
    if (tabName === 'fusion-mapping' && !document.getElementById('fusion-mapping-content').innerHTML) {
        renderFusionMappingContent();
    }
    if (tabName === 'impl-roadmap' && !document.getElementById('impl-roadmap-content').innerHTML) {
        renderImplRoadmapContent();
    }
};

// ============================================================================
// ORACLE FUSION MAPPING DATA
// ============================================================================

const FUSION_MAPPING_DATA = [
    {
        category: 'Order Management',
        icon: 'fa-file-invoice',
        status: 'developed',
        statusLabel: 'Developed',
        summary: 'Sales order import, status tracking, wave planning, and order lifecycle management are fully integrated with Oracle Fusion Order Hub.',
        fusionAPIs: [
            { api: 'salesOrdersForOrderHub', desc: 'Import/query sales orders, update order status, manage order lifecycle' },
            { api: 'salesOrdersForOrderHub/{OrderId}/child/lines', desc: 'Access order line details, quantities, item info' },
            { api: 'salesOrdersForOrderHub - PATCH', desc: 'Update order status, cancel/modify orders' }
        ],
        webSolution: 'Trip Management page with pending orders view, order grouping by wave/trip, batch pick release, real-time status tracking across all order states.',
        mobileSolution: 'Order status lookup, priority order alerts, quick order search by number/customer for warehouse supervisors.',
        apexAPIs: ['getpendingorders', 'trips/addorders', 'trips/getpendingorders']
    },
    {
        category: 'Picking',
        icon: 'fa-hand-pointer',
        status: 'developed',
        statusLabel: 'Developed',
        summary: 'Pick transactions, wave/batch picking, pick release, lot allocation, and pick confirmation are fully operational through Oracle Fusion pick APIs.',
        fusionAPIs: [
            { api: 'pickTransactions', desc: 'Create/confirm pick transactions, manage pick wave execution' },
            { api: 'pickTransactions - POST/PATCH', desc: 'Confirm picks, handle short picks, record actual quantities' },
            { api: 'inventoryStagedTransactions', desc: 'Stage picked inventory for shipping confirmation' }
        ],
        webSolution: 'Trip detail view with pick release per order, batch lot allocation, pick progress tracking, auto pick release with monitor printing integration.',
        mobileSolution: 'Scan-to-pick interface, pick list display with bin locations, short pick handling, pick confirmation via barcode scan, voice-directed picking (Phase 2).',
        apexAPIs: ['trip/pickrelease/oneorder/{orderNumber}', 'trip/pickerassignment']
    },
    {
        category: 'Shipping',
        icon: 'fa-shipping-fast',
        status: 'developed',
        statusLabel: 'Developed',
        summary: 'Shipment creation, carrier assignment, shipping label printing, and shipment status tracking are integrated with Fusion shipping APIs.',
        fusionAPIs: [
            { api: 'shipmentRequests', desc: 'Create/manage shipment requests, assign carriers' },
            { api: 'shipmentLines', desc: 'Manage individual shipment lines, quantities, and tracking' },
            { api: 'inventoryStagedTransactions', desc: 'Confirm shipment staging, trigger ship-confirm' }
        ],
        webSolution: 'Pending shipment lines view, shipment details per order, print shipping labels, carrier assignment through trip management, batch ship-confirm.',
        mobileSolution: 'Scan-to-ship confirmation, loading dock checklist, proof of dispatch capture (photo/signature), shipment verification.',
        apexAPIs: ['orders/getshipmentdetails/{orderNumber}', 'getpendingshipmentlines']
    },
    {
        category: 'Transport Management',
        icon: 'fa-truck',
        status: 'developed',
        statusLabel: 'Developed',
        summary: 'Trip creation, vehicle assignment, multi-stop delivery management, and trip tracking are fully built in the current WMS.',
        fusionAPIs: [
            { api: 'salesOrdersForOrderHub', desc: 'Source delivery addresses and customer info for route planning' }
        ],
        webSolution: 'Full trip management with create/edit/delete trips, vehicle assignment, picker assignment, multi-order grouping, trip analytics dashboard with KPIs.',
        mobileSolution: 'Driver app with trip details, delivery sequence, navigation integration, proof of delivery capture, trip status updates in real-time.',
        apexAPIs: ['trips/create', 'GETTRIPDETAILS/{tripId}', 'gettrillines', 'vehicles/get']
    },
    {
        category: 'Inventory Management',
        icon: 'fa-boxes',
        status: 'partial',
        statusLabel: 'Partially Developed',
        summary: 'Auto inventory processing is built. Real-time on-hand queries, stock transfers, cycle counting, and FIFO/FEFO strategies need further development.',
        fusionAPIs: [
            { api: 'inventoryStagedTransactions', desc: 'Process inventory transactions (receipts, issues, transfers)' },
            { api: 'inventoryOnhandBalances', desc: 'Query real-time on-hand stock by organization, subinventory, locator' },
            { api: 'inventoryTransfers', desc: 'Execute stock transfers between subinventories/organizations' },
            { api: 'cycleCounts', desc: 'Create/manage cycle count schedules and record count results' },
            { api: 'inventoryAdjustments', desc: 'Post inventory adjustments for discrepancies' }
        ],
        webSolution: 'Extend auto-inventory processing to include on-hand dashboard, stock transfer UI, cycle count scheduling, aging reports, min/max alerts, FIFO/FEFO strategy configuration.',
        mobileSolution: 'Mobile stock lookup by scanning bin/item, cycle count entry via scan, stock adjustment entry, real-time on-hand queries with location drill-down.',
        apexAPIs: ['transactions/process']
    },
    {
        category: 'Lot & Batch Management',
        icon: 'fa-layer-group',
        status: 'partial',
        statusLabel: 'Partially Developed',
        summary: 'Lot allocation during picking is implemented. Full lot lifecycle tracking, expiry management, and traceability need development.',
        fusionAPIs: [
            { api: 'inventoryLotNumbers', desc: 'Query/manage lot numbers, expiry dates, lot attributes' },
            { api: 'pickTransactions (lot fields)', desc: 'Lot-specific pick transactions with lot selection' },
            { api: 'inventoryStagedTransactions (lot fields)', desc: 'Lot-level inventory staging and confirmation' },
            { api: 'inventoryOnhandBalances (lot filter)', desc: 'On-hand by lot number for FEFO/FIFO enforcement' }
        ],
        webSolution: 'Lot history/genealogy viewer, expiry dashboard with auto-flagging, lot-based recall management, lot splitting/merging interface, FEFO picking enforcement.',
        mobileSolution: 'Scan lot barcode to view full history, lot assignment during receiving, expiry date capture, lot-based pick confirmation.',
        apexAPIs: []
    },
    {
        category: 'Receiving Goods',
        icon: 'fa-dolly',
        status: 'new',
        statusLabel: 'New Development',
        summary: 'Inbound receiving workflow needs full development. Oracle Fusion provides receipt and PO APIs for integration.',
        fusionAPIs: [
            { api: 'receivingReceiptRequests', desc: 'Create receiving receipts, record received quantities against POs' },
            { api: 'purchaseOrders', desc: 'Query PO details for expected quantities, items, suppliers' },
            { api: 'advanceShipmentNotices', desc: 'Process ASN data for expected inbound deliveries' },
            { api: 'receivingTransactions', desc: 'Record receiving transactions (receive, deliver, return-to-vendor)' }
        ],
        webSolution: 'Receiving dashboard with expected deliveries, PO-based receiving form, discrepancy logging, receiving label printing, receiving analytics.',
        mobileSolution: 'Mobile receiving app: scan PO barcode, scan items to receive, capture lot/batch/expiry, photo capture for damages, print labels on arrival.',
        apexAPIs: []
    },
    {
        category: 'Quality Control',
        icon: 'fa-clipboard-check',
        status: 'new',
        statusLabel: 'New Development',
        summary: 'QC inspection workflow at receiving with hold/release/quarantine routing. Fusion quality management APIs support inspection results.',
        fusionAPIs: [
            { api: 'qualityInspections', desc: 'Create inspection records, record pass/fail results' },
            { api: 'qualityInspectionPlans', desc: 'Define inspection checklists and sampling rules' },
            { api: 'inventoryStagedTransactions (hold)', desc: 'Place/release inventory holds for QC quarantine' }
        ],
        webSolution: 'QC inspection queue, configurable checklists per item/category, pass/fail recording, quarantine zone management, QC analytics dashboard.',
        mobileSolution: 'Mobile QC inspection: scan item, fill checklist, capture photos of defects, approve/reject with routing to quarantine or put-away.',
        apexAPIs: []
    },
    {
        category: 'Put-Away',
        icon: 'fa-inbox',
        status: 'new',
        statusLabel: 'New Development',
        summary: 'System-directed put-away with zone rules, bin capacity tracking, and scan confirmation. Fusion locator APIs drive location suggestions.',
        fusionAPIs: [
            { api: 'inventoryOrganizations/child/subinventories', desc: 'Query subinventories and locators for put-away targets' },
            { api: 'inventoryTransfers', desc: 'Execute put-away as transfer from receiving to storage location' },
            { api: 'inventoryOnhandBalances', desc: 'Check bin capacity and current occupancy for smart suggestions' }
        ],
        webSolution: 'Put-away task queue with system suggestions, zone-based rules configuration, bin capacity dashboard, replenishment triggers, put-away analytics.',
        mobileSolution: 'Mobile put-away: scan received pallet, get directed location, scan bin to confirm, override option, real-time bin capacity display.',
        apexAPIs: []
    },
    {
        category: 'Warehouse Structure & Locations',
        icon: 'fa-warehouse',
        status: 'new',
        statusLabel: 'New Development',
        summary: 'Define zones, bins, rack locations, and generate barcodes. Fusion organization/subinventory structure provides the master data.',
        fusionAPIs: [
            { api: 'inventoryOrganizations', desc: 'Query/manage warehouse organizations' },
            { api: 'inventoryOrganizations/child/subinventories', desc: 'Manage subinventories (zones) within warehouses' },
            { api: 'inventoryOrganizations/child/subinventories/child/locators', desc: 'Manage bin/rack locators within subinventories' }
        ],
        webSolution: 'Warehouse structure configuration page with visual zone layout, bin/rack CRUD, location type assignment, barcode/QR generation and printing.',
        mobileSolution: 'Location lookup by scanning, warehouse map view, bin label scanning for quick info, location-based task assignment.',
        apexAPIs: []
    },
    {
        category: 'Stock Reservation',
        icon: 'fa-lock',
        status: 'new',
        statusLabel: 'New Development',
        summary: 'Reserve stock against sales orders, prevent double allocation, and manage reservation lifecycle through Fusion supply/demand APIs.',
        fusionAPIs: [
            { api: 'salesOrdersForOrderHub (reservation fields)', desc: 'View/manage reservations linked to sales order lines' },
            { api: 'inventoryReservations', desc: 'Create/release/transfer inventory reservations' },
            { api: 'inventoryOnhandBalances', desc: 'Calculate available-to-reserve quantities' }
        ],
        webSolution: 'Reservation management dashboard, reserved vs available view, auto-release rules configuration, manual override interface, VIP priority rules.',
        mobileSolution: 'Quick reservation status check by scanning order/item, reservation alerts for supervisors.',
        apexAPIs: []
    },
    {
        category: 'Packing & Staging',
        icon: 'fa-box-open',
        status: 'new',
        statusLabel: 'New Development',
        summary: 'Pack confirmation, packing slip/label printing, multi-box support, and staging by carrier/route. Extends existing print management.',
        fusionAPIs: [
            { api: 'shipmentRequests/child/packingUnits', desc: 'Manage packing units (cartons/pallets) per shipment' },
            { api: 'shipmentLines', desc: 'Link packed items to shipment lines' },
            { api: 'inventoryStagedTransactions', desc: 'Confirm staged inventory ready for shipping' }
        ],
        webSolution: 'Packing station interface with order details, scan-to-pack confirmation, packing slip generation, multi-box management, staging by carrier/route view.',
        mobileSolution: 'Mobile pack station: scan order, scan items into boxes, capture weight/dimensions, print labels, confirm staging location.',
        apexAPIs: []
    },
    {
        category: 'Returns & Reverse Logistics',
        icon: 'fa-undo-alt',
        status: 'new',
        statusLabel: 'New Development',
        summary: 'Full return receipt, inspection, restock/quarantine/scrap routing, and RTV processing through Fusion return order APIs.',
        fusionAPIs: [
            { api: 'returnOrders', desc: 'Create/manage return material authorizations (RMAs)' },
            { api: 'receivingReceiptRequests (return type)', desc: 'Receive returned goods into warehouse' },
            { api: 'inventoryTransfers', desc: 'Route inspected returns to restock, quarantine, or scrap locations' },
            { api: 'creditMemos', desc: 'Trigger credit memo creation for approved returns' }
        ],
        webSolution: 'Returns processing dashboard, return receipt creation linked to original order, inspection workflow, disposition routing, return reason analytics, RTV management.',
        mobileSolution: 'Mobile returns receiving: scan RMA, inspect items with photo capture, disposition selection (restock/damage/scrap), restock location assignment.',
        apexAPIs: []
    },
    {
        category: 'Performance Tracking (KPIs)',
        icon: 'fa-chart-line',
        status: 'partial',
        statusLabel: 'Partially Developed',
        summary: 'Basic trip/order KPIs are displayed. Comprehensive warehouse-wide KPI tracking across all operations needs development.',
        fusionAPIs: [
            { api: 'All operational APIs', desc: 'KPI data derived from transaction volumes, timestamps, and accuracy metrics across all Fusion APIs' }
        ],
        webSolution: 'Extend existing analytics dashboard with picks/hour, put-aways/hour, receiving accuracy, fulfillment rate, cycle count accuracy, dock-to-stock time, on-time dispatch, labor productivity per user.',
        mobileSolution: 'Supervisor KPI dashboard on mobile, real-time team leaderboard, individual picker performance cards, shift summary reports.',
        apexAPIs: []
    },
    {
        category: 'Dashboard & Reporting',
        icon: 'fa-chart-bar',
        status: 'partial',
        statusLabel: 'Partially Developed',
        summary: 'Trip analytics dashboard exists. Needs customizable dashboards, scheduled reports, Excel/PDF export, and drill-down capabilities.',
        fusionAPIs: [
            { api: 'Analytics (BI Publisher)', desc: 'Oracle BI Publisher for scheduled report generation and distribution' },
            { api: 'All operational APIs', desc: 'Real-time data feeds for dashboard widgets from all transaction APIs' }
        ],
        webSolution: 'Customizable dashboard builder with drag-drop widgets, scheduled email reports via APEX, Excel/PDF export (ExcelJS already integrated), historical trend charts, drill-down from summary to detail.',
        mobileSolution: 'Compact KPI cards for mobile, key metrics at a glance, daily/weekly summary push notifications.',
        apexAPIs: []
    },
    {
        category: 'Labor Management',
        icon: 'fa-users-cog',
        status: 'partial',
        statusLabel: 'Partially Developed',
        summary: 'Picker management and task assignment exist. Needs full labor tracking with productivity metrics, shift scheduling, and supervisor tools.',
        fusionAPIs: [
            { api: 'workers', desc: 'Query workforce data, roles, and assignments from HCM' }
        ],
        webSolution: 'Extend picker management with login/logout tracking, productivity dashboards per user, shift scheduling, supervisor task reallocation, team leaderboard.',
        mobileSolution: 'Worker clock-in/out via mobile, task queue with priority, productivity self-view, supervisor task reassignment.',
        apexAPIs: ['pickers/getpickers', 'trip/pickerassignment']
    },
    {
        category: 'Mobile Devices & Scanning',
        icon: 'fa-mobile-alt',
        status: 'new',
        statusLabel: 'New Development',
        summary: 'New mobile-first PWA application for warehouse floor operations with barcode/QR scanning across all workflows.',
        fusionAPIs: [
            { api: 'All operational APIs', desc: 'Mobile app consumes the same Fusion REST APIs through APEX middleware layer' }
        ],
        webSolution: 'Admin interface for mobile device management, device registration, push notification configuration, offline sync settings.',
        mobileSolution: 'Progressive Web App (PWA) with camera-based barcode/QR scanning, touch-optimized UI, offline queue with auto-sync, push notifications for task assignments, support for Android/iOS/handheld scanners.',
        apexAPIs: []
    },
    {
        category: 'User Access & Security',
        icon: 'fa-shield-alt',
        status: 'partial',
        statusLabel: 'Partially Developed',
        summary: 'Basic authentication and session management exist. Needs full RBAC, audit trails, SSO, and encryption hardening.',
        fusionAPIs: [
            { api: 'Oracle IDCS/IAM', desc: 'Identity Cloud Service for SSO, MFA, and centralized user management' }
        ],
        webSolution: 'Role-based access control configuration, audit log viewer, user management panel, password policy settings, session management.',
        mobileSolution: 'Biometric login (fingerprint/face), SSO integration, auto-logout on inactivity, encrypted local storage.',
        apexAPIs: []
    },
    {
        category: 'System Integration',
        icon: 'fa-plug',
        status: 'developed',
        statusLabel: 'Developed',
        summary: 'Bi-directional Oracle Fusion integration and APEX REST APIs are fully operational. Email/SMS and webhook support need addition.',
        fusionAPIs: [
            { api: 'All fscmRestApi endpoints', desc: 'Full bi-directional integration with Fusion Cloud ERP' },
            { api: 'Oracle APEX REST', desc: 'Middleware layer for custom business logic and data orchestration' }
        ],
        webSolution: 'Integration monitoring dashboard, API health checks, webhook configuration, email/SMS notification setup, EDI configuration for carriers/suppliers.',
        mobileSolution: 'Real-time sync status indicator, offline queue management, push notification triggers from integration events.',
        apexAPIs: ['Multiple APEX endpoints already in use']
    },
    {
        category: 'Technical Requirements',
        icon: 'fa-server',
        status: 'partial',
        statusLabel: 'Partially Developed',
        summary: 'Architecture is scalable (Oracle Cloud + APEX + WebView2). Needs formal SLA monitoring, backup automation, and performance benchmarks.',
        fusionAPIs: [
            { api: 'Oracle Cloud Infrastructure', desc: 'OCI for compute, storage, and database hosting with built-in HA' }
        ],
        webSolution: 'Health monitoring dashboard, performance metrics tracking, automated backup configuration, scalability settings, uptime monitoring.',
        mobileSolution: 'Performance profiling for mobile app, offline data limits configuration, network quality indicators.',
        apexAPIs: []
    },
    {
        category: 'Implementation & Support',
        icon: 'fa-headset',
        status: 'partial',
        statusLabel: 'Partially Developed',
        summary: 'Release manager and update system exist. Needs formal training program, documentation portal, and SLA tracking.',
        fusionAPIs: [],
        webSolution: 'This Help page serves as documentation hub. Release Manager handles updates. Need training module, SLA ticket tracking, migration tools.',
        mobileSolution: 'In-app help/tutorials, contextual tips, feedback submission, support ticket creation from mobile.',
        apexAPIs: []
    },
    {
        category: 'Integration with Grays Shops',
        icon: 'fa-store',
        status: 'new',
        statusLabel: 'New Development',
        summary: 'Full shop-warehouse integration for catalog sync, stock availability, shop orders, inter-shop transfers, and click-and-collect.',
        fusionAPIs: [
            { api: 'salesOrdersForOrderHub', desc: 'Receive shop-generated orders into WMS for fulfillment' },
            { api: 'inventoryOnhandBalances', desc: 'Real-time stock availability queries for shop POS systems' },
            { api: 'inventoryTransfers', desc: 'Inter-shop and shop-to-warehouse stock transfer processing' },
            { api: 'itemsV2', desc: 'Product catalog sync between warehouse and shops' }
        ],
        webSolution: 'Shop integration dashboard, catalog sync management, shop order queue with priority picking, inter-shop transfer management, consolidated reporting across all locations.',
        mobileSolution: 'Shop staff app for stock checks, transfer requests, click-and-collect order management, real-time order status for customers.',
        apexAPIs: []
    }
];

// ============================================================================
// IMPLEMENTATION ROADMAP DATA
// ============================================================================

const IMPL_ROADMAP_DATA = [
    {
        phase: 'Phase 1',
        title: 'Core Operations (Completed)',
        status: 'completed',
        timeline: 'Completed',
        icon: 'fa-check-circle',
        color: '#38a169',
        description: 'Foundation of the WMS with trip management, order processing, picking, printing, and Oracle Fusion integration.',
        platform: 'Web (WMS Desktop App)',
        items: [
            { name: 'Trip Management (create, edit, multi-tab)', done: true },
            { name: 'Oracle Fusion Sales Order Import', done: true },
            { name: 'Pick Release & Lot Allocation', done: true },
            { name: 'Vehicle & Picker Management', done: true },
            { name: 'Print Management & Monitor Printing', done: true },
            { name: 'Auto Inventory Processing', done: true },
            { name: 'Auto Sales Order Processing', done: true },
            { name: 'Pending Shipment Lines & Store Transactions', done: true },
            { name: 'WMS Co-Pilot AI Assistant', done: true },
            { name: 'Settings, Updates & Release Manager', done: true }
        ]
    },
    {
        phase: 'Phase 2',
        title: 'Warehouse Foundation',
        status: 'next',
        timeline: 'Q2 2026',
        icon: 'fa-warehouse',
        color: '#667eea',
        description: 'Establish warehouse structure, receiving workflows, and quality control - the physical foundation for all warehouse operations.',
        platform: 'Web + Mobile',
        items: [
            { name: 'Warehouse Structure & Location Management (zones, bins, racks)', done: false },
            { name: 'Barcode/QR Code Generation for Locations', done: false },
            { name: 'Receiving Goods Workflow (PO-based receiving)', done: false },
            { name: 'Receiving Label Printing', done: false },
            { name: 'Lot/Batch & Expiry Capture at Receiving', done: false },
            { name: 'Quality Control Inspection Workflow', done: false },
            { name: 'QC Hold/Release/Quarantine Routing', done: false },
            { name: 'Mobile Receiving App (scan PO, scan items, capture lot)', done: false }
        ]
    },
    {
        phase: 'Phase 3',
        title: 'Inventory & Storage',
        status: 'planned',
        timeline: 'Q3 2026',
        icon: 'fa-cubes',
        color: '#e53e3e',
        description: 'Full inventory visibility, put-away optimization, stock reservations, and lot traceability across the warehouse.',
        platform: 'Web + Mobile',
        items: [
            { name: 'System-Directed Put-Away with Zone Rules', done: false },
            { name: 'Bin Capacity Tracking & Smart Suggestions', done: false },
            { name: 'Real-Time Stock Visibility by Location', done: false },
            { name: 'Cycle Counting & Stock Adjustments', done: false },
            { name: 'FIFO/FEFO/LIFO Inventory Strategies', done: false },
            { name: 'Stock Reservation Management', done: false },
            { name: 'Full Lot Traceability (receiving to dispatch)', done: false },
            { name: 'Expiry Management & Auto-Flagging', done: false },
            { name: 'Min/Max Stock Level Alerts', done: false },
            { name: 'Mobile Put-Away App (scan, direct, confirm)', done: false },
            { name: 'Mobile Stock Lookup & Cycle Count', done: false }
        ]
    },
    {
        phase: 'Phase 4',
        title: 'Packing, Shipping & Returns',
        status: 'planned',
        timeline: 'Q4 2026',
        icon: 'fa-box-open',
        color: '#d69e2e',
        description: 'Complete outbound workflow from pack station to ship-confirm, plus reverse logistics for returns processing.',
        platform: 'Web + Mobile',
        items: [
            { name: 'Packing Station Interface (scan-to-pack)', done: false },
            { name: 'Multi-Box Shipment & Packing Slip Generation', done: false },
            { name: 'Staging by Carrier/Route', done: false },
            { name: 'Enhanced Shipping with Carrier Assignment & Waybills', done: false },
            { name: 'Returns Receipt & Inspection Workflow', done: false },
            { name: 'Return Disposition (restock/quarantine/scrap)', done: false },
            { name: 'Return-to-Vendor (RTV) Processing', done: false },
            { name: 'Mobile Pack/Ship Confirmation App', done: false },
            { name: 'Mobile Returns Receiving & Inspection', done: false }
        ]
    },
    {
        phase: 'Phase 5',
        title: 'Analytics, KPIs & Labor',
        status: 'planned',
        timeline: 'Q1 2027',
        icon: 'fa-chart-line',
        color: '#805ad5',
        description: 'Comprehensive performance tracking, customizable dashboards, labor management, and operational analytics across all warehouse activities.',
        platform: 'Web + Mobile',
        items: [
            { name: 'Warehouse-Wide KPI Dashboard (picks/hr, accuracy, fulfillment)', done: false },
            { name: 'Customizable Dashboard Builder', done: false },
            { name: 'Scheduled Report Generation (email)', done: false },
            { name: 'Excel/PDF Export Enhancement', done: false },
            { name: 'Historical Trend Analysis', done: false },
            { name: 'Labor Productivity Tracking per User', done: false },
            { name: 'Shift Scheduling & Task Reallocation', done: false },
            { name: 'Team Leaderboard & Gamification', done: false },
            { name: 'Mobile Supervisor Dashboard', done: false },
            { name: 'Mobile Worker Productivity Self-View', done: false }
        ]
    },
    {
        phase: 'Phase 6',
        title: 'Mobile Platform & Scanning',
        status: 'planned',
        timeline: 'Q2 2027',
        icon: 'fa-mobile-alt',
        color: '#319795',
        description: 'Dedicated mobile PWA for warehouse floor staff with barcode scanning, offline support, and push notifications across all operations.',
        platform: 'Mobile (PWA)',
        items: [
            { name: 'Mobile PWA App Architecture & Shell', done: false },
            { name: 'Camera-Based Barcode/QR Scanning Engine', done: false },
            { name: 'Offline Mode with Auto-Sync Queue', done: false },
            { name: 'Push Notifications for Task Assignments', done: false },
            { name: 'Unified Mobile Task Queue (receive, put-away, pick, pack, ship)', done: false },
            { name: 'Android/iOS/Handheld Scanner Support', done: false },
            { name: 'Driver Delivery App (trip details, POD, navigation)', done: false },
            { name: 'Mobile Admin & Device Management', done: false }
        ]
    },
    {
        phase: 'Phase 7',
        title: 'Grays Shops Integration',
        status: 'planned',
        timeline: 'Q3 2027',
        icon: 'fa-store',
        color: '#e53e3e',
        description: 'Full integration between warehouse and Grays retail shops for catalog sync, stock visibility, shop orders, and inter-shop transfers.',
        platform: 'Web + Mobile',
        items: [
            { name: 'Product Catalog Sync (Fusion Items API)', done: false },
            { name: 'Real-Time Stock Availability for Shops', done: false },
            { name: 'Auto-Generate Warehouse Orders from Shop Sales', done: false },
            { name: 'Priority Picking for Shop Orders', done: false },
            { name: 'Inter-Shop Stock Transfer Management', done: false },
            { name: 'Shop Returns Through Warehouse', done: false },
            { name: 'Click-and-Collect Order Flow', done: false },
            { name: 'Consolidated Cross-Location Reporting', done: false },
            { name: 'Shop Staff Mobile App (stock check, transfer requests)', done: false }
        ]
    },
    {
        phase: 'Phase 8',
        title: 'Security, Compliance & Hardening',
        status: 'planned',
        timeline: 'Q4 2027',
        icon: 'fa-shield-alt',
        color: '#2d3748',
        description: 'Enterprise-grade security, full RBAC, audit trails, SSO, and formal SLA monitoring. Production hardening and training.',
        platform: 'Web + Mobile',
        items: [
            { name: 'Role-Based Access Control (RBAC) Implementation', done: false },
            { name: 'Full Audit Trail for All User Actions', done: false },
            { name: 'SSO Integration (Oracle IDCS)', done: false },
            { name: 'Password Policy & Session Management', done: false },
            { name: 'Data Encryption (at rest and in transit)', done: false },
            { name: 'Uptime Monitoring & SLA Dashboard', done: false },
            { name: 'Automated Backup & Disaster Recovery', done: false },
            { name: 'User Training Program & Documentation', done: false },
            { name: 'Go-Live Support & Post-Go-Live Warranty', done: false }
        ]
    }
];

// ============================================================================
// RENDER FUSION MAPPING CONTENT
// ============================================================================

function renderFusionMappingContent() {
    const container = document.getElementById('fusion-mapping-content');

    // Status legend and summary
    const developed = FUSION_MAPPING_DATA.filter(c => c.status === 'developed').length;
    const partial = FUSION_MAPPING_DATA.filter(c => c.status === 'partial').length;
    const newDev = FUSION_MAPPING_DATA.filter(c => c.status === 'new').length;

    let html = '';

    // Overview cards
    html += '<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; margin-bottom: 2rem;">';
    html += '<div style="background: linear-gradient(135deg, #38a169, #68d391); color: white; padding: 1.5rem; border-radius: 12px;"><div style="font-size: 2rem; font-weight: 700;">' + developed + '</div><div style="opacity: 0.9; font-size: 0.875rem;">Fully Developed</div></div>';
    html += '<div style="background: linear-gradient(135deg, #d69e2e, #f6e05e); color: white; padding: 1.5rem; border-radius: 12px;"><div style="font-size: 2rem; font-weight: 700;">' + partial + '</div><div style="opacity: 0.9; font-size: 0.875rem;">Partially Developed</div></div>';
    html += '<div style="background: linear-gradient(135deg, #667eea, #764ba2); color: white; padding: 1.5rem; border-radius: 12px;"><div style="font-size: 2rem; font-weight: 700;">' + newDev + '</div><div style="opacity: 0.9; font-size: 0.875rem;">New Development</div></div>';
    html += '<div style="background: linear-gradient(135deg, #4a5568, #718096); color: white; padding: 1.5rem; border-radius: 12px;"><div style="font-size: 2rem; font-weight: 700;">' + FUSION_MAPPING_DATA.length + '</div><div style="opacity: 0.9; font-size: 0.875rem;">Total Categories</div></div>';
    html += '</div>';

    // Architecture note
    html += '<div style="background: #edf2f7; border-left: 4px solid #667eea; padding: 1rem 1.5rem; border-radius: 0 8px 8px 0; margin-bottom: 2rem;">';
    html += '<div style="font-weight: 700; color: #2d3748; margin-bottom: 0.25rem;"><i class="fas fa-info-circle" style="color: #667eea; margin-right: 6px;"></i>Architecture</div>';
    html += '<div style="color: #4a5568; font-size: 0.875rem; line-height: 1.6;">All integrations flow through the three-tier architecture: <strong>Oracle Fusion Cloud</strong> (fscmRestApi) &rarr; <strong>Oracle APEX</strong> (REST middleware + business logic) &rarr; <strong>WMS Application</strong> (WebView2 desktop + Mobile PWA). The APEX layer handles authentication, caching, custom business rules, and orchestration of multiple Fusion API calls.</div>';
    html += '</div>';

    // Category cards
    FUSION_MAPPING_DATA.forEach(function(cat) {
        var statusColors = {
            developed: { bg: '#f0fff4', border: '#38a169', badge: '#38a169', badgeBg: '#c6f6d5' },
            partial: { bg: '#fffff0', border: '#d69e2e', badge: '#975a16', badgeBg: '#fefcbf' },
            'new': { bg: '#f7f7ff', border: '#667eea', badge: '#553c9a', badgeBg: '#e9d8fd' }
        };
        var sc = statusColors[cat.status] || statusColors['new'];

        html += '<div style="background: ' + sc.bg + '; border: 1px solid ' + sc.border + '33; border-radius: 12px; margin-bottom: 1.5rem; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.04);">';

        // Category header
        html += '<div style="padding: 1.25rem 1.5rem; border-bottom: 1px solid ' + sc.border + '22; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 0.5rem;">';
        html += '<div style="display: flex; align-items: center; gap: 0.75rem;">';
        html += '<div style="width: 40px; height: 40px; border-radius: 10px; background: ' + sc.border + '; color: white; display: flex; align-items: center; justify-content: center; font-size: 1.1rem;"><i class="fas ' + cat.icon + '"></i></div>';
        html += '<div><div style="font-weight: 700; color: #2d3748; font-size: 1.05rem;">' + cat.category + '</div>';
        html += '<div style="color: #718096; font-size: 0.8rem;">' + cat.summary + '</div></div>';
        html += '</div>';
        html += '<span style="background: ' + sc.badgeBg + '; color: ' + sc.badge + '; padding: 4px 14px; border-radius: 20px; font-size: 0.75rem; font-weight: 700; white-space: nowrap;">' + cat.statusLabel + '</span>';
        html += '</div>';

        // Body - 2 column layout
        html += '<div style="padding: 1.25rem 1.5rem;">';
        html += '<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem;">';

        // Left column: Fusion APIs
        html += '<div>';
        html += '<div style="font-weight: 700; color: #2d3748; margin-bottom: 0.5rem; font-size: 0.85rem;"><i class="fas fa-cloud" style="color: #e53e3e; margin-right: 6px;"></i>Oracle Fusion APIs</div>';
        if (cat.fusionAPIs.length > 0) {
            cat.fusionAPIs.forEach(function(a) {
                html += '<div style="background: white; border: 1px solid #e2e8f0; border-radius: 8px; padding: 0.6rem 0.8rem; margin-bottom: 0.4rem;">';
                html += '<div style="font-weight: 600; color: #667eea; font-size: 0.8rem; font-family: monospace;">' + a.api + '</div>';
                html += '<div style="color: #718096; font-size: 0.75rem;">' + a.desc + '</div>';
                html += '</div>';
            });
        } else {
            html += '<div style="color: #a0aec0; font-size: 0.8rem; font-style: italic;">No direct Fusion API - managed through APEX/internal logic</div>';
        }

        // APEX APIs if any
        if (cat.apexAPIs && cat.apexAPIs.length > 0) {
            html += '<div style="font-weight: 700; color: #2d3748; margin: 0.75rem 0 0.5rem 0; font-size: 0.85rem;"><i class="fas fa-database" style="color: #38a169; margin-right: 6px;"></i>APEX REST Endpoints</div>';
            cat.apexAPIs.forEach(function(ep) {
                html += '<div style="background: #f0fff4; border: 1px solid #c6f6d5; border-radius: 6px; padding: 0.4rem 0.6rem; margin-bottom: 0.3rem; font-family: monospace; font-size: 0.75rem; color: #22543d;">' + ep + '</div>';
            });
        }
        html += '</div>';

        // Right column: Solution approach
        html += '<div>';
        html += '<div style="font-weight: 700; color: #2d3748; margin-bottom: 0.5rem; font-size: 0.85rem;"><i class="fas fa-desktop" style="color: #667eea; margin-right: 6px;"></i>Web-Based Solution</div>';
        html += '<div style="color: #4a5568; font-size: 0.8rem; line-height: 1.5; margin-bottom: 1rem; background: white; border: 1px solid #e2e8f0; border-radius: 8px; padding: 0.6rem 0.8rem;">' + cat.webSolution + '</div>';

        html += '<div style="font-weight: 700; color: #2d3748; margin-bottom: 0.5rem; font-size: 0.85rem;"><i class="fas fa-mobile-alt" style="color: #319795; margin-right: 6px;"></i>Mobile App Solution</div>';
        html += '<div style="color: #4a5568; font-size: 0.8rem; line-height: 1.5; background: white; border: 1px solid #e2e8f0; border-radius: 8px; padding: 0.6rem 0.8rem;">' + cat.mobileSolution + '</div>';
        html += '</div>';

        html += '</div>'; // grid
        html += '</div>'; // body
        html += '</div>'; // card
    });

    container.innerHTML = html;
}

// ============================================================================
// RENDER IMPLEMENTATION ROADMAP CONTENT
// ============================================================================

function renderImplRoadmapContent() {
    const container = document.getElementById('impl-roadmap-content');

    let html = '';

    // Overall progress summary
    const totalItems = IMPL_ROADMAP_DATA.reduce(function(sum, p) { return sum + p.items.length; }, 0);
    const doneItems = IMPL_ROADMAP_DATA.reduce(function(sum, p) { return sum + p.items.filter(function(i) { return i.done; }).length; }, 0);
    const pctDone = Math.round((doneItems / totalItems) * 100);

    html += '<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; margin-bottom: 2rem;">';
    html += '<div style="background: linear-gradient(135deg, #667eea, #764ba2); color: white; padding: 1.5rem; border-radius: 12px;"><div style="font-size: 2rem; font-weight: 700;">' + IMPL_ROADMAP_DATA.length + '</div><div style="opacity: 0.9; font-size: 0.875rem;">Total Phases</div></div>';
    html += '<div style="background: linear-gradient(135deg, #38a169, #68d391); color: white; padding: 1.5rem; border-radius: 12px;"><div style="font-size: 2rem; font-weight: 700;">' + doneItems + '/' + totalItems + '</div><div style="opacity: 0.9; font-size: 0.875rem;">Items Completed</div></div>';
    html += '<div style="background: linear-gradient(135deg, #d69e2e, #f6e05e); color: white; padding: 1.5rem; border-radius: 12px;"><div style="font-size: 2rem; font-weight: 700;">' + pctDone + '%</div><div style="opacity: 0.9; font-size: 0.875rem;">Overall Progress</div></div>';
    html += '<div style="background: linear-gradient(135deg, #319795, #4fd1c5); color: white; padding: 1.5rem; border-radius: 12px;"><div style="font-size: 2rem; font-weight: 700;">Q2 2026 - Q4 2027</div><div style="opacity: 0.9; font-size: 0.875rem;">Timeline</div></div>';
    html += '</div>';

    // Approach note
    html += '<div style="background: #edf2f7; border-left: 4px solid #667eea; padding: 1rem 1.5rem; border-radius: 0 8px 8px 0; margin-bottom: 2rem;">';
    html += '<div style="font-weight: 700; color: #2d3748; margin-bottom: 0.25rem;"><i class="fas fa-lightbulb" style="color: #d69e2e; margin-right: 6px;"></i>Implementation Approach</div>';
    html += '<div style="color: #4a5568; font-size: 0.875rem; line-height: 1.6;">Each phase delivers both <strong>web-based extensions</strong> to the existing WMS desktop application and <strong>new mobile interfaces</strong> (PWA) for warehouse floor operations. The Oracle APEX middleware layer is extended with new REST endpoints for each phase. All mobile features consume the same APIs as the web application through the shared APEX layer.</div>';
    html += '</div>';

    // Dual platform legend
    html += '<div style="display: flex; gap: 1.5rem; margin-bottom: 1.5rem; flex-wrap: wrap;">';
    html += '<div style="display: flex; align-items: center; gap: 0.4rem; font-size: 0.8rem; color: #4a5568;"><span style="width: 12px; height: 12px; border-radius: 3px; background: #667eea; display: inline-block;"></span> Web (Extend WMS Desktop)</div>';
    html += '<div style="display: flex; align-items: center; gap: 0.4rem; font-size: 0.8rem; color: #4a5568;"><span style="width: 12px; height: 12px; border-radius: 3px; background: #319795; display: inline-block;"></span> Mobile (New PWA)</div>';
    html += '<div style="display: flex; align-items: center; gap: 0.4rem; font-size: 0.8rem; color: #4a5568;"><span style="width: 12px; height: 12px; border-radius: 3px; background: #38a169; display: inline-block;"></span> Completed</div>';
    html += '<div style="display: flex; align-items: center; gap: 0.4rem; font-size: 0.8rem; color: #4a5568;"><span style="width: 12px; height: 12px; border-radius: 3px; background: #e2e8f0; border: 1px solid #cbd5e0; display: inline-block;"></span> Planned</div>';
    html += '</div>';

    // Phase cards
    IMPL_ROADMAP_DATA.forEach(function(phase) {
        var phaseDone = phase.items.filter(function(i) { return i.done; }).length;
        var phaseTotal = phase.items.length;
        var phasePct = Math.round((phaseDone / phaseTotal) * 100);

        var borderColor = phase.color;
        var isCompleted = phase.status === 'completed';
        var isNext = phase.status === 'next';

        html += '<div style="border: 2px solid ' + borderColor + (isNext ? '' : '44') + '; border-radius: 12px; margin-bottom: 1.5rem; overflow: hidden;' + (isNext ? ' box-shadow: 0 4px 20px ' + borderColor + '33;' : '') + '">';

        // Phase header
        html += '<div style="padding: 1.25rem 1.5rem; background: ' + borderColor + '11; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 0.5rem;">';
        html += '<div style="display: flex; align-items: center; gap: 0.75rem;">';
        html += '<div style="width: 44px; height: 44px; border-radius: 12px; background: ' + borderColor + '; color: white; display: flex; align-items: center; justify-content: center; font-size: 1.2rem;"><i class="fas ' + phase.icon + '"></i></div>';
        html += '<div>';
        html += '<div style="font-weight: 700; color: #2d3748; font-size: 1.1rem;">' + phase.phase + ': ' + phase.title + '</div>';
        html += '<div style="color: #718096; font-size: 0.8rem;">' + phase.description + '</div>';
        html += '</div></div>';
        html += '<div style="display: flex; align-items: center; gap: 1rem; flex-wrap: wrap;">';
        html += '<span style="background: ' + borderColor + '22; color: ' + borderColor + '; padding: 4px 12px; border-radius: 6px; font-size: 0.75rem; font-weight: 700;"><i class="fas fa-calendar-alt" style="margin-right: 4px;"></i>' + phase.timeline + '</span>';
        html += '<span style="background: ' + borderColor + '22; color: ' + borderColor + '; padding: 4px 12px; border-radius: 6px; font-size: 0.75rem; font-weight: 700;">' + phase.platform + '</span>';
        html += '</div>';
        html += '</div>';

        // Progress bar
        html += '<div style="padding: 0.75rem 1.5rem 0; display: flex; align-items: center; gap: 0.75rem;">';
        html += '<div style="flex: 1; background: #e2e8f0; border-radius: 10px; height: 8px; overflow: hidden;"><div style="width: ' + phasePct + '%; background: ' + borderColor + '; height: 100%; border-radius: 10px; transition: width 0.5s ease;"></div></div>';
        html += '<span style="font-size: 0.8rem; font-weight: 700; color: ' + borderColor + ';">' + phasePct + '% (' + phaseDone + '/' + phaseTotal + ')</span>';
        html += '</div>';

        // Items
        html += '<div style="padding: 0.75rem 1.5rem 1.25rem; display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 0.4rem;">';
        phase.items.forEach(function(item) {
            var itemIcon = item.done ? 'fa-check-circle' : 'fa-circle';
            var itemColor = item.done ? '#38a169' : '#cbd5e0';
            var textStyle = item.done ? 'color: #4a5568;' : 'color: #718096;';
            html += '<div style="display: flex; align-items: center; gap: 0.5rem; padding: 0.35rem 0; font-size: 0.85rem; ' + textStyle + '">';
            html += '<i class="fas ' + itemIcon + '" style="color: ' + itemColor + '; font-size: 0.9rem; flex-shrink: 0;"></i>';
            html += '<span>' + item.name + '</span>';
            html += '</div>';
        });
        html += '</div>';

        html += '</div>';
    });

    container.innerHTML = html;
}

// ============================================================================
// INITIALIZATION ON PAGE LOAD
// ============================================================================

$(document).ready(function() {
    console.log('[Requirements] New Requirements module loaded');

    // Initialize when the New Requirements help tab is clicked
    $(document).on('click', '.help-tab[data-help-tab="new-requirements"]', function() {
        setTimeout(function() {
            if (!requirementsGrid) {
                initializeRequirementsPage();
            }
            // Set active styling on first sub-tab
            var firstTab = document.querySelector('.req-sub-tab[data-req-tab="requirements"]');
            if (firstTab && firstTab.classList.contains('active')) {
                firstTab.style.background = 'white';
                firstTab.style.color = '#667eea';
                firstTab.style.boxShadow = '0 2px 8px rgba(0,0,0,0.08)';
            }
        }, 100);
    });
});

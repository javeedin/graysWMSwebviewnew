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
        }, 100);
    });
});

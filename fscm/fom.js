/* Fusion Order Management — page entry (fscm/om.html). Views grouped Sales Orders · Customers · Shipping · Billing. */
(function () {
    FX.start({
        module: 'om',
        sub: 'Order Hub sales orders, POS, customers, price lists, shipping and billing — live from Oracle Fusion',
        views: [
            { id: 'orders', group: 'Sales Orders', label: 'Manage Orders', icon: 'fa-file-lines', desc: 'Search Order Hub — orders, lines, analytics; open orders in tabs.', render: FOM.viewOrders },
            { id: 'create', group: 'Sales Orders', label: 'Create / Change Order', icon: 'fa-file-circle-plus', desc: 'New, copy, return (RMA) and change orders.', render: FOM.viewCreate },
            { id: 'pos', group: 'Sales Orders', label: 'POS Sales Order', icon: 'fa-cash-register', desc: 'Scan to sell — 80 mm receipt.', render: FOM.viewPos },
            { id: 'customers', group: 'Customers', label: 'Customers', icon: 'fa-users', desc: 'Customer accounts from the customer search report.', render: FOM.viewCustomers },
            { id: 'pricelist', group: 'Customers', label: 'Price List', icon: 'fa-tags', desc: 'Fusion pricing price lists, items and list prices.', render: FOM.viewPriceList },
            { id: 'shiplines', group: 'Shipping', label: 'Shipment Lines', icon: 'fa-truck-ramp-box', desc: 'Pending shipment lines — pick release, pick slips, ship confirm.', render: FOM.viewShipLines },
            { id: 'picks', group: 'Shipping', label: 'Confirm Picks', icon: 'fa-clipboard-check', desc: 'Pick slips — allocate lots / serials, confirm, ship.', render: FOM.viewConfirmPicks },
            { id: 'autoinvoice', group: 'Billing', label: 'AutoInvoice', icon: 'fa-file-invoice', desc: 'Push to AR — submit AutoInvoice (ESS) and follow it.', render: FOM.viewAutoInvoice },
            { id: 'ar', group: 'Billing', label: 'AR Invoices', icon: 'fa-file-invoice-dollar', desc: 'Receivables invoices with lines and accounting.', render: FOM.viewArInvoices },
            { id: 'settings', group: 'Settings', label: 'Settings', icon: 'fa-sliders', desc: 'Business defaults for this PC.', render: FOM.viewSettings }
        ]
    });
})();

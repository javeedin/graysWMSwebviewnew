// ============================================================================
// PRINT ALL PRINTER SELECTION MODAL (SEPARATE FROM AUTO-PRINT MODAL)
// ============================================================================

let currentPrintAllData = null;

// Show printer selection modal for Print All
window.showPrintAllPrinterModal = async function(tripId, orderCount, orders) {
    console.log('[Monitor] Showing Print All printer modal for trip:', tripId);

    currentPrintAllData = {
        tripId: tripId,
        orderCount: orderCount,
        orders: orders
    };

    // Populate modal fields
    document.getElementById('print-modal-trip-id').textContent = tripId;
    document.getElementById('print-modal-order-count').textContent = `${orderCount} orders`;

    // Show modal
    const modal = document.getElementById('print-all-printer-modal');
    modal.style.display = 'flex';

    // Load printers
    try {
        await loadPrintersForPrintAll();
    } catch (error) {
        console.error('[Monitor] Error loading printers:', error);
        const select = document.getElementById('print-modal-printer-select');
        select.innerHTML = '<option value="">-- Error loading printers, please refresh --</option>';
    }
};

// Close Print All printer modal
window.closePrintAllPrinterModal = function() {
    console.log('[Monitor] Closing Print All printer modal');
    document.getElementById('print-all-printer-modal').style.display = 'none';
    document.getElementById('print-modal-error').style.display = 'none';
    currentPrintAllData = null;
};

// Load printers into Print All modal
async function loadPrintersForPrintAll() {
    const select = document.getElementById('print-modal-printer-select');

    try {
        console.log('[Monitor] Loading printers for Print All...');
        select.innerHTML = '<option value="">-- Loading printers... --</option>';

        const data = await callApexAPINew('/printers/all', 'GET');
        const printers = data.items || [];

        console.log('[Monitor] Loaded', printers.length, 'printers for Print All');

        if (printers.length === 0) {
            select.innerHTML = '<option value="">-- No printers found --</option>';
            return;
        }

        select.innerHTML = '<option value="">-- Select a printer --</option>';

        printers.forEach(printer => {
            const option = document.createElement('option');
            option.value = printer.configId;
            option.textContent = `${printer.printerName}${printer.isActive === 'Y' ? ' (Active)' : ''}`;
            if (printer.isActive === 'Y') {
                option.selected = true;
            }
            select.appendChild(option);
        });

        // Store printers for later use
        window.allPrintersForPrintAll = printers;

    } catch (error) {
        console.error('[Monitor] Failed to load printers for Print All:', error);
        select.innerHTML = '<option value="">-- Failed to load printers --</option>';
    }
}

// Confirm Print All with selected printer - NO DATABASE SAVE
window.confirmPrintAllWithPrinter = async function() {
    const errorDiv = document.getElementById('print-modal-error');
    errorDiv.style.display = 'none';

    const printerConfigId = document.getElementById('print-modal-printer-select').value;

    if (!printerConfigId) {
        errorDiv.textContent = 'Please select a printer';
        errorDiv.style.display = 'block';
        return;
    }

    if (!currentPrintAllData) {
        errorDiv.textContent = 'Invalid print data';
        errorDiv.style.display = 'block';
        return;
    }

    const selectedPrinter = window.allPrintersForPrintAll.find(p => p.configId == printerConfigId);
    const tripId = currentPrintAllData.tripId;
    const orders = currentPrintAllData.orders;

    console.log('[Monitor] Print All confirmed');
    console.log('[Monitor] Printer:', selectedPrinter?.printerName);
    console.log('[Monitor] Orders:', orders.length);

    // Close modal
    closePrintAllPrinterModal();

    // Show confirmation
    const confirmed = confirm(
        `Add ${orders.length} orders to print queue?\n\n` +
        `Printer: ${selectedPrinter?.printerName}\n\n` +
        `You can monitor progress in the Print Queue tab.`
    );

    if (!confirmed) {
        return;
    }

    console.log(`[Monitor] Adding ${orders.length} orders to print queue...`);

    // Add all orders to print queue
    for (const order of orders) {
        // Add printer name to order data
        order.printerName = selectedPrinter?.printerName;
        addToPrintQueue(tripId, order);
    }

    console.log(`[Monitor] ✅ ${orders.length} jobs added to print queue`);

    // Show message
    alert(`${orders.length} jobs added to Print Queue!\n\nClick OK to start printing.`);

    // Start processing the queue
    await processPrintQueue();
};

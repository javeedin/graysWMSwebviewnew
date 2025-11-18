// ============================================================================
// WMS CO-PILOT - Simple Implementation
// ============================================================================

console.log('[Co-Pilot] Loading...');

// Wait for DOM to be ready
document.addEventListener('DOMContentLoaded', function() {
    console.log('[Co-Pilot] Initializing...');

    // Toggle Co-Pilot Panel
    window.toggleCopilot = function() {
        const panel = document.getElementById('copilot-panel');
        const overlay = document.getElementById('copilot-overlay');

        if (panel && overlay) {
            const isOpen = panel.classList.contains('open');

            if (isOpen) {
                panel.classList.remove('open');
                overlay.classList.remove('open');
                console.log('[Co-Pilot] Panel closed');
            } else {
                panel.classList.add('open');
                overlay.classList.add('open');
                console.log('[Co-Pilot] Panel opened');
            }
        }
    };

    // Co-Pilot Actions
    window.copilotAction = function(action) {
        console.log('[Co-Pilot] Action:', action);

        switch(action) {
            case 'createTrip':
                alert('🚚 Create New Trip\n\n(Feature implementation coming soon)');
                break;
            case 'printOrder':
                alert('🖨️ Print Order\n\n(Feature implementation coming soon)');
                break;
            case 'printTrip':
                alert('📄 Print Trip\n\n(Feature implementation coming soon)');
                break;
            default:
                alert('Co-Pilot action: ' + action + '\n\n(Coming soon)');
        }
    };

    // Keyboard shortcut: Alt+C to toggle
    document.addEventListener('keydown', function(e) {
        if (e.altKey && e.key === 'c') {
            e.preventDefault();
            toggleCopilot();
        }
    });

    console.log('[Co-Pilot] ✅ Ready! (Press Alt+C to toggle)');
});

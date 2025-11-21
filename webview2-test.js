// ============================================================================
// WebView2 Integration Test
// ============================================================================

console.log('[WebView2 Test] Loading test module...');

// Test if WebView2 is available
window.testWebView2Integration = function() {
    console.log('[WebView2 Test] Starting integration test...');

    // Check if WebView2 is available
    if (window.chrome && window.chrome.webview) {
        console.log('✅ WebView2 detected!');
        console.log('✅ window.chrome.webview available');

        // Try to send a test message
        try {
            window.chrome.webview.postMessage({
                type: 'TEST_MESSAGE',
                data: 'Hello from JavaScript'
            });
            console.log('✅ Test message sent successfully');
            alert('WebView2 is available!\n\nNow check your C# console to see if the message was received.\n\nIf you see the message in C#, the integration is working.');
        } catch (error) {
            console.error('❌ Error sending test message:', error);
            alert('WebView2 detected but message failed:\n' + error.message);
        }
    } else {
        console.log('❌ WebView2 NOT detected');
        console.log('Running in:', navigator.userAgent);
        alert('WebView2 NOT detected!\n\nThis is running in: ' + (window.chrome ? 'Chrome/Edge' : 'Other browser') + '\n\nMake sure you are running this in a WebView2 application.');
    }
};

// Add test button to diagnostic toolbar if it exists
document.addEventListener('DOMContentLoaded', function() {
    const toolbar = document.getElementById('diagnostic-toolbar');
    if (toolbar) {
        const buttonContainer = toolbar.querySelector('div:first-child');
        if (buttonContainer) {
            const testButton = document.createElement('button');
            testButton.className = 'btn btn-sm';
            testButton.style.cssText = 'background: #9c27b0; color: white; border: 1px solid #7b1fa2; padding: 4px 10px; font-size: 11px;';
            testButton.innerHTML = '<i class="fas fa-vial"></i> Test WebView2';
            testButton.onclick = testWebView2Integration;
            buttonContainer.appendChild(testButton);
        }
    }
});

console.log('[WebView2 Test] ✅ Module loaded');

// ========================================
// Distribution Manager
// Handles WMS module distribution and updates
// ========================================

console.log('[Distribution] ========================================');
console.log('[Distribution] Module loading...');
console.log('[Distribution] ========================================');

let distributionConfig = {
    distributionFolder: 'C:\\fusion\\fusionclientweb\\wms',
    // Use GitHub Releases API to automatically get latest release
    githubReleaseAPI: 'https://api.github.com/repos/javeedin/graysWMSwebviewnew/releases/latest',
    isDownloading: false
};

console.log('[Distribution] Configuration loaded:');
console.log('[Distribution] - Folder:', distributionConfig.distributionFolder);
console.log('[Distribution] - API:', distributionConfig.githubReleaseAPI);

// ========================================
// Launch WMS Module
// ========================================

function launchWMSModule() {
    console.log('[Distribution] ========================================');
    console.log('[Distribution] launchWMSModule() called');
    console.log('[Distribution] ========================================');

    // Check if distribution folder exists
    const requestId = 'req_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);

    const message = {
        action: 'check-distribution-folder',
        folder: distributionConfig.distributionFolder,
        requestId: requestId
    };

    console.log('[Distribution] Sending message to C#:', message);

    if (window.chrome && window.chrome.webview) {
        console.log('[Distribution] WebView2 available - sending message');
        window.chrome.webview.postMessage(message);
        console.log('[Distribution] Message sent successfully');
    } else {
        console.error('[Distribution] WebView2 NOT available!');
        alert('WMS module not available. Please download the latest version first.');
    }
}

// ========================================
// Download New Version
// ========================================

async function downloadNewVersion() {
    console.log('[Distribution] ========================================');
    console.log('[Distribution] downloadNewVersion() called');
    console.log('[Distribution] ========================================');

    if (distributionConfig.isDownloading) {
        console.warn('[Distribution] Download already in progress');
        alert('Download already in progress. Please wait...');
        return;
    }

    console.log('[Distribution] Step 1: Starting download process...');

    try {
        distributionConfig.isDownloading = true;

        // Update button state
        console.log('[Distribution] Step 2: Updating button state...');
        updateDownloadButtonState('Checking for updates...');

        // Fetch latest release info
        console.log('[Distribution] Step 3: Fetching release info from:', distributionConfig.githubReleaseAPI);
        const fetchUrl = distributionConfig.githubReleaseAPI + '?t=' + Date.now();
        console.log('[Distribution] Full URL:', fetchUrl);

        const response = await fetch(fetchUrl);
        console.log('[Distribution] Fetch response status:', response.status);
        console.log('[Distribution] Fetch response ok:', response.ok);

        if (!response.ok) {
            throw new Error(`Failed to fetch release info: ${response.status}`);
        }

        const githubRelease = await response.json();
        console.log('[Distribution] Step 4: GitHub Release info received:');
        console.log('[Distribution] - Full response:', githubRelease);

        // Parse GitHub API response
        const version = githubRelease.tag_name?.replace('v', '') || githubRelease.tag_name;
        const releaseDate = githubRelease.published_at;

        // Find the ZIP asset (wms-webview-html-*.zip)
        const zipAsset = githubRelease.assets?.find(asset =>
            asset.name.includes('wms-webview-html') && asset.name.endsWith('.zip')
        );

        if (!zipAsset) {
            throw new Error('No WMS ZIP file found in release assets');
        }

        const packageUrl = zipAsset.browser_download_url;

        console.log('[Distribution] - Version:', version);
        console.log('[Distribution] - Package URL:', packageUrl);
        console.log('[Distribution] - Release date:', releaseDate);

        // Confirm download with user
        const confirmMsg = `Download WMS version ${version}?\n\n` +
                          `This will download and install the latest version to:\n` +
                          `${distributionConfig.distributionFolder}\n\n` +
                          `Size: ~2MB\nTime: ~30 seconds`;

        console.log('[Distribution] Step 5: Asking user for confirmation...');
        const userConfirmed = confirm(confirmMsg);
        console.log('[Distribution] User confirmed:', userConfirmed);

        if (!userConfirmed) {
            console.log('[Distribution] Download cancelled by user');
            updateDownloadButtonState('Get New Version');
            distributionConfig.isDownloading = false;
            return;
        }

        // Send download request to C# backend
        console.log('[Distribution] Step 6: Preparing download message for C#...');
        updateDownloadButtonState('Downloading...');

        const requestId = 'req_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);

        const downloadMessage = {
            action: 'download-distribution',
            version: version,
            packageUrl: packageUrl,
            extractTo: distributionConfig.distributionFolder,
            requestId: requestId
        };

        console.log('[Distribution] Step 7: Sending download message to C#:');
        console.log('[Distribution] Message:', JSON.stringify(downloadMessage, null, 2));

        if (window.chrome && window.chrome.webview) {
            console.log('[Distribution] WebView2 available - sending message');
            window.chrome.webview.postMessage(downloadMessage);
            console.log('[Distribution] Message sent successfully');

            // Show progress message
            console.log('[Distribution] Step 8: Showing progress overlay...');
            showDownloadProgress(version);
        } else {
            console.error('[Distribution] WebView2 NOT available!');
            throw new Error('WebView2 not available');
        }

    } catch (error) {
        console.error('[Distribution] ========================================');
        console.error('[Distribution] ERROR in downloadNewVersion:');
        console.error('[Distribution] Error message:', error.message);
        console.error('[Distribution] Error stack:', error.stack);
        console.error('[Distribution] ========================================');

        alert('Failed to download new version:\n' + error.message);

        updateDownloadButtonState('Get New Version');
        distributionConfig.isDownloading = false;
    }
}

// ========================================
// Helper Functions
// ========================================

function updateDownloadButtonState(text) {
    const buttons = document.querySelectorAll('button[onclick="downloadNewVersion()"]');
    buttons.forEach(button => {
        const icon = button.querySelector('i');
        if (icon) {
            button.innerHTML = `<i class="${icon.className}"></i> ${text}`;
        } else {
            button.textContent = text;
        }
        button.disabled = text !== 'Get New Version';
    });
}

function showDownloadProgress(version) {
    // Create progress overlay
    const overlay = document.createElement('div');
    overlay.id = 'download-progress-overlay';
    overlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.8);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10000;
    `;

    overlay.innerHTML = `
        <div style="background: white; padding: 2rem 3rem; border-radius: 12px; text-align: center; max-width: 500px;">
            <div style="font-size: 3rem; margin-bottom: 1rem;">📦</div>
            <h2 style="margin: 0 0 1rem 0; color: #333;">Downloading WMS v${version}</h2>
            <p style="color: #666; margin-bottom: 1.5rem;">
                Please wait while we download and install the latest version...
            </p>
            <div style="width: 100%; height: 8px; background: #f0f0f0; border-radius: 4px; overflow: hidden;">
                <div id="download-progress-bar" style="width: 0%; height: 100%; background: linear-gradient(90deg, #6366f1, #8b5cf6); transition: width 0.3s;"></div>
            </div>
            <p id="download-status-text" style="margin-top: 1rem; font-size: 0.9rem; color: #999;">
                Connecting to GitHub...
            </p>
        </div>
    `;

    document.body.appendChild(overlay);

    // Simulate progress (actual progress will be updated by C# callbacks)
    let progress = 0;
    const progressInterval = setInterval(() => {
        progress += Math.random() * 10;
        if (progress > 90) {
            progress = 90; // Cap at 90% until actual completion
            clearInterval(progressInterval);
        }
        updateProgressBar(progress);
    }, 500);

    // Store interval for cleanup
    window.distributionProgressInterval = progressInterval;
}

function updateProgressBar(percent) {
    const progressBar = document.getElementById('download-progress-bar');
    const statusText = document.getElementById('download-status-text');

    if (progressBar) {
        progressBar.style.width = percent + '%';
    }

    if (statusText) {
        if (percent < 30) {
            statusText.textContent = 'Downloading package from GitHub...';
        } else if (percent < 60) {
            statusText.textContent = 'Extracting files...';
        } else if (percent < 90) {
            statusText.textContent = 'Installing files...';
        } else {
            statusText.textContent = 'Finalizing...';
        }
    }
}

function closeDownloadProgress() {
    const overlay = document.getElementById('download-progress-overlay');
    if (overlay) {
        overlay.remove();
    }

    if (window.distributionProgressInterval) {
        clearInterval(window.distributionProgressInterval);
    }
}

// ========================================
// Message Handlers (from C# backend)
// ========================================

// Listen for messages from C# backend
console.log('[Distribution] Setting up message listener for C# responses...');
if (window.chrome && window.chrome.webview) {
    console.log('[Distribution] WebView2 available - listener registered');
    window.chrome.webview.addEventListener('message', function(event) {
        console.log('[Distribution] ========================================');
        console.log('[Distribution] Message received from C#:');
        console.log('[Distribution] Message data:', event.data);
        console.log('[Distribution] ========================================');

        const message = event.data;

        console.log('[Distribution] Message type:', message.type);

        switch (message.type) {
            case 'distribution-folder-exists':
                console.log('[Distribution] Routing to: handleDistributionFolderExists');
                handleDistributionFolderExists(message);
                break;

            case 'distribution-download-progress':
                console.log('[Distribution] Routing to: handleDownloadProgress');
                handleDownloadProgress(message);
                break;

            case 'distribution-download-complete':
                console.log('[Distribution] Routing to: handleDownloadComplete');
                handleDownloadComplete(message);
                break;

            case 'distribution-download-failed':
                console.log('[Distribution] Routing to: handleDownloadFailed');
                handleDownloadFailed(message);
                break;

            case 'launch-wms-module':
                console.log('[Distribution] Routing to: handleLaunchWMSModule');
                handleLaunchWMSModule(message);
                break;

            default:
                console.warn('[Distribution] Unknown message type:', message.type);
        }
    });
} else {
    console.error('[Distribution] WebView2 NOT available - cannot register message listener!');
}

function handleDistributionFolderExists(message) {
    console.log('[Distribution] ========================================');
    console.log('[Distribution] handleDistributionFolderExists called');
    console.log('[Distribution] Exists:', message.exists);
    console.log('[Distribution] Folder:', message.folder);
    console.log('[Distribution] ========================================');

    if (message.exists) {
        // Launch index.html from distribution folder
        console.log('[Distribution] Folder exists - launching WMS module...');

        const requestId = 'req_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        const indexPath = distributionConfig.distributionFolder + '\\index.html';

        const launchMessage = {
            action: 'launch-wms-module',
            indexPath: indexPath,
            requestId: requestId
        };

        console.log('[Distribution] Launch message:', launchMessage);

        if (window.chrome && window.chrome.webview) {
            console.log('[Distribution] Sending launch message to C#...');
            window.chrome.webview.postMessage(launchMessage);
            console.log('[Distribution] Launch message sent');
        } else {
            console.error('[Distribution] WebView2 not available!');
        }
    } else {
        console.log('[Distribution] Folder does not exist - prompting user...');
        const download = confirm(
            'WMS module not installed yet.\n\n' +
            'Would you like to download it now?\n' +
            'This will download ~2MB from GitHub.'
        );

        console.log('[Distribution] User response:', download);

        if (download) {
            console.log('[Distribution] User confirmed - calling downloadNewVersion()');
            downloadNewVersion();
        } else {
            console.log('[Distribution] User cancelled');
        }
    }
}

function handleDownloadProgress(message) {
    console.log('[Distribution] Download progress:', message.percent + '%');
    updateProgressBar(message.percent);
}

function handleDownloadComplete(message) {
    console.log('[Distribution] ========================================');
    console.log('[Distribution] Download complete!');
    console.log('[Distribution] Version:', message.version);
    console.log('[Distribution] Folder:', message.folder);
    console.log('[Distribution] ========================================');

    // Update progress to 100%
    updateProgressBar(100);

    // Wait a moment before closing
    setTimeout(() => {
        closeDownloadProgress();

        alert(
            `✅ WMS v${message.version} installed successfully!\n\n` +
            `Location: ${distributionConfig.distributionFolder}\n\n` +
            `Click the WMS button to launch the module.`
        );

        updateDownloadButtonState('Get New Version');
        distributionConfig.isDownloading = false;
    }, 1000);
}

function handleDownloadFailed(message) {
    console.error('[Distribution] Download failed:', message.error);

    closeDownloadProgress();

    alert(
        '❌ Download failed\n\n' +
        `Error: ${message.error}\n\n` +
        'Please check your internet connection and try again.'
    );

    updateDownloadButtonState('Get New Version');
    distributionConfig.isDownloading = false;
}

function handleLaunchWMSModule(message) {
    console.log('[Distribution] WMS module launched:', message.success);

    if (!message.success) {
        alert(
            'Failed to launch WMS module.\n\n' +
            'Please ensure the module is downloaded first.'
        );
    }
}

// ========================================
// Initialize on load
// ========================================

console.log('[Distribution] ========================================');
console.log('[Distribution] Module FULLY loaded');
console.log('[Distribution] Distribution folder:', distributionConfig.distributionFolder);
console.log('[Distribution] Release API:', distributionConfig.githubReleaseAPI);

// Verify functions are defined
console.log('[Distribution] Function check:');
console.log('[Distribution] - launchWMSModule:', typeof launchWMSModule);
console.log('[Distribution] - downloadNewVersion:', typeof downloadNewVersion);
console.log('[Distribution] - updateDownloadButtonState:', typeof updateDownloadButtonState);
console.log('[Distribution] - showDownloadProgress:', typeof showDownloadProgress);

// Make functions globally accessible (in case of scope issues)
window.launchWMSModule = launchWMSModule;
window.downloadNewVersion = downloadNewVersion;

console.log('[Distribution] Functions exposed to window object');
console.log('[Distribution] - window.launchWMSModule:', typeof window.launchWMSModule);
console.log('[Distribution] - window.downloadNewVersion:', typeof window.downloadNewVersion);

// Enable "Get New Version" button now that script is fully loaded
const downloadButton = document.getElementById('btn-download-version');
if (downloadButton) {
    downloadButton.disabled = false;
    downloadButton.style.opacity = '1';
    console.log('[Distribution] ✅ "Get New Version" button enabled');
} else {
    console.warn('[Distribution] ⚠️ "Get New Version" button not found in DOM');
}

console.log('[Distribution] ========================================');

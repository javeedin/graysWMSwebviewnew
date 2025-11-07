// ========================================
// Distribution Manager
// Handles WMS module distribution and updates
// ========================================

let distributionConfig = {
    distributionFolder: 'C:\\fusion\\fusionclientweb\\wms',
    githubReleaseAPI: 'https://raw.githubusercontent.com/javeedin/graysWMSwebviewnew/main/latest-release.json',
    isDownloading: false
};

// ========================================
// Launch WMS Module
// ========================================

function launchWMSModule() {
    console.log('[Distribution] Launching WMS module...');

    // Check if distribution folder exists
    const message = {
        action: 'check-distribution-folder',
        folder: distributionConfig.distributionFolder
    };

    if (window.chrome && window.chrome.webview) {
        window.chrome.webview.postMessage(message);
    } else {
        console.warn('[Distribution] WebView2 not available');
        alert('WMS module not available. Please download the latest version first.');
    }
}

// ========================================
// Download New Version
// ========================================

async function downloadNewVersion() {
    if (distributionConfig.isDownloading) {
        alert('Download already in progress. Please wait...');
        return;
    }

    console.log('[Distribution] Starting download...');

    try {
        distributionConfig.isDownloading = true;

        // Update button state
        updateDownloadButtonState('Checking for updates...');

        // Fetch latest release info
        const response = await fetch(distributionConfig.githubReleaseAPI + '?t=' + Date.now());

        if (!response.ok) {
            throw new Error(`Failed to fetch release info: ${response.status}`);
        }

        const releaseInfo = await response.json();

        console.log('[Distribution] Latest version:', releaseInfo.version);
        console.log('[Distribution] Package URL:', releaseInfo.html_package_url);

        // Confirm download with user
        const confirmMsg = `Download WMS version ${releaseInfo.version}?\n\n` +
                          `This will download and install the latest version to:\n` +
                          `${distributionConfig.distributionFolder}\n\n` +
                          `Size: ~2MB\nTime: ~30 seconds`;

        if (!confirm(confirmMsg)) {
            console.log('[Distribution] Download cancelled by user');
            updateDownloadButtonState('Get New Version');
            distributionConfig.isDownloading = false;
            return;
        }

        // Send download request to C# backend
        updateDownloadButtonState('Downloading...');

        const downloadMessage = {
            action: 'download-distribution',
            version: releaseInfo.version,
            packageUrl: releaseInfo.html_package_url,
            extractTo: distributionConfig.distributionFolder
        };

        if (window.chrome && window.chrome.webview) {
            window.chrome.webview.postMessage(downloadMessage);

            // Show progress message
            showDownloadProgress(releaseInfo.version);
        } else {
            throw new Error('WebView2 not available');
        }

    } catch (error) {
        console.error('[Distribution] Download failed:', error);
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
if (window.chrome && window.chrome.webview) {
    window.chrome.webview.addEventListener('message', function(event) {
        const message = event.data;

        switch (message.type) {
            case 'distribution-folder-exists':
                handleDistributionFolderExists(message);
                break;

            case 'distribution-download-progress':
                handleDownloadProgress(message);
                break;

            case 'distribution-download-complete':
                handleDownloadComplete(message);
                break;

            case 'distribution-download-failed':
                handleDownloadFailed(message);
                break;

            case 'launch-wms-module':
                handleLaunchWMSModule(message);
                break;
        }
    });
}

function handleDistributionFolderExists(message) {
    console.log('[Distribution] Folder check result:', message.exists);

    if (message.exists) {
        // Launch index.html from distribution folder
        const launchMessage = {
            action: 'launch-wms-module',
            indexPath: distributionConfig.distributionFolder + '\\index.html'
        };

        if (window.chrome && window.chrome.webview) {
            window.chrome.webview.postMessage(launchMessage);
        }
    } else {
        const download = confirm(
            'WMS module not installed yet.\n\n' +
            'Would you like to download it now?\n' +
            'This will download ~2MB from GitHub.'
        );

        if (download) {
            downloadNewVersion();
        }
    }
}

function handleDownloadProgress(message) {
    console.log('[Distribution] Download progress:', message.percent);
    updateProgressBar(message.percent);
}

function handleDownloadComplete(message) {
    console.log('[Distribution] Download complete!');

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

console.log('[Distribution] Module loaded');
console.log('[Distribution] Distribution folder:', distributionConfig.distributionFolder);
console.log('[Distribution] Release API:', distributionConfig.githubReleaseAPI);

// ========================================
// Update Manager
// Handles automatic updates for HTML/JS files and EXE
// ========================================

let updateConfig = {
    githubReleaseAPI: '',
    autoUpdateHTML: true,
    autoUpdateEXE: false,
    checkIntervalMinutes: 60,
    currentVersion: '1.1.0'
};

let updateCheckTimer = null;
let latestReleaseInfo = null;

// ========================================
// Initialize Update Manager
// ========================================

async function initUpdateManager() {
    console.log('[UpdateManager] Initializing...');

    // Load config
    try {
        const configResponse = await fetch('config.json');
        const config = await configResponse.json();

        updateConfig = {
            githubReleaseAPI: config.GITHUB_RELEASE_API || '',
            autoUpdateHTML: config.AUTO_UPDATE_HTML !== false,
            autoUpdateEXE: config.AUTO_UPDATE_EXE === true,
            checkIntervalMinutes: config.UPDATE_CHECK_INTERVAL_MINUTES || 60,
            currentVersion: config.APP_VERSION || '1.1.0'
        };

        console.log('[UpdateManager] Configuration loaded:', updateConfig);
    } catch (error) {
        console.error('[UpdateManager] Failed to load config:', error);
    }

    // Check for updates on startup
    if (updateConfig.githubReleaseAPI) {
        await checkForUpdates();

        // Set up periodic update checks
        if (updateConfig.checkIntervalMinutes > 0) {
            updateCheckTimer = setInterval(
                checkForUpdates,
                updateConfig.checkIntervalMinutes * 60 * 1000
            );
            console.log(`[UpdateManager] Periodic checks enabled (every ${updateConfig.checkIntervalMinutes} minutes)`);
        }
    } else {
        console.warn('[UpdateManager] GitHub Release API not configured');
    }

    // Add update notification UI to the page
    injectUpdateNotificationUI();
}

// ========================================
// Check for Updates
// ========================================

async function checkForUpdates() {
    if (!updateConfig.githubReleaseAPI) {
        return;
    }

    console.log('[UpdateManager] Checking for updates...');

    try {
        // Fetch latest release info from GitHub
        const response = await fetch(updateConfig.githubReleaseAPI + '?t=' + Date.now());

        if (!response.ok) {
            console.error('[UpdateManager] Failed to fetch release info:', response.status);
            return;
        }

        const releaseInfo = await response.json();
        latestReleaseInfo = releaseInfo;

        console.log('[UpdateManager] Latest release:', releaseInfo.version);
        console.log('[UpdateManager] Current version:', updateConfig.currentVersion);

        // Compare versions
        if (isNewerVersion(releaseInfo.version, updateConfig.currentVersion)) {
            console.log('[UpdateManager] 🎉 New version available:', releaseInfo.version);
            showUpdateNotification(releaseInfo);
        } else {
            console.log('[UpdateManager] ✓ Up to date');
            hideUpdateNotification();
        }

    } catch (error) {
        console.error('[UpdateManager] Error checking for updates:', error);
    }
}

// ========================================
// Version Comparison
// ========================================

function isNewerVersion(remoteVersion, localVersion) {
    // Compare semantic versions (MAJOR.MINOR.PATCH)
    const remote = remoteVersion.split('.').map(Number);
    const local = localVersion.split('.').map(Number);

    for (let i = 0; i < 3; i++) {
        if (remote[i] > local[i]) return true;
        if (remote[i] < local[i]) return false;
    }

    return false; // Versions are equal
}

// ========================================
// Update Notification UI
// ========================================

function injectUpdateNotificationUI() {
    // Create notification banner (hidden by default)
    const banner = document.createElement('div');
    banner.id = 'update-notification';
    banner.className = 'update-notification hidden';
    banner.innerHTML = `
        <div class="update-notification-content">
            <div class="update-notification-icon">🎉</div>
            <div class="update-notification-text">
                <strong>New version available!</strong>
                <span id="update-version-text"></span>
            </div>
            <div class="update-notification-actions">
                <button id="btn-view-changelog" class="btn-update-secondary">
                    View Changelog
                </button>
                <button id="btn-download-update" class="btn-update-primary">
                    Download Update
                </button>
                <button id="btn-dismiss-update" class="btn-update-dismiss">
                    ✕
                </button>
            </div>
        </div>
    `;

    document.body.insertBefore(banner, document.body.firstChild);

    // Add event listeners
    document.getElementById('btn-view-changelog').addEventListener('click', viewChangelog);
    document.getElementById('btn-download-update').addEventListener('click', downloadAndApplyUpdate);
    document.getElementById('btn-dismiss-update').addEventListener('click', hideUpdateNotification);

    // Add CSS styles
    injectUpdateStyles();
}

function injectUpdateStyles() {
    const style = document.createElement('style');
    style.textContent = `
        .update-notification {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 1rem;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            z-index: 10000;
            animation: slideDown 0.3s ease-out;
            transition: transform 0.3s ease-out;
        }

        .update-notification.hidden {
            display: none;
        }

        .update-notification-content {
            max-width: 1200px;
            margin: 0 auto;
            display: flex;
            align-items: center;
            gap: 1rem;
        }

        .update-notification-icon {
            font-size: 2rem;
            line-height: 1;
        }

        .update-notification-text {
            flex: 1;
            display: flex;
            flex-direction: column;
            gap: 0.25rem;
        }

        .update-notification-text strong {
            font-size: 1rem;
            font-weight: 600;
        }

        .update-notification-text span {
            font-size: 0.875rem;
            opacity: 0.9;
        }

        .update-notification-actions {
            display: flex;
            gap: 0.5rem;
            align-items: center;
        }

        .btn-update-primary,
        .btn-update-secondary,
        .btn-update-dismiss {
            padding: 0.5rem 1rem;
            border: none;
            border-radius: 6px;
            font-size: 0.875rem;
            font-weight: 500;
            cursor: pointer;
            transition: all 0.2s;
        }

        .btn-update-primary {
            background: white;
            color: #667eea;
        }

        .btn-update-primary:hover {
            transform: translateY(-1px);
            box-shadow: 0 4px 12px rgba(0,0,0,0.2);
        }

        .btn-update-secondary {
            background: rgba(255,255,255,0.2);
            color: white;
            border: 1px solid rgba(255,255,255,0.3);
        }

        .btn-update-secondary:hover {
            background: rgba(255,255,255,0.3);
        }

        .btn-update-dismiss {
            background: transparent;
            color: white;
            padding: 0.25rem 0.5rem;
            font-size: 1.25rem;
            line-height: 1;
        }

        .btn-update-dismiss:hover {
            background: rgba(255,255,255,0.2);
        }

        @keyframes slideDown {
            from {
                transform: translateY(-100%);
            }
            to {
                transform: translateY(0);
            }
        }

        /* Adjust main content to account for notification banner */
        body.update-notification-visible {
            padding-top: 80px;
        }
    `;

    document.head.appendChild(style);
}

function showUpdateNotification(releaseInfo) {
    const notification = document.getElementById('update-notification');
    if (!notification) return;

    const versionText = document.getElementById('update-version-text');
    versionText.textContent = `Version ${releaseInfo.version} is ready to install`;

    notification.classList.remove('hidden');
    document.body.classList.add('update-notification-visible');
}

function hideUpdateNotification() {
    const notification = document.getElementById('update-notification');
    if (!notification) return;

    notification.classList.add('hidden');
    document.body.classList.remove('update-notification-visible');
}

// ========================================
// Update Actions
// ========================================

function viewChangelog() {
    if (!latestReleaseInfo || !latestReleaseInfo.changelog_url) {
        alert('Changelog not available');
        return;
    }

    // Open changelog in default browser
    if (window.chrome && window.chrome.webview) {
        window.chrome.webview.postMessage({
            action: 'open-url',
            url: latestReleaseInfo.changelog_url
        });
    } else {
        window.open(latestReleaseInfo.changelog_url, '_blank');
    }
}

async function downloadAndApplyUpdate() {
    if (!latestReleaseInfo) {
        alert('No update information available');
        return;
    }

    const updateBtn = document.getElementById('btn-download-update');
    const originalText = updateBtn.textContent;

    try {
        updateBtn.disabled = true;
        updateBtn.textContent = 'Downloading...';

        console.log('[UpdateManager] Starting update download...');

        // Request C# backend to download and apply update
        const message = {
            action: 'download-update',
            version: latestReleaseInfo.version,
            htmlPackageUrl: latestReleaseInfo.html_package_url,
            exeUrl: latestReleaseInfo.exe_url
        };

        if (window.chrome && window.chrome.webview) {
            window.chrome.webview.postMessage(message);

            updateBtn.textContent = 'Installing...';

            // Show success message
            setTimeout(() => {
                alert('Update downloaded successfully! The application will reload to apply changes.');

                // Reload the application to use new files
                location.reload();
            }, 1000);
        } else {
            // Fallback: Manual download
            console.warn('[UpdateManager] WebView2 not available, opening download URL');
            window.open(latestReleaseInfo.html_package_url, '_blank');

            updateBtn.textContent = originalText;
            updateBtn.disabled = false;

            alert('Please extract the downloaded files to the application directory and restart.');
        }

    } catch (error) {
        console.error('[UpdateManager] Error downloading update:', error);
        alert('Failed to download update. Please try again later.');

        updateBtn.textContent = originalText;
        updateBtn.disabled = false;
    }
}

// ========================================
// Manual Update Check
// ========================================

async function manualCheckForUpdates() {
    console.log('[UpdateManager] Manual update check requested');

    const result = await checkForUpdates();

    if (!latestReleaseInfo) {
        alert('Unable to check for updates. Please check your internet connection.');
        return;
    }

    if (!isNewerVersion(latestReleaseInfo.version, updateConfig.currentVersion)) {
        alert(`You're running the latest version (${updateConfig.currentVersion})`);
    }
}

// ========================================
// Initialize on load
// ========================================

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initUpdateManager);
} else {
    initUpdateManager();
}

// ========================================
// Settings Page Functions
// ========================================

async function loadSettingsPageData() {
    console.log('[UpdateManager] Loading settings page data');

    try {
        // Load version.json
        const versionResponse = await fetch('version.json?t=' + Date.now());
        const versionData = await versionResponse.json();

        // Update UI
        document.getElementById('current-version-display').textContent = versionData.version || '1.1.0';
        document.getElementById('build-date-display').textContent = versionData.build_date || 'Unknown';

        // Load config.json
        const configResponse = await fetch('config.json?t=' + Date.now());
        const configData = await configResponse.json();

        // Update checkboxes
        document.getElementById('auto-update-html-checkbox').checked = configData.AUTO_UPDATE_HTML !== false;
        document.getElementById('check-updates-on-start-checkbox').checked = configData.CHECK_UPDATES_ON_START !== false;
        document.getElementById('update-interval-input').value = configData.UPDATE_CHECK_INTERVAL_MINUTES || 60;

        // Update status
        if (latestReleaseInfo && isNewerVersion(latestReleaseInfo.version, updateConfig.currentVersion)) {
            document.getElementById('update-status-display').textContent = `Update available: ${latestReleaseInfo.version}`;
            document.getElementById('update-status-display').style.color = '#FF9800';
        } else {
            document.getElementById('update-status-display').textContent = 'Up to date';
            document.getElementById('update-status-display').style.color = '#4CAF50';
        }

        // Update last check time
        const lastCheckTime = localStorage.getItem('last-update-check-time');
        if (lastCheckTime) {
            const date = new Date(parseInt(lastCheckTime));
            document.getElementById('last-update-check-time').textContent = date.toLocaleString();
        } else {
            document.getElementById('last-update-check-time').textContent = 'Never';
        }

    } catch (error) {
        console.error('[UpdateManager] Error loading settings page:', error);
    }
}

async function saveUpdateSettings() {
    console.log('[UpdateManager] Saving update settings');

    try {
        const autoUpdateHTML = document.getElementById('auto-update-html-checkbox').checked;
        const checkOnStart = document.getElementById('check-updates-on-start-checkbox').checked;
        const interval = parseInt(document.getElementById('update-interval-input').value);

        // Update in-memory config
        updateConfig.autoUpdateHTML = autoUpdateHTML;
        updateConfig.checkIntervalMinutes = interval;

        // Update config.json through C# backend
        const message = {
            action: 'save-update-settings',
            autoUpdateHTML: autoUpdateHTML,
            checkUpdatesOnStart: checkOnStart,
            updateIntervalMinutes: interval
        };

        if (window.chrome && window.chrome.webview) {
            window.chrome.webview.postMessage(message);
        }

        // Restart update timer with new interval
        if (updateCheckTimer) {
            clearInterval(updateCheckTimer);
        }

        if (interval > 0) {
            updateCheckTimer = setInterval(
                checkForUpdates,
                interval * 60 * 1000
            );
        }

        alert('Settings saved successfully!');

    } catch (error) {
        console.error('[UpdateManager] Error saving settings:', error);
        alert('Failed to save settings. Please try again.');
    }
}

// Listen for menu navigation to settings page
document.addEventListener('DOMContentLoaded', function() {
    const menuItems = document.querySelectorAll('.menu-item');
    menuItems.forEach(item => {
        item.addEventListener('click', function() {
            const pageId = this.getAttribute('data-page');
            if (pageId === 'settings') {
                // Load settings page data when settings page is opened
                setTimeout(loadSettingsPageData, 100);
            }
        });
    });
});

// Update last check time after each check
const originalCheckForUpdates = checkForUpdates;
checkForUpdates = async function() {
    await originalCheckForUpdates();
    localStorage.setItem('last-update-check-time', Date.now().toString());
};

console.log('[UpdateManager] Module loaded');

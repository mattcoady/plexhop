// Popup script for PlexHop

document.addEventListener('DOMContentLoaded', () => {
  const tokenInput = document.getElementById('plexToken');
  const autoSyncCheckbox = document.getElementById('autoSyncToken');
  const modeSelect = document.getElementById('preferredMode');
  const newTabCheckbox = document.getElementById('openInNewTab');
  const showSidebarCheckbox = document.getElementById('showSidebarButton');
  const showWatchPanelCheckbox = document.getElementById('showWatchPanel');
  const showDetailsLinkCheckbox = document.getElementById('showDetailsLink');
  const showImdbButtonCheckbox = document.getElementById('showImdbButton');

  const saveBtn = document.getElementById('saveBtn');
  const testBtn = document.getElementById('testBtn');
  const clearCacheBtn = document.getElementById('clearCacheBtn');
  const statusMsg = document.getElementById('statusMessage');

  document.getElementById('versionLabel').textContent = 'v' + chrome.runtime.getManifest().version;

  let statusTimeout = null;

  // lines: array of strings, or {text, strong} segments per line
  function showStatus(lines, type = 'info', timeout = 6000) {
    if (statusTimeout) {
      clearTimeout(statusTimeout);
      statusTimeout = null;
    }

    statusMsg.textContent = '';
    const lineList = Array.isArray(lines) ? lines : [lines];
    lineList.forEach((line, i) => {
      if (i > 0) statusMsg.appendChild(document.createElement('br'));
      const segments = Array.isArray(line) ? line : [{ text: line }];
      for (const seg of segments) {
        if (seg.strong) {
          const strong = document.createElement('strong');
          strong.textContent = seg.text;
          statusMsg.appendChild(strong);
        } else {
          statusMsg.appendChild(document.createTextNode(seg.text));
        }
      }
    });

    statusMsg.className = `status-msg ${type}`;
    statusMsg.style.display = 'block';

    if (timeout > 0) {
      statusTimeout = setTimeout(() => {
        statusMsg.style.display = 'none';
      }, timeout);
    }
  }

  // Load existing settings
  chrome.storage.local.get([
    'plexToken',
    'autoSyncToken',
    'openInNewTab',
    'preferredMode',
    'showSidebarButton',
    'showWatchPanel',
    'showDetailsLink',
    'showImdbButton'
  ], (items) => {
    if (items.plexToken) tokenInput.value = items.plexToken;
    autoSyncCheckbox.checked = items.autoSyncToken === true;
    if (items.preferredMode) modeSelect.value = items.preferredMode;
    if (typeof items.openInNewTab !== 'undefined') newTabCheckbox.checked = items.openInNewTab;
    if (typeof items.showSidebarButton !== 'undefined') showSidebarCheckbox.checked = items.showSidebarButton;
    if (typeof items.showWatchPanel !== 'undefined') showWatchPanelCheckbox.checked = items.showWatchPanel;
    if (typeof items.showDetailsLink !== 'undefined') showDetailsLinkCheckbox.checked = items.showDetailsLink;
    if (typeof items.showImdbButton !== 'undefined') showImdbButtonCheckbox.checked = items.showImdbButton;
  });

  // Save settings
  saveBtn.addEventListener('click', () => {
    chrome.storage.local.set({
      plexToken: tokenInput.value.trim(),
      autoSyncToken: autoSyncCheckbox.checked,
      preferredMode: modeSelect.value,
      openInNewTab: newTabCheckbox.checked,
      showSidebarButton: showSidebarCheckbox.checked,
      showWatchPanel: showWatchPanelCheckbox.checked,
      showDetailsLink: showDetailsLinkCheckbox.checked,
      showImdbButton: showImdbButtonCheckbox.checked
    }, () => {
      showStatus('✓ Settings saved successfully!', 'success', 3000);
    });
  });

  // Test Plex Token & Servers (the actual requests run in the background worker)
  testBtn.addEventListener('click', async () => {
    const token = tokenInput.value.trim();
    if (!token) {
      showStatus('⚠️ Please enter a Plex Token first to test.', 'error', 4000);
      return;
    }

    testBtn.disabled = true;
    testBtn.textContent = 'Testing...';
    showStatus('⏳ Checking Plex account & servers...', 'info', 0);

    try {
      const result = await chrome.runtime.sendMessage({ action: 'testToken', token });

      if (!result || result.error) {
        showStatus(`❌ Network error: ${result?.error || 'no response'}`, 'error', 6000);
      } else if (!result.ok) {
        showStatus([
          [{ text: '❌ ' }, { text: 'Invalid Plex Token', strong: true }, { text: ' (401 Unauthorized). Please check the token.' }]
        ], 'error', 8000);
      } else {
        const lines = [
          [{ text: '✓ Connected as ' }, { text: result.username || 'Plex User', strong: true }, { text: '!' }]
        ];
        if (result.serverNames && result.serverNames.length > 0) {
          lines.push([{ text: '📡 Detected Server: ' }, { text: result.serverNames.join(', '), strong: true }]);
        }
        lines.push('✨ Ready to link your movies with Plex!');
        showStatus(lines, 'success', 8000);
      }
    } catch (e) {
      console.error('Test error:', e);
      showStatus(`❌ Network error: ${e.message}`, 'error', 6000);
    } finally {
      testBtn.disabled = false;
      testBtn.textContent = 'Test Token & Server';
    }
  });

  // Clear cached film -> Plex URL mappings (stored in chrome.storage.local)
  clearCacheBtn.addEventListener('click', () => {
    chrome.storage.local.get(null, (items) => {
      const cacheKeys = Object.keys(items).filter(k => k.startsWith('cacheTarget_'));
      if (cacheKeys.length === 0) {
        showStatus('ℹ️ No cached film mappings to clear.', 'info', 3000);
        return;
      }
      chrome.storage.local.remove(cacheKeys, () => {
        showStatus(`ℹ️ Cleared ${cacheKeys.length} cached film mappings.`, 'info', 3000);
      });
    });
  });
});

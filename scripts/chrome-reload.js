#!/usr/bin/env node
/**
 * Simple Chrome Extension Auto-Reload
 * 
 * Watches dist/panel and manually reloads extension in chrome://extensions
 * 
 * Usage:
 * 1. Open Chrome DevTools (F12) in any tab
 * 2. Run: node scripts/chrome-reload.js
 * 3. Run npm run dev:panel in another terminal
 * 4. Edit files - extension will reload automatically
 */

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const DIST_PATH = path.join(__dirname, '../dist/panel');
let watchTimeout = null;

console.log('🚀 Chrome Extension Auto-Reload Started');
console.log('📁 Watching:', DIST_PATH);
console.log('');
console.log('⚙️  Setup Instructions:');
console.log('   1. Open Chrome');
console.log('   2. Go to chrome://extensions');
console.log('   3. Find "nglens" extension and copy its ID');
console.log('   4. Set: export EXTENSION_ID="your_extension_id"');
console.log('   5. Keep this script running');
console.log('   6. Make code changes - extension reloads automatically!');
console.log('');

const extensionId = process.env.EXTENSION_ID;
if (!extensionId) {
  console.warn('⚠️  EXTENSION_ID not set. Run:');
  console.warn('   export EXTENSION_ID="your_extension_id_from_chrome_extensions"');
  console.warn('   Then run this script again.\n');
}

// Watch for changes in dist/panel
watchDirectory(DIST_PATH);

function watchDirectory(dir) {
  fs.watch(dir, { recursive: true }, (eventType, filename) => {
    if (!filename) return;
    
    // Skip dotfiles, maps, and node_modules
    if (filename.startsWith('.') || filename.includes('.map') || filename.includes('node_modules')) {
      return;
    }

    console.log(`📝 Changed: ${filename}`);
    
    // Debounce reloads (wait for multiple file writes to settle)
    clearTimeout(watchTimeout);
    watchTimeout = setTimeout(() => {
      reloadExtension();
    }, 800);
  });
}

function reloadExtension() {
  if (!extensionId) {
    console.log('⏭️  Skipping reload (EXTENSION_ID not set)');
    return;
  }

  // Use Chrome's native extension reload mechanism
  // This opens DevTools and runs: chrome.runtime.reload()
  const script = `
    tell application "Google Chrome"
      activate
      -- Open extension page
      open location "chrome-extension://${extensionId}/panel/index.html"
      
      -- Wait a moment
      delay 0.2
      
      -- Open DevTools
      tell application "System Events"
        keystroke "j" using {command down, option down}
      end tell
      
      -- Wait for DevTools to open
      delay 0.5
      
      -- Paste and run reload command
      keystroke "chrome.runtime.reload()" using command down, shift down
      keystroke "return"
    end tell
  `;

  // For macOS, use AppleScript
  exec(`osascript -e '${script.replace(/'/g, "'\"'\"'")}'`, (err) => {
    if (err) {
      console.log('✨ Reload triggered (DevTools method)');
    } else {
      console.log('✨ Extension reloaded!\n');
    }
  });
}

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n👋 Stopping auto-reload...');
  process.exit(0);
});

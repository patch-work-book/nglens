#!/usr/bin/env node
/**
 * Simple Chrome Extension Auto-Reload
 * 
 * Watches dist/panel and reloads extension in Chrome via AppleScript
 * 
 * Usage:
 * EXTENSION_ID="your_id" npm run dev:watch-reload
 */

import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_PATH = path.join(__dirname, '../dist/panel');
let watchTimeout = null;

console.log('🚀 Chrome Extension Auto-Reload Started');
console.log('📁 Watching:', DIST_PATH);
console.log('');

const extensionId = process.env.EXTENSION_ID;
if (!extensionId) {
  console.error('❌ EXTENSION_ID environment variable not set!');
  console.error('Run: export EXTENSION_ID="your_extension_id"');
  process.exit(1);
}

console.log(`✅ Extension ID: ${extensionId}`);
console.log('');
console.log('Watching for changes... (edit a file to test)');
console.log('');

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
  console.log('♻️  Reloading extension...');
  
  // Use AppleScript to interact with Chrome (macOS only)
  const script = `
    tell application "Google Chrome"
      activate
      delay 0.1
      tell application "System Events"
        -- Cmd+Shift+R to reload extension
        keystroke "r" using {command down, shift down}
      end tell
    end tell
  `;

  exec(`osascript -e '${script.replace(/'/g, "'\"'\"'")}'`, (err) => {
    if (!err) {
      console.log('✨ Extension reloaded in Chrome!\n');
    }
  });
}

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n👋 Stopping auto-reload...');
  process.exit(0);
});

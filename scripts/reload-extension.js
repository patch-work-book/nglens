#!/usr/bin/env node
/**
 * Chrome Extension Auto-Reload Script
 * 
 * Watches dist/panel for changes and sends reload signal to Chrome extension
 * via Chrome DevTools Protocol
 * 
 * Usage: node scripts/reload-extension.js
 */

const fs = require('fs');
const path = require('path');
const http = require('http');

const DIST_PATH = path.join(__dirname, '../dist/panel');
const CHROME_DEBUG_PORT = 9222;
let lastReloadTime = 0;
const RELOAD_DEBOUNCE = 1000; // Wait 1s after last change before reloading

console.log('🔍 Watching for extension changes...');
console.log(`📁 Watching: ${DIST_PATH}`);
console.log('💡 Make sure Chrome is running with: chrome --remote-debugging-port=9222');
console.log('');

// Watch dist/panel for changes
fs.watch(DIST_PATH, { recursive: true }, (eventType, filename) => {
  if (!filename || filename.startsWith('.')) return;
  
  const now = Date.now();
  if (now - lastReloadTime < RELOAD_DEBOUNCE) return;
  lastReloadTime = now;

  console.log(`📝 Changed: ${filename}`);
  triggerExtensionReload();
});

async function triggerExtensionReload() {
  try {
    // Get list of open targets (tabs, extensions, etc)
    const targets = await fetch(`http://localhost:${CHROME_DEBUG_PORT}/json`).then(r => r.json());
    
    // Find extension background page or service worker
    const extensionTarget = targets.find(t => 
      t.type === 'service_worker' || 
      t.type === 'background_page' ||
      t.url?.includes('chrome-extension://') ||
      t.title?.includes('nglens')
    );

    if (!extensionTarget) {
      console.log('⚠️  Extension target not found. Make sure:');
      console.log('   1. Chrome is running with: chrome --remote-debugging-port=9222');
      console.log('   2. nglens extension is loaded in chrome://extensions/');
      return;
    }

    console.log(`✨ Reloading extension: ${extensionTarget.title || extensionTarget.url}`);
    
    // Connect to the extension and reload it
    const wsUrl = extensionTarget.webSocketDebuggerUrl;
    if (!wsUrl) {
      console.log('⚠️  Could not get WebSocket URL for extension');
      return;
    }

    // Use chrome.runtime.reload() via content script injection
    const reloadCommand = {
      id: 1,
      method: 'Runtime.evaluate',
      params: {
        expression: 'chrome.runtime.reload()'
      }
    };

    const ws = require('ws');
    const socket = new ws(wsUrl);
    
    socket.on('open', () => {
      socket.send(JSON.stringify(reloadCommand));
      socket.close();
      console.log('✅ Reload signal sent!\n');
    });

    socket.on('error', (err) => {
      console.error('❌ WebSocket error:', err.message);
    });

  } catch (err) {
    console.error('❌ Error triggering reload:', err.message);
  }
}

// Keep the process running
process.on('SIGINT', () => {
  console.log('\n👋 Stopping extension reloader...');
  process.exit(0);
});

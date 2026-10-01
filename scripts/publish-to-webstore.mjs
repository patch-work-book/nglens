#!/usr/bin/env node
/**
 * Publish ngLens to Chrome Web Store via the Chrome Web Store API.
 * 
 * Prerequisites (set as GitHub secrets):
 *   CWS_CLIENT_ID — OAuth 2.0 Client ID from Google Cloud Console
 *   CWS_CLIENT_SECRET — OAuth 2.0 Client Secret
 *   CWS_REFRESH_TOKEN — Refresh token (obtain once via OAuth flow)
 *   EXTENSION_ID — The Chrome extension ID from the Web Store
 * 
 * Usage:
 *   CWS_CLIENT_ID=xxx CWS_CLIENT_SECRET=yyy CWS_REFRESH_TOKEN=zzz EXTENSION_ID=abc node scripts/publish-to-webstore.mjs
 */
import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '..');
const DIST_DIR = path.join(PROJECT_ROOT, 'dist');

// Validate environment variables
const { CWS_CLIENT_ID, CWS_CLIENT_SECRET, CWS_REFRESH_TOKEN, EXTENSION_ID } = process.env;

if (!CWS_CLIENT_ID || !CWS_CLIENT_SECRET || !CWS_REFRESH_TOKEN || !EXTENSION_ID) {
  console.error('❌ Missing required environment variables:');
  console.error('   - CWS_CLIENT_ID');
  console.error('   - CWS_CLIENT_SECRET');
  console.error('   - CWS_REFRESH_TOKEN');
  console.error('   - EXTENSION_ID');
  process.exit(1);
}

// Read package version
const packageJson = JSON.parse(readFileSync(path.join(PROJECT_ROOT, 'package.json'), 'utf-8'));
const version = packageJson.version;

console.log(`📦 Publishing ngLens v${version} to Chrome Web Store...`);
console.log(`   Extension ID: ${EXTENSION_ID}`);
console.log(`   Dist directory: ${DIST_DIR}`);

try {
  // Use npx to run chrome-webstore-upload (already installed as devDependency)
  const command = [
    'npx',
    'chrome-webstore-upload',
    'upload',
    '--source', DIST_DIR,
    '--extension-id', EXTENSION_ID,
    '--client-id', CWS_CLIENT_ID,
    '--client-secret', CWS_CLIENT_SECRET,
    '--refresh-token', CWS_REFRESH_TOKEN,
  ].join(' ');

  console.log('⏳ Uploading to Chrome Web Store...');
  const output = execSync(command, { encoding: 'utf-8', stdio: 'inherit' });
  
  console.log('✅ Upload successful!');
  console.log(`   Version: ${version}`);
  console.log(`   Extension: ${EXTENSION_ID}`);
  console.log(`   View on store: https://chrome.google.com/webstore/detail/${EXTENSION_ID}`);
  
  // Optionally publish (make it live). Uncomment if you want auto-publish:
  // console.log('📢 Publishing to public (making it live)...');
  // const publishCommand = [
  //   'npx',
  //   'chrome-webstore-upload',
  //   'publish',
  //   '--extension-id', EXTENSION_ID,
  //   '--client-id', CWS_CLIENT_ID,
  //   '--client-secret', CWS_CLIENT_SECRET,
  //   '--refresh-token', CWS_REFRESH_TOKEN,
  // ].join(' ');
  // execSync(publishCommand, { stdio: 'inherit' });
  // console.log('✅ Published to public!');
  
} catch (error) {
  console.error('❌ Upload failed:');
  console.error(error.message);
  process.exit(1);
}

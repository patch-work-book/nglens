#!/usr/bin/env node

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('🔨 ngLens Build Runner');
console.log('======================\n');

const projectRoot = __dirname;

// Verify recommendation-engine.service exists
const serviceFile = path.join(projectRoot, 'src/devtools/panel/app/services/recommendation-engine.service.ts');
if (!fs.existsSync(serviceFile)) {
  console.error(`❌ ERROR: Service file not found at ${serviceFile}`);
  process.exit(1);
}
console.log('✅ recommendation-engine.service.ts verified');

// Clean build cache
console.log('\n🧹 Cleaning build cache...');
const dirsToClean = ['dist', 'out-tsc'];
for (const dir of dirsToClean) {
  const fullPath = path.join(projectRoot, dir);
  if (fs.existsSync(fullPath)) {
    console.log(`  - Removing ${dir}/`);
    try {
      execSync(`rm -rf "${fullPath}"`);
    } catch (e) {
      console.log(`  - Warning: Could not remove ${dir}, continuing...`);
    }
  }
}

console.log('\n🏗️  Running build...');
try {
  // Use the correct Node version from nvm
  const nodePath = '/Users/gowthamb/.nvm/versions/node/v22.22.3/bin';
  const npmPath = path.join(nodePath, 'npm');
  
  console.log(`Using: ${npmPath}`);
  console.log(`Node: ${path.join(nodePath, 'node')} --version`);
  
  // Run the build
  execSync(`${npmPath} run build`, {
    cwd: projectRoot,
    stdio: 'inherit',
    env: { 
      ...process.env, 
      CI: 'false', 
      PATH: `${nodePath}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin`
    }
  });
  
  console.log('\n✅ Build completed successfully!');
  console.log('\n📋 Next steps:');
  console.log('  1. Go to chrome://extensions/');
  console.log('  2. Find ngLens and click refresh');
  console.log('  3. Open DevTools to test');
  
  process.exit(0);
} catch (err) {
  console.error('\n❌ Build failed!');
  console.error(err.message);
  process.exit(1);
}

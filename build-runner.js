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
    execSync(`rm -rf "${fullPath}"`);
  }
}

console.log('\n🏗️  Running build...');
try {
  // Run the build
  execSync('npm run build', {
    cwd: projectRoot,
    stdio: 'inherit',
    env: { ...process.env, CI: 'false' }
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

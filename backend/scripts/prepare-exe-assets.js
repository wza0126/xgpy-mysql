const fs = require('fs');
const path = require('path');

const backendRoot = path.resolve(__dirname, '..');
const projectRoot = path.resolve(backendRoot, '..');
const frontendDist = path.join(projectRoot, 'frontend', 'dist');
const exeAssetsDir = path.join(backendRoot, 'exe-assets');
const targetFrontendDist = path.join(exeAssetsDir, 'frontend-dist');

if (!fs.existsSync(path.join(frontendDist, 'index.html'))) {
  throw new Error('frontend/dist/index.html not found. Run npm run build:frontend first.');
}

fs.rmSync(targetFrontendDist, { recursive: true, force: true });
fs.mkdirSync(exeAssetsDir, { recursive: true });
fs.cpSync(frontendDist, targetFrontendDist, { recursive: true });

console.log(`Copied frontend dist to ${path.relative(projectRoot, targetFrontendDist)}`);

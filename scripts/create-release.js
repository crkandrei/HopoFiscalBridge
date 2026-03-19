#!/usr/bin/env node
// scripts/create-release.js
// Usage: node scripts/create-release.js --version 1.2.0

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');

const args = process.argv.slice(2);
const versionIdx = args.indexOf('--version');
if (versionIdx === -1 || !args[versionIdx + 1]) {
  console.error('Usage: node scripts/create-release.js --version <version>');
  process.exit(1);
}
const version = args[versionIdx + 1];

// Detect GitHub owner from git remote
let repoOwner = '{owner}';
try {
  const remoteUrl = execSync('git config --get remote.origin.url', { encoding: 'utf-8' }).trim();
  const match = remoteUrl.match(/github\.com[:/]([^/]+)/);
  if (match) repoOwner = match[1];
} catch (e) { /* use placeholder if git remote not configured */ }

const root = path.resolve(__dirname, '..');
const tag = `v${version}`;
const zipName = `HopoFiscalBridge-${tag}.zip`;
const zipNameLatest = `HopoFiscalBridge-latest.zip`;
const zipPath = path.join(root, zipName);
const zipPathLatest = path.join(root, zipNameLatest);

console.log(`Building HopoFiscalBridge ${tag}...`);

// 1. Install & build
execSync('npm install', { cwd: root, stdio: 'inherit' });
execSync('npm run build', { cwd: root, stdio: 'inherit' });

// 2. Verify nssm.exe exists
const nssmPath = path.join(root, 'install', 'nssm.exe');
if (!fs.existsSync(nssmPath)) {
  console.error('ERROR: install/nssm.exe not found.');
  console.error('Download from https://nssm.cc/download and place at install/nssm.exe');
  process.exit(1);
}

// 3. Create ZIP
console.log(`Creating ${zipName}...`);
const zip = new AdmZip();

const addDir = (fsPath, zipPath) => {
  if (!fs.existsSync(fsPath)) return;
  zip.addLocalFolder(fsPath, zipPath);
};

addDir(path.join(root, 'dist'), 'dist');
addDir(path.join(root, 'node_modules'), 'node_modules');
zip.addLocalFile(path.join(root, 'package.json'), '');
zip.addLocalFile(path.join(root, '.env.example'), '');
zip.addLocalFile(nssmPath, 'install');
zip.addLocalFile(path.join(root, 'install', 'install.ps1'), 'install');
zip.addLocalFile(path.join(root, 'install', 'uninstall.ps1'), 'install');
zip.addLocalFile(path.join(root, 'install', 'update.ps1'), 'install');
zip.addLocalFile(path.join(root, 'install', 'generate-env.js'), 'install');

zip.writeZip(zipPath);
// Also write a "latest" copy for stable download URL (developer convenience only)
fs.copyFileSync(zipPath, zipPathLatest);
console.log(`Created: ${zipName} + ${zipNameLatest}`);

// 4. Create GitHub Release — upload both versioned and latest ZIPs
console.log(`Creating GitHub Release ${tag}...`);
try {
  execSync(
    `gh release create ${tag} "${zipPath}" "${zipPathLatest}" --title "${tag}" --notes "HopoFiscalBridge ${tag}"`,
    { cwd: root, stdio: 'inherit' }
  );
} finally {
  // 5. Cleanup local ZIPs (always, even on failure)
  try { fs.unlinkSync(zipPath); } catch (e) {}
  try { fs.unlinkSync(zipPathLatest); } catch (e) {}
}

console.log(`\nRelease ${tag} published successfully.`);
console.log(`Download URL: https://github.com/${repoOwner}/HopoFiscalBridge/releases/download/${tag}/${zipName}`);

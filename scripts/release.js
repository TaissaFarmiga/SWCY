/**
 * 水文测验 OTA 一键发布 Pipeline v2.0
 *
 * 流程：
 *   STEP 1: bump version (patch +1)
 *   STEP 2: npm run build
 *   STEP 3: node scripts/pack.js (dist.zip + SHA256 + dist/version.json)
 *   STEP 4: git add package.json dist.zip dist/version.json
 *   STEP 5: git commit -m "release: v2 OTA bundle"
 *   STEP 6: git push
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import { createHash } from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

function log(step, msg) {
  console.log(`[${step}] ${msg}`);
}

function fail(step, err) {
  console.error(`\n❌ [${step}] FAILED:`, err.message || err);
  process.exit(1);
}

/* ================================================================
   STEP 1: Bump version (patch)
   ================================================================ */
const pkgPath = resolve(ROOT, 'package.json');
let pkg;

try {
  pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
} catch (e) {
  fail('STEP 1', e);
}

const [major, minor, patch] = pkg.version.split('.').map(Number);
const newVersion = `${major}.${minor}.${patch + 1}`;
pkg.version = newVersion;

try {
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf-8');
} catch (e) {
  fail('STEP 1', e);
}

log('STEP 1', `Version bumped: v${newVersion}`);

/* ================================================================
   STEP 2: Build
   ================================================================ */
try {
  log('STEP 2', 'Running: npm run build...');
  execSync('npm run build', { cwd: ROOT, stdio: 'inherit' });
  log('STEP 2', 'Build complete');
} catch (e) {
  fail('STEP 2', e);
}

/* ================================================================
   STEP 3: Pack (dist.zip + SHA256 + dist/version.json)
   ================================================================ */
try {
  log('STEP 3', 'Running: node scripts/pack.js...');
  execSync('node scripts/pack.js', { cwd: ROOT, stdio: 'inherit' });
  log('STEP 3', 'Pack complete');
} catch (e) {
  fail('STEP 3', e);
}

/* ================================================================
   Verify SHA256 (cross-check)
   ================================================================ */
const zipPath = resolve(ROOT, 'dist.zip');
const manifestPath = resolve(ROOT, 'dist', 'version.json');

if (!existsSync(zipPath)) {
  fail('VERIFY', 'dist.zip not found after pack');
}
if (!existsSync(manifestPath)) {
  fail('VERIFY', 'dist/version.json not found after pack');
}

try {
  const hash = createHash('sha256');
  hash.update(readFileSync(zipPath));
  const sha256 = hash.digest('hex');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
  if (manifest.sha256 !== sha256) {
    fail('VERIFY', 'SHA256 mismatch between version.json and dist.zip');
  }
  log('VERIFY', 'SHA256 integrity confirmed');
} catch (e) {
  fail('VERIFY', e);
}

/* ================================================================
   STEP 4–6: git add / commit / push
   ================================================================ */
try {
  const status = execSync('git status --porcelain', { cwd: ROOT, encoding: 'utf-8' }).trim();
  if (!status) {
    log('GIT', 'No changes to commit — skipping git steps');
    printSummary();
  } else {
    /* STEP 4: git add */
    try {
      log('STEP 4', 'Running: git add package.json dist.zip dist/version.json');
      execSync('git add package.json dist.zip dist/version.json', { cwd: ROOT, stdio: 'inherit' });
      log('STEP 4', 'Staged release files');
    } catch (e) {
      fail('STEP 4', e);
    }

    /* STEP 5: git commit */
    try {
      const commitMsg = 'release: v2 OTA bundle';
      log('STEP 5', `Running: git commit -m "${commitMsg}"`);
      execSync(`git commit -m "${commitMsg}"`, { cwd: ROOT, stdio: 'inherit' });
      log('STEP 5', 'Committed');
    } catch (e) {
      fail('STEP 5', e);
    }

    /* STEP 6: git push */
    try {
      log('STEP 6', 'Running: git push...');
      execSync('git push', { cwd: ROOT, stdio: 'inherit' });
      log('STEP 6', 'Pushed to remote');
    } catch (e) {
      fail('STEP 6', e);
    }

    printSummary();
  }
} catch (e) {
  fail('GIT', e);
}

function printSummary() {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
  console.log('');
  console.log('═══════════════════════════════════════════');
  console.log('🚀 OTA RELEASE v2 COMPLETE');
  console.log(`📦 Bundle: dist.zip (v${manifest.version})`);
  console.log(`🔐 Integrity: VERIFIED (SHA256: ${manifest.sha256})`);
  console.log('🌐 Ready for Gitee Pages propagation');
  console.log('═══════════════════════════════════════════');
  console.log('');
  console.log('⚠️  MANUAL STEP REQUIRED:');
  console.log('Go to Gitee Pages → Click "Update"');
  console.log('Wait 1~3 minutes for CDN propagation');
  console.log('');
}
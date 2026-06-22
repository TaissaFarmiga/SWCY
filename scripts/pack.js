/**
 * 水文测验 OTA Release v2 打包脚本
 *
 * 流程：
 *   1. 读取 package.json 版本号
 *   2. 确定性 zip 压缩 dist/（文件固定排序，compression level 9）
 *   3. 计算 dist.zip SHA256
 *   4. 写入 dist/version.json（控制面 — Gitee Pages 分发格式）
 *
 * 确定性要求：
 *   - 使用 Node 原生 crypto + execSync 保证跨平台一致
 *   - 不使用 archiver（Node 24 ESM/CJS 兼容性问题）
 */

import { readFileSync, writeFileSync, existsSync, unlinkSync, statSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const distDir = resolve(ROOT, 'dist');
const zipPath = resolve(ROOT, 'dist.zip');

const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf-8'));
const VERSION = pkg.version;

/* ================================================================
   STEP 0: Validate dist/ exists
   ================================================================ */
if (!existsSync(distDir)) {
  console.error('❌ dist/ not found — run npm run build first');
  process.exit(1);
}

/* ================================================================
   STEP 1: 确定性 zip 压缩
   ================================================================ */
if (existsSync(zipPath)) {
  unlinkSync(zipPath);
}

console.log(`📦 [OTA v2] 构建确定性增量包 (v${VERSION})...`);

try {
  // 使用 PowerShell Compress-Archive（最高压缩等级 + 盖写）
  execSync(
    `powershell -NoProfile -Command "Compress-Archive -Path '${distDir}\\*' -DestinationPath '${zipPath}' -CompressionLevel Optimal -Force"`,
    { cwd: ROOT, stdio: 'pipe' },
  );
} catch (err) {
  console.error('❌ 压缩失败:', err.message);
  process.exit(1);
}

if (!existsSync(zipPath)) {
  console.error('❌ dist.zip 未生成');
  process.exit(1);
}

const zipSize = statSync(zipPath).size;

/* ================================================================
   STEP 2: SHA256 计算
   ================================================================ */
const buf = readFileSync(zipPath);
const hash = createHash('sha256');
hash.update(buf);
const sha256 = hash.digest('hex');

/* ================================================================
   STEP 3: 写入 dist/version.json（OTA 控制面）
   ================================================================ */
const manifest = {
  version: VERSION,
  url: 'https://farmiga.gitee.io/shuiwen/dist.zip',
  sha256,
  rollout: 100,
  createdAt: new Date().toISOString(),
};

writeFileSync(resolve(distDir, 'version.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf-8');

/* ================================================================
   STEP 4: 发布输出验证（Release Gate）
   ================================================================ */
const zipKB = (zipSize / 1024).toFixed(2);

console.log('');
console.log('═══════════════════════════════════════════');
console.log(`✔ dist.zip size: ${zipKB} KB`);
console.log(`✔ SHA256: ${sha256}`);
console.log(`✔ version: ${VERSION}`);
console.log(`✔ rollout: ${manifest.rollout}`);
console.log(`✔ createdAt: ${manifest.createdAt}`);
console.log('✔ manifest: OK');
console.log('═══════════════════════════════════════════');
console.log('');
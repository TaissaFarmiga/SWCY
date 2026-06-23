/**
 * uploadToCos.js — 腾讯云 COS 自动化发版脚本
 *
 * 执行流程：
 *   1. 压缩 dist 目录 → .temp/dist.zip
 *   2. 上传 dist.zip 到 COS
 *   3. 生成 version.json 并覆盖上传至 COS
 *   4. 清理 .temp 临时目录
 *
 * 用法：npm run deploy:cloud
 *
 * 配置方式（三选一，优先级递减）：
 *   A. 环境变量（CI/CD 推荐）：
 *      COS_SECRET_ID, COS_SECRET_KEY, COS_BUCKET, COS_REGION
 *   B. 同目录下 cos.config.json：
 *      { "SecretId":"...", "SecretKey":"...", "Bucket":"...", "Region":"..." }
 *   C. 直接修改下方 CONFIG 占位符（仅本地调试用）
 */

import fs from 'fs';
import path from 'path';
import archiver from 'archiver';
import COS from 'cos-nodejs-sdk-v5';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── 配置解析 ───────────────────────────────────────────────
const CONFIG_FILE = path.join(__dirname, 'cos.config.json');

let SecretId, SecretKey, Bucket, Region;

// 1. 环境变量（最高优先级）
if (process.env.COS_SECRET_ID) {
  SecretId = process.env.COS_SECRET_ID;
  SecretKey = process.env.COS_SECRET_KEY;
  Bucket = process.env.COS_BUCKET;
  Region = process.env.COS_REGION;
}
// 2. 配置文件
else if (fs.existsSync(CONFIG_FILE)) {
  const cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
  SecretId = cfg.SecretId;
  SecretKey = cfg.SecretKey;
  Bucket = cfg.Bucket;
  Region = cfg.Region;
}
// 3. 占位符（需替换为真实值）
else {
  console.warn('⚠️  未检测到腾讯云密钥配置！请设置环境变量或创建 scripts/cos.config.json');
  console.warn('   当前使用占位符，上传将失败。');
  // ---------- 占位符：替换为你的真实值 ----------
  SecretId = 'YOUR_SECRET_ID';
  SecretKey = 'YOUR_SECRET_KEY';
  Bucket = 'your-bucket-1234567890';
  Region = 'ap-guangzhou';
  // ------------------------------------------
}

// ─── 路径常量 ───────────────────────────────────────────────
const DIST_DIR = path.join(__dirname, '..', 'dist');
const TEMP_DIR = path.join(__dirname, '..', '.temp');
const ZIP_PATH = path.join(TEMP_DIR, 'dist.zip');

// ─── COS 客户端初始化 ──────────────────────────────────────
const cos = new COS({
  SecretId,
  SecretKey,
  Domain: '{Bucket}.cos.{Region}.myqcloud.com', // 公网默认域名模板
});

// ─── 工具函数 ──────────────────────────────────────────────

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function removeDir(dir) {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** 上传单个文件到 COS，返回 Promise */
function uploadFile(key, localPath) {
  return new Promise((resolve, reject) => {
    cos.putObject(
      {
        Bucket,
        Region,
        Key: key,
        Body: fs.createReadStream(localPath),
        onProgress: (progress) => {
          const pct = Math.round(progress.percent * 100);
          process.stdout.write(`\r  ⏳ ${key} 上传中... ${pct}%`);
        },
      },
      (err, data) => {
        if (err) {
          console.error(`\n  ❌ ${key} 上传失败:`, err.message || err);
          reject(err);
        } else {
          console.log(`\n  ✅ ${key} 上传成功 (${data.statusCode})`);
          resolve(data);
        }
      }
    );
  });
}

/** 压缩 dist 目录为 .temp/dist.zip */
function compressDist() {
  return new Promise((resolve, reject) => {
    ensureDir(TEMP_DIR);

    const output = fs.createWriteStream(ZIP_PATH);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', () => {
      const sizeMB = (archive.pointer() / 1024 / 1024).toFixed(2);
      console.log(`  📦 dist.zip 压缩完成 (${sizeMB} MB)`);
      resolve();
    });

    archive.on('error', (err) => reject(err));

    archive.pipe(output);
    archive.directory(DIST_DIR, false);
    archive.finalize();
  });
}

// ─── 主流程 ─────────────────────────────────────────────────

async function deploy() {
  console.log('🚀 启动 COS 云发版...\n');

  // 0. 前置校验
  if (!fs.existsSync(DIST_DIR)) {
    console.error('❌ dist 目录不存在，请先执行 npm run build');
    process.exit(1);
  }

  // 1. 压缩 dist
  console.log('1/4 压缩构建产物...');
  await compressDist();

  // 2. 上传 dist.zip
  console.log('\n2/4 上传 dist.zip 到 COS...');
  await uploadFile('dist.zip', ZIP_PATH);

  // 3. 生成并上传 version.json（防竞态：zip 成功后才写 version）
  console.log('\n3/4 生成 version.json 并上传...');
  const versionPayload = {
    version: JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf-8')).version,
    timestamp: new Date().toISOString(),
    updateType: process.env.UPDATE_TYPE || 'zip', // zip | apk, 可通过 UPDATE_TYPE=apk 覆盖
    forceUpdate: false,
  };
  const versionPath = path.join(TEMP_DIR, 'version.json');
  fs.writeFileSync(versionPath, JSON.stringify(versionPayload, null, 2));
  await uploadFile('version.json', versionPath);

  // 4. 清理临时文件
  console.log('\n4/4 清理临时目录...');
  removeDir(TEMP_DIR);
  console.log('  🧹 .temp 已清理');

  console.log('\n🎉 发版完成！');
  console.log(`   dist.zip   → https://${Bucket}.cos.${Region}.myqcloud.com/dist.zip`);
  console.log(`   version.json → https://${Bucket}.cos.${Region}.myqcloud.com/version.json`);
}

deploy().catch((err) => {
  console.error('\n💥 发版失败:', err.message || err);

  // 无论成功失败，清理临时目录（防止 .temp 残留）
  removeDir(TEMP_DIR);

  process.exit(1);
});
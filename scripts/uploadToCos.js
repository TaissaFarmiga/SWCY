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
import { execSync } from 'child_process';

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
        Headers: {
          'x-cos-acl': 'public-read', // 🚀 强行将上传的对象设为公有读，防止腾讯云默认私有拦截！
        },
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

// 智能判定：支持环境变量 UPDATE_TYPE=apk 或 命令行传参 --apk
const isApkMode = process.env.UPDATE_TYPE === 'apk' || process.argv.includes('--apk');

async function deploy() {
  console.log('🚀 启动 COS 云发版...\n');

  // 0. 全自动前端构建编译（确保云端 zip 盒本地 APK 里的 Web 代码 100% 为最新）
  console.log('0/4 启动前端 Vite 生产环境构建编译...');
  try {
    execSync('npm run build', { stdio: 'inherit' });
    console.log('   ✅ 前端编译成功！');
  } catch (e) {
    console.error('   ❌ 前端编译失败，发版流终止！');
    process.exit(1);
  }

  // 1. 压缩 dist
  console.log('\n1/4 压缩构建产物...');
  await compressDist();

  // 2. 上传 dist.zip
  console.log('\n2/4 上传 dist.zip 到 COS...');
  await uploadFile('dist.zip', ZIP_PATH);

  // 1.5/4 如果是 APK 模式，启动命令行 Gradle 全自动编译并上传
  if (isApkMode) {
    console.log('\n🛠️  1.5/4 检测到 APK 大版本模式，启动原生底层命令行全自动编译...');
    
    try {
      // A. 自动执行 Capacitor 同步，确保最新的 Web 代码被同步到 Android 原生目录
      console.log('   ⏳ 正在同步最新 Web 代码到 Android 工程...');
      execSync('npx cap sync android', { stdio: 'inherit' });

      // B. 智能判断操作系统，调用对应的 Gradle 编译器执行 assembleRelease
      console.log('   ⏳ 正在调用 Gradle 编译器编译 Release APK...');
      const isWindows = process.platform === 'win32';
      const gradleCmd = isWindows ? 'gradlew.bat assembleRelease' : './gradlew assembleRelease';
      
      // 执行原生编译
      execSync(`cd android && ${gradleCmd}`, { stdio: 'inherit' });
      console.log('   ✅ 原生 APK 命令行编译成功！');

    } catch (e) {
      console.error('\n   ❌ Gradle 编译失败！');
      console.error('      请确保本地 Android SDK 环境变量（ANDROID_HOME）配置正确。');
      process.exit(1);
    }

    // C. 自动搜寻编译产物
    console.log('\n⏳ 正在搜寻编译生成的 APK 安装包...');
    const releaseApkPath = path.join(__dirname, '../android/app/build/outputs/apk/release/app-release.apk');
    const releaseUnsignedPath = path.join(__dirname, '../android/app/build/outputs/apk/release/app-release-unsigned.apk');
    const debugApkPath = path.join(__dirname, '../android/app/build/outputs/apk/debug/app-debug.apk');
    
    let targetApkPath = null;
    if (fs.existsSync(releaseApkPath)) {
      targetApkPath = releaseApkPath;
    } else if (fs.existsSync(releaseUnsignedPath)) {
      targetApkPath = releaseUnsignedPath;
      console.log('   ⚠️ 未发现签名 key，自动使用本地 Unsigned 签名包...');
    } else if (fs.existsSync(debugApkPath)) {
      targetApkPath = debugApkPath;
      console.log('   ⚠️ 未找到 Release 包，自动使用本地 Debug 调试包...');
    } else {
      console.error('\n   ❌ 未在本地输出目录找到任何生成的 APK 文件！');
      process.exit(1);
    }

    // D. 执行全自动云端上传（直接上传原始 app-release.apk 安装包）
    console.log(`   ⏳ 正在将 ${path.basename(targetApkPath)} 自动上传至腾讯云...`);
    await uploadFile('app-release.apk', targetApkPath);
  }

  // 3. 生成并上传 version.json（防竞态：zip 成功后才写 version）
  console.log('\n3/4 生成 version.json 并上传...');
  const versionPayload = {
    version: JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf-8')).version,
    timestamp: new Date().toISOString(),
    updateType: isApkMode ? 'apk' : 'zip', // zip | apk, 可通过 --apk 命令行参数 或 UPDATE_TYPE=apk 环境变量覆盖
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
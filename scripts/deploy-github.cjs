const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const https = require('https');

// 1. 本地免配置沙盒环境注入 (动态获取 Windows 路径，防止系统变量冲突)
const username = os.userInfo().username;
process.env.ANDROID_HOME = `C:\\Users\\${username}\\AppData\\Local\\Android\\Sdk`;

// 💡 智能雷达扫描：自动探测并还原真实的 JAVA_HOME (兼容 jbr/jre 差异及自定义路径)
let javaHome = '';
console.log('🔍 [OTA DEPLOY] 正在启动雷达自检，自动检索本地 JDK 编译环境...');

// 降级策略 1: 扫描 Android Studio 常规内置 JDK 物理路径
const commonAsPaths = [
  `C:\\Program Files\\Android\\Android Studio\\jbr`,
  `C:\\Program Files\\Android\\Android Studio\\jre`,
  `C:\\Program Files(x86)\\Android\\Android Studio\\jbr`,
  `C:\\Program Files(x86)\\Android\\Android Studio\\jre`
];
for (const p of commonAsPaths) {
  if (fs.existsSync(p)) {
    javaHome = p;
    break;
  }
}

// 降级策略 2: 若常规路径未命中，调用 where.exe 在 Android 目录下递归检索 java.exe 并反向推导
if (!javaHome) {
  try {
    const searchPath = `C:\\Program Files\\Android`;
    if (fs.existsSync(searchPath)) {
      const output = execSync(`where.exe /R "${searchPath}" java.exe`, { encoding: 'utf-8', stdio: [] });
      const firstLine = output.split('\n')[0].trim();
      if (firstLine && fs.existsSync(firstLine)) {
        // 从 path\to\bin\java.exe 向上截取两级得到 JAVA_HOME
        javaHome = path.dirname(path.dirname(firstLine));
      }
    }
  } catch (e) {
    // 忽略异常，由后续降级策略继续补位
  }
}

// 降级策略 3: 全局雷达探测
if (!javaHome) {
  try {
    const output = execSync('where.exe java.exe', { encoding: 'utf-8', stdio: [] });
    const firstLine = output.split('\n')[0].trim();
    if (firstLine && fs.existsSync(firstLine)) {
      javaHome = path.dirname(path.dirname(firstLine));
    }
  } catch (e) {
    // 忽略
  }
}

// 降级策略 4: 保底读取系统环境
if (!javaHome && process.env.JAVA_HOME && fs.existsSync(process.env.JAVA_HOME)) {
  javaHome = process.env.JAVA_HOME;
}

if (!javaHome) {
  console.error('❌ [OTA DEPLOY] 雷达自检失败：未能在你的电脑上定位到有效的 Java 编译环境！');
  console.error('👉 请确认是否正常安装了 Android Studio 或者是 JDK 17，并保持默认安装路径。');
  process.exit(1);
}

process.env.JAVA_HOME = javaHome;
process.env.PATH = `${process.env.PATH};${process.env.ANDROID_HOME}\\platform-tools;${process.env.JAVA_HOME}\\bin`;

console.log('🤖 [OTA DEPLOY] 正在启动本地沙盒编译部署系统...');
console.log(`🤖 [OTA DEPLOY] 动态注入 ANDROID_HOME: ${process.env.ANDROID_HOME}`);
console.log(`🤖 [OTA DEPLOY] 雷达探测定位 JAVA_HOME: ${process.env.JAVA_HOME}`);

// 2. 读取并解析 .env
let token = '';
try {
  const envContent = fs.readFileSync('.env', 'utf-8');
  const match = envContent.match(/GITHUB_TOKEN=(ghp_[a-zA-Z0-9]+)/);
  if (match) {
    token = match[1];
  }
} catch (e) {
  console.error('❌ [OTA DEPLOY] 无法读取 .env 文件，请先创建并存入 GITHUB_TOKEN');
  process.exit(1);
}

if (!token || token.includes('请在此处')) {
  console.error('❌ [OTA DEPLOY] 未检测到有效的 GITHUB_TOKEN，请先在 .env 文件中粘贴你的 ghp_ 密钥');
  process.exit(1);
}

// 3. 自动递增版本号并对齐 Android 的 build.gradle
const packageJsonPath = path.join(__dirname, '../package.json');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
const oldVersion = packageJson.version;

const parts = oldVersion.split('.').map(Number);
parts[2] += 1; // 自动递增 Patch 版本号
const newVersion = parts.join('.');
packageJson.version = newVersion;
fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2), 'utf-8');

// 对齐 android/app/build.gradle 中的 versionName
const gradlePath = path.join(__dirname, '../android/app/build.gradle');
try {
  let gradleContent = fs.readFileSync(gradlePath, 'utf-8');
  gradleContent = gradleContent.replace(/versionName\s+"[^"]+"/, `versionName "${newVersion}"`);
  // 同时递增 versionCode (取当前时间戳的前10位，防止溢出)
  const newVersionCode = Math.floor(Date.now() / 100000);
  gradleContent = gradleContent.replace(/versionCode\s+\d+/, `versionCode ${newVersionCode}`);
  fs.writeFileSync(gradlePath, gradleContent, 'utf-8');
  console.log(`✅ [OTA DEPLOY] 版本号成功升级: ${oldVersion} 🚀 ${newVersion} (Code: ${newVersionCode})`);
} catch (err) {
  console.error('❌ [OTA DEPLOY] 对齐 build.gradle 失败，请检查路径:', err.message);
  process.exit(1);
}

// 4. 执行本地物理编译与 Capacitor 同步
try {
  console.log('📦 [OTA DEPLOY] 正在编译 React 生产包...');
  execSync('npm run build', { stdio: 'inherit' });

  console.log('📦 [OTA DEPLOY] 正在同步 Web 资源到 Capacitor...');
  execSync('npx cap sync', { stdio: 'inherit' });

  console.log('📦 [OTA DEPLOY] 正在调用本地 Gradle 编译 APK 大包...');
  // Windows 使用 gradlew.bat，CWD 设为 android 子目录
  execSync('gradlew.bat assembleDebug', { cwd: 'android', stdio: 'inherit', shell: true });
} catch (err) {
  console.error('❌ [OTA DEPLOY] 编译打包过程中发生异常，中断发布！');
  process.exit(1);
}

// 5. 验证编译包物理存在
const apkPath = path.join(__dirname, '../android/app/build/outputs/apk/debug/app-debug.apk');
if (!fs.existsSync(apkPath)) {
  console.error('❌ [OTA DEPLOY] 编译成功但未找到生成的 APK 包，请检查 Android 项目配置');
  process.exit(1);
}
console.log('✅ [OTA DEPLOY] APK 物理大包生成成功！');

// 6. 执行 Git Commit 与 Push Tag
try {
  console.log('🚀 [OTA DEPLOY] 正在提交本地更改并推送 Tag...');
  execSync('git add .', { stdio: 'inherit' });
  execSync(`git commit -m "feat: 自动化升级至 v${newVersion}"`, { stdio: 'inherit' });
  execSync(`git tag v${newVersion}`, { stdio: 'inherit' });
  execSync('git push origin main', { stdio: 'inherit' });
  execSync(`git push origin v${newVersion}`, { stdio: 'inherit' });
} catch (err) {
  console.warn('⚠️ [OTA DEPLOY] Git 推送失败（可能是没有需要提交的内容或远程冲突），继续执行 API 发布...', err.message);
}

// 7. 调用 GitHub API 自动创建 Release 并上传资源 (纯原生 Node https 请求)
const repoOwner = 'TaissaFarmiga';
const repoName = 'SWCY';

const requestOptions = {
  host: 'api.github.com',
  headers: {
    'User-Agent': 'HydroTerminal-Deploy-Script',
    'Authorization': `token ${token}`,
    'Accept': 'application/vnd.github+json',
    'Content-Type': 'application/json'
  }
};

const createReleaseData = JSON.stringify({
  tag_name: `v${newVersion}`,
  name: `${newVersion} 最新版本`,
  body: `v${newVersion}\n\nfeat: 自动化发布更新。`,
  draft: false,
  prerelease: false
});

console.log('🚀 [OTA DEPLOY] 正在向 GitHub 请求创建最新 Release 节点...');

const req = https.request({
  ...requestOptions,
  path: `/repos/${repoOwner}/${repoName}/releases`,
  method: 'POST'
}, (res) => {
  let responseBody = '';
  res.on('data', (chunk) => responseBody += chunk);
  res.on('end', () => {
    if (res.statusCode !== 201) {
      console.error(`❌ [OTA DEPLOY] 创建 Release 失败 (HTTP ${res.statusCode}):`, responseBody);
      process.exit(1);
    }
    const release = JSON.parse(responseBody);
    console.log(`✅ [OTA DEPLOY] GitHub Release 节点创建成功！ID: ${release.id}`);
    
    // 提取上传资源的 host
    const uploadUrlTemplate = release.upload_url;
    const uploadUrl = uploadUrlTemplate.split('{')[0] + `?name=update.apk`;
    
    uploadApkAsset(uploadUrl, apkPath);
  });
});

req.on('error', (err) => {
  console.error('❌ [OTA DEPLOY] 创建 Release 网络请求失败:', err);
});
req.write(createReleaseData);
req.end();

// 上传 APK 附件
function uploadApkAsset(url, filePath) {
  const fileStats = fs.statSync(filePath);
  const fileStream = fs.readFileSync(filePath);
  const parsedUrl = new URL(url);

  console.log(`🚀 [OTA DEPLOY] 正在向 GitHub 满速上传 APK 安装包资产 (${(fileStats.size / 1024 / 1024).toFixed(2)} MB)...`);

  const uploadReq = https.request({
    host: parsedUrl.host,
    path: parsedUrl.pathname + parsedUrl.search,
    method: 'POST',
    headers: {
      'User-Agent': 'HydroTerminal-Deploy-Script',
      'Authorization': `token ${token}`,
      'Accept': 'application/vnd.github+json',
      'Content-Type': 'application/vnd.android.package-archive',
      'Content-Length': fileStats.size
    }
  }, (res) => {
    let responseBody = '';
    res.on('data', (chunk) => responseBody += chunk);
    res.on('end', () => {
      if (res.statusCode === 201) {
        console.log('🎉 [OTA DEPLOY] 全流程大功告成！手机端双轨控制台已准备就绪，点击即可秒级更新！');
      } else {
        console.error(`❌ [OTA DEPLOY] 附件上传失败 (HTTP ${res.statusCode}):`, responseBody);
      }
    });
  });

  uploadReq.on('error', (err) => {
    console.error('❌ [OTA DEPLOY] 上传 APK 网络请求发生崩溃:', err);
  });
  uploadReq.write(fileStream);
  uploadReq.end();
}
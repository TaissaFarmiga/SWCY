const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const APK_RELATIVE_PATH = path.join('android', 'app', 'build', 'outputs', 'apk', 'enterprise', 'release', 'app-enterprise-release.apk');
const REQUIRED_SIGNING_ENV = [
  'HYDRO_KEYSTORE_PATH',
  'HYDRO_KEYSTORE_PASSWORD',
  'HYDRO_KEY_ALIAS',
  'HYDRO_KEY_PASSWORD',
];

const HELP = `
前向回退包构建。不会修改当前项目工作区，不会 push 或发布 GitHub Release。

用法：
  npm run build:android:forward-rollback -- --ref <Git-ref> --version <x.y.z> --output <项目外目录> [--keystore-properties <文件>]

参数：
  --ref <Git-ref>                 需回退到的已提交源码，例如 backup/v1.10.26-pre-mobile-ux-20260730
  --version <x.y.z>               新 APK 版本，必须高于当前工作区与目标源码版本
  --output <目录>                  APK 输出目录。必须位于当前项目目录之外
  --keystore-properties <文件>    可选。临时复制到 worktree 的正式签名配置；storeFile 必须为绝对路径
  --help                          显示本帮助

也可使用环境变量：
  HYDRO_KEYSTORE_PATH HYDRO_KEYSTORE_PASSWORD HYDRO_KEY_ALIAS HYDRO_KEY_PASSWORD

示例：
  npm run build:android:forward-rollback -- --ref backup/v1.10.26-pre-mobile-ux-20260730 --version 1.10.28 --output D:\\Releases\\Hydro

说明：
  Android 不能覆盖安装更低 versionCode。此工具从旧源码构建更高版本号 APK，属于前向回退。
`;

function fail(message) {
  throw new Error(message);
}

function commandName(name) {
  return process.platform === 'win32' ? `${name}.cmd` : name;
}

function run(command, args, options = {}) {
  const requiresWindowsShell = process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(command);
  const result = spawnSync(command, args, {
    cwd: options.cwd || PROJECT_ROOT,
    env: options.env || process.env,
    encoding: 'utf8',
    stdio: options.capture ? 'pipe' : 'inherit',
    shell: requiresWindowsShell,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const details = options.capture ? `\n${result.stderr || result.stdout || ''}` : '';
    fail(`${command} ${args.join(' ')} 失败，退出码 ${result.status}${details}`);
  }
  return options.capture ? (result.stdout || '').trim() : '';
}

function git(args, options = {}) {
  return run('git', args, options);
}

function parseArguments(argv) {
  const options = { ref: '', version: '', output: '', keystoreProperties: '' };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help' || argument === '-h') return { help: true };
    const key = argument === '--ref' ? 'ref'
      : argument === '--version' ? 'version'
        : argument === '--output' ? 'output'
          : argument === '--keystore-properties' ? 'keystoreProperties'
            : null;
    if (!key) fail(`未知参数：${argument}\n${HELP}`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) fail(`${argument} 缺少值\n${HELP}`);
    options[key] = value;
    index += 1;
  }
  for (const [key, value] of Object.entries(options)) {
    if (!value && key !== 'keystoreProperties') fail(`缺少 --${key === 'keystoreProperties' ? 'keystore-properties' : key}\n${HELP}`);
  }
  return options;
}

function parseVersion(value, label) {
  const match = String(value).trim().match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) fail(`${label} 必须为 x.y.z：${value}`);
  const parts = match.slice(1).map(Number);
  if (parts.some((part) => !Number.isSafeInteger(part) || part < 0)) fail(`${label} 包含无效数值：${value}`);
  if (parts[1] > 99 || parts[2] > 99) fail(`${label} 的次版本号和修订号必须小于等于 99，避免当前 versionCode 映射冲突：${value}`);
  const normalized = parts.join('.');
  const code = parts[0] * 10000 + parts[1] * 100 + parts[2];
  if (!Number.isSafeInteger(code) || code <= 0 || code > 2_100_000_000) fail(`${label} 生成的 versionCode 无效：${code}`);
  return { normalized, parts, code };
}

function compareVersions(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left.parts[index] !== right.parts[index]) return left.parts[index] > right.parts[index] ? 1 : -1;
  }
  return 0;
}

function pathIsInside(parent, child) {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function resolveCommit(ref) {
  const result = git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], { capture: true });
  if (!/^[0-9a-f]{40}$/i.test(result)) fail(`Git ref 无法解析为提交：${ref}`);
  return result;
}

function assertSigningInput(options) {
  const environmentReady = REQUIRED_SIGNING_ENV.every((name) => process.env[name]?.trim());
  if (!options.keystoreProperties && !environmentReady) {
    fail(`缺少正式签名。设置 ${REQUIRED_SIGNING_ENV.join('、')}，或传入 --keystore-properties。`);
  }
  if (!options.keystoreProperties) return null;

  const propertiesPath = path.resolve(options.keystoreProperties);
  if (!fs.existsSync(propertiesPath) || !fs.statSync(propertiesPath).isFile()) {
    fail(`keystore.properties 不存在：${propertiesPath}`);
  }
  const text = fs.readFileSync(propertiesPath, 'utf8');
  const storeFile = text.match(/^\s*storeFile\s*=\s*(.+?)\s*$/m)?.[1];
  if (!storeFile || !path.isAbsolute(storeFile)) {
    fail('--keystore-properties 中 storeFile 必须为绝对路径；或改用 HYDRO_* 环境变量。');
  }
  return propertiesPath;
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(HELP);
    return;
  }

  const outputDirectory = path.resolve(options.output);
  if (pathIsInside(PROJECT_ROOT, outputDirectory)) {
    fail(`--output 必须位于当前项目目录之外：${PROJECT_ROOT}`);
  }
  const currentPackage = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'package.json'), 'utf8'));
  const currentVersion = parseVersion(currentPackage.version, '当前工作区版本');
  const targetVersion = parseVersion(options.version, '目标版本');
  if (compareVersions(targetVersion, currentVersion) <= 0 || targetVersion.code <= currentVersion.code) {
    fail(`目标版本 ${targetVersion.normalized} 必须高于当前工作区 ${currentVersion.normalized}`);
  }
  const signingProperties = assertSigningInput(options);
  const sourceCommit = resolveCommit(options.ref);
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hydro-forward-rollback-'));
  const worktreePath = path.join(temporaryRoot, 'worktree');
  let worktreeAdded = false;

  try {
    process.stdout.write(`[forward-rollback] 创建临时 worktree: ${sourceCommit.slice(0, 12)}\n`);
    git(['worktree', 'add', '--detach', worktreePath, sourceCommit]);
    worktreeAdded = true;

    const sourcePackagePath = path.join(worktreePath, 'package.json');
    const sourcePackage = JSON.parse(fs.readFileSync(sourcePackagePath, 'utf8'));
    const sourceVersion = parseVersion(sourcePackage.version, '目标源码版本');
    if (compareVersions(targetVersion, sourceVersion) <= 0 || targetVersion.code <= sourceVersion.code) {
      fail(`目标版本 ${targetVersion.normalized} 必须高于目标源码 ${sourceVersion.normalized}`);
    }

    process.stdout.write('[forward-rollback] 安装锁定依赖\n');
    run(commandName('npm'), ['ci', '--no-audit', '--fund=false'], { cwd: worktreePath });

    sourcePackage.version = targetVersion.normalized;
    fs.writeFileSync(sourcePackagePath, `${JSON.stringify(sourcePackage, null, 2)}\n`, 'utf8');
    if (signingProperties) {
      fs.copyFileSync(signingProperties, path.join(worktreePath, 'android', 'keystore.properties'));
    }

    process.stdout.write(`[forward-rollback] 构建 enterprise release v${targetVersion.normalized}\n`);
    run(commandName('npm'), ['run', 'build'], { cwd: worktreePath });
    run(commandName('npx'), ['cap', 'sync', 'android'], { cwd: worktreePath });
    run(process.platform === 'win32' ? 'gradlew.bat' : './gradlew', ['assembleEnterpriseRelease', '--no-daemon', '--console=plain'], {
      cwd: path.join(worktreePath, 'android'),
    });

    const builtApk = path.join(worktreePath, APK_RELATIVE_PATH);
    if (!fs.existsSync(builtApk) || fs.statSync(builtApk).size <= 0) fail(`未生成 enterprise release APK：${builtApk}`);

    fs.mkdirSync(outputDirectory, { recursive: true });
    const outputName = `hydro-forward-rollback-v${targetVersion.normalized}-from-${sourceCommit.slice(0, 12)}.apk`;
    const outputApk = path.join(outputDirectory, outputName);
    const outputManifest = path.join(outputDirectory, `${outputName}.json`);
    if (fs.existsSync(outputApk) || fs.existsSync(outputManifest)) fail(`输出文件已存在，拒绝覆盖：${outputApk}`);

    fs.copyFileSync(builtApk, outputApk, fs.constants.COPYFILE_EXCL);
    const digest = sha256(outputApk);
    const manifest = {
      kind: 'hydro-terminal-forward-rollback-build',
      builtAt: new Date().toISOString(),
      sourceRef: options.ref,
      sourceCommit,
      sourceVersion: sourceVersion.normalized,
      currentWorkspaceVersion: currentVersion.normalized,
      targetVersion: targetVersion.normalized,
      targetVersionCode: targetVersion.code,
      flavor: 'enterprise',
      applicationId: 'com.hydro.geekterminal',
      apk: { file: outputName, bytes: fs.statSync(outputApk).size, sha256: digest },
      publishState: 'not-pushed-not-released',
    };
    fs.writeFileSync(outputManifest, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    process.stdout.write(`${JSON.stringify({ apk: outputApk, manifest: outputManifest, sha256: digest }, null, 2)}\n`);
  } finally {
    if (worktreeAdded) {
      try { git(['worktree', 'remove', '--force', worktreePath]); } catch { /* best effort cleanup */ }
    }
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
    try { git(['worktree', 'prune']); } catch { /* best effort cleanup */ }
  }
}

try {
  main();
} catch (error) {
  process.stderr.write(`[forward-rollback] ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}

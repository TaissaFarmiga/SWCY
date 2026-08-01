const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const PROJECT_ROOT = path.resolve(__dirname, '..');

function fail(message) {
  throw new Error(message);
}

function parseArguments(args) {
  const options = { properties: path.join(PROJECT_ROOT, 'android', 'keystore.properties') };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--help') return { help: true };
    if (!['--input', '--output', '--properties'].includes(argument)) fail(`未知参数：${argument}`);
    const value = args[index + 1];
    if (!value || value.startsWith('--')) fail(`${argument} 缺少值`);
    options[argument.slice(2)] = value;
    index += 1;
  }
  if (!options.input || !options.output) fail('必须提供 --input 和 --output');
  return options;
}

function decodeProperty(value) {
  let output = '';
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character !== '\\') {
      output += character;
      continue;
    }
    index += 1;
    if (index >= value.length) {
      output += '\\';
      break;
    }
    const escaped = value[index];
    if (escaped === 't') output += '\t';
    else if (escaped === 'r') output += '\r';
    else if (escaped === 'n') output += '\n';
    else if (escaped === 'f') output += '\f';
    else if (escaped === 'u') {
      const hex = value.slice(index + 1, index + 5);
      if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail('keystore.properties 包含无效 Unicode 转义');
      output += String.fromCharCode(Number.parseInt(hex, 16));
      index += 4;
    } else output += escaped;
  }
  return output;
}

function readProperties(filePath) {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) fail(`签名配置不存在：${filePath}`);
  const properties = {};
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    if (!line.trim() || /^\s*[#!]/.test(line)) continue;
    const match = line.match(/^\s*([^=:]+?)\s*[=:]\s*(.*)$/);
    if (!match) continue;
    properties[decodeProperty(match[1].trim())] = decodeProperty(match[2]);
  }
  return properties;
}

function resolveConfiguredFile(value, propertiesPath, label) {
  if (!value?.trim()) fail(`缺少 ${label}`);
  const resolved = path.isAbsolute(value) ? path.normalize(value) : path.resolve(path.dirname(propertiesPath), value);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) fail(`${label} 不存在：${resolved}`);
  return resolved;
}

function resolveAndroidSdk(properties) {
  const localSdk = properties.sdkDir || '';
  const candidates = [
    process.env.ANDROID_SDK_ROOT,
    process.env.ANDROID_HOME,
    localSdk,
    process.platform === 'win32' ? 'D:\\Android\\SDK' : '',
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Android', 'Sdk') : '',
  ].filter(Boolean).map((candidate) => path.resolve(candidate));
  const sdk = candidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isDirectory());
  if (!sdk) fail('Android SDK 不存在');
  return sdk;
}

function compareBuildTools(left, right) {
  const a = left.split('.').map((part) => Number.parseInt(part, 10) || 0);
  const b = right.split('.').map((part) => Number.parseInt(part, 10) || 0);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    if ((a[index] || 0) !== (b[index] || 0)) return (b[index] || 0) - (a[index] || 0);
  }
  return 0;
}

function resolveApksignerJar(androidSdk) {
  const buildToolsRoot = path.join(androidSdk, 'build-tools');
  const versions = fs.readdirSync(buildToolsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort(compareBuildTools);
  for (const version of versions) {
    const candidate = path.join(buildToolsRoot, version, 'lib', 'apksigner.jar');
    if (fs.existsSync(candidate)) return candidate;
  }
  fail(`apksigner.jar 不存在：${buildToolsRoot}`);
}

function resolveJava() {
  const executable = process.platform === 'win32' ? 'java.exe' : 'java';
  const candidates = [
    process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin', executable) : '',
    process.platform === 'win32' ? 'D:\\Android\\AndroidStudio\\jbr\\bin\\java.exe' : '',
  ].filter(Boolean);
  const java = candidates.find((candidate) => fs.existsSync(candidate));
  if (!java) fail('java 可执行文件不存在');
  return java;
}

function runJava(java, jar, args, environment, capture = false) {
  const result = spawnSync(java, ['-jar', jar, ...args], {
    cwd: PROJECT_ROOT,
    env: environment,
    encoding: 'utf8',
    stdio: capture ? 'pipe' : 'inherit',
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const details = capture ? `\n${result.stderr || result.stdout || ''}` : '';
    fail(`apksigner ${args[0]} 失败，退出码 ${result.status}${details}`);
  }
  return capture ? `${result.stdout || ''}\n${result.stderr || ''}` : '';
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write('用法：node scripts/sign-android-lineage.cjs --input <APK> --output <APK> [--properties <keystore.properties>]\n');
    return;
  }

  const input = path.resolve(options.input);
  const output = path.resolve(options.output);
  const propertiesPath = path.resolve(options.properties);
  if (!fs.existsSync(input) || !fs.statSync(input).isFile()) fail(`输入 APK 不存在：${input}`);
  if (input === output) fail('输入与输出 APK 不能相同');
  if (fs.existsSync(output)) fail(`输出已存在，拒绝覆盖：${output}`);
  fs.mkdirSync(path.dirname(output), { recursive: true });

  const properties = fs.existsSync(propertiesPath) ? readProperties(propertiesPath) : {};
  const setting = (propertyName, environmentName) => properties[propertyName]?.trim() || process.env[environmentName]?.trim();
  const formalKeystore = resolveConfiguredFile(setting('storeFile', 'HYDRO_KEYSTORE_PATH'), propertiesPath, '正式 keystore');
  const legacyKeystore = resolveConfiguredFile(setting('legacyStoreFile', 'HYDRO_LEGACY_KEYSTORE_PATH'), propertiesPath, '旧版 keystore');
  const lineage = resolveConfiguredFile(setting('lineageFile', 'HYDRO_SIGNING_LINEAGE_PATH'), propertiesPath, '签名谱系');
  const formalPassword = setting('storePassword', 'HYDRO_KEYSTORE_PASSWORD');
  const formalKeyPassword = setting('keyPassword', 'HYDRO_KEY_PASSWORD');
  const formalAlias = setting('keyAlias', 'HYDRO_KEY_ALIAS');
  const legacyPassword = setting('legacyStorePassword', 'HYDRO_LEGACY_KEYSTORE_PASSWORD');
  const legacyKeyPassword = setting('legacyKeyPassword', 'HYDRO_LEGACY_KEY_PASSWORD');
  const legacyAlias = setting('legacyKeyAlias', 'HYDRO_LEGACY_KEY_ALIAS');
  const rotationMinSdkVersion = Number.parseInt(setting('rotationMinSdkVersion', 'HYDRO_ROTATION_MIN_SDK_VERSION') || '28', 10);
  const minSdkVersion = Number.parseInt(setting('minSdkVersion', 'HYDRO_MIN_SDK_VERSION') || '23', 10);
  if (![formalPassword, formalKeyPassword, formalAlias, legacyPassword, legacyKeyPassword, legacyAlias].every(Boolean)) {
    fail('签名配置缺少正式或旧版密钥字段');
  }
  if (!Number.isInteger(rotationMinSdkVersion) || rotationMinSdkVersion < 28) fail('rotationMinSdkVersion 必须不小于 28');
  if (!Number.isInteger(minSdkVersion) || minSdkVersion < 1 || minSdkVersion >= rotationMinSdkVersion) fail('minSdkVersion 无效');

  const androidSdk = resolveAndroidSdk(properties);
  const apksignerJar = resolveApksignerJar(androidSdk);
  const java = resolveJava();
  const environment = {
    ...process.env,
    HYDRO_LINEAGE_FORMAL_STORE_PASSWORD: formalPassword,
    HYDRO_LINEAGE_FORMAL_KEY_PASSWORD: formalKeyPassword,
    HYDRO_LINEAGE_LEGACY_STORE_PASSWORD: legacyPassword,
    HYDRO_LINEAGE_LEGACY_KEY_PASSWORD: legacyKeyPassword,
  };

  try {
    runJava(java, apksignerJar, [
      'sign', '--out', output,
      '--lineage', lineage,
      '--rotation-min-sdk-version', String(rotationMinSdkVersion),
      '--ks', legacyKeystore,
      '--ks-key-alias', legacyAlias,
      '--ks-pass', 'env:HYDRO_LINEAGE_LEGACY_STORE_PASSWORD',
      '--key-pass', 'env:HYDRO_LINEAGE_LEGACY_KEY_PASSWORD',
      '--next-signer',
      '--ks', formalKeystore,
      '--ks-key-alias', formalAlias,
      '--ks-pass', 'env:HYDRO_LINEAGE_FORMAL_STORE_PASSWORD',
      '--key-pass', 'env:HYDRO_LINEAGE_FORMAL_KEY_PASSWORD',
      input,
    ], environment);

    const legacyVerification = runJava(java, apksignerJar, [
      'verify', '--verbose', '--print-certs',
      '--min-sdk-version', String(minSdkVersion),
      '--max-sdk-version', String(rotationMinSdkVersion - 1),
      output,
    ], environment, true);
    const formalVerification = runJava(java, apksignerJar, [
      'verify', '--verbose', '--print-certs',
      '--min-sdk-version', String(rotationMinSdkVersion),
      '--max-sdk-version', '10000',
      output,
    ], environment, true);
    const legacyDigest = legacyVerification.match(/certificate SHA-256 digest:\s*([0-9a-f]+)/i)?.[1];
    const formalDigest = formalVerification.match(/certificate SHA-256 digest:\s*([0-9a-f]+)/i)?.[1];
    if (!legacyDigest || !formalDigest || legacyDigest === formalDigest) fail('签名谱系双区间证书校验失败');

    process.stdout.write(`${JSON.stringify({
      input,
      output,
      bytes: fs.statSync(output).size,
      sha256: sha256(output),
      minSdkVersion,
      rotationMinSdkVersion,
      legacyCertificateSha256: legacyDigest,
      formalCertificateSha256: formalDigest,
    }, null, 2)}\n`);
  } catch (error) {
    fs.rmSync(output, { force: true });
    throw error;
  }
}

try {
  main();
} catch (error) {
  process.stderr.write(`[sign-lineage] ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}

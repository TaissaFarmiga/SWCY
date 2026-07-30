import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const variant = process.argv[2] || 'storeDebug';
const manifestRoot = path.join(root, 'android', 'app', 'build', 'intermediates');

function findFiles(directory, name, output = []) {
  if (!existsSync(directory)) return output;
  for (const entry of readdirSync(directory)) {
    const fullPath = path.join(directory, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) findFiles(fullPath, name, output);
    else if (entry === name && fullPath.toLowerCase().includes(variant.toLowerCase())) output.push(fullPath);
  }
  return output;
}

const manifests = findFiles(manifestRoot, 'AndroidManifest.xml')
  .sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs);
if (manifests.length === 0) throw new Error(`未找到${variant}合并Manifest；请先构建该Variant`);
const manifestPath = manifests[0];
const xml = readFileSync(manifestPath, 'utf8');
const permissions = [...xml.matchAll(/<uses-permission[^>]+android:name="([^"]+)"/g)].map((match) => match[1]);
const required = [
  'android.permission.INTERNET',
  'android.permission.ACCESS_NETWORK_STATE',
  'android.permission.ACCESS_COARSE_LOCATION',
  'android.permission.ACCESS_FINE_LOCATION',
];
const forbidden = [
  'android.permission.REQUEST_INSTALL_PACKAGES',
  'android.permission.ACCESS_BACKGROUND_LOCATION',
  'android.permission.QUERY_ALL_PACKAGES',
  'android.permission.MANAGE_EXTERNAL_STORAGE',
  'android.permission.READ_EXTERNAL_STORAGE',
  'android.permission.WRITE_EXTERNAL_STORAGE',
  'android.permission.CAMERA',
  'android.permission.RECORD_AUDIO',
];
const missing = required.filter((permission) => !permissions.includes(permission));
const unexpected = forbidden.filter((permission) => permissions.includes(permission));
if (missing.length > 0) throw new Error(`Store Manifest缺少必要权限：${missing.join(', ')}`);
if (unexpected.length > 0) throw new Error(`Store Manifest包含禁用权限：${unexpected.join(', ')}`);
if (!/android:allowBackup="false"/.test(xml)) throw new Error('Store Manifest必须禁用系统明文备份');
if (!/android:usesCleartextTraffic="false"/.test(xml)) throw new Error('Store Manifest必须禁用明文网络');

console.log(JSON.stringify({ variant, manifestPath, permissions, status: 'pass' }, null, 2));


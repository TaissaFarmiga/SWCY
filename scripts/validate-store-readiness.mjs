import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const codeOnly = process.argv.includes('--code-only');
const requiredFiles = [
  'resources/icon.svg',
  'resources/splash.svg',
  '_AI_Tools_/STORE_RELEASE/STORE_RELEASE_CHECKLIST.md',
  '_AI_Tools_/STORE_RELEASE/LEGAL_MATERIALS_CHECKLIST.md',
  '_AI_Tools_/STORE_RELEASE/DEPENDENCY_RISK_REPORT.md',
];
const missingFiles = requiredFiles.filter((file) => !existsSync(path.join(root, file)));
if (missingFiles.length > 0) throw new Error(`Store准备文件缺失：${missingFiles.join(', ')}`);

const requiredEnvironment = {
  VITE_APP_OPERATOR_NAME: process.env.VITE_APP_OPERATOR_NAME,
  VITE_APP_SUPPORT_CONTACT: process.env.VITE_APP_SUPPORT_CONTACT,
  VITE_APP_PRIVACY_URL: process.env.VITE_APP_PRIVACY_URL,
  VITE_APP_PRIVACY_EFFECTIVE_DATE: process.env.VITE_APP_PRIVACY_EFFECTIVE_DATE,
  VITE_APP_FILING_NUMBER: process.env.VITE_APP_FILING_NUMBER,
};

if (!codeOnly) {
  const missingEnvironment = Object.entries(requiredEnvironment)
    .filter(([, value]) => !value?.trim())
    .map(([name]) => name);
  if (missingEnvironment.length > 0) throw new Error(`Store Release缺少上架主体配置：${missingEnvironment.join(', ')}`);
  if (!/^https:\/\//i.test(requiredEnvironment.VITE_APP_PRIVACY_URL)) throw new Error('VITE_APP_PRIVACY_URL必须使用HTTPS');

  const keystoreProperties = path.join(root, 'android', 'keystore.properties');
  const propertyText = existsSync(keystoreProperties) ? readFileSync(keystoreProperties, 'utf8') : '';
  const signingReady = [
    process.env.HYDRO_KEYSTORE_PATH || (/^\s*storeFile\s*=.+$/m.test(propertyText) ? 'configured' : ''),
    process.env.HYDRO_KEYSTORE_PASSWORD || (/^\s*storePassword\s*=.+$/m.test(propertyText) ? 'configured' : ''),
    process.env.HYDRO_KEY_ALIAS || (/^\s*keyAlias\s*=.+$/m.test(propertyText) ? 'configured' : ''),
    process.env.HYDRO_KEY_PASSWORD || (/^\s*keyPassword\s*=.+$/m.test(propertyText) ? 'configured' : ''),
  ].every(Boolean);
  if (!signingReady) throw new Error('Store Release缺少正式签名配置；禁止使用临时密钥代替');
}

console.log(JSON.stringify({ codeOnly, requiredFiles: requiredFiles.length, status: 'ready' }));


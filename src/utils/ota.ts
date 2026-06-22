/**
 * OTA 更新运行时 — 纯客户端、无额外依赖、localStorage 持久化
 *
 * 核心流程：fetch manifest (双源 fallback) → 灰度判断 → badVersion 检查
 *          → 下载 bundle → SHA256 校验 → set(bundle) → watchdog(15s)
 *          → LKG 确认(3s 稳定运行)
 *
 * 失败策略：sha256 mismatch → 加入 badVersions (24h 熔断)
 *          watchdog 触发 → rollback → reset() → reload
 */

import { CapacitorHttp } from '@capacitor/core';
import { CapacitorUpdater } from '@capgo/capacitor-updater';

/* ================================================================
   Constants
   ================================================================ */

const STORAGE_KEY = 'ota_state';
const DEVICE_ID_KEY = 'ota_device_id';
const BUNDLE_MAP_KEY = 'ota_bundle_map';
const WATCHDOG_MS = 15000;
const LKG_SETTLE_MS = 3000;
const CIRCUIT_BREAKER_MS = 24 * 60 * 60 * 1000; // 24h

/* ================================================================
   Types
   ================================================================ */

export interface Manifest {
  version: string;
  url: string;
  sha256: string;
  rollout: number;
}

interface OTAStorage {
  current: string;
  lastGood: string;
  badVersions: string[];
}

/** 内部：version → bundleId 映射 */
interface BundleMap {
  [version: string]: string;
}

/* ================================================================
   Local Storage helpers
   ================================================================ */

function readOTAStorage(): OTAStorage {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        current: parsed.current || '',
        lastGood: parsed.lastGood || '',
        badVersions: Array.isArray(parsed.badVersions) ? parsed.badVersions : [],
      };
    }
  } catch {
    /* corrupt data — reset */
  }
  return { current: '', lastGood: '', badVersions: [] };
}

function writeOTAStorage(s: OTAStorage): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
}

function readBundleMap(): BundleMap {
  try {
    const raw = localStorage.getItem(BUNDLE_MAP_KEY);
    if (raw) return JSON.parse(raw) as BundleMap;
  } catch {
    /* ignore */
  }
  return {};
}

function writeBundleMap(m: BundleMap): void {
  localStorage.setItem(BUNDLE_MAP_KEY, JSON.stringify(m));
}

/* ================================================================
   Device Identity & Grayscale
   ================================================================ */

function getDeviceId(): string {
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}

/** djb2 变异 hash → 0–99 桶号 */
function hashBucket(deviceId: string): number {
  let hash = 5381;
  for (let i = 0; i < deviceId.length; i++) {
    hash = ((hash << 5) + hash + deviceId.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % 100;
}

/* ================================================================
   SHA256 (Web Crypto API, 零依赖)
   ================================================================ */

async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/* ================================================================
   Watchdog
   ================================================================ */

let watchdogTimer: ReturnType<typeof setTimeout> | null = null;

function clearWatchdog(): void {
  if (watchdogTimer) {
    clearTimeout(watchdogTimer);
    watchdogTimer = null;
  }
}

async function rollback(): Promise<void> {
  clearWatchdog();
  const storage = readOTAStorage();
  const bundleMap = readBundleMap();
  const lastGoodBundleId = storage.lastGood ? bundleMap[storage.lastGood] : undefined;

  console.warn('[OTA] Rolling back, lastGood:', storage.lastGood, 'bundleId:', lastGoodBundleId);

  try {
    if (lastGoodBundleId) {
      await CapacitorUpdater.set({ id: lastGoodBundleId });
    } else {
      await CapacitorUpdater.reset();
    }
  } catch (e) {
    console.error('[OTA] Rollback set() failed, resetting:', e);
    try {
      await CapacitorUpdater.reset();
    } catch {
      /* nothing more we can do */
    }
  }

  // 恢复当前版本标记
  if (storage.lastGood) {
    storage.current = storage.lastGood;
    writeOTAStorage(storage);
  }

  window.location.reload();
}

function startWatchdog(): void {
  clearWatchdog();
  (window as any).__APP_READY__ = false;
  watchdogTimer = setTimeout(() => {
    if (!(window as any).__APP_READY__) {
      console.error('[OTA] Watchdog fired — app not ready within 15s');
      rollback();
    }
  }, WATCHDOG_MS);
}

/* ================================================================
   LKG (Last Known Good)
   ================================================================ */

let lkgTimer: ReturnType<typeof setTimeout> | null = null;

export function initLKG(currentVersion: string): void {
  const storage = readOTAStorage();
  storage.current = currentVersion;
  writeOTAStorage(storage);

  if (lkgTimer) clearTimeout(lkgTimer);
  lkgTimer = setTimeout(() => {
    const s = readOTAStorage();
    s.lastGood = currentVersion;
    writeOTAStorage(s);
    console.log('[OTA] LKG confirmed:', currentVersion);
  }, LKG_SETTLE_MS);
}

/* ================================================================
   markAppReady — 由 App 层调用，确认渲染完成
   ================================================================ */

export function markAppReady(): void {
  (window as any).__APP_READY__ = true;
  clearWatchdog();
}

/* ================================================================
   Fetch Manifest (双源 fallback)
   ================================================================ */

async function fetchManifest(url: string): Promise<Manifest> {
  const res = await CapacitorHttp.get({
    url,
    connectTimeout: 10000,
    readTimeout: 10000,
  });

  if (res.status !== 200) {
    throw new Error(`HTTP ${res.status}`);
  }

  const data = typeof res.data === 'string' ? JSON.parse(res.data) : res.data;

  if (
    !data ||
    typeof data.version !== 'string' ||
    typeof data.url !== 'string' ||
    typeof data.sha256 !== 'string' ||
    typeof data.rollout !== 'number'
  ) {
    throw new Error('Invalid manifest format');
  }

  return data as Manifest;
}

/* ================================================================
   Download & SHA256 Verify
   ================================================================ */

async function downloadBundleBinary(url: string): Promise<ArrayBuffer> {
  const res = await CapacitorHttp.get({
    url,
    responseType: 'arraybuffer',
    connectTimeout: 30000,
    readTimeout: 120000,
  });

  if (res.status !== 200) {
    throw new Error(`Download HTTP ${res.status}`);
  }

  const data = res.data as ArrayBuffer;
  if (!data || data.byteLength === 0) {
    throw new Error('Empty download');
  }

  return data;
}

/* ================================================================
   Circuit Breaker (24h 熔断)
   ================================================================ */

function addBadVersion(version: string): void {
  const storage = readOTAStorage();
  if (!storage.badVersions.includes(version)) {
    storage.badVersions.push(version);
    writeOTAStorage(storage);
  }
  // 24h 后自动清除
  setTimeout(() => {
    const s = readOTAStorage();
    s.badVersions = s.badVersions.filter((v) => v !== version);
    writeOTAStorage(s);
    console.log('[OTA] Circuit breaker cleared for:', version);
  }, CIRCUIT_BREAKER_MS);
}

export function isVersionBlocked(version: string): boolean {
  const storage = readOTAStorage();
  return storage.badVersions.includes(version);
}

/* ================================================================
   runOTA — 主入口
   ================================================================ */

/**
 * 执行 OTA 更新检查与安装。
 *
 * @param manifestUrls  双源 fallback URL 列表（按优先级排列）
 * @param options.force  若为 true，则跳过灰度判断（手动触发场景）
 * @returns  true 表示触发了更新安装（页面即将 reload），false 表示无需更新
 */
export async function runOTA(
  manifestUrls: string[],
  options?: { force?: boolean },
): Promise<boolean> {
  const force = options?.force ?? false;

  /* ── 1. Fetch manifest (双源 fallback) ── */
  let manifest: Manifest | null = null;
  for (const url of manifestUrls) {
    try {
      manifest = await fetchManifest(url);
      console.log('[OTA] Manifest fetched from:', url);
      break;
    } catch (e) {
      console.warn('[OTA] Manifest source failed:', url, e);
    }
  }

  if (!manifest) {
    console.warn('[OTA] All manifest sources exhausted, aborting');
    return false;
  }

  /* ── 2. Manifest 已解析（fetchManifest 内部校验） ── */

  /* ── 3. 灰度判断（force 模式跳过） ── */
  if (!force) {
    const bucket = hashBucket(getDeviceId());
    console.log('[OTA] Grayscale: bucket=', bucket, 'rollout=', manifest.rollout);
    if (bucket >= manifest.rollout) {
      console.log('[OTA] Device not in rollout group, aborting');
      return false;
    }
  }

  /* ── 4. badVersions 检查 ── */
  if (isVersionBlocked(manifest.version)) {
    console.warn('[OTA] Version blocked (badVersions):', manifest.version);
    return false;
  }

  /* ── 5. 下载 bundle 二进制 ── */
  console.log('[OTA] Downloading bundle:', manifest.url);
  let bundleBinary: ArrayBuffer;
  try {
    bundleBinary = await downloadBundleBinary(manifest.url);
  } catch (e) {
    console.error('[OTA] Bundle download failed:', e);
    // download 中断 → 不修改 current
    return false;
  }

  /* ── 6. SHA256 校验 ── */
  let actualSha256: string;
  try {
    actualSha256 = await sha256Hex(bundleBinary);
  } catch (e) {
    console.error('[OTA] SHA256 computation failed:', e);
    return false;
  }

  if (actualSha256 !== manifest.sha256) {
    console.error(
      `[OTA] SHA256 MISMATCH — expected: ${manifest.sha256}, actual: ${actualSha256}`,
    );
    // mismatch → 加入熔断列表，不允许 install
    addBadVersion(manifest.version);
    return false;
  }

  console.log('[OTA] SHA256 verified OK');

  /* ── 7. CapacitorUpdater.download + set ── */
  let bundleId: string;
  try {
    const bundle = await CapacitorUpdater.download({
      version: manifest.version,
      url: manifest.url,
    });
    bundleId = bundle.id;
    await CapacitorUpdater.set({ id: bundleId });
  } catch (e) {
    console.error('[OTA] CapacitorUpdater.download/set failed:', e);
    // set() 失败 → fallback reset()
    try {
      await CapacitorUpdater.reset();
    } catch {
      /* ignore */
    }
    return false;
  }

  /* ── 持久化 bundleId 映射 ── */
  const bundleMap = readBundleMap();
  bundleMap[manifest.version] = bundleId;
  writeBundleMap(bundleMap);

  /* ── 更新 storage.current ── */
  const storage = readOTAStorage();
  storage.current = manifest.version;
  writeOTAStorage(storage);

  /* ── 8. 启动 Watchdog ── */
  startWatchdog();

  /* ── 重载以应用新版本 ── */
  window.location.reload();
  return true;
}

/* ================================================================
   rollbackNow — 外部可触发的回滚
   ================================================================ */

export function rollbackNow(): void {
  rollback();
}

/* ================================================================
   清理所有 timer（用于组件卸载）
   ================================================================ */

export function destroyOTATimers(): void {
  clearWatchdog();
  if (lkgTimer) {
    clearTimeout(lkgTimer);
    lkgTimer = null;
  }
}
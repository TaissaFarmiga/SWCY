/**
 * SnapshotPlugin — Capacitor Plugin Bridge (TypeScript)
 *
 * 双轨 OTA 通道：
 *   - ZIP 热更：applySnapshot → Native OkHttp 下载解压 → WebView reload
 *   - APK 整包：downloadAndInstallApk → Native OkHttp 下载 → 唤起系统安装
 */

import { registerPlugin } from '@capacitor/core';
import type { PluginListenerHandle } from '@capacitor/core';
import type { SnapshotInfo } from '../types/update';

// ─── TypeScript 接口映射 ───────────────────────────────

export interface CreateTestSnapshotResult {
  success: boolean;
  path: string;
}

export interface ApplyTestSnapshotResult {
  success: boolean;
  path: string;
  confirmedPath: string;
}

export interface CurrentServerPathResult {
  currentServerPath: string;
}

export interface ReadTestSnapshotResult {
  success: boolean;
  exists: boolean;
  size: number;
  content: string;
}

export interface SnapshotPluginInterface {
  getCurrentInfo(): Promise<SnapshotInfo>;
  createTestSnapshot(): Promise<CreateTestSnapshotResult>;
  applyTestSnapshot(): Promise<ApplyTestSnapshotResult>;
  getCurrentServerPath(): Promise<CurrentServerPathResult>;
  readTestSnapshot(): Promise<ReadTestSnapshotResult>;
  applySnapshot(options: { path: string; zipUrl: string }): Promise<void>;
  downloadAndInstallApk(options: { apkUrl: string; isXorEncrypted?: boolean }): Promise<void>;
  
  // 原生事件监听器声明
  addListener(
    eventName: 'downloadProgress',
    listenerFunc: (progress: { progress: number; bytesRead: number; totalBytes: number }) => void
  ): Promise<PluginListenerHandle> & PluginListenerHandle;
}

export const SnapshotPlugin = registerPlugin<SnapshotPluginInterface>('SnapshotPlugin');

// ─── 版本元数据结构 ───────────────────────────────────

interface CloudVersion {
  version: string;
  timestamp: string;
  updateType: 'zip' | 'apk';
  forceUpdate: boolean;
}

// ─── COS 基地址（占位符，部署前替换为实际域名）───────

// ─── COS 基地址（动态读取） ───────
const COS_BASE = 'https://YOUR_CUSTOM_DOMAIN'; // 📐 请在这里填入你绑定的已备案自定义域名，例如：https://ota.yourdomain.com

// ─── 核心更新逻辑 ─────────────────────────────────────

/**
 * 检测云端版本并触发对应的更新通道。
 *
 * 流程：
 *   1. fetch COS 上的 version.json
 *   2. 比对本地 package.json version
 *   3. 云端更新 → ZIP 热更通道
 *   4. 云端更旧 → APK 整包通道（大版本回退/升级）
 */
export async function checkAndTriggerUpdate(): Promise<{
  hasUpdate: boolean;
  updateType?: 'zip' | 'apk';
  message: string;
}> {
  try {
    // 1. 拉取云端版本声明
    const resp = await fetch(`${COS_BASE}/version.json`, {
      cache: 'no-cache',
    });
    if (!resp.ok) {
      return { hasUpdate: false, message: `云端版本查询失败 (HTTP ${resp.status})` };
    }

    const cloud: CloudVersion = await resp.json();

    // 2. 本地版本号（优先读取本地已缓存的热更版本，若无则读取原生 APK 版本作为基准）
    const appliedZip = localStorage.getItem('applied_zip_version');
    let localVersion = '';
    try {
      const info = await SnapshotPlugin.getCurrentInfo();
      localVersion = appliedZip || info.apkVersion || '';
    } catch {
      localVersion = '0.0.0';
    }

    // 3. 版本比对
    if (compareVersions(cloud.version, localVersion) <= 0) {
      return { hasUpdate: false, message: `已是最新版本 (${localVersion})` };
    }

    // 4. 双轨路由
    if (cloud.updateType === 'apk') {
      const apkUrl = `${COS_BASE}/app-release.apk`;
      console.log('[OTA] APK 大版本更新 →', apkUrl);
      await SnapshotPlugin.downloadAndInstallApk({ apkUrl, isXorEncrypted: true });
      return { hasUpdate: true, updateType: 'apk', message: 'APK 安装中...' };
    }

    // 默认 ZIP 热更
    const zipUrl = `${COS_BASE}/dist.zip`;
    const snapshotPath = '/data/user/0/com.hydro.geekterminal/files/snapshots/latest';
    console.log('[OTA] ZIP 热更 →', zipUrl);
    await SnapshotPlugin.applySnapshot({ path: snapshotPath, zipUrl });

    // 【核心修复】热更重载前，必须将当前最新版本号写入本地缓存锁，防止死循环
    localStorage.setItem('applied_zip_version', cloud.version);

    return { hasUpdate: true, updateType: 'zip', message: '热更新已触发，WebView 即将重载' };

  } catch (err: any) {
    console.error('[OTA] 更新流程异常', err);
    return { hasUpdate: false, message: `更新失败: ${err?.message || err}` };
  }
}

/**
 * 简易语义化版本比对。
 * 返回 >0 表示 a > b，<0 表示 a < b，0 表示相等。
 */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * 启动自检探针：用于沙盒数据被意外清空后的静默恢复
 * 极度克制：不抛出错误、不弹窗、只处理 ZIP 静默覆盖
 */
export async function silentBootProbe(): Promise<void> {
  try {
    const resp = await fetch(`${COS_BASE}/version.json`, { cache: 'no-store' });
    if (!resp.ok) return;
    
    const cloud = await resp.json();
    
    // 优先读取本地已缓存的热更版本
    const appliedZip = localStorage.getItem('applied_zip_version');
    let localVersion = '';
    try {
      const info = await SnapshotPlugin.getCurrentInfo();
      localVersion = appliedZip || info.apkVersion || '0.0.0';
    } catch { return; }

    // 如果落后，且为热更包，则静默拉取
    if (compareVersions(cloud.version, localVersion) > 0 && cloud.updateType === 'zip') {
      console.log('[OTA] 探针检测到本地引擎落后，正在后台静默同步...');
      const zipUrl = `${COS_BASE}/dist.zip`;
      const snapshotPath = '/data/user/0/com.hydro.geekterminal/files/snapshots/latest';
      await SnapshotPlugin.applySnapshot({ path: snapshotPath, zipUrl });

      // 【核心修复】静默热更重载前，必须将当前最新版本号写入本地缓存锁，防止死循环
      localStorage.setItem('applied_zip_version', cloud.version);
    }
  } catch (e) {
    console.warn('[OTA] 静默探针终止');
  }
}

/**
 * SnapshotPlugin — Capacitor Plugin Bridge (TypeScript)
 *
 * 保留本地 Snapshot 验证能力；正式更新仅使用 GitHub Release APK。
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
  downloadAndInstallApk(options: { apkUrl: string; expectedSha256: string }): Promise<void>;
  
  // 原生事件监听器声明
  addListener(
    eventName: 'downloadProgress',
    listenerFunc: (progress: { progress: number; bytesRead: number; totalBytes: number }) => void
  ): Promise<PluginListenerHandle> & PluginListenerHandle;
}

export const SnapshotPlugin = registerPlugin<SnapshotPluginInterface>('SnapshotPlugin');

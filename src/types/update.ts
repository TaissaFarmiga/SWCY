/**
 * Snapshot Update System — 类型定义
 */

export interface SnapshotInfo {
  /** 当前运行版本 (空字符串表示使用 APK 内置版本) */
  currentVersion: string;
  /** 上一个运行版本 (空字符串表示无) */
  previousVersion: string;
  /** APK 版本号 */
  apkVersion: string;
}
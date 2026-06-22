import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Capacitor } from '@capacitor/core';
import App from './App.tsx';
import './index.css';

// 【Capacitor 原生容器阻断】在原生环境中严禁注册 Service Worker，防止与 WebView 缓存冲突
if (!Capacitor.isNativePlatform()) {
  // 仅在浏览器 PWA 环境下注册 SW
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        // SW 注册失败静默处理，不阻塞应用启动
      });
    });
  }
}

/**
 * Capgo OTA 热更新管线 — 预埋接口
 *
 * 当前为 Mock 阶段：在控制台打印检测更新的状态。
 * 待集成 @capgo/capacitor-updater 后，替换为真实调用：
 *
 *   import { CapacitorUpdater } from '@capgo/capacitor-updater';
 *   const updater = new CapacitorUpdater();
 *   const version = await updater.download({ ... });
 *   await updater.set(version);
 */
async function initializeOTA() {
  // 待集成 @capgo/capacitor-updater
  console.log('[Capgo OTA] 热更新管线初始化中...');

  try {
    const isNative = Capacitor.isNativePlatform();
    console.log(`[Capgo OTA] 运行环境: ${isNative ? '原生 (Capacitor)' : '浏览器 (PWA)'}`);

    if (!isNative) {
      console.log('[Capgo OTA] 浏览器环境，跳过原生更新检查');
      return;
    }

    // ───── Mock: 模拟云端版本检测 ─────
    console.log('[Capgo OTA] 正在查询云端最新版本...');

    // 模拟网络延迟
    await new Promise((resolve) => setTimeout(resolve, 800));

    const mockCurrentVersion = '1.0.0';
    const mockLatestVersion = '1.0.0'; // 与当前版本相同，表示已是最新
    const mockUpdateAvailable = false;   // 替换为 true 可模拟有更新

    console.log(`[Capgo OTA] 当前版本: v${mockCurrentVersion}`);
    console.log(`[Capgo OTA] 云端版本: v${mockLatestVersion}`);

    if (mockUpdateAvailable) {
      console.log('[Capgo OTA] ⚡ 发现新版本！正在后台下载增量包...');
      // 真实集成时:
      //   const bundle = await CapacitorUpdater.download({
      //     url: 'https://capgo.app/api/bundle/download',
      //     version: latestVersion,
      //   });
      //   await CapacitorUpdater.set(bundle);
      //   console.log('[Capgo OTA] 增量包已就绪，下次启动生效');

      await new Promise((resolve) => setTimeout(resolve, 1200));
      console.log('[Capgo OTA] 增量包下载完成 (Mock)');
    } else {
      console.log('[Capgo OTA] ✅ 当前已是最新版本，无需更新');
    }

    console.log('[Capgo OTA] 热更新管线就绪');
  } catch (err) {
    console.error('[Capgo OTA] 更新检测失败:', err);
    // OTA 失败不应阻塞应用启动
  }
}

// 应用挂载时调用 OTA 初始化
initializeOTA();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);

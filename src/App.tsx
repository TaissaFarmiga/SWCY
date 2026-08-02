import { useState, useEffect } from 'react';
import { App as CapApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { StatusBar, Style } from '@capacitor/status-bar';
import { motion } from 'framer-motion';
import { Home } from './components/Home';
import FlowApp from './components/FlowApp';
import { LevelingApp } from './components/leveling/LevelingApp';
import { FlowDeviationTool } from './components/tools/FlowDeviationTool';
import { SpiritLevel } from './components/tools/SpiritLevel';
import { AppInfo } from './components/AppInfo';
import { useUiStore } from './store/uiStore';
import type { AppRoute } from './types/navigation';
import { useZeroJitter } from './hooks/useZeroJitter';

export default function App() {
  const [route, setRoute] = useState<AppRoute>({ type: 'home' });
  const darkMode = useUiStore((state) => state.darkMode);

  // 动态挂载 I/O 驱动：精确寻找当前激活的业务岛屿滚动容器
  useZeroJitter(route.type !== 'home', `scroll-${route.type}`);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
  }, [darkMode]);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    const syncStatusBarStyle = () => {
      const style = document.documentElement.classList.contains('dark')
        ? Style.Dark
        : Style.Light;
      StatusBar.setStyle({ style }).catch(() => {});
    };

    syncStatusBarStyle();
    const observer = new MutationObserver(syncStatusBarStyle);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let handle: { remove: () => void } | null = null;
    CapApp.addListener('backButton', () => {
      const backEvent = new CustomEvent('hydro-app-back', { cancelable: true });
      window.dispatchEvent(backEvent);
      if (backEvent.defaultPrevented) return;

      setRoute((prev) => {
        if (prev.type !== 'home') return { type: 'home' };
        CapApp.exitApp();
        return prev;
      });
    }).then((h) => {
      handle = h;
    });
    return () => handle?.remove();
  }, []);

  return (
    <div className="w-full min-h-screen bg-[#F2F2F7] dark:bg-gray-950 transition-colors duration-300">
      {/* 100% 贴合任何设备屏幕 (手机/iPad/PC)，死守 320px 最小宽度底线 */}
      <div className="w-full relative min-h-screen overflow-hidden flex flex-col">

        {/* 常驻岛屿架构 (Persistent Islands) - 完全避免 Canvas 销毁重建 */}
        <div className="absolute inset-0">

          {/* HOME 岛屿 */}
          <motion.div
            aria-hidden={route.type !== 'home'}
            animate={{ opacity: route.type === 'home' ? 1 : 0 }}
            transition={{ duration: 0.2 }}
            className={`absolute inset-0 overflow-y-auto overflow-x-hidden ${route.type === 'home' ? 'visible pointer-events-auto' : 'invisible pointer-events-none'}`}
          >
            <Home onSelect={(type) => setRoute({ type })} />
          </motion.div>

          {/* FLOW 岛屿 (独立滚动容器) */}
          <motion.div
            id="scroll-flow"
            aria-hidden={route.type !== 'flow'}
            animate={{ opacity: route.type === 'flow' ? 1 : 0 }}
            transition={{ duration: 0.25 }}
            className={`absolute inset-0 overflow-y-auto overflow-x-hidden ${route.type === 'flow' ? 'visible pointer-events-auto' : 'invisible pointer-events-none'}`}
          >
            <FlowApp isActive={route.type === 'flow'} onBack={() => setRoute({ type: 'home' })} />
          </motion.div>

          {/* LEVELING 岛屿 (独立滚动容器) */}
          <motion.div
            id="scroll-leveling"
            aria-hidden={route.type !== 'leveling'}
            animate={{ opacity: route.type === 'leveling' ? 1 : 0 }}
            transition={{ duration: 0.25 }}
            className={`absolute inset-0 overflow-y-auto overflow-x-hidden ${route.type === 'leveling' ? 'visible pointer-events-auto' : 'invisible pointer-events-none'}`}
          >
            <LevelingApp isActive={route.type === 'leveling'} onBack={() => setRoute({ type: 'home' })} />
          </motion.div>

          {/* FLOW DEVIATION 岛屿 */}
          <motion.div
            id="scroll-flow-deviation"
            aria-hidden={route.type !== 'flow-deviation'}
            animate={{ opacity: route.type === 'flow-deviation' ? 1 : 0 }}
            transition={{ duration: 0.25 }}
            className={`absolute inset-0 overflow-y-auto overflow-x-hidden ${route.type === 'flow-deviation' ? 'visible pointer-events-auto' : 'invisible pointer-events-none'}`}
          >
            {route.type === 'flow-deviation' && <FlowDeviationTool onBack={() => setRoute({ type: 'home' })} />}
          </motion.div>

          {/* SPIRIT LEVEL 岛屿 (电子气泡工具箱) */}
          <motion.div
            id="scroll-spirit-level"
            aria-hidden={route.type !== 'spirit-level'}
            animate={{ opacity: route.type === 'spirit-level' ? 1 : 0 }}
            transition={{ duration: 0.25 }}
            className={`absolute inset-0 overflow-y-auto overflow-x-hidden ${route.type === 'spirit-level' ? 'visible pointer-events-auto' : 'invisible pointer-events-none'}`}
          >
            {/* 仅在激活时挂载，彻底阻断后台传感器耗电 */}
            {route.type === 'spirit-level' && <SpiritLevel onBack={() => setRoute({ type: 'home' })} />}
          </motion.div>

          <motion.div
            id="scroll-app-info"
            aria-hidden={route.type !== 'app-info'}
            animate={{ opacity: route.type === 'app-info' ? 1 : 0 }}
            transition={{ duration: 0.25 }}
            className={`absolute inset-0 overflow-y-auto overflow-x-hidden ${route.type === 'app-info' ? 'visible pointer-events-auto' : 'invisible pointer-events-none'}`}
          >
            {route.type === 'app-info' && <AppInfo onBack={() => setRoute({ type: 'home' })} />}
          </motion.div>
        </div>

      </div>
    </div>
  );
}

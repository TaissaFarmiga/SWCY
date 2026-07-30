import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import type { StateStorage } from 'zustand/middleware';

const fallbackStorage = new Map<string, string>();

function browserStorage(): Storage | null {
  return typeof localStorage === 'undefined' ? null : localStorage;
}

/**
 * 全项目统一持久化适配器。
 * Android/iOS 原生容器使用 Capacitor Preferences；Web/PWA 使用 localStorage。
 * Node 测试环境使用仅进程内存储，避免访问不存在的 window/localStorage。
 */
export function createPlatformStateStorage(): StateStorage {
  return {
    getItem: async (name) => {
      if (Capacitor.isNativePlatform()) {
        try {
          const { value } = await Preferences.get({ key: name });
          if (value !== null) return value;
          const legacyValue = browserStorage()?.getItem(name) ?? null;
          if (legacyValue !== null) await Preferences.set({ key: name, value: legacyValue });
          return legacyValue;
        } catch (error) {
          console.error(`[persistence] ${name} 原生存储读取失败，尝试旧WebView存储`, error);
          return browserStorage()?.getItem(name) ?? null;
        }
      }
      return browserStorage()?.getItem(name) ?? fallbackStorage.get(name) ?? null;
    },
    setItem: async (name, value) => {
      if (Capacitor.isNativePlatform()) {
        await Preferences.set({ key: name, value });
        return;
      }
      const storage = browserStorage();
      if (storage) storage.setItem(name, value);
      else fallbackStorage.set(name, value);
    },
    removeItem: async (name) => {
      if (Capacitor.isNativePlatform()) {
        await Preferences.remove({ key: name });
        return;
      }
      const storage = browserStorage();
      if (storage) storage.removeItem(name);
      fallbackStorage.delete(name);
    },
  };
}

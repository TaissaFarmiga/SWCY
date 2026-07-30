import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { StateStorage } from 'zustand/middleware';
import { createPlatformStateStorage } from '../lib/persistence';

const UI_STORAGE_KEY = 'hydro-ui';
const platformStorage = createPlatformStateStorage();

function systemPrefersDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

const legacyAwareStorage: StateStorage = {
  getItem: async (name) => {
    const current = await platformStorage.getItem(name);
    if (current !== null || name !== UI_STORAGE_KEY) return current;
    const legacyTheme = await platformStorage.getItem('theme');
    if (legacyTheme !== 'dark' && legacyTheme !== 'light') return null;
    return JSON.stringify({ state: { darkMode: legacyTheme === 'dark' }, version: 1 });
  },
  setItem: (name, value) => platformStorage.setItem(name, value),
  removeItem: (name) => platformStorage.removeItem(name),
};

interface UiState {
  darkMode: boolean;
  hydrated: boolean;
  setDarkMode: (darkMode: boolean) => void;
  setHydrated: (hydrated: boolean) => void;
}

export const useUiStore = create<UiState>()(persist((set) => ({
  darkMode: systemPrefersDark(),
  hydrated: false,
  setDarkMode: (darkMode) => set({ darkMode }),
  setHydrated: (hydrated) => set({ hydrated }),
}), {
  name: UI_STORAGE_KEY,
  version: 1,
  storage: createJSONStorage(() => legacyAwareStorage),
  partialize: (state) => ({ darkMode: state.darkMode }),
  onRehydrateStorage: () => (state) => state?.setHydrated(true),
}));

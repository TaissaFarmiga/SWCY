import { useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { Keyboard } from '@capacitor/keyboard';

function isEditable(element: HTMLElement | null): element is HTMLInputElement | HTMLTextAreaElement {
  if (!element) return false;
  const tagName = element.tagName.toUpperCase();
  return tagName === 'INPUT' || tagName === 'TEXTAREA' || element.isContentEditable;
}

/** Keep focused fields inside the real keyboard viewport on Web and Android. */
export function useZeroJitter(isActive: boolean, containerId: string = 'viewport-container') {
  useEffect(() => {
    if (!isActive) return undefined;

    let alignTimeout: ReturnType<typeof setTimeout> | null = null;
    let nativeKeyboardHeight = 0;
    let disposed = false;
    const nativeHandles: Array<{ remove: () => Promise<void> }> = [];
    const visualViewport = window.visualViewport;
    const root = document.getElementById(containerId) ?? document.documentElement;
    const previousPaddingBottom = root.style.paddingBottom;
    const previousScrollPaddingBottom = root.style.scrollPaddingBottom;

    const applyKeyboardInset = (height: number) => {
      const inset = Math.max(0, Math.round(height));
      root.style.paddingBottom = inset > 0 ? `${inset + 16}px` : previousPaddingBottom;
      root.style.scrollPaddingBottom = inset > 0 ? `${inset + 16}px` : previousScrollPaddingBottom;
    };

    const alignActiveElement = (element: HTMLElement, delay = 80) => {
      if (alignTimeout) clearTimeout(alignTimeout);
      alignTimeout = setTimeout(() => {
        if (!isEditable(element) || document.activeElement !== element) return;
        const viewportTop = visualViewport?.offsetTop ?? 0;
        const viewportHeight = visualViewport?.height ?? window.innerHeight;
        const viewportBottom = viewportTop + viewportHeight;
        const rect = element.getBoundingClientRect();
        const safeTop = viewportTop + 12;
        const safeBottom = viewportBottom - 16;
        const offset = rect.bottom > safeBottom
          ? rect.bottom - safeBottom
          : rect.top < safeTop
            ? rect.top - safeTop
            : 0;
        if (Math.abs(offset) < 4) return;
        root.scrollBy({ top: offset, behavior: 'auto' });
      }, delay);
    };

    const handleFocusIn = (event: FocusEvent) => {
      const target = event.target as HTMLElement;
      if (isEditable(target)) alignActiveElement(target);
    };

    const handleViewportChange = () => {
      const visualKeyboardHeight = visualViewport
        ? Math.max(0, window.innerHeight - visualViewport.height - visualViewport.offsetTop)
        : 0;
      applyKeyboardInset(Math.max(nativeKeyboardHeight, visualKeyboardHeight));
      const active = document.activeElement as HTMLElement | null;
      if (isEditable(active)) alignActiveElement(active, 40);
    };

    if (Capacitor.isNativePlatform()) {
      void Promise.all([
        Keyboard.addListener('keyboardDidShow', ({ keyboardHeight }) => {
          nativeKeyboardHeight = keyboardHeight;
          applyKeyboardInset(keyboardHeight);
          const active = document.activeElement as HTMLElement | null;
          if (isEditable(active)) alignActiveElement(active, 40);
        }),
        Keyboard.addListener('keyboardDidHide', () => {
          nativeKeyboardHeight = 0;
          applyKeyboardInset(0);
        }),
      ]).then((handles) => {
        if (disposed) {
          handles.forEach((handle) => void handle.remove());
          return;
        }
        nativeHandles.push(...handles);
      });
    }

    document.addEventListener('focusin', handleFocusIn);
    visualViewport?.addEventListener('resize', handleViewportChange);
    visualViewport?.addEventListener('scroll', handleViewportChange);
    return () => {
      disposed = true;
      document.removeEventListener('focusin', handleFocusIn);
      visualViewport?.removeEventListener('resize', handleViewportChange);
      visualViewport?.removeEventListener('scroll', handleViewportChange);
      if (alignTimeout) clearTimeout(alignTimeout);
      nativeHandles.forEach((handle) => void handle.remove());
      root.style.paddingBottom = previousPaddingBottom;
      root.style.scrollPaddingBottom = previousScrollPaddingBottom;
    };
  }, [containerId, isActive]);
}

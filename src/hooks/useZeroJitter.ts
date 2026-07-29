import { useEffect } from 'react';

export function useZeroJitter(isActive: boolean, containerId: string = 'viewport-container') {
  useEffect(() => {
    if (!isActive) return;

    let focusTimeout: ReturnType<typeof setTimeout> | null = null;
    let alignTimeout: ReturnType<typeof setTimeout> | null = null;

    const injectPadding = (paddingStr: string) => {
      const root = document.getElementById(containerId);
      if (root) root.style.paddingBottom = paddingStr;
    };

    const alignActiveElement = (el: HTMLElement) => {
      if (alignTimeout) clearTimeout(alignTimeout);
      alignTimeout = setTimeout(() => {
        const isVerticalCard = !!el.closest('[id^="vertical-"]');
        const rect = el.getBoundingClientRect();
        const targetTop = window.innerHeight * (isVerticalCard ? 0.3 : 0.65);
        const offset = rect.top - targetTop;
        if (Math.abs(offset) > 30) {
          const root = document.getElementById(containerId) || document.scrollingElement || document.documentElement;
          root.scrollBy({ top: offset, behavior: 'smooth' });
        }
      }, 150);
    };

    const checkEditable = (el: HTMLElement | null): boolean => {
      if (!el || !el.tagName) return false;
      const tagName = el.tagName.toUpperCase();
      return tagName === 'INPUT' || tagName === 'TEXTAREA' || el.isContentEditable;
    };

    const handleFocusIn = (e: FocusEvent) => {
      if (focusTimeout) clearTimeout(focusTimeout);
      const target = e.target as HTMLElement;
      if (checkEditable(target)) {
        injectPadding('400px');
        alignActiveElement(target);
      }
    };

    const handleFocusOut = () => {
      focusTimeout = setTimeout(() => {
        const activeEl = document.activeElement as HTMLElement;
        if (!checkEditable(activeEl)) {
          injectPadding('0px');
        }
      }, 150);
    };

    const handleInputClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (checkEditable(target) && document.activeElement === target) {
        injectPadding('400px');
        alignActiveElement(target);
      }
    };

    document.addEventListener('focusin', handleFocusIn);
    document.addEventListener('focusout', handleFocusOut);
    document.addEventListener('click', handleInputClick);

    return () => {
      document.removeEventListener('focusin', handleFocusIn);
      document.removeEventListener('focusout', handleFocusOut);
      document.removeEventListener('click', handleInputClick);
      if (focusTimeout) clearTimeout(focusTimeout);
      if (alignTimeout) clearTimeout(alignTimeout);
      injectPadding('0px');
    };
  }, [isActive, containerId]);
}

import { useEffect } from 'react';

function isEditable(element: HTMLElement | null): element is HTMLInputElement | HTMLTextAreaElement {
  if (!element) return false;
  const tagName = element.tagName.toUpperCase();
  return tagName === 'INPUT' || tagName === 'TEXTAREA' || element.isContentEditable;
}

/** Keep focused fields inside the actual visual viewport. No synthetic 400px spacer. */
export function useZeroJitter(isActive: boolean, containerId: string = 'viewport-container') {
  useEffect(() => {
    if (!isActive) return undefined;

    let alignTimeout: ReturnType<typeof setTimeout> | null = null;
    const visualViewport = window.visualViewport;

    const alignActiveElement = (element: HTMLElement) => {
      if (alignTimeout) clearTimeout(alignTimeout);
      alignTimeout = setTimeout(() => {
        if (!isEditable(element) || document.activeElement !== element) return;
        const viewportTop = visualViewport?.offsetTop ?? 0;
        const viewportHeight = visualViewport?.height ?? window.innerHeight;
        const viewportBottom = viewportTop + viewportHeight;
        const rect = element.getBoundingClientRect();
        const safeTop = viewportTop + 16;
        const safeBottom = viewportBottom - 16;
        const offset = rect.bottom > safeBottom
          ? rect.bottom - safeBottom
          : rect.top < safeTop
            ? rect.top - safeTop
            : 0;
        if (Math.abs(offset) < 4) return;
        const root = document.getElementById(containerId) ?? document.scrollingElement ?? document.documentElement;
        root.scrollBy({ top: offset, behavior: 'smooth' });
      }, 120);
    };

    const handleFocusIn = (event: FocusEvent) => {
      const target = event.target as HTMLElement;
      if (isEditable(target)) alignActiveElement(target);
    };

    const handleViewportChange = () => {
      const active = document.activeElement as HTMLElement | null;
      if (isEditable(active)) alignActiveElement(active);
    };

    document.addEventListener('focusin', handleFocusIn);
    visualViewport?.addEventListener('resize', handleViewportChange);
    visualViewport?.addEventListener('scroll', handleViewportChange);
    return () => {
      document.removeEventListener('focusin', handleFocusIn);
      visualViewport?.removeEventListener('resize', handleViewportChange);
      visualViewport?.removeEventListener('scroll', handleViewportChange);
      if (alignTimeout) clearTimeout(alignTimeout);
    };
  }, [containerId, isActive]);
}

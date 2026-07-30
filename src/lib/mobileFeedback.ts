import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle } from '@capacitor/haptics';

function vibrateFallback(durationMs: number): void {
  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
    navigator.vibrate(durationMs);
  }
}

export async function triggerCenterFeedback(): Promise<void> {
  if (!Capacitor.isNativePlatform()) {
    vibrateFallback(12);
    return;
  }

  try {
    await Haptics.impact({ style: ImpactStyle.Light });
  } catch {
    vibrateFallback(12);
  }
}

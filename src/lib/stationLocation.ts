import { Capacitor } from '@capacitor/core';
import { Geolocation } from '@capacitor/geolocation';
import type { NewStationLocation } from '../store/levelingStore';

export type StationLocationResult =
  | { status: 'captured'; location: NewStationLocation }
  | { status: 'denied' | 'unsupported' | 'timeout' | 'unavailable'; message: string };

const POSITION_OPTIONS = {
  enableHighAccuracy: true,
  timeout: 10_000,
  maximumAge: 30_000,
} as const;

function errorResult(error: unknown): StationLocationResult {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();
  if (lower.includes('permission') || lower.includes('denied')) {
    return { status: 'denied', message: '定位权限未授予' };
  }
  if (lower.includes('timeout')) return { status: 'timeout', message: '定位超时，请移至开阔处重试' };
  return { status: 'unavailable', message: '暂未获取有效定位' };
}

function fromPosition(position: {
  coords: { latitude: number; longitude: number; accuracy?: number | null };
  timestamp?: number;
}, source: NewStationLocation['source']): StationLocationResult {
  const { latitude: lat, longitude: lng, accuracy } = position.coords;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return { status: 'unavailable', message: '定位结果无效' };
  return {
    status: 'captured',
    location: {
      lat,
      lng,
      ...(typeof accuracy === 'number' && Number.isFinite(accuracy) && accuracy >= 0 ? { accuracyM: accuracy } : {}),
      capturedAt: new Date(position.timestamp ?? Date.now()).toISOString(),
      source,
    },
  };
}

async function captureBrowserLocation(): Promise<StationLocationResult> {
  if (!navigator.geolocation) return { status: 'unsupported', message: '当前环境不支持定位' };
  try {
    const position = await new Promise<GeolocationPosition>((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, POSITION_OPTIONS);
    });
    return fromPosition(position, 'browser-gps');
  } catch (error) {
    return errorResult(error);
  }
}

export async function captureStationLocation(): Promise<StationLocationResult> {
  if (!Capacitor.isNativePlatform()) return captureBrowserLocation();
  try {
    let permissions = await Geolocation.checkPermissions();
    if (permissions.location !== 'granted' && permissions.coarseLocation !== 'granted') {
      permissions = await Geolocation.requestPermissions({ permissions: ['location', 'coarseLocation'] });
    }
    if (permissions.location !== 'granted' && permissions.coarseLocation !== 'granted') {
      return { status: 'denied', message: '未授权定位；可无定位建站' };
    }
    const position = await Geolocation.getCurrentPosition(POSITION_OPTIONS);
    return fromPosition(position, 'native-gps');
  } catch (error) {
    return errorResult(error);
  }
}

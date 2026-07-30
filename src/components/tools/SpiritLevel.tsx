import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, useSpring } from 'framer-motion';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  Gauge,
  RefreshCcw,
  RotateCcw,
  Smartphone,
} from 'lucide-react';
import { applyDeadZone, boundedBubblePosition, lowPassTilt, rotateForScreen } from '../../lib/spiritLevel';

type PermissionState = 'idle' | 'requesting' | 'active' | 'denied' | 'unsupported' | 'no-data' | 'error';
type PermissionResult = 'granted' | 'denied';
type SensorPermissionOutcome = PermissionResult | 'unavailable' | 'error';
type SensorSource = '方向传感器' | '重力传感器';

interface PermissionCapableConstructor {
  requestPermission?: () => Promise<PermissionResult>;
}

interface TiltReading {
  x: number;
  y: number;
  source: SensorSource;
}

interface SensorCapabilities {
  orientation: boolean;
  motion: boolean;
}

const RENDER_INTERVAL_MS = 50;
const NO_DATA_TIMEOUT_MS = 3000;
const PERFECT_LIMIT_DEGREES = 0.3;
const WARNING_LIMIT_DEGREES = 1.5;

function getCapabilities(): SensorCapabilities {
  return {
    orientation: typeof window !== 'undefined' && 'DeviceOrientationEvent' in window,
    motion: typeof window !== 'undefined' && 'DeviceMotionEvent' in window,
  };
}

async function requestSensorPermission(
  available: boolean,
  constructor: PermissionCapableConstructor | undefined,
): Promise<SensorPermissionOutcome> {
  if (!available || !constructor) return 'unavailable';
  if (!constructor.requestPermission) return 'granted';
  try {
    return await constructor.requestPermission() === 'granted' ? 'granted' : 'denied';
  } catch (error) {
    console.error('[SpiritLevel] 单个传感器权限请求失败', error);
    return 'error';
  }
}

function getScreenAngle(): number {
  const screenAngle = window.screen.orientation?.angle;
  if (Number.isFinite(screenAngle)) return Number(screenAngle);
  const legacyAngle = (window as Window & { orientation?: number }).orientation;
  return Number.isFinite(legacyAngle) ? Number(legacyAngle) : 0;
}

function orientationToTilt(beta: number, gamma: number, screenAngle: number): { x: number; y: number } {
  const verticalPitch = beta >= 0 ? beta - 90 : beta + 90;
  const roll = beta < 0 ? -gamma : gamma;
  return rotateForScreen(roll, verticalPitch, screenAngle);
}

function motionToTilt(
  acceleration: DeviceMotionEventAcceleration,
  screenAngle: number,
): { x: number; y: number } | null {
  const { x, y, z } = acceleration;
  if (![x, y, z].every((value) => typeof value === 'number' && Number.isFinite(value))) return null;
  const side = Math.atan2(x as number, Math.hypot(y as number, z as number)) * 180 / Math.PI;
  const front = Math.atan2(z as number, Math.hypot(x as number, y as number)) * 180 / Math.PI;
  return rotateForScreen(side, front, screenAngle);
}

export function SpiritLevel({ onBack }: { onBack: () => void }) {
  const capabilities = useMemo(getCapabilities, []);
  const [permissionState, setPermissionState] = useState<PermissionState>('idle');
  const [enabledSensors, setEnabledSensors] = useState<SensorCapabilities>({ orientation: false, motion: false });
  const [reading, setReading] = useState<TiltReading | null>(null);
  const [isCalibrated, setIsCalibrated] = useState(false);

  const screenAngleRef = useRef(0);
  const filteredRef = useRef<{ x: number; y: number } | null>(null);
  const latestRef = useRef<TiltReading | null>(null);
  const calibrationRef = useRef({ x: 0, y: 0 });
  const lastOrientationAtRef = useRef(0);
  const renderTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const noDataTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const centeredRef = useRef(false);
  const mountedRef = useRef(true);

  const bubbleX = useSpring(0, { damping: 26, stiffness: 210, mass: 0.5 });
  const bubbleY = useSpring(0, { damping: 26, stiffness: 210, mass: 0.5 });

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const requestAccess = useCallback(async () => {
    if (!capabilities.orientation && !capabilities.motion) {
      setPermissionState('unsupported');
      return;
    }

    setPermissionState('requesting');
    try {
      const orientationConstructor = capabilities.orientation
        ? DeviceOrientationEvent as unknown as PermissionCapableConstructor
        : undefined;
      const motionConstructor = capabilities.motion
        ? DeviceMotionEvent as unknown as PermissionCapableConstructor
        : undefined;
      const [orientationOutcome, motionOutcome] = await Promise.all([
        requestSensorPermission(capabilities.orientation, orientationConstructor),
        requestSensorPermission(capabilities.motion, motionConstructor),
      ]);
      if (!mountedRef.current) return;
      const enabled = {
        orientation: orientationOutcome === 'granted',
        motion: motionOutcome === 'granted',
      };
      if (!enabled.orientation && !enabled.motion) {
        setEnabledSensors(enabled);
        setPermissionState(orientationOutcome === 'error' || motionOutcome === 'error' ? 'error' : 'denied');
        return;
      }
      setEnabledSensors(enabled);
      filteredRef.current = null;
      latestRef.current = null;
      setReading(null);
      setPermissionState('active');
    } catch (error) {
      console.error('[SpiritLevel] 传感器权限请求失败', error);
      if (mountedRef.current) setPermissionState('error');
    }
  }, [capabilities.motion, capabilities.orientation]);

  useEffect(() => {
    if (permissionState !== 'active') return;

    screenAngleRef.current = getScreenAngle();
    const updateScreenAngle = () => {
      screenAngleRef.current = getScreenAngle();
      filteredRef.current = null;
      latestRef.current = null;
      calibrationRef.current = { x: 0, y: 0 };
      setIsCalibrated(false);
      setReading(null);
      bubbleX.set(0);
      bubbleY.set(0);
    };

    const publishReading = () => {
      renderTimerRef.current = null;
      const latest = latestRef.current;
      if (!latest) return;
      const calibrated = {
        x: applyDeadZone(latest.x - calibrationRef.current.x),
        y: applyDeadZone(latest.y - calibrationRef.current.y),
        source: latest.source,
      };
      const bubble = boundedBubblePosition(calibrated.x, calibrated.y);
      bubbleX.set(bubble.x);
      bubbleY.set(bubble.y);
      setReading(calibrated);
    };

    const acceptTilt = (x: number, y: number, source: SensorSource) => {
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      if (noDataTimerRef.current) {
        clearTimeout(noDataTimerRef.current);
        noDataTimerRef.current = null;
      }
      const previous = filteredRef.current;
      const filtered = lowPassTilt(previous, { x, y });
      filteredRef.current = filtered;
      latestRef.current = { ...filtered, source };
      if (!renderTimerRef.current) {
        renderTimerRef.current = setTimeout(publishReading, RENDER_INTERVAL_MS);
      }
    };

    const handleOrientation = (event: DeviceOrientationEvent) => {
      if (event.beta === null || event.gamma === null) return;
      if (!Number.isFinite(event.beta) || !Number.isFinite(event.gamma)) return;
      lastOrientationAtRef.current = Date.now();
      const tilt = orientationToTilt(event.beta, event.gamma, screenAngleRef.current);
      acceptTilt(tilt.x, tilt.y, '方向传感器');
    };

    const handleMotion = (event: DeviceMotionEvent) => {
      if (Date.now() - lastOrientationAtRef.current < 1000) return;
      if (!event.accelerationIncludingGravity) return;
      const tilt = motionToTilt(event.accelerationIncludingGravity, screenAngleRef.current);
      if (tilt) acceptTilt(tilt.x, tilt.y, '重力传感器');
    };

    if (enabledSensors.orientation) window.addEventListener('deviceorientation', handleOrientation);
    if (enabledSensors.motion) window.addEventListener('devicemotion', handleMotion);
    window.screen.orientation?.addEventListener('change', updateScreenAngle);
    window.addEventListener('orientationchange', updateScreenAngle);

    noDataTimerRef.current = setTimeout(() => {
      if (!latestRef.current) setPermissionState('no-data');
    }, NO_DATA_TIMEOUT_MS);

    return () => {
      if (enabledSensors.orientation) window.removeEventListener('deviceorientation', handleOrientation);
      if (enabledSensors.motion) window.removeEventListener('devicemotion', handleMotion);
      window.screen.orientation?.removeEventListener('change', updateScreenAngle);
      window.removeEventListener('orientationchange', updateScreenAngle);
      if (renderTimerRef.current) clearTimeout(renderTimerRef.current);
      if (noDataTimerRef.current) clearTimeout(noDataTimerRef.current);
      renderTimerRef.current = null;
      noDataTimerRef.current = null;
      bubbleX.set(0);
      bubbleY.set(0);
    };
  }, [bubbleX, bubbleY, enabledSensors.motion, enabledSensors.orientation, permissionState]);

  const calibrate = useCallback(() => {
    const latest = latestRef.current;
    if (!latest) return;
    calibrationRef.current = { x: latest.x, y: latest.y };
    setIsCalibrated(true);
    bubbleX.set(0);
    bubbleY.set(0);
    setReading({ x: 0, y: 0, source: latest.source });
  }, [bubbleX, bubbleY]);

  const resetCalibration = useCallback(() => {
    calibrationRef.current = { x: 0, y: 0 };
    setIsCalibrated(false);
    const latest = latestRef.current;
    if (latest) setReading(latest);
  }, []);

  const deviation = reading ? Math.hypot(reading.x, reading.y) : null;
  const levelState = deviation === null
    ? '等待传感器'
    : deviation <= PERFECT_LIMIT_DEGREES
      ? '已对中'
      : deviation <= WARNING_LIMIT_DEGREES
        ? '接近垂直'
        : '偏离垂直';

  useEffect(() => {
    const centered = deviation !== null && deviation <= PERFECT_LIMIT_DEGREES;
    if (centered && !centeredRef.current && navigator.vibrate) navigator.vibrate(10);
    centeredRef.current = centered;
  }, [deviation]);

  if (permissionState !== 'active') {
    const unsupported = permissionState === 'unsupported';
    const denied = permissionState === 'denied';
    const noData = permissionState === 'no-data';
    const failed = permissionState === 'error';
    const title = unsupported
      ? '设备不支持电子气泡'
      : denied
        ? '传感器权限已拒绝'
        : noData
          ? '未收到传感器数据'
          : failed
            ? '传感器启动失败'
            : '启动电子气泡';
    const description = unsupported
      ? '当前浏览器未提供方向或重力传感器接口。此工具不会生成模拟读数。'
      : denied
        ? '请在系统或浏览器设置中允许动作与方向访问，然后重试。'
        : noData
          ? '设备虽提供接口，但暂未返回真实读数。请确认系统传感器权限后重试。'
          : '需要设备方向或重力传感器。请将手机竖直贴近水准尺，再点击启动。';

    return (
      <main className="app-safe-screen relative mx-auto flex min-h-[100dvh] w-full max-w-xl flex-col items-center justify-center px-4 pb-28 text-center">
        <button type="button" onClick={onBack} aria-label="返回首页" title="返回首页" className="app-safe-floating-top absolute left-3 flex min-h-11 min-w-11 items-center justify-center rounded-xl text-slate-600 transition-colors hover:bg-white/60 active:scale-95 dark:text-slate-300 dark:hover:bg-gray-800/60">
          <ChevronLeft className="h-5 w-5" />
        </button>
        <div className="mb-5 flex h-20 w-20 items-center justify-center rounded-full border border-white/80 bg-white/65 shadow-lg backdrop-blur-xl dark:border-gray-700 dark:bg-gray-800/60">
          {unsupported || denied || noData || failed
            ? <AlertTriangle className="h-9 w-9 text-amber-500" />
            : <Smartphone className="h-10 w-10 text-cyan-500" />}
        </div>
        <h1 className="text-xl font-black text-slate-800 dark:text-slate-100">{title}</h1>
        <p className="mt-3 max-w-[290px] text-sm leading-6 text-slate-500 dark:text-slate-400">{description}</p>
        {!unsupported && (
          <button
            type="button"
            onClick={requestAccess}
            disabled={permissionState === 'requesting'}
            className="mt-7 flex min-h-12 min-w-44 items-center justify-center gap-2 rounded-2xl bg-cyan-500 px-6 font-bold text-white shadow-lg shadow-cyan-500/25 active:scale-95 disabled:opacity-60"
          >
            <RefreshCcw className={`h-4 w-4 ${permissionState === 'requesting' ? 'animate-spin' : ''}`} />
            {permissionState === 'requesting' ? '正在请求权限' : noData || denied || failed ? '重新尝试' : '启动传感器'}
          </button>
        )}
        <p className="mt-4 text-[11px] text-slate-400">
          方向接口：{capabilities.orientation ? '可用' : '不可用'} · 重力接口：{capabilities.motion ? '可用' : '不可用'}
        </p>
      </main>
    );
  }

  const perfect = deviation !== null && deviation <= PERFECT_LIMIT_DEGREES;
  const warning = deviation !== null && deviation > PERFECT_LIMIT_DEGREES && deviation <= WARNING_LIMIT_DEGREES;
  const statusColor = perfect
    ? 'bg-emerald-500 shadow-emerald-500/50'
    : warning
      ? 'bg-amber-400 shadow-amber-400/50'
      : 'bg-red-500 shadow-red-500/40';
  const textColor = perfect ? 'text-emerald-600' : warning ? 'text-amber-600' : 'text-red-500';
  const ringColor = perfect ? 'border-emerald-500/40' : warning ? 'border-amber-400/35' : 'border-red-500/30';

  return (
    <main className="app-safe-screen mx-auto flex min-h-[100dvh] w-full max-w-xl flex-col items-center overflow-x-hidden px-3 pb-28 min-[360px]:px-4">
      <header className="relative mb-5 w-full min-h-11 text-center">
        <button type="button" onClick={onBack} aria-label="返回首页" title="返回首页" className="absolute left-0 top-0 flex min-h-11 min-w-11 items-center justify-center rounded-xl text-slate-600 transition-colors hover:bg-white/60 active:scale-95 dark:text-slate-300 dark:hover:bg-gray-800/60">
          <ChevronLeft className="h-5 w-5" />
        </button>
        <div className="px-12">
          <p className="text-xs font-semibold tracking-[0.2em] text-amber-500">工具箱</p>
          <h1 className="mt-1 text-xl font-black text-slate-800 dark:text-slate-100">电子气泡</h1>
          <p className="mt-1 text-[11px] text-slate-400">真实传感器 · {reading?.source ?? '等待读数'}</p>
        </div>
      </header>

      <section aria-live="polite" className="mb-4 w-full max-w-sm rounded-3xl border border-white/80 bg-white/65 p-4 shadow-glass backdrop-blur-xl dark:border-gray-700 dark:bg-gray-800/60">
        <div className="flex items-center justify-between gap-3">
          <div>
            <span className="block text-xs text-slate-500">中心偏差</span>
            <strong className={`font-mono text-3xl ${textColor}`}>{deviation === null ? '--' : deviation.toFixed(2)}°</strong>
          </div>
          <div className={`flex min-h-11 items-center gap-2 rounded-2xl px-3 text-sm font-bold ${perfect ? 'bg-emerald-50 text-emerald-700' : warning ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-600'}`}>
            {perfect ? <CheckCircle2 className="h-4 w-4" /> : <Gauge className="h-4 w-4" />}
            <span>水平状态：{levelState}</span>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 font-mono text-sm">
          <div className="rounded-xl bg-slate-50/90 p-2.5 text-slate-700 dark:bg-gray-900/60 dark:text-slate-200">X：{reading ? reading.x.toFixed(2) : '--'}°</div>
          <div className="rounded-xl bg-slate-50/90 p-2.5 text-slate-700 dark:bg-gray-900/60 dark:text-slate-200">Y：{reading ? reading.y.toFixed(2) : '--'}°</div>
        </div>
      </section>

      <section className="relative flex h-[min(78vw,280px)] w-[min(78vw,280px)] min-h-[240px] min-w-[240px] items-center justify-center" aria-label="电子气泡靶盘">
        <div className="absolute inset-0 rounded-full border-2 border-white/70 bg-white/45 shadow-[inset_0_4px_20px_rgba(0,0,0,0.05),0_8px_32px_rgba(0,0,0,0.08)] backdrop-blur-xl dark:border-gray-700/60 dark:bg-gray-900/40" />
        <div className={`absolute h-[72%] w-[72%] rounded-full border-2 border-dashed ${ringColor}`} />
        <div className={`absolute h-[36%] w-[36%] rounded-full border ${ringColor}`} />
        <div className="absolute h-px w-[92%] bg-slate-300/60 dark:bg-gray-600/50" />
        <div className="absolute h-[92%] w-px bg-slate-300/60 dark:bg-gray-600/50" />
        <div className="absolute z-10 h-3 w-3 rounded-full border-2 border-slate-400/60" />
        <motion.div className="absolute z-20" style={{ x: bubbleX, y: bubbleY }}>
          <div className={`relative flex h-14 w-14 items-center justify-center overflow-hidden rounded-full border-2 border-white/80 shadow-xl ${statusColor}`}>
            <span className="absolute left-[16%] top-[12%] h-2.5 w-4 -rotate-45 rounded-full bg-white/45 blur-[1px]" />
            <span className="h-1.5 w-1.5 rounded-full bg-white/90" />
          </div>
        </motion.div>
      </section>

      <section className="mt-5 grid w-full max-w-sm grid-cols-2 gap-2">
        <button
          type="button"
          onClick={calibrate}
          disabled={!reading}
          className="flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-cyan-500 px-3 text-sm font-bold text-white shadow-lg shadow-cyan-500/20 active:scale-95 disabled:opacity-40"
        >
          <Gauge className="h-4 w-4" />归零校准
        </button>
        <button
          type="button"
          onClick={resetCalibration}
          disabled={!isCalibrated}
          className="flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-white/80 bg-white/70 px-3 text-sm font-bold text-slate-600 shadow-glass active:scale-95 disabled:opacity-40 dark:border-gray-700 dark:bg-gray-800/60 dark:text-slate-300"
        >
          <RotateCcw className="h-4 w-4" />取消校准
        </button>
      </section>
      <p className="mt-4 max-w-[280px] text-center text-[10px] leading-5 text-slate-400">
        将手机竖直贴紧水准尺后校准。读数经过低通滤波和 0.05° 死区处理；仅作现场辅助，不替代仪器检定。
      </p>
    </main>
  );
}

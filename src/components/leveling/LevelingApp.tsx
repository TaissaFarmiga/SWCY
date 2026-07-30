import { ResultDrawer } from './ResultDrawer';
import { RadarTrajectoryDrawer } from './RadarTrajectoryDrawer';
import { LevelingProfileDrawer } from './LevelingProfileDrawer';
import { useEffect, useState, useRef, useMemo } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Plus, Waves, History, Play, Square, Sun, Moon, Trash2, Download, Upload, Settings, LineChart, MapPin, Calendar, BarChart3, Navigation, ChevronLeft } from 'lucide-react';

// 导入真实的资产图标
import hydroIconSrc from '../../../assets/icon.svg';

import { useLevelingStore } from '../../store/levelingStore';
import type { LevelingGrade, LevelingRoute } from '../../types/leveling';
import { StationCard } from './StationCard';
import { LevelingSaveHub } from './LevelingSaveHub';
import { useUiStore } from '../../store/uiStore';

// 📊 Numbers 图标
function NumbersIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="2" y="15" width="20" height="7" rx="3" fill="#34C759" />
      <rect x="5" y="8" width="3.5" height="7" rx="1" fill="#007AFF" />
      <rect x="10.25" y="5" width="3.5" height="10" rx="1" fill="#FFCC00" />
      <rect x="15.5" y="2" width="3.5" height="13" rx="1" fill="#34C759" />
    </svg>
  );
}

const formatTime = (timeStr?: string) => {
  if (!timeStr) return '--:--';
  const d = new Date(timeStr);
  if (!isNaN(d.getTime())) return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return '--:--';
};

const getLocalDatetime = (isoStr?: string) => {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  if (isNaN(d.getTime())) return '';
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
};

function GlassButton({ children, onClick, className = '', highlight = false, disabled = false, title }: { children: React.ReactNode; onClick?: () => void; className?: string; highlight?: boolean; disabled?: boolean; title?: string; }) {
  return (
    <button onClick={onClick} disabled={disabled} title={title} className={`flex min-h-11 min-w-11 items-center justify-center gap-1 px-2 py-1.5 rounded-lg backdrop-blur-md border shadow-sm transition-all active:scale-95 shrink-0 disabled:opacity-40 ${
      highlight ? 'bg-blue-600 text-white border-blue-500 shadow-blue-500/20 hover:bg-blue-700' : 'bg-white/60 dark:bg-gray-800/60 border-white/80 dark:border-gray-600/50 text-slate-700 dark:text-slate-200 hover:bg-white/80 dark:hover:bg-gray-700/80'
    } ${className}`}>
      {children}
    </button>
  );
}

function DeleteRouteButton({ onDelete }: { onDelete: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);
  const tap1 = () => { setConfirming(true); timerRef.current = setTimeout(() => setConfirming(false), 3000); };
  const tap2 = () => { if (timerRef.current) clearTimeout(timerRef.current); setConfirming(false); onDelete(); };
  return confirming ? (
    <button aria-label="确认删除历史任务" onClick={(e) => { e.stopPropagation(); tap2(); }} className="min-h-11 min-w-11 p-0.5 rounded bg-red-500 text-white text-[9px] font-bold animate-pulse shrink-0">确认</button>
  ) : (
    <button aria-label="删除历史任务" onClick={(e) => { e.stopPropagation(); tap1(); }} className="min-h-11 min-w-11 p-0.5 rounded hover:bg-red-50 text-slate-400 hover:text-red-500 shrink-0"><Trash2 className="w-3 h-3" /></button>
  );
}

export function LevelingApp({ isActive = true, onBack }: { isActive?: boolean; onBack: () => void }) {
  const { currentRoute, routes, hasHydrated } = useLevelingStore();
  const {
    updateRouteMeta, addStation, markTime, showHistoryPanel, toggleHistoryPanel,
    loadRoute, deleteRoute, createRoute, addKnownPoint, updateKnownPoint, removeKnownPoint,
    lastAddedStationId, setLastAddedStationId // 🚀 订阅自动定位所需的临时 ID
  } = useLevelingStore();

  const darkMode = useUiStore((state) => state.darkMode);
  const setDarkMode = useUiStore((state) => state.setDarkMode);

  const [showSettings, setShowSettings] = useState(false);
  const [showResultDrawer, setShowResultDrawer] = useState(false);
  const [showRadarDrawer, setShowRadarDrawer] = useState(false);
  const [showProfileDrawer, setShowProfileDrawer] = useState(false);
  const [isLocating, setIsLocating] = useState(false); // GPS 寻星 Loading 状态
  const lastGradeWheelAtRef = useRef(0);

  useEffect(() => {
    if (!isActive) return;
    const handleAppBack = (event: Event) => {
      if (showResultDrawer) setShowResultDrawer(false);
      else if (showProfileDrawer) setShowProfileDrawer(false);
      else if (showRadarDrawer) setShowRadarDrawer(false);
      else if (showSettings) setShowSettings(false);
      else if (showHistoryPanel) toggleHistoryPanel();
      else return;
      event.preventDefault();
    };
    window.addEventListener('hydro-app-back', handleAppBack);
    return () => window.removeEventListener('hydro-app-back', handleAppBack);
  }, [isActive, showHistoryPanel, showProfileDrawer, showRadarDrawer, showResultDrawer, showSettings, toggleHistoryPanel]);

  // 🛰️ 异步 GPS 打卡建站钩子
  const handleAddStationWithGPS = async () => {
    if (isLocating) return;
    setIsLocating(true);
    try {
      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 4000, // 4秒极限超时，防止野外无信号卡死干活进度
          maximumAge: 10000
        });
      });
      // 成功抓取坐标，带经纬度建站
      addStation(undefined, position.coords.latitude, position.coords.longitude);
    } catch (error) {
      console.warn('GPS 信号弱或未授权，安全降级为无坐标建站', error);
      addStation(); // 降级兜底
    } finally {
      setIsLocating(false);
    }
  };

  // 🚀 自动定位 useEffect (背后定位逻辑与测流完全对齐)
  useEffect(() => {
    if (lastAddedStationId) {
      const t = setTimeout(() => {
        document.getElementById(`station-${lastAddedStationId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setLastAddedStationId(null); // 定焦完毕后清空 ID
      }, 100);
      return () => clearTimeout(t);
    }
  }, [lastAddedStationId, setLastAddedStationId]);

  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data: unknown = JSON.parse(ev.target?.result as string);
        if (typeof data === 'object' && data !== null && 'stations' in data) useLevelingStore.getState().importBackup(data);
      } catch (err) { console.error("备份文件解析失败", err); }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const stations = currentRoute.stations;
  const stationCount = stations.length;
  const calculation = currentRoute.calculation;
  const isErrorOverLimit = calculation.isWithinTolerance === false;
  const evalStatus = calculation.isWithinTolerance === null ? '待闭合' : calculation.isWithinTolerance ? '合格' : '超限';
  const routeTypeLabel = currentRoute.routeType === 'attached'
    ? '附合水准路线'
    : currentRoute.routeType === 'closed'
      ? '闭合水准路线'
      : currentRoute.routeType === 'round-trip'
        ? '往返水准路线'
        : '开放水准路线';

  const sortedRoutes = useMemo(() => routes.slice().sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()).slice(0, 10), [routes]);
  const getHistoryName = (route: LevelingRoute) => {
    const targetTime = route.startTime || route.createdAt;
    const d = new Date(targetTime);
    const timeDisplay = isNaN(d.getTime()) ? '--:--' : `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    const loc = route.location ? `${route.location} ` : '';
    const name = route.name || '未设置测量对象';
    return `${loc}${name} ${timeDisplay}`;
  };

  if (!isActive) return null;
  if (!hasHydrated) return <div className="flex min-h-[100dvh] items-center justify-center text-sm text-slate-400">正在恢复水准测量数据…</div>;

  return (
    <div data-testid="leveling-screen" className="min-h-screen pb-8 bg-gradient-to-br from-[#F2F2F7] to-slate-100 dark:from-gray-950 dark:to-slate-900 overflow-x-hidden">

      {/* 🚀 第 1 层：全局微光标题栏 */}
      <header className="app-safe-header relative z-20 bg-[#F2F2F7] dark:bg-gray-950 border-b border-slate-200/60 dark:border-gray-800/60">
        <div className="px-2 py-1.5 flex flex-wrap items-center justify-between gap-1.5">
          <button type="button" onClick={onBack} aria-label="返回首页" title="返回首页" className="flex min-h-11 items-center gap-1 rounded-xl pr-1.5 text-left transition-colors hover:bg-white/60 active:scale-[0.98] dark:hover:bg-gray-800/60">
            <ChevronLeft className="h-5 w-5 shrink-0 text-slate-500 dark:text-slate-300" />
            {/* 彻底去除冗余的白边、padding和border，让原生图标完全透出 */}
            <div className="shrink-0 w-7 h-7 flex items-center justify-center overflow-hidden">
              <img src={hydroIconSrc} alt="logo" className="w-full h-full object-contain" />
            </div>
            <div className="flex flex-col justify-center">
              <span className="max-w-[120px] text-[13px] font-bold text-slate-800 dark:text-white truncate leading-tight">
                {currentRoute.name || '未设置测量对象'}
              </span>
              <div className="flex items-center mt-0.5">
                <span className="text-[9px] font-bold text-indigo-500/90 dark:text-indigo-400/90 leading-none bg-indigo-50 dark:bg-indigo-900/30 px-1 py-[3px] rounded-md border border-indigo-100 dark:border-indigo-800/50">
                  {routeTypeLabel}
                </span>
              </div>
            </div>
          </button>
          <div className="flex items-center gap-1 flex-wrap justify-end">
            <button onClick={() => document.getElementById('leveling-import-input')?.click()} className="flex min-h-11 min-w-11 items-center justify-center rounded-md bg-white/60 dark:bg-gray-800/60 border border-white/80 dark:border-gray-700 text-slate-500 hover:text-amber-600 hover:bg-amber-50" title="导入 JSON"><Download className="w-4 h-4" /></button>
            <button onClick={() => useLevelingStore.getState().exportCurrentRouteJSON()} className="flex min-h-11 min-w-11 items-center justify-center rounded-md bg-white/60 dark:bg-gray-800/60 border border-white/80 dark:border-gray-700 text-slate-500 hover:text-indigo-600" title="导出 JSON"><Upload className="w-4 h-4" /></button>
            <button onClick={() => void useLevelingStore.getState().exportData().catch((error: unknown) => console.error('[水准导出] 生成 Excel 失败', error))} className="flex min-h-11 min-w-11 items-center justify-center rounded-md bg-white/60 dark:bg-gray-800/60 border border-white/80 dark:border-gray-700 text-slate-500 hover:text-emerald-600" title="导出 Numbers/Excel"><NumbersIcon className="w-4 h-4" /></button>
            <button onClick={() => setDarkMode(!darkMode)} aria-label={darkMode ? '切换浅色模式' : '切换深色模式'} className="flex min-h-11 min-w-11 items-center justify-center rounded-md bg-white/60 dark:bg-gray-800/60 border border-white/80 dark:border-gray-700 text-slate-500 hover:bg-slate-100 dark:hover:bg-gray-800">
              {darkMode ? <Sun className="w-4 h-4 text-yellow-400" /> : <Moon className="w-4 h-4" />}
            </button>
            <input id="leveling-import-input" type="file" accept=".json" onChange={handleImportFile} className="w-0 h-0 opacity-0 absolute pointer-events-none" />
          </div>
        </div>
      </header>

      {/* 🚀 第 2 层：动态全息 HUD 仪表盘 (Universal HUD) */}
      <div className="relative z-30 px-2 py-2 bg-gradient-to-b from-[#F2F2F7]/80 dark:from-gray-950/80 to-transparent backdrop-blur-sm">
        <div className="flex flex-col gap-2.5 p-3 rounded-[16px] bg-white/70 dark:bg-gray-900/60 border border-white/80 dark:border-gray-700/50 shadow-sm backdrop-blur-md">

          {/* 上层：三大外业生命线指标 */}
          <div className="flex items-center justify-between divide-x divide-slate-200/50 dark:divide-gray-700/50">
            <div className="flex-1 flex flex-col items-center justify-center">
              <span className="text-[10px] text-slate-400 dark:text-slate-500 font-medium mb-0.5">累计高差</span>
              <div className="flex items-baseline gap-0.5">
                <span className={`font-mono text-[13px] font-black ${(currentRoute.totalDeltaHeight ?? 0) > 0 ? 'text-rose-500' : 'text-indigo-500'}`}>
                  {currentRoute.totalDeltaHeight === null ? '--' : `${currentRoute.totalDeltaHeight > 0 ? '+' : ''}${currentRoute.totalDeltaHeight.toFixed(4)}`}
                </span>
                <span className="text-[9px] text-slate-400">m</span>
              </div>
            </div>

            <div className="flex-1 flex flex-col items-center justify-center">
              <span className="text-[10px] text-slate-400 dark:text-slate-500 font-medium mb-0.5">累计视距差</span>
              <div className="flex items-baseline gap-0.5">
                <span className={`font-mono text-[13px] font-black ${Math.abs(stations[stationCount - 1]?.result.accumulatedDistanceDiff ?? 0) > 4 ? 'text-amber-500 animate-pulse' : 'text-slate-700 dark:text-slate-200'}`}>
                  {stations[stationCount - 1]?.result.accumulatedDistanceDiff === null || stationCount === 0
                    ? '--'
                    : `${(stations[stationCount - 1].result.accumulatedDistanceDiff ?? 0) > 0 ? '+' : ''}${stations[stationCount - 1].result.accumulatedDistanceDiff?.toFixed(1)}`}
                </span>
                <span className="text-[9px] text-slate-400">m</span>
              </div>
            </div>

            <div className="flex-1 flex flex-col items-center justify-center">
              <span className="text-[10px] text-slate-400 dark:text-slate-500 font-medium mb-0.5">测段里程</span>
              <div className="flex items-baseline gap-0.5">
                <span className="font-mono text-[13px] font-black text-slate-700 dark:text-slate-200">
                  {currentRoute.totalDistance > 0 ? currentRoute.totalDistance.toFixed(3) : '--'}
                </span>
                <span className="text-[9px] text-slate-400">km</span>
              </div>
            </div>
          </div>

          {/* 下层：智能变形质量雷达 */}
          <div className="pt-2 border-t border-slate-100/80 dark:border-gray-800/80">
            {(evalStatus === "合格" || evalStatus === "超限") && calculation.closureErrorMm !== null && calculation.allowableErrorMm !== null ? (
              // 🎯 状态 B：闭合对账，呈现容差 Health Bar
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between text-[10px] font-bold px-1">
                  <span className={`${isErrorOverLimit ? 'text-red-500 animate-pulse' : 'text-emerald-500'}`}>闭合差: {calculation.closureErrorMm.toFixed(1)} mm</span>
                  <span className="text-slate-400">容许: ±{calculation.allowableErrorMm.toFixed(1)} mm</span>
                </div>
                {/* 液态容差轨道 */}
                <div className="relative w-full h-1.5 bg-slate-200/70 dark:bg-gray-800 rounded-full overflow-visible my-0.5">
                  {/* 中心绝对零点标线 */}
                  <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-px h-3 bg-slate-400 dark:bg-gray-600 z-0" />
                  {/* 物理动态光标 */}
                  <div
                    className="absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full shadow-md z-10 transition-all duration-500 ease-out border-[1.5px] border-white dark:border-gray-900"
                    style={{
                      left: `clamp(0%, ${50 + calculation.closureErrorMm / Math.max(calculation.allowableErrorMm, 0.001) * 50}%, 100%)`,
                      backgroundColor: isErrorOverLimit ? '#ef4444' : '#10b981'
                    }}
                  />
                </div>
              </div>
            ) : (
              // 📡 状态 A：未闭合，保持静默追踪
              <div className="flex items-center justify-between px-1 py-0.5">
                <div className="flex items-center gap-2">
                  <div className="relative flex w-1.5 h-1.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-blue-500"></span>
                  </div>
                  <span className="text-[11px] font-bold text-slate-600 dark:text-slate-300 tracking-wide">引擎实时追踪中...</span>
                </div>
                <span className="text-[10px] font-mono font-bold text-slate-400 dark:text-slate-500 bg-slate-100/50 dark:bg-gray-800/50 px-2 py-0.5 rounded-md border border-slate-200/50 dark:border-gray-700/50">已测 {stationCount} 站</span>
              </div>
            )}
          </div>
        </div>

        {/* 🚀 第 3 层：极速打卡与存档枢纽 */}
        <div className="flex items-center gap-1.5 w-full pt-1.5">
          <div className="flex-1 flex items-center gap-1.5 overflow-x-auto no-scrollbar">
            <GlassButton onClick={() => createRoute(currentRoute.grade)} highlight className="px-2.5" title="新建路线">
              <Plus className="w-4 h-4 stroke-[2.5]" />
            </GlassButton>
            <GlassButton onClick={toggleHistoryPanel} className="min-w-[50px]" title="历史记录">
              <History className="w-3.5 h-3.5" />
              <span className="text-[11px] font-bold font-mono">{routes.length}</span>
            </GlassButton>
            <div className="w-px h-5 bg-slate-300/50 dark:bg-gray-600/50 mx-0.5 shrink-0" />
           <GlassButton onClick={() => markTime('start')} className="bg-green-50/60 dark:bg-green-900/20 border-green-200/50 dark:border-green-800/50 hover:bg-green-100/80 dark:hover:bg-green-900/40">
  <Play className="w-3.5 h-3.5 text-green-600 dark:text-green-400 fill-current" />
  <span className="text-[11px] font-mono font-bold text-green-700 dark:text-green-300">{formatTime(currentRoute.startTime)}</span>
</GlassButton>
<GlassButton onClick={() => markTime('end')} disabled={!currentRoute.startTime} className="bg-red-50/60 dark:bg-red-900/20 border-red-200/50 dark:border-red-800/50 hover:bg-red-100/80 dark:hover:bg-red-900/40">
  <Square className="w-3.5 h-3.5 text-red-500 dark:text-red-400 fill-current" />
  <span className="text-[11px] font-mono font-bold text-red-600 dark:text-red-300">{formatTime(currentRoute.endTime)}</span>
</GlassButton>
          </div>
          <LevelingSaveHub />
        </div>
      </div>

      {/* 📜 历史测次面板：紧贴在触发按钮(第3层)正下方 */}
      <div className="px-2 mb-2 relative z-20">
        <AnimatePresence>
          {showHistoryPanel && routes.length > 0 && (
            <motion.div
              initial={{ opacity: 0, scaleY: 0.95, transformOrigin: 'top' }}
              animate={{ opacity: 1, scaleY: 1 }}
              exit={{ opacity: 0, scaleY: 0.95 }}
              transition={{ duration: 0.15, ease: 'easeOut' }}
              style={{ willChange: 'transform, opacity' }}
              className="p-1.5 rounded-lg bg-white/60 dark:bg-gray-900/60 border border-white/80 dark:border-gray-700/80 max-h-64 overflow-y-auto shadow-sm custom-scrollbar"
            >
              <div className="flex flex-col gap-1">
                {sortedRoutes.map((route, index) => (
                  <div key={route.id} className={`flex items-center gap-1 px-1.5 py-1 rounded-md transition-all ${
                    route.id === currentRoute.id
                      ? 'bg-indigo-50/90 dark:bg-indigo-900/40 ring-2 ring-indigo-500 shadow-md'
                      : 'bg-slate-50 dark:bg-gray-800 hover:bg-slate-100 dark:hover:bg-gray-700'
                  }`}>
                    <button onClick={() => { loadRoute(route.id); toggleHistoryPanel(); }}
                      className="flex min-h-11 flex-1 items-center justify-between text-left min-w-0">
                      <div className="flex items-center gap-1.5 min-w-0 flex-1">
                        <span className={`text-[10px] font-bold shrink-0 ${route.id === currentRoute.id ? 'text-indigo-600 dark:text-indigo-400' : 'text-indigo-500 dark:text-cyan-400'}`}>#{index + 1}</span>
                        <span className={`text-[11px] truncate font-medium ${route.id === currentRoute.id ? 'text-indigo-900 dark:text-indigo-100' : 'text-slate-700 dark:text-slate-200'}`}>{getHistoryName(route)}</span>
                      </div>
                      <span className={`text-[10px] shrink-0 font-mono ml-2 ${route.id === currentRoute.id ? 'text-indigo-500 dark:text-indigo-300' : 'text-slate-400 dark:text-slate-500'}`}>{route.totalDistance.toFixed(2)} km</span>
                    </button>
                    <DeleteRouteButton onDelete={() => deleteRoute(route.id)} />
                  </div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* 🚀 第 4 层：测段工具栏 (Tool Bar) */}
      <div className="flex flex-wrap items-center justify-center gap-2 px-2 pb-2 relative z-0">

        {/* 🍏 极客交互：无尽莫比乌斯环 3D 机械滚轮 (Infinite Circular Drum) */}
        <motion.div
          role="button"
          tabIndex={0}
          aria-label={`当前等级：${currentRoute.grade === 'out' ? '普通' : `${currentRoute.grade}等`}，点击切换`}
          className="relative w-[64px] h-[44px] rounded-[12px] bg-slate-200/50 dark:bg-gray-800/50 shadow-[inset_0_2px_4px_rgba(0,0,0,0.1)] overflow-hidden shrink-0 cursor-ns-resize select-none touch-none z-10"
          style={{
            maskImage: 'linear-gradient(to bottom, transparent 0%, black 30%, black 70%, transparent 100%)',
            WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, black 30%, black 70%, transparent 100%)',
            perspective: '150px'
          }}
          onWheel={(e) => {
            const now = Date.now();
            if (now - lastGradeWheelAtRef.current < 150) return;
            const offset = e.deltaY;
            if (Math.abs(offset) < 5) return;
            lastGradeWheelAtRef.current = now;

            const grades: LevelingGrade[] = ['out', '4', '3'];
            const currentIndex = grades.indexOf(currentRoute.grade);

            // 🚀 环形取模：无视边界，无限循环
            const next = offset > 0
              ? (currentIndex + 1) % 3  // 滚轮向下 -> 切换到下一个
              : (currentIndex - 1 + 3) % 3; // 滚轮向上 -> 切换到上一个

            if (navigator.vibrate) navigator.vibrate(10);
            updateRouteMeta({ grade: grades[next] });
          }}
          onPanEnd={(_e, info) => {
            const offset = info.offset.y;
            if (Math.abs(offset) < 10) return;
            const grades: LevelingGrade[] = ['out', '4', '3'];
            const currentIndex = grades.indexOf(currentRoute.grade);

            // 🚀 环形取模：无视边界，无限循环
            const next = offset < 0
              ? (currentIndex + 1) % 3  // 手指上滑 -> 界面上移 -> 露出下方元素 (下一个)
              : (currentIndex - 1 + 3) % 3; // 手指下滑 -> 界面下移 -> 露出上方元素 (上一个)

            if (navigator.vibrate) navigator.vibrate(10);
            updateRouteMeta({ grade: grades[next] });
          }}
          onTap={() => {
             const grades: LevelingGrade[] = ['out', '4', '3'];
             const next = (grades.indexOf(currentRoute.grade) + 1) % 3;
             if (navigator.vibrate) navigator.vibrate(10);
             updateRouteMeta({ grade: grades[next] });
          }}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            const grades: LevelingGrade[] = ['out', '4', '3'];
            const next = (grades.indexOf(currentRoute.grade) + 1) % 3;
            updateRouteMeta({ grade: grades[next] });
          }}
        >
          {/* 🎯 居中高亮悬浮窗 */}
          <div className="absolute top-1/2 left-[4px] right-[4px] -translate-y-1/2 h-[24px] bg-white/90 dark:bg-gray-700/90 rounded-[8px] shadow-sm border border-slate-200/80 dark:border-gray-600/80 pointer-events-none" />

          {/* 3D 齿轮文字：引入最短圆柱路径算法 */}
          {(['out', '4', '3'] as LevelingGrade[]).map((g, i) => {
            const currentIndex = (['out', '4', '3'] as LevelingGrade[]).indexOf(currentRoute.grade);

            // 🚀 核心数学引擎：最短环形距离计算 (Shortest Circular Path Offset)
            // 确保当选中"三等"时，"普通"会自动瞬移到"三等"下方；当选中"普通"时，"三等"自动跑到"普通"上方。
            let offset = i - currentIndex;
            if (offset > 1) offset -= 3; // +2 修正为 -1 (瞬移到上方)
            if (offset < -1) offset += 3; // -2 修正为 +1 (瞬移到下方)

            return (
              <motion.div
                key={g}
                initial={false}
                animate={{
                  y: offset * 18, // 控制露出的高度
                  rotateX: offset * -50,
                  scale: offset === 0 ? 1 : 0.8,
                  opacity: offset === 0 ? 1 : 0.4,
                }}
                transition={{ type: 'spring', stiffness: 350, damping: 25 }}
                className={`absolute inset-0 flex items-center justify-center font-bold text-[13px] tracking-widest pointer-events-none ${offset === 0 ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-500 dark:text-slate-400'}`}
                style={{ transformStyle: 'preserve-3d' }}
              >
                {g === 'out' ? '普通' : g === '4' ? '四等' : '三等'}
              </motion.div>
            );
          })}
        </motion.div>

        {/* 设置按钮 */}
        <button type="button" onClick={() => setShowSettings(!showSettings)} title="测量设置" className={`flex min-h-11 min-w-11 items-center justify-center rounded-xl border shadow-sm active:scale-95 transition-all shrink-0 ${showSettings ? 'bg-indigo-500 text-white border-indigo-500' : 'bg-white/60 dark:bg-gray-800/60 border-white/80 dark:border-gray-700/60 text-slate-600 dark:text-slate-300 hover:bg-white/90'}`}>
          <Settings className="w-4 h-4" />
        </button>

        <motion.button type="button" onClick={() => setShowProfileDrawer(true)} whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }} className="relative flex min-h-11 items-center gap-1.5 overflow-hidden rounded-xl border border-indigo-400/40 bg-gradient-to-r from-indigo-600/80 to-blue-600/80 px-3 text-[11px] font-bold text-white shadow-lg shadow-indigo-500/20 shrink-0">
          <span className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent animate-shimmer" />
          <LineChart className="relative w-3.5 h-3.5" />
          <span className="relative">纵断面</span>
        </motion.button>

        {/* 雷达轨迹入口 */}
        <motion.button type="button" onClick={() => setShowRadarDrawer(true)} whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }} className="relative flex min-h-11 items-center gap-1.5 overflow-hidden rounded-xl border border-indigo-400/40 bg-gradient-to-r from-indigo-600/80 to-blue-600/80 px-3 text-[11px] font-bold text-white shadow-lg shadow-indigo-500/20 shrink-0">
          <span className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent animate-shimmer" />
          <Navigation className="relative w-3.5 h-3.5" />
          <span className="relative">雷达轨迹</span>
        </motion.button>

        {/* 成果表抽屉入口 */}
        <motion.button type="button" onClick={() => setShowResultDrawer(true)} whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }} className="relative flex min-h-11 items-center gap-1.5 overflow-hidden rounded-xl border border-emerald-400/40 bg-gradient-to-r from-emerald-500/90 to-teal-600/90 px-3 text-[11px] font-bold text-white shadow-lg shadow-emerald-500/20 shrink-0">
          <span className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent animate-shimmer" />
          <BarChart3 className="relative w-3.5 h-3.5" />
          <span className="relative">成果表</span>
        </motion.button>
      </div>

      {/* ⚙️ 内嵌测量设置面板 (场景化直录版) */}
      <AnimatePresence>
        {showSettings && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} className="overflow-hidden px-2 relative z-10 mb-2">
            <div className="p-2.5 bg-white dark:bg-gray-800 rounded-[14px] border border-slate-100 dark:border-gray-700 shadow-[0_2px_12px_rgba(0,0,0,0.04)] flex flex-col gap-2.5">

              <div className="flex items-center gap-2.5 bg-[#F8F9FA] dark:bg-gray-900 rounded-lg px-2.5 border border-slate-100 dark:border-gray-800">
                <Calendar className="w-4 h-4 text-blue-500 shrink-0" />
                <input
                  type="datetime-local"
                  value={getLocalDatetime(currentRoute.createdAt)}
                  onChange={(e) => {
                    const newD = new Date(e.target.value);
                    if (!isNaN(newD.getTime())) {
                      const iso = newD.toISOString();
                      updateRouteMeta({ createdAt: iso, startTime: iso });
                    }
                  }}
                  className="flex-1 py-1.5 text-xs bg-transparent border-0 outline-none text-slate-700 dark:text-slate-200 font-mono tracking-wide"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <label className="rounded-lg border border-slate-200 px-2 py-1 dark:border-gray-700">
                  <span className="block text-[10px] font-bold text-slate-400">路线类型</span>
                  <select value={currentRoute.routeType} onChange={(event) => updateRouteMeta({ routeType: event.target.value as LevelingRoute['routeType'] })} className="min-h-9 w-full bg-transparent text-xs font-bold text-slate-700 dark:text-slate-200">
                    <option value="attached">附合路线</option>
                    <option value="closed">闭合路线</option>
                    <option value="round-trip">往返路线</option>
                    <option value="open">开放路线</option>
                  </select>
                </label>
                <label className="rounded-lg border border-slate-200 px-2 py-1 dark:border-gray-700">
                  <span className="block text-[10px] font-bold text-slate-400">新站方向</span>
                  <select value={currentRoute.direction} onChange={(event) => updateRouteMeta({ direction: event.target.value as LevelingRoute['direction'] })} className="min-h-9 w-full bg-transparent text-xs font-bold text-slate-700 dark:text-slate-200">
                    <option value="forward">往测</option>
                    <option value="return">返测</option>
                  </select>
                </label>
              </div>

              <div className="flex items-center gap-2.5 rounded-lg px-2.5 border border-slate-200 dark:border-gray-700">
                <Navigation className="w-4 h-4 text-slate-400 shrink-0" />
                <input type="text" value={currentRoute.location || ''} onChange={(e) => updateRouteMeta({ location: e.target.value })} placeholder="位置信息 (如: 郑家屯（六）)" className="flex-1 py-1.5 text-[13px] bg-transparent border-0 focus:ring-0 outline-none text-slate-700 dark:text-slate-200" />
              </div>

              <div className="flex items-center gap-2.5 rounded-lg px-2.5 border border-slate-200 dark:border-gray-700">
                <MapPin className="w-4 h-4 text-slate-400 shrink-0" />
                <input type="text" value={currentRoute.name || ''} onChange={(e) => updateRouteMeta({ name: e.target.value })} placeholder="测量对象 (如: 基本水尺校测)" className="flex-1 py-1.5 text-[13px] bg-transparent border-0 focus:ring-0 outline-none text-slate-700 dark:text-slate-200" />
              </div>

              <div className="rounded-lg bg-indigo-50/70 px-2 py-1 text-[10px] leading-4 text-indigo-700 dark:bg-indigo-950/30 dark:text-indigo-300">
                当前仪器：{currentRoute.instrumentSnapshot?.name ?? (currentRoute.instrument || '未登记水准仪')}{currentRoute.instrumentSnapshot?.serialNumber ? ` · ${currentRoute.instrumentSnapshot.serialNumber}` : ''} · 规则 {currentRoute.ruleProfileSnapshot.name}
              </div>

              <div className="grid grid-cols-1 gap-2 min-[360px]:grid-cols-2">
                {([
                  ['taskNumber', '任务编号'], ['organization', '作业单位'], ['surveyor', '施测人员'], ['checker', '复核人员'],
                  ['backStaffNumber', '后尺编号'], ['foreStaffNumber', '前尺编号'], ['weather', '天气'], ['terrain', '地形'],
                ] as const).map(([key, placeholder]) => <input key={key} type="text" value={currentRoute[key] ?? ''} onChange={(event) => updateRouteMeta({ [key]: event.target.value })} placeholder={placeholder} className="min-h-11 min-w-0 rounded-lg border border-slate-200 bg-slate-50 px-2 text-xs text-slate-700 outline-none focus:border-indigo-400 dark:border-gray-700 dark:bg-gray-900 dark:text-slate-200" />)}
                <textarea value={currentRoute.notes ?? ''} onChange={(event) => updateRouteMeta({ notes: event.target.value })} placeholder="备注" className="min-h-16 min-w-0 resize-y rounded-lg border border-slate-200 bg-slate-50 px-2 py-2 text-xs text-slate-700 outline-none focus:border-indigo-400 dark:border-gray-700 dark:bg-gray-900 dark:text-slate-200 min-[360px]:col-span-2" />
              </div>

             {/* 💧 三栏并排：自适应宽度调优 */}
              <div className="flex items-center gap-2">
                {/* 1. 水尺编号：极限压缩宽度 (w-20 约 80px，仅供填 4 个字母) */}
                <div className="flex items-center gap-1 rounded-lg px-1.5 py-0.5 border border-slate-200 dark:border-gray-700 shrink-0 w-[72px]">
                  <span className="text-[11px] font-bold text-slate-400 shrink-0">水尺</span>
                  <input type="text" value={currentRoute.staffNumber || ''} onChange={(e) => updateRouteMeta({ staffNumber: e.target.value })} className="w-full py-1 bg-transparent border-0 focus:ring-0 outline-none text-blue-500 font-mono text-[13px] text-center px-0" />
                </div>
                {/* 2. 水位：弹性拉伸 */}
                <div className="flex items-center gap-1 rounded-lg px-1.5 py-0.5 border border-slate-200 dark:border-gray-700 flex-1 min-w-0">
                  <span className="text-[11px] font-bold text-slate-400 shrink-0">水位</span>
                  <input type="number" value={currentRoute.waterLevel || ''} onChange={(e) => updateRouteMeta({ waterLevel: e.target.value })} className="w-full py-1 bg-transparent border-0 focus:ring-0 outline-none text-blue-500 font-mono text-[13px] text-center px-0" />
                </div>
                {/* 3. 读数：文字标签，弹性拉伸 */}
                <div className="flex items-center gap-1 rounded-lg px-1.5 py-0.5 border border-slate-200 dark:border-gray-700 flex-1 min-w-0">
                  <span className="text-[11px] font-bold text-slate-400 shrink-0">读数</span>
                  <input type="number" value={currentRoute.waterEdgeReading || ''} onChange={(e) => updateRouteMeta({ waterEdgeReading: e.target.value })} className="w-full py-1 bg-transparent border-0 focus:ring-0 outline-none text-blue-500 font-mono text-[13px] text-center px-0" />
                </div>
              </div>

              {/* 👇 极致精简：录入测点高程 (等比例弹性拉伸版) */}
              <div className="mt-1 pt-2.5 border-t border-slate-100 dark:border-gray-700/50 flex flex-col gap-1.5">
                <div className="flex items-center justify-between px-1 mb-1">
                  <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400">📌 录入测点高程</span>
                </div>

                <div className="flex flex-col gap-1.5 w-full">
                  {currentRoute.knownPoints?.map((kp, idx) => (
                    <div key={kp.id} className="flex items-center gap-1.5 w-full">
                      <span className="text-[10px] text-slate-400 w-2.5 font-mono text-right shrink-0">{idx + 1}.</span>

                      {/* 点名输入：flex-1，最小宽度保障 */}
                      <input type="text" value={kp.name} onChange={e => updateKnownPoint(kp.id, 'name', e.target.value)} placeholder="点名" className="flex-1 min-w-[50px] py-1.5 px-2 text-[12px] font-bold bg-slate-50 dark:bg-gray-900 border border-slate-200 dark:border-gray-700 rounded-lg outline-none text-center text-slate-700 dark:text-slate-200 placeholder:text-slate-400 placeholder:font-normal" />

                      <span className="text-[10px] text-slate-400 font-bold shrink-0">原用:</span>

                      {/* 高程输入：flex-[1.2] 让它比点名稍微宽一点点，适应小数位 */}
                      <input type="number" inputMode="decimal" value={kp.elevation ?? ''} onChange={e => updateKnownPoint(kp.id, 'elevation', e.target.value === '' ? null : e.target.value)} placeholder="已知高程" className="flex-[1.2] min-w-[70px] py-1.5 px-2 text-[13px] font-mono font-bold text-blue-500 bg-slate-50 dark:bg-gray-900 border border-slate-200 dark:border-gray-700 rounded-lg outline-none placeholder:text-slate-400 placeholder:font-normal placeholder:text-[11px]" />

                      {/* 操作按钮组：固定在最右侧不被压缩 */}
                      <div className="flex items-center gap-0.5 shrink-0 ml-1">
                        <button onClick={() => addKnownPoint(kp.id)} aria-label={`在测点 ${idx + 1} 后添加测点`} className="flex min-h-11 min-w-11 items-center justify-center text-indigo-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-md transition-colors shadow-sm bg-white border border-slate-200">
                          <Plus className="w-3.5 h-3.5 stroke-[3]" />
                        </button>
                        <button onClick={() => removeKnownPoint(kp.id)} aria-label={`删除测点 ${idx + 1}`} className="flex min-h-11 min-w-11 items-center justify-center text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-md transition-colors shadow-sm bg-white border border-slate-200">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                  {(!currentRoute.knownPoints || currentRoute.knownPoints.length === 0) && (
                    <div className="flex flex-col items-center justify-center gap-2 py-3 bg-slate-50 dark:bg-gray-800/50 rounded-lg border border-dashed border-slate-200 dark:border-gray-700">
                      <span className="text-[10px] text-slate-400">暂无测点，闭合差与不符值将无法结算</span>
                      <button onClick={() => addKnownPoint()} className="flex items-center gap-1 text-[10px] font-bold bg-white text-indigo-500 border border-slate-200 px-3 py-1.5 rounded-md shadow-sm">
                        <Plus className="w-3 h-3 stroke-[3]" /> 添加第一个测点
                      </button>
                    </div>
                  )}
                </div>
              </div>

            </div>
          </motion.div>
        )}
      </AnimatePresence>


      {/* 🏗️ 瀑布流测站 */}
      <div className="px-2 pt-1 pb-6 space-y-2 relative z-0">
        <AnimatePresence mode="popLayout">
          {stations.map((station, index) => (
            <motion.div key={station.id} layout initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95 }} transition={{ duration: 0.2 }}>
              <StationCard station={station} index={index} grade={currentRoute.grade} />
            </motion.div>
          ))}
        </AnimatePresence>

        {stationCount === 0 && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="py-16 flex flex-col items-center justify-center text-slate-400">
            <Waves className="w-12 h-12 opacity-20 mb-3 text-indigo-500" />
            <p className="text-sm font-medium">暂无水准测站数据</p>
            <p className="text-[11px] opacity-70 mt-1">请点击下方按钮开始观测</p>
          </motion.div>
        )}

        {/* 🚀 异步 GPS 打卡添加新测站 */}
        <button onClick={handleAddStationWithGPS} disabled={isLocating}
          className="w-full min-h-11 flex items-center justify-center gap-1.5 p-2 rounded-xl bg-white/40 dark:bg-gray-900/40 border border-dashed border-slate-300 dark:border-gray-600 text-sm font-bold text-slate-500 dark:text-slate-400 hover:border-indigo-500 dark:hover:border-indigo-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-all disabled:opacity-50">
          {isLocating ? (
            <><div className="w-3.5 h-3.5 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" /><span>🛰️ 寻星定位中...</span></>
          ) : (
            <><Plus className="w-4 h-4 stroke-[3]" /><span>添加新测站</span></>
          )}
        </button>
      </div>

     {/* 📊 物理重力扭曲·成果抽屉 */}
      <AnimatePresence>
        {showResultDrawer && (
          <ResultDrawer onClose={() => setShowResultDrawer(false)} />
        )}

        {showProfileDrawer && (
          <LevelingProfileDrawer onClose={() => setShowProfileDrawer(false)} />
        )}

        {showRadarDrawer && (
          <RadarTrajectoryDrawer onClose={() => setShowRadarDrawer(false)} />
        )}
      </AnimatePresence>
    </div>
  );
}

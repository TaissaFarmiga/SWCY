import { ResultDrawer } from './ResultDrawer';
import { RadarTrajectoryDrawer } from './RadarTrajectoryDrawer';
import { LevelingProfileDrawer } from './LevelingProfileDrawer';
import { useEffect, useState, useRef, useMemo } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Plus, Waves, History, Play, Square, Sun, Moon, Trash2, Download, Upload, Settings, LineChart, MapPin, Calendar, BarChart3, Navigation, ChevronLeft, FileSpreadsheet } from 'lucide-react';

// 导入真实的资产图标

import { useLevelingStore } from '../../store/levelingStore';
import type { LevelingGrade, LevelingRoute, SurveyDirection } from '../../types/leveling';
import { StationCard } from './StationCard';
import { LevelingSaveHub } from './LevelingSaveHub';
import { useUiStore } from '../../store/uiStore';
import { captureStationLocation } from '../../lib/stationLocation';
import { triggerCenterFeedback } from '../../lib/mobileFeedback';

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
    <button onClick={onClick} disabled={disabled} title={title} className={`${highlight ? 'glass-primary-button' : 'glass-rounded-button'} shrink-0 disabled:opacity-40 ${className}`}>
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
    <button aria-label="确认删除历史任务" onClick={(e) => { e.stopPropagation(); tap2(); }} className="glass-danger-button shrink-0 animate-pulse">确认</button>
  ) : (
    <button aria-label="删除历史任务" onClick={(e) => { e.stopPropagation(); tap1(); }} className="glass-icon-button shrink-0 text-slate-400 hover:text-red-500"><Trash2 className="w-3 h-3" /></button>
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
  const [isLocating, setIsLocating] = useState(false);
  const [locationFailure, setLocationFailure] = useState<{ message: string; direction: SurveyDirection } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showNotice = (message: string) => {
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    setNotice(message);
    noticeTimerRef.current = setTimeout(() => setNotice(null), 3_200);
  };

  useEffect(() => () => {
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
  }, []);

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
  const handleAddStationWithGPS = async (direction: SurveyDirection) => {
    if (isLocating) return;
    setIsLocating(true);
    try {
      const result = await captureStationLocation();
      if (result.status === 'captured') {
        addStation(undefined, result.location, direction);
        setLocationFailure(null);
        showNotice(`已添加${direction === 'return' ? '返测' : '往测'}站${result.location.accuracyM ? `，定位精度 ±${Math.round(result.location.accuracyM)} m` : ''}`);
      } else {
        setLocationFailure({ message: result.message, direction });
      }
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
  const hasRecordedReadings = stations.some(({ readings }) => (
    readings.intermediates.length > 0
    || Object.values(readings).some((value) => typeof value === 'string' && value.trim() !== '')
  ));
  const changeGrade = (grade: LevelingGrade) => {
    if (grade === currentRoute.grade) return;
    if (hasRecordedReadings) {
      showNotice('已有读数，不能原地切换等级；请新建路线后选择等级');
      return;
    }
    updateRouteMeta({ grade });
    void triggerCenterFeedback();
  };
  const calculation = currentRoute.calculation;
  const isErrorOverLimit = calculation.isWithinTolerance === false;
  const evalStatus = calculation.isWithinTolerance === null ? '待闭合' : calculation.isWithinTolerance ? '合格' : '超限';
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

      <header data-testid="leveling-app-header" className="app-safe-header relative z-30 border-b border-white/70 bg-[#F2F2F7]/82 backdrop-blur-2xl dark:border-gray-700/70 dark:bg-gray-950/82">
        <div className="flex min-h-11 min-w-0 items-center gap-0.5 px-1.5 py-0.5">
          <button type="button" onClick={onBack} aria-label="返回首页" title="返回首页" className="glass-icon-button">
            <ChevronLeft className="h-5 w-5" />
          </button>
          <div className="min-w-[4.5rem] max-w-[7rem] flex-1 px-1"><h1 className="truncate text-sm font-bold text-slate-800 dark:text-white">{currentRoute.name || '水准测量'}</h1></div>
          <div data-testid="leveling-toolbar" className="app-page-toolbar min-w-0 flex-1">
            <button data-testid="leveling-result" type="button" onClick={() => setShowResultDrawer(true)} aria-label="成果表" title="成果表" className="glass-icon-button"><BarChart3 className="h-4 w-4" /></button>
            <button data-testid="leveling-profile" type="button" onClick={() => setShowProfileDrawer(true)} aria-label="纵断面" title="纵断面" className="glass-icon-button"><LineChart className="h-4 w-4" /></button>
            <button data-testid="leveling-radar" type="button" onClick={() => setShowRadarDrawer(true)} aria-label="测站轨迹" title="测站轨迹" className="glass-icon-button"><Navigation className="h-4 w-4" /></button>
            <button type="button" onClick={() => document.getElementById('leveling-import-input')?.click()} aria-label="导入JSON" title="导入JSON" className="glass-icon-button"><Download className="h-4 w-4" /></button>
            <button type="button" onClick={() => useLevelingStore.getState().exportCurrentRouteJSON()} aria-label="导出JSON" title="导出JSON" className="glass-icon-button"><Upload className="h-4 w-4" /></button>
            <button type="button" onClick={() => void useLevelingStore.getState().exportData().catch(() => showNotice('Excel 导出失败'))} aria-label="导出Excel" title="导出Excel" className="glass-icon-button"><FileSpreadsheet className="h-4 w-4" /></button>
            <button type="button" onClick={() => setShowSettings(true)} aria-label="测量设置" title="测量设置" className="glass-icon-button"><Settings className="h-4 w-4" /></button>
            <button type="button" onClick={() => setDarkMode(!darkMode)} aria-label={darkMode ? '浅色模式' : '深色模式'} title={darkMode ? '浅色模式' : '深色模式'} className="glass-icon-button">{darkMode ? <Sun className="h-4 w-4 text-amber-400" /> : <Moon className="h-4 w-4" />}</button>
          </div>
        </div>
        <input id="leveling-import-input" type="file" accept=".json" onChange={handleImportFile} className="sr-only" />
      </header>

      {/* 🚀 第 2 层：动态全息 HUD 仪表盘 (Universal HUD) */}
      <div className="relative z-30 px-2 py-1 bg-gradient-to-b from-[#F2F2F7]/80 dark:from-gray-950/80 to-transparent backdrop-blur-sm">
        <div className="flex flex-col gap-1.5 rounded-[14px] border border-white/80 bg-white/70 p-2 shadow-sm backdrop-blur-md dark:border-gray-700/50 dark:bg-gray-900/60">

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
          <div className="border-t border-slate-100/80 pt-1.5 dark:border-gray-800/80">
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
        <div className="flex w-full items-center gap-1 pt-1">
          <div className="no-scrollbar flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto pr-1">
            <GlassButton onClick={() => createRoute(currentRoute.grade)} highlight className="px-2.5" title="新建路线">
              <Plus className="w-4 h-4 stroke-[2.5]" />
            </GlassButton>
           <GlassButton onClick={() => markTime('start')} className="bg-green-50/60 dark:bg-green-900/20 border-green-200/50 dark:border-green-800/50 hover:bg-green-100/80 dark:hover:bg-green-900/40">
  <Play className="w-3.5 h-3.5 text-green-600 dark:text-green-400 fill-current" />
  <span className="text-[11px] font-mono font-bold text-green-700 dark:text-green-300">{formatTime(currentRoute.startTime)}</span>
</GlassButton>
<GlassButton onClick={() => markTime('end')} disabled={!currentRoute.startTime} className="bg-red-50/60 dark:bg-red-900/20 border-red-200/50 dark:border-red-800/50 hover:bg-red-100/80 dark:hover:bg-red-900/40">
  <Square className="w-3.5 h-3.5 text-red-500 dark:text-red-400 fill-current" />
  <span className="text-[11px] font-mono font-bold text-red-600 dark:text-red-300">{formatTime(currentRoute.endTime)}</span>
</GlassButton>
            <GlassButton onClick={toggleHistoryPanel} className="min-w-[50px]" title="历史记录">
              <History className="w-3.5 h-3.5" />
              <span className="text-[11px] font-bold font-mono">{routes.length}</span>
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

      <section className="px-2 pb-1.5">
        <div className="flex min-h-11 items-center gap-1 rounded-xl border border-white/75 bg-white/65 p-1 shadow-glass backdrop-blur-2xl dark:border-gray-700/70 dark:bg-gray-900/65">
          <div role="radiogroup" aria-label="水准等级" className="flex min-w-0 flex-1 rounded-full bg-slate-100/85 p-0.5 dark:bg-gray-800/85">
            {([['out', '普通'], ['4', '四等'], ['3', '三等']] as const).map(([grade, label]) => (
              <button key={grade} type="button" role="radio" aria-checked={currentRoute.grade === grade} onClick={() => changeGrade(grade)} className={`min-h-9 min-w-0 flex-1 rounded-full px-2 text-xs font-bold transition-colors ${currentRoute.grade === grade ? 'bg-white text-blue-600 shadow-sm dark:bg-gray-700 dark:text-cyan-300' : 'text-slate-500 dark:text-slate-400'}`}>
                {label}
              </button>
            ))}
          </div>
        </div>
      </section>

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

              <div className="grid grid-cols-1 gap-2">
                <label className="rounded-lg border border-slate-200 px-2 py-1 dark:border-gray-700">
                  <span className="block text-[10px] font-bold text-slate-400">路线类型</span>
                  <select value={currentRoute.routeType} onChange={(event) => updateRouteMeta({ routeType: event.target.value as LevelingRoute['routeType'] })} className="min-h-9 w-full bg-transparent text-xs font-bold text-slate-700 dark:text-slate-200">
                    <option value="attached">附合路线</option>
                    <option value="closed">闭合路线</option>
                    <option value="round-trip">往返路线（往返测站可逐站设置）</option>
                    <option value="open">开放路线</option>
                  </select>
                </label>
              </div>
              <p className="rounded-xl bg-slate-100/70 px-2.5 py-2 text-xs leading-5 text-slate-500 dark:bg-gray-900/65 dark:text-slate-400">通过底部往测、返测按钮添加测站；点击测站序号旁的方向标志可随时切换。</p>

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
                ] as const).map(([key, placeholder]) => <input key={key} type="text" value={currentRoute[key] ?? ''} onChange={(event) => updateRouteMeta({ [key]: event.target.value })} placeholder={placeholder} className="min-h-10 min-w-0 rounded-lg border border-slate-200 bg-slate-50 px-2 text-xs text-slate-700 outline-none focus:border-indigo-400 dark:border-gray-700 dark:bg-gray-900 dark:text-slate-200" />)}
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
                        <button onClick={() => addKnownPoint(kp.id)} aria-label={`在测点 ${idx + 1} 后添加测点`} className="glass-icon-button text-indigo-500 hover:text-indigo-700">
                          <Plus className="w-3.5 h-3.5 stroke-[3]" />
                        </button>
                        <button onClick={() => removeKnownPoint(kp.id)} aria-label={`删除测点 ${idx + 1}`} className="glass-icon-button text-slate-400 hover:text-red-500">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                  {(!currentRoute.knownPoints || currentRoute.knownPoints.length === 0) && (
                    <div className="flex flex-col items-center justify-center gap-2 py-3 bg-slate-50 dark:bg-gray-800/50 rounded-lg border border-dashed border-slate-200 dark:border-gray-700">
                      <span className="text-[10px] text-slate-400">暂无测点，闭合差与不符值将无法结算</span>
                      <button onClick={() => addKnownPoint()} className="glass-pill-button text-indigo-600">
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
      <div className="relative z-0 space-y-1.5 px-2 pb-4 pt-1">
        <AnimatePresence initial={false}>
          {stations.map((station, index) => {
            return (
              <motion.div key={station.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.98 }} transition={{ duration: 0.16 }}>
                <StationCard station={station} index={index} grade={currentRoute.grade} />
              </motion.div>
            );
          })}
        </AnimatePresence>

        {stationCount === 0 && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center justify-center py-10 text-slate-400">
            <Waves className="w-12 h-12 opacity-20 mb-3 text-indigo-500" />
            <p className="text-sm font-medium">暂无水准测站数据</p>
            <p className="text-[11px] opacity-70 mt-1">请点击下方按钮开始观测</p>
          </motion.div>
        )}

        <div className="grid grid-cols-2 gap-1.5">
          <button data-testid="leveling-add-forward-station" type="button" onClick={() => void handleAddStationWithGPS('forward')} disabled={isLocating}
            className="glass-primary-button min-w-0 px-2 disabled:opacity-50">
            {isLocating ? <div className="h-3.5 w-3.5 rounded-full border-2 border-blue-500 border-t-transparent animate-spin" /> : <Plus className="h-4 w-4 stroke-[3]" />}
            <span className="truncate text-[11px] min-[360px]:text-xs">添加测站（往测）</span>
          </button>
          <button data-testid="leveling-add-return-station" type="button" onClick={() => void handleAddStationWithGPS('return')} disabled={isLocating}
            className="glass-primary-button min-w-0 border-violet-300 bg-violet-100 px-2 text-violet-700 disabled:opacity-50 dark:border-violet-700 dark:bg-violet-950/50 dark:text-violet-300">
            {isLocating ? <div className="h-3.5 w-3.5 rounded-full border-2 border-violet-500 border-t-transparent animate-spin" /> : <Plus className="h-4 w-4 stroke-[3]" />}
            <span className="truncate text-[11px] min-[360px]:text-xs">添加测站（返测）</span>
          </button>
        </div>
        {locationFailure && (
          <section data-testid="leveling-location-fallback" role="status" className="mt-2 rounded-2xl border border-amber-200 bg-amber-50/85 p-2.5 text-amber-800 shadow-sm dark:border-amber-800/60 dark:bg-amber-950/35 dark:text-amber-200">
            <p className="text-xs font-semibold">{locationFailure.message}</p>
            <div className="mt-2 flex gap-2">
              <button data-testid="leveling-continue-without-location" type="button" onClick={() => { addStation(undefined, undefined, locationFailure.direction); setLocationFailure(null); showNotice(`已无定位添加${locationFailure.direction === 'return' ? '返测' : '往测'}站`); }} className="glass-pill-button flex-1">无定位继续</button>
              <button type="button" onClick={() => void handleAddStationWithGPS(locationFailure.direction)} className="glass-pill-button flex-1">重新定位</button>
            </div>
          </section>
        )}
        {notice && <p role="status" aria-live="polite" className="mt-2 rounded-xl bg-slate-900/85 px-3 py-2 text-center text-xs font-semibold text-white dark:bg-white/90 dark:text-slate-900">{notice}</p>}
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

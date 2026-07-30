/**
 * 水文测验终端主应用 — PWA 移动端
 * 包含：深色模式切换、多槽位时光机存盘系统、Liquid Glass 导入菜单、Numbers 导出、Toast 通知、V-Field 断面垂线分布图抽屉
 */
import { motion, AnimatePresence, useDragControls } from 'framer-motion';
import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { Sun, Moon, Download, Upload, Activity, X, BookmarkPlus, Layers, Trash2, ChevronLeft, MoreHorizontal, FileSpreadsheet, History } from 'lucide-react';
import Dashboard from './Dashboard';
import PeriodToggle from './PeriodToggle';
import HydroTable from './HydroTable';
import SectionCFDChart from './SectionCFDChart';
import type { SnappedPoint } from './SectionCFDChart';
import { useHydroStore } from '../store/hydroStore';
import type { SectionTemplate } from '../store/hydroStore';
import type { Run } from '../types';
import { useUiStore } from '../store/uiStore';

/* ──────────── Numbers 图标 ──────────── */
function NumbersIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* 绿色圆角底座 */}
      <rect x="2" y="15" width="20" height="7" rx="3" fill="#34C759" />
      {/* 蓝色柱 */}
      <rect x="5" y="8" width="3.5" height="7" rx="1" fill="#007AFF" />
      {/* 黄色柱 */}
      <rect x="10.25" y="5" width="3.5" height="10" rx="1" fill="#FFCC00" />
      {/* 绿色柱 */}
      <rect x="15.5" y="2" width="3.5" height="13" rx="1" fill="#34C759" />
    </svg>
  );
}

/* ──────────── Toast ──────────── */
function Toast({ message, show }: { message: string; show: boolean }) {
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0, y: -20, x: '-50%' }}
          animate={{ opacity: 1, y: 0, x: '-50%' }}
          exit={{ opacity: 0, y: -20, x: '-50%' }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          className="app-safe-toast fixed left-1/2 z-[110] w-[88%] max-w-xs px-4 py-2.5 rounded-xl bg-red-500/95 dark:bg-red-600/95 text-white text-xs font-bold shadow-2xl text-center leading-snug break-words border border-white/20 backdrop-blur-md"
        >
          {message}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* ──────────── v7.0 底部数据栏（动态下沉覆盖） ──────────── */
function QuarterlyDataBar({ snappedPoint }: { snappedPoint: SnappedPoint | null }) {
  const totalDischarge = useHydroStore((s) => s.currentRun.totalDischarge);
  const totalArea = useHydroStore((s) => s.currentRun.totalArea);
  const meanVelocity = useHydroStore((s) => s.currentRun.meanVelocity);

  // 有磁吸选中点时：下沉覆盖为测点详情
  if (snappedPoint) {
    return (
      <div className="shrink-0 px-4 py-1.5 flex items-center justify-between bg-black/80 backdrop-blur-md border-t border-blue-500/30">
        <div className="flex flex-col">
          <span className="text-blue-400 text-[10px]">D 距起点</span>
          <span className="text-blue-300 font-mono font-bold text-sm">{snappedPoint.distance.toFixed(1)} <span className="text-[9px] text-blue-400/60">m</span></span>
        </div>
        <div className="w-px h-6 bg-blue-500/30" />
        <div className="flex flex-col items-center">
          <span className="text-blue-400 text-[10px]">d 水深</span>
          <span className="text-blue-300 font-mono font-bold text-sm">{snappedPoint.depth.toFixed(2)} <span className="text-[9px] text-blue-400/60">m</span></span>
        </div>
        <div className="w-px h-6 bg-blue-500/30" />
        <div className="flex flex-col items-end">
          <span className="text-blue-400 text-[10px]">v 流速</span>
          <span className="text-blue-300 font-mono font-bold text-sm">{snappedPoint.velocity.toFixed(3)} <span className="text-[9px] text-blue-400/60">m/s</span></span>
        </div>
      </div>
    );
  }

  // 默认：Q / A / V̄ 统计视图
  return (
    <div className="shrink-0 px-4 py-1.5 flex items-center justify-between bg-black/80 backdrop-blur-md border-t border-slate-700/50">
      <div className="flex flex-col">
        <span className="text-slate-400 text-[10px]">总流量 Q</span>
        <span className="text-cyan-400 font-mono font-bold text-sm">{totalDischarge || '0.00'} <span className="text-[9px] text-cyan-500/60">m³/s</span></span>
      </div>
      <div className="w-px h-6 bg-slate-700/50" />
      <div className="flex flex-col items-center">
        <span className="text-slate-400 text-[10px]">总面积 A</span>
        <span className="text-emerald-400 font-mono font-bold text-sm">{totalArea || '0.00'} <span className="text-[9px] text-emerald-500/60">m²</span></span>
      </div>
      <div className="w-px h-6 bg-slate-700/50" />
      <div className="flex flex-col items-end">
        <span className="text-slate-400 text-[10px]">平均流速 V̄</span>
        <span className="text-amber-400 font-mono font-bold text-sm">{meanVelocity || '0.00'} <span className="text-[9px] text-amber-500/60">m/s</span></span>
      </div>
    </div>
  );
}

/* ──────────── Loading 占位屏 ──────────── */
function LoadingScreen() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#F2F2F7] dark:bg-gray-950">
      <div className="flex flex-col items-center gap-3">
        <div className="w-10 h-10 border-3 border-hydro-blue border-t-transparent rounded-full animate-spin" />
        <p className="text-sm text-slate-500 dark:text-slate-400 font-medium">正在加载水文数据...</p>
      </div>
    </div>
  );
}

/** 防误触删除按钮（复用组件） */
function DeleteRunButton({ onDelete }: { onDelete: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);
  const tap1 = () => { setConfirming(true); timerRef.current = setTimeout(() => setConfirming(false), 3000); };
  const tap2 = () => { if (timerRef.current) clearTimeout(timerRef.current); setConfirming(false); onDelete(); };
  return confirming ? (
    <button aria-label="确认删除测次" onClick={tap2} className="min-h-11 min-w-11 rounded bg-red-500 dark:bg-red-600 text-white text-[9px] font-bold animate-pulse shrink-0">确认删除</button>
  ) : (
    <button aria-label="删除测次" onClick={(e) => { e.stopPropagation(); tap1(); }} className="flex min-h-11 min-w-11 items-center justify-center rounded hover:bg-red-50 dark:hover:bg-red-900/30 text-slate-400 dark:text-slate-500 hover:text-red-500 shrink-0" title="删除测次（二次确认）">
      <Trash2 className="w-3 h-3" />
    </button>
  );
}

export default function FlowApp({ isActive = true, onBack }: { isActive?: boolean; onBack: () => void }) {
  const _hasHydrated = useHydroStore((s) => s._hasHydrated);
  const recalculate = useHydroStore((s) => s.recalculate);
  const exportData = useHydroStore((s) => s.exportData);
  const currentRun = useHydroStore((s) => s.currentRun);
  const importBackup = useHydroStore((s) => s.importBackup);
  const runs = useHydroStore((s) => s.runs);
  const loadRun = useHydroStore((s) => s.loadRun);
  const deleteRun = useHydroStore((s) => s.deleteRun);
  const showHistory = useHydroStore((s) => s.showHistoryPanel);
  const toggleHistoryPanel = useHydroStore((s) => s.toggleHistoryPanel);
  const templates = useHydroStore((s) => s.templates);

  const sortedRuns = useMemo(
    () => runs.slice().sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()).slice(0, 10),
    [runs]
  );

  const getHistoryName = (run: Run) => {
    const timeDisplay = run.startTime ? run.startTime : new Date(run.timestamp).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).replace(/\//g, '-');
    return `${run.location || '未知断面'} ${timeDisplay}`;
  };

  const measureCount = useHydroStore(
    (s) => s.currentRun.verticals.filter((v) => v.type === 'measure').length,
  );
  const darkMode = useUiStore((state) => state.darkMode);
  const setDarkMode = useUiStore((state) => state.setDarkMode);
  const [toast, setToast] = useState({ show: false, message: '' });
  const [showImportMenu, setShowImportMenu] = useState(false);
  const [showTemplateMenu, setShowTemplateMenu] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const importMenuRef = useRef<HTMLDivElement>(null);
  const templateMenuRef = useRef<HTMLDivElement>(null);
  const [showCFDSheet, setShowCFDSheet] = useState(false);
  const [sheetHeight, setSheetHeight] = useState(75); // vh 百分比，默认 75vh
  const minSheetVh = 28;   // 绝对安全防线：顶栏～64px + 底部～38px + 图表 >68px(chart padding) → 确保 Canvas 不崩溃
  const maxSheetVh = 95;
  const dragControls = useDragControls();
  const sheetContainerRef = useRef<HTMLDivElement>(null);

  /* v7.0 磁吸吸附状态 — 由 SectionCFDChart 回调驱动 */
  const [snappedPoint, setSnappedPoint] = useState<SnappedPoint | null>(null);

  /* ── Toast 防抖 ── */
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
  }, []);

  /* ── 底部抽屉拖拽 resize 逻辑 ── */
  const handleSheetDrag = useCallback(
    (_event: MouseEvent | TouchEvent | PointerEvent, info: { delta: { y: number } }) => {
      setSheetHeight((prev) => {
        // 向上拖拽（delta.y < 0）增加高度，向下拖拽减少高度
        const deltaVh = (-info.delta.y / window.innerHeight) * 100;
        const next = prev + deltaVh;
        return Math.max(minSheetVh, Math.min(maxSheetVh, next));
      });
    },
    []
  );

  useEffect(() => {
    if (!isActive) return;
    recalculate(false);
  }, [isActive, recalculate]);

  /* ── 由 App 集中接管 Android 返回；此处仅消费当前业务弹层 ── */
  useEffect(() => {
    if (!isActive) return undefined;
    const handleAppBack = (event: Event) => {
      if (showCFDSheet) {
        setShowCFDSheet(false);
        event.preventDefault();
        return;
      }
      if (showMore) {
        setShowMore(false);
        event.preventDefault();
        return;
      }
      if (showImportMenu) {
        setShowImportMenu(false);
        event.preventDefault();
        return;
      }
      if (showTemplateMenu) {
        setShowTemplateMenu(false);
        event.preventDefault();
        return;
      }
    };
    window.addEventListener('hydro-app-back', handleAppBack);
    return () => window.removeEventListener('hydro-app-back', handleAppBack);
  }, [isActive, showCFDSheet, showImportMenu, showMore, showTemplateMenu]);

  /* 点击外部关闭导入菜单 */
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (importMenuRef.current && !importMenuRef.current.contains(e.target as Node)) {
        setShowImportMenu(false);
      }
    }
    if (showImportMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showImportMenu]);

  /* 点击外部关闭模板菜单 */
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (templateMenuRef.current && !templateMenuRef.current.contains(e.target as Node)) {
        setShowTemplateMenu(false);
      }
    }
    if (showTemplateMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showTemplateMenu]);

  const showToast = (msg: string, persistent = false) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast({ show: true, message: msg });
    if (!persistent) {
      toastTimerRef.current = setTimeout(() => setToast({ show: false, message: '' }), 2000);
    }
  };

  /* ── 模板：保存当前断面几何骨架 ── */
  const handleSaveTemplate = () => {
    const tpl = useHydroStore.getState().saveTemplate();
    showToast('📐 断面模板已保存 — ' + tpl.name);
  };

  /* ── 模板：载入并覆盖起点距/测法 ── */
  const handleLoadTemplate = (tpl: SectionTemplate) => {
    useHydroStore.getState().loadTemplate(tpl);
    setShowTemplateMenu(false);
    showToast('📐 模板已载入 — ' + tpl.name);
  };

  /* ── 模板：删除指定模板 ── */
  const handleDeleteTemplate = (id: string) => {
    useHydroStore.getState().deleteTemplate(id);
    showToast('🗑️ 模板已删除');
  };

  /* ── 导入外部 JSON ── */
  const handleImportClick = () => {
    document.getElementById('hydro-import-input-compact')?.click();
  };

  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target?.result as string);
        importBackup(data);
        setShowImportMenu(false);
        showToast('✅ 备份已成功还原');
      } catch {
        showToast('❌ 文件格式无效，请选择正确的备份文件');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  /* ── 水合防闪烁：在 Capacitor 原生存储完全就绪前，只渲染 Loading 占位屏 ── */
  if (!_hasHydrated) return <LoadingScreen />;

  return (
    <div
      data-testid="flow-screen"
      id="app-root-container"
      className="min-h-screen bg-[#F2F2F7] dark:bg-gray-950 transition-[padding,colors] duration-300"
      style={{
        paddingLeft: 'var(--app-safe-left)',
        paddingRight: 'var(--app-safe-right)',
        paddingBottom: 'var(--app-safe-bottom)',
      }}
    >
      <Toast message={toast.message} show={toast.show} />

      {/* 背景装饰 */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-0 right-0 w-[300px] h-[300px] bg-hydro-blue/3 dark:bg-hydro-blue/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/3" />
      </div>

      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="relative z-10">
        <header data-testid="flow-app-header" className="app-safe-header relative z-30 border-b border-white/70 bg-[#F2F2F7]/82 backdrop-blur-2xl dark:border-gray-700/70 dark:bg-gray-950/82">
          <div className="flex min-h-12 items-center gap-1 px-2 py-1">
            <button type="button" onClick={onBack} aria-label="返回首页" title="返回首页" className="glass-icon-button"><ChevronLeft className="h-5 w-5" /></button>
            <div className="min-w-0 flex-1 px-1"><h1 className="truncate text-sm font-bold text-slate-800 dark:text-white">水文测验</h1><p className="truncate text-xs text-slate-500 dark:text-slate-400">GB 50179-2015 · {measureCount} 条垂线</p></div>
            <button data-testid="flow-result" type="button" onClick={() => setShowCFDSheet(true)} aria-label="断面成果" title="断面成果" className="glass-icon-button"><Activity className="h-4 w-4" /></button>
            <button data-testid="flow-more" type="button" onClick={() => setShowMore((value) => !value)} aria-label="更多功能" title="更多功能" aria-expanded={showMore} className="glass-icon-button"><MoreHorizontal className="h-5 w-5" /></button>
          </div>
        </header>
        <input id="hydro-import-input-compact" type="file" accept=".json" onChange={handleImportFile} className="sr-only" />

        <AnimatePresence>
          {showMore && (
            <motion.section data-testid="flow-more-menu" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} className="relative z-40 mx-2 mt-2 grid grid-cols-2 gap-1.5 rounded-2xl border border-white/75 bg-white/84 p-1.5 shadow-glass backdrop-blur-2xl dark:border-gray-700/70 dark:bg-gray-900/84 min-[390px]:grid-cols-3">
              <button type="button" onClick={() => { handleSaveTemplate(); setShowMore(false); }} className="glass-menu-button"><BookmarkPlus className="h-4 w-4" />存为模板</button>
              <div ref={templateMenuRef} className="relative">
                <button type="button" onClick={() => setShowTemplateMenu((value) => !value)} className="glass-menu-button w-full"><Layers className="h-4 w-4" />载入模板</button>
                <AnimatePresence>
                  {showTemplateMenu && <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} className="absolute left-0 top-[calc(100%+0.25rem)] z-50 max-h-64 w-64 overflow-y-auto rounded-2xl border border-white/75 bg-white/95 p-1.5 shadow-glass backdrop-blur-2xl dark:border-gray-700/70 dark:bg-gray-900/95">
                    {templates.length === 0 ? <p className="px-3 py-3 text-xs text-slate-500">暂无断面模板</p> : templates.map((tpl) => <div key={tpl.id} className="flex items-center gap-1"><button type="button" onClick={() => { handleLoadTemplate(tpl); setShowMore(false); }} className="min-h-11 min-w-0 flex-1 truncate px-2 text-left text-xs text-slate-700 dark:text-slate-200">{tpl.name}</button><button type="button" aria-label={`删除模板 ${tpl.name}`} onClick={() => handleDeleteTemplate(tpl.id)} className="glass-icon-button"><Trash2 className="h-4 w-4" /></button></div>)}
                  </motion.div>}
                </AnimatePresence>
              </div>
              <button type="button" onClick={() => { handleImportClick(); setShowMore(false); }} className="glass-menu-button"><Download className="h-4 w-4" />导入备份</button>
              <button type="button" onClick={() => { useHydroStore.getState().exportCurrentRunJSON(); setShowMore(false); }} className="glass-menu-button"><Upload className="h-4 w-4" />导出 JSON</button>
              <button type="button" onClick={() => { exportData(); setShowMore(false); }} className="glass-menu-button"><FileSpreadsheet className="h-4 w-4" />导出 Excel</button>
              <button type="button" onClick={() => { toggleHistoryPanel(); setShowMore(false); }} className="glass-menu-button"><History className="h-4 w-4" />历史测次</button>
              <button type="button" onClick={() => { setDarkMode(!darkMode); setShowMore(false); }} className="glass-menu-button">{darkMode ? <Sun className="h-4 w-4 text-amber-400" /> : <Moon className="h-4 w-4" />}{darkMode ? '浅色模式' : '深色模式'}</button>
            </motion.section>
          )}
        </AnimatePresence>

       {/* Legacy action header retained only for source compatibility. */}
        <header className="hidden">
          <div className="px-2 py-1.5 flex flex-wrap items-center justify-between gap-1.5">
            <div className="flex shrink-0 items-center">
              <button
                type="button"
                onClick={onBack}
                aria-label="返回首页"
                title="返回首页"
                className="flex min-h-11 min-w-11 items-center justify-center rounded-xl text-slate-600 transition-all hover:bg-slate-200/50 active:scale-95 dark:text-slate-300 dark:hover:bg-gray-800/50"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
              <div className="flex min-h-11 items-center px-1.5 text-left">
                <div className="shrink-0 whitespace-nowrap">
                  <h1 className="mb-0.5 text-sm font-bold leading-none text-slate-800 dark:text-white">水文测验</h1>
                  <p className="text-xs leading-none text-slate-400 dark:text-slate-500">GB 50179-2015</p>
                </div>
              </div>
            </div>

            {/* 操作按钮区 */}
            <div className="flex items-center gap-1 flex-wrap justify-end flex-1 min-w-[200px]">
              {/* 存为模板 — 断面几何骨架快照 */}
              <button onClick={handleSaveTemplate}
                className="flex min-h-11 min-w-11 items-center justify-center rounded-md bg-white/60 dark:bg-gray-800/60 border border-white/80 dark:border-gray-700 text-slate-500 dark:text-slate-400 hover:text-violet-600 dark:hover:text-violet-400 hover:bg-violet-50 dark:hover:bg-violet-900/30 transition-colors"
                title="存为常用断面模板">
                <BookmarkPlus className="w-4 h-4" />
              </button>

              {/* 载入模板 — 断面模板悬浮菜单 */}
              <div className="md:relative">
                <button
                  onClick={() => setShowTemplateMenu(!showTemplateMenu)}
                  className="flex min-h-11 min-w-11 items-center justify-center rounded-md bg-white/60 dark:bg-gray-800/60 border border-white/80 dark:border-gray-700 text-slate-500 dark:text-slate-400 hover:text-violet-600 dark:hover:text-violet-400 hover:bg-violet-50 dark:hover:bg-violet-900/30 transition-colors"
                  title="载入常用断面模板"
                >
                  <Layers className="w-4 h-4" />
                </button>

                <AnimatePresence>
                  {showTemplateMenu && (
                    <motion.div
                      initial={{ opacity: 0, scale: 0.92, y: -4 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.92, y: -4 }}
                      transition={{ duration: 0.18, ease: 'easeOut' }}
                      className="absolute left-4 right-4 mx-auto md:left-auto md:right-0 top-full z-[60] mt-2 w-auto max-w-[320px] md:w-64 rounded-xl
                        backdrop-blur-xl bg-white/90 dark:bg-gray-900/90
                        shadow-2xl border border-gray-100 dark:border-gray-800
                        p-3 max-h-64 overflow-y-auto custom-scrollbar"
                    >
                      {templates.length === 0 ? (
                        <div className="px-4 py-3 text-left text-sm text-slate-400 dark:text-slate-500">
                          <div className="flex items-center gap-3">
                            <span className="text-lg">📐</span>
                            <div>
                              <div className="font-medium text-slate-400 dark:text-slate-500">暂无断面模板</div>
                              <div className="text-xs">点击左侧 📌 按钮保存当前断面</div>
                            </div>
                          </div>
                        </div>
                      ) : (
                        templates.map((tpl) => (
                          <div key={tpl.id} className="flex items-center border-b border-slate-100/60 dark:border-gray-700/40 last:border-0">
                            <button
                              onClick={() => handleLoadTemplate(tpl)}
                              className="flex min-h-11 flex-1 items-center gap-3 px-2 py-2.5 text-left text-sm text-slate-700 dark:text-slate-200
                                hover:bg-violet-50/80 dark:hover:bg-violet-900/30 transition-colors"
                            >
                              <span className="text-lg">📐</span>
                              <div className="min-w-0">
                                <div className="font-medium truncate">{tpl.name}</div>
                                <div className="text-[10px] text-slate-400 dark:text-slate-500">
                                  {tpl.verticals.length}条垂线 · {new Date(tpl.createdAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                                </div>
                              </div>
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); handleDeleteTemplate(tpl.id); }}
                              className="flex min-h-11 min-w-11 items-center justify-center mr-1 rounded hover:bg-red-50 dark:hover:bg-red-900/30 text-slate-400 dark:text-slate-500 hover:text-red-500 shrink-0"
                              title="删除模板">
                              <X className="w-3 h-3" />
                            </button>
                          </div>
                        ))
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* 分隔符 */}
              <div className="w-px h-5 bg-slate-300/50 dark:bg-gray-600/50 mx-0.5 shrink-0" />

              {/* 导入备份 */}
              <div className="md:relative">
                <button
                  onClick={() => setShowImportMenu(!showImportMenu)}
                  className="flex min-h-11 min-w-11 items-center justify-center rounded-md bg-white/60 dark:bg-gray-800/60 border border-white/80 dark:border-gray-700 text-slate-500 dark:text-slate-400 hover:text-amber-600 dark:hover:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/30 transition-colors"
                  title="导入备份"
                >
                  <Download className="w-4 h-4" />
                </button>

                <AnimatePresence>
                  {showImportMenu && (
                    <motion.div
                      initial={{ opacity: 0, scale: 0.92, y: -4 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.92, y: -4 }}
                      transition={{ duration: 0.18, ease: 'easeOut' }}
                      className="absolute left-4 right-4 mx-auto md:left-auto md:right-0 top-full z-50 mt-1.5 w-auto max-w-[280px] md:w-52 rounded-2xl
                        bg-white/75 dark:bg-gray-800/75
                        backdrop-blur-xl
                        border border-white/30 dark:border-gray-700/60
                        shadow-2xl shadow-black/10 dark:shadow-black/40
                        overflow-hidden"
                    >
                      <button
                        onClick={() => { handleImportClick(); setShowImportMenu(false); }}
                        className="w-full flex items-center gap-3 px-4 py-3 text-left text-sm text-slate-700 dark:text-slate-200
                          hover:bg-slate-100/70 dark:hover:bg-gray-700/70 transition-colors"
                      >
                        <span className="text-lg">📂</span>
                        <div>
                          <div className="font-medium">导入外部 JSON 文件</div>
                          <div className="text-xs text-slate-400 dark:text-slate-500">从设备选择备份文件</div>
                        </div>
                      </button>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              <input id="hydro-import-input" type="file" accept=".json" onChange={handleImportFile} className="w-0 h-0 opacity-0 absolute pointer-events-none" />

              {/* 单测次分享 */}
              <button onClick={() => useHydroStore.getState().exportCurrentRunJSON()}
                className="flex min-h-11 min-w-11 items-center justify-center rounded-md bg-white/60 dark:bg-gray-800/60 border border-white/80 dark:border-gray-700 text-slate-500 dark:text-slate-400 hover:text-hydro-blue dark:hover:text-hydro-blue-light transition-colors"
                title="导出当前测次 JSON">
                <Upload className="w-4 h-4" />
              </button>

              {/* Numbers 导出 */}
              <button onClick={exportData}
                className="flex min-h-11 min-w-11 items-center justify-center rounded-md bg-white/60 dark:bg-gray-800/60 border border-white/80 dark:border-gray-700 text-slate-500 dark:text-slate-400 hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors"
                title="导出 Numbers / Excel">
                <NumbersIcon className="w-4 h-4" />
              </button>

              {/* 暗黑模式切换 */}
              <button onClick={() => setDarkMode(!darkMode)}
                className="flex min-h-11 min-w-11 items-center justify-center rounded-md bg-white/60 dark:bg-gray-800/60 border border-white/80 dark:border-gray-700 text-slate-500 dark:text-yellow-400 hover:bg-slate-100 dark:hover:bg-gray-800 transition-colors"
                title={darkMode ? '切换亮色模式' : '切换深色模式'}>
                {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              </button>
            </div>
          </div>

        </header>

        <Dashboard />

        {/* 历史测次面板：已成功上移至中间层级 */}
        <div className="px-2 mb-2">
          <AnimatePresence>
            {showHistory && runs.length > 0 && (
              <motion.div
                initial={{ opacity: 0, scaleY: 0.95, transformOrigin: 'top' }}
                animate={{ opacity: 1, scaleY: 1 }}
                exit={{ opacity: 0, scaleY: 0.95 }}
                transition={{ duration: 0.15, ease: 'easeOut' }}
                style={{ willChange: 'transform, opacity' }}
                className="p-1.5 rounded-lg bg-white/60 dark:bg-gray-900/60 border border-white/80 dark:border-gray-700/80 max-h-64 overflow-y-auto shadow-sm">
                <div className="flex flex-col gap-1">
                  {sortedRuns.map((run, index) => (
                    <div key={run.id} className={`flex items-center gap-1 px-1.5 py-1 rounded-md ${
                      run.id === currentRun.id
                        ? 'bg-blue-50/80 dark:bg-blue-900/40 ring-1 ring-blue-500 shadow-sm'
                        : 'bg-slate-50 dark:bg-gray-800 hover:bg-slate-100 dark:hover:bg-gray-700'
                    }`}>
                      <button onClick={() => { loadRun(run.id); toggleHistoryPanel(); }}
                        className="flex min-h-11 flex-1 items-center justify-between text-left min-w-0">
                        <div className="flex items-center gap-1.5 min-w-0 flex-1">
                          <span className="text-xs font-bold text-hydro-blue dark:text-cyan-400 shrink-0">#{index + 1}</span>
                          <span className="text-xs text-slate-700 dark:text-slate-200 break-all font-medium">{getHistoryName(run)}</span>
                        </div>
                        <span className="text-[10px] text-slate-400 dark:text-slate-500 shrink-0">{run.totalDischarge || '--'} m³/s</span>
                      </button>
                      <DeleteRunButton onDelete={() => deleteRun(run.id)} />
                    </div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="flex items-center justify-center gap-2 px-2">
          <PeriodToggle />
          <button type="button" onClick={() => setShowCFDSheet(true)} className="glass-pill-button"><Activity className="h-4 w-4" />断面成果</button>
        </div>
        <HydroTable />

        {/* ────── 可拖拽底部抽屉 (Bottom Sheet) + 深度夸张免责声明 ────── */}
        <AnimatePresence>
          {showCFDSheet && (
            <>
              {/* 遮罩 */}
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
                onClick={() => setShowCFDSheet(false)}
              />
              {/* 抽屉面板 — Framer Motion drag 驱动高度调节 */}
              <motion.div
                ref={sheetContainerRef}
                drag="y"
                dragControls={dragControls}
                dragListener={false}
                dragConstraints={{ top: 0, bottom: 0 }}
                dragElastic={0}
                onDrag={handleSheetDrag}
                initial={{ y: '100%' }}
                animate={{ y: 0 }}
                exit={{ y: '100%' }}
                transition={{ type: 'spring', damping: 28, stiffness: 280 }}
                className="fixed bottom-0 left-0 right-0 z-50
                  rounded-t-3xl
                  bg-[#0a0f1e]/95
                  backdrop-blur-2xl
                  border-t border-white/10
                  shadow-2xl shadow-black/60
                  overflow-hidden
                  flex flex-col"
                style={{ height: `${sheetHeight}vh`, paddingBottom: 'var(--app-safe-bottom)' }}
              >
                {/* 抽屉头部 — 合并小白条和标题，全区域可拖拽防误触 */}
                <div
                  onPointerDown={(e) => dragControls.start(e)}
                  className="flex flex-col border-b border-white/8 flex-shrink-0 cursor-ns-resize touch-none select-none"
                >
                  {/* 拖拽手柄 */}
                  <div className="flex justify-center pt-3 pb-2">
                    <div className="w-10 h-1.5 rounded-full bg-white/30 transition-colors" />
                  </div>
                  {/* 标题区 */}
                  <div className="flex items-center justify-between px-5 pb-3">
                    <div className="flex items-center gap-2">
                      <div className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse shadow-lg shadow-cyan-400/50" />
                      <span className="text-sm font-mono font-bold text-white/90 tracking-wide">
                        断面垂线分布图
                      </span>
                      <span className="text-[10px] text-white/25 ml-1 hidden sm:inline">{sheetHeight.toFixed(0)}%</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-mono text-white/40">
                        {measureCount} 条垂线
                      </span>
                      <button
                        aria-label="关闭断面垂线分布图"
                        onClick={() => setShowCFDSheet(false)}
                        onPointerDown={(e) => e.stopPropagation()}
                        className="flex min-h-11 min-w-11 items-center justify-center rounded-full bg-white/5 hover:bg-white/10 border border-white/10 text-white/60 hover:text-white transition-colors cursor-pointer"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>

                {/* 图表区 — flex-1 自动撑满，压扁防线 min-h-[20px] */}
                <div className="flex-1 min-h-[20px] p-2">
                  <SectionCFDChart isActive={isActive} onSnapChange={setSnappedPoint} />
                </div>

                {/* 底部成果状态栏 — 固定在容器最底端，绝不位移，flex-shrink-0 防压扁 */}
                <QuarterlyDataBar snappedPoint={snappedPoint} />
              </motion.div>
            </>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}

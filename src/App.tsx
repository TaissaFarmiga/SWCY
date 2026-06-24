/**
 * 水文测验终端主应用 — PWA 移动端
 * 包含：深色模式切换、多槽位时光机存盘系统、Liquid Glass 导入菜单、Numbers 导出、Toast 通知、V-Field 断面垂线分布图抽屉
 */
import { motion, AnimatePresence, useDragControls } from 'framer-motion';
import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { Sun, Moon, Download, Upload, Activity, X, BookmarkPlus, Layers, Trash2 } from 'lucide-react';
import { App as CapApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { StatusBar } from '@capacitor/status-bar';
import Dashboard from './components/Dashboard';
import PeriodToggle from './components/PeriodToggle';
import HydroTable from './components/HydroTable';
import SectionCFDChart from './components/SectionCFDChart';
import type { SnappedPoint } from './components/SectionCFDChart';
import { useHydroStore } from './store/hydroStore';
import { SectionTemplate } from './store/hydroStore';
import { SnapshotPlugin, silentBootProbe, checkAndTriggerUpdate, compareVersions } from './bridge/snapshotPlugin';

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
          className="fixed top-6 left-1/2 z-[110] w-[88%] max-w-xs px-4 py-2.5 rounded-xl bg-red-500/95 dark:bg-red-600/95 text-white text-xs font-bold shadow-2xl text-center leading-snug break-words border border-white/20 backdrop-blur-md"
        >
          {message}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* ──────────── 模板持久化辅助 ──────────── */
const TEMPLATES_KEY = 'hydrology-templates';

function loadTemplates(): SectionTemplate[] {
  try {
    const raw = localStorage.getItem(TEMPLATES_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
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
    <button onClick={tap2} className="p-0.5 rounded bg-red-500 dark:bg-red-600 text-white text-[9px] font-bold animate-pulse shrink-0">确认删除</button>
  ) : (
    <button onClick={(e) => { e.stopPropagation(); tap1(); }} className="p-0.5 rounded hover:bg-red-50 dark:hover:bg-red-900/30 text-slate-400 dark:text-slate-500 hover:text-red-500 shrink-0" title="删除测次（二次确认）">
      <Trash2 className="w-3 h-3" />
    </button>
  );
}

export default function App() {
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

  const sortedRuns = useMemo(
    () => runs.slice().sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()).slice(0, 10),
    [runs]
  );

  const getHistoryName = (run: any) => {
    const timeDisplay = run.startTime ? run.startTime : new Date(run.timestamp).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).replace(/\//g, '-');
    return `${run.location || '未知断面'} ${timeDisplay}`;
  };

  const measureCount = useHydroStore(
    (s) => s.currentRun.verticals.filter((v) => v.type === 'measure').length,
  );
  const [darkMode, setDarkMode] = useState(() => {
    const saved = localStorage.getItem('theme');
    if (saved) return saved === 'dark';
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });
  const [toast, setToast] = useState({ show: false, message: '' });
  const [showOtaMenu, setShowOtaMenu] = useState(false);
  const otaMenuRef = useRef<HTMLDivElement>(null);
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);

  // 🔬 终极诊断雷达专用的顶层物理 Ref 声明
  const diagnosticsResizeCount = useRef(0);
  const diagnosticsLastFocusInScrollY = useRef(0);

  /* ── GitHub OTA 三线容灾自愈下载逻辑 ── */
  const handleGitHubOTA = async () => {
    setShowOtaMenu(false);
    if (isCheckingOTA) return;
    setIsCheckingOTA(true);
    setDownloadProgress(0); // 唤醒 Safari 极简进度条
    showToast('正在连接 GitHub 备用节点...', false); // 弱提示，2秒自动淡出
    
    let progressListener: any = null;
    try {
      // 注册真实进度条监听器
      progressListener = await SnapshotPlugin.addListener('downloadProgress', (data) => {
        setDownloadProgress(data.progress);
      });

      const res = await fetch('https://api.github.com/repos/TaissaFarmiga/SWCY/releases/latest', {
        headers: {
          'Accept': 'application/vnd.github+json',
          'User-Agent': 'HydroTerminal-PWA-OTA'
        }
      });
      if (!res.ok) throw new Error(`API 访问失败 (HTTP ${res.status})`);
      const data = await res.json();
      const cloudVersion = data.tag_name.replace(/^v/, '');
      
      const info = await SnapshotPlugin.getCurrentInfo();
      const appliedZip = localStorage.getItem('applied_zip_version');
      const localVersion = appliedZip || info.apkVersion || '0.0.0';
      
      if (compareVersions(cloudVersion, localVersion) > 0) {
        const apkAsset = data.assets.find((a: any) => a.name.endsWith('.apk'));
        if (apkAsset) {
          const rawUrl = apkAsset.browser_download_url;
          
          // 容灾瀑布流三候选：防线 1 -> 防线 2 -> 防线 3 (官方直链)
          const candidates = [
            `https://gh.ddlc.top/${rawUrl}`,
            `https://github.moeyy.xyz/${rawUrl}`,
            rawUrl
          ];

          let success = false;
          for (let i = 0; i < candidates.length; i++) {
            const currentUrl = candidates[i];
            try {
              // 弱提示切换状态，2秒淡出，不打扰录入
              if (i === 1) showToast('主极速线路异常，正在切换至备用高速线路...', false);
              if (i === 2) showToast('高速线路失效，已启用官方保底线路下载...', false);
              
              await SnapshotPlugin.downloadAndInstallApk({ 
                apkUrl: currentUrl,
                isXorEncrypted: false 
              });
              success = true;
              break; // 下载拉起成功，跳出循环
            } catch (singleErr) {
              console.warn(`节点 [${i}] 尝试失败，准备尝试下一节点`, singleErr);
            }
          }

          if (!success) {
            throw new Error('所有下载通道均连接超时，请检查网络后再试');
          }
        } else {
          showToast('未发现安装包(APK)产物');
        }
      } else {
        showToast(`当前已是最新规程版本 (${localVersion})`);
      }
    } catch (err: any) {
      showToast(`更新中断: ${err?.message || err}`);
    } finally {
      setIsCheckingOTA(false);
      setDownloadProgress(null); // 销毁 Safari 进度条
      if (progressListener) {
        progressListener.remove();
      }
    }
  };

  const [showImportMenu, setShowImportMenu] = useState(false);
  const [showTemplateMenu, setShowTemplateMenu] = useState(false);
  const [isCheckingOTA, setIsCheckingOTA] = useState(false);
  const importMenuRef = useRef<HTMLDivElement>(null);
  const templateMenuRef = useRef<HTMLDivElement>(null);
  const [showCFDSheet, setShowCFDSheet] = useState(false);
  const [sheetHeight, setSheetHeight] = useState(75); // vh 百分比，默认 75vh
  const minSheetVh = 28;   // 绝对安全防线：顶栏～64px + 底部～38px + 图表 >68px(chart padding) → 确保 Canvas 不崩溃
  const maxSheetVh = 95;
  const [templates, setTemplates] = useState<SectionTemplate[]>(loadTemplates);
  const dragControls = useDragControls();
  const sheetContainerRef = useRef<HTMLDivElement>(null);

  /* v7.0 磁吸吸附状态 — 由 SectionCFDChart 回调驱动 */
  const [snappedPoint, setSnappedPoint] = useState<SnappedPoint | null>(null);

  /* ── Toast 防抖 ── */
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    recalculate();
  }, [recalculate]);

  /* ── 沉浸式全面屏 + 全局光标后置逻辑 ── */
  useEffect(() => {
    // 1. 沉浸式全面屏（测试：临时设置为 false，观察 VisualViewport 是否能成功触发 resize 信号）
    if (Capacitor.isNativePlatform()) {
      StatusBar.setOverlaysWebView({ overlay: false }).catch(() => {});
    }

    // 2. 全局光标后置逻辑：点击输入框默认定位到最后
    const moveCursorToEnd = (e: Event) => {
      const target = e.target as HTMLInputElement;
      if (target && target.tagName === 'INPUT') {
        // 利用宏任务跳过浏览器默认的光标定位行为
        setTimeout(() => {
          try {
            // 防御机制：如果用户是滑动/双击有意选中了文本，则放行，不干预光标
            if (target.selectionStart !== target.selectionEnd) return;

            const len = target.value?.length || 0;
            if (typeof target.setSelectionRange === 'function') {
              target.setSelectionRange(len, len);
            }
          } catch (err) {
            // 忽略 type="number" 等不支持 setSelectionRange API 时的原生警告
          }
        }, 10);
      }
    };

    // 监听获取焦点和点击（因为点击已聚焦的输入框也会移动光标）
    document.addEventListener('focusin', moveCursorToEnd);
    document.addEventListener('click', moveCursorToEnd);

    return () => {
      document.removeEventListener('focusin', moveCursorToEnd);
      document.removeEventListener('click', moveCursorToEnd);
    };
  }, []);

  /* ── App 启动调试日志 ── */
  useEffect(() => {
    console.log("[APP DEBUG] App started");
    console.log("[APP DEBUG] url =", window.location.href);
    console.log("[APP DEBUG] platform =", Capacitor.getPlatform());
  }, []);

  /* ── 1. H5 视口物理拟合与过卷阻断：基于 VisualViewport 的垫底补偿与自适应恢复（唯一布局驱动源） ── */
  useEffect(() => {
    // 动态注入 overscroll-behavior 阻止 Android 原生回弹造成的二次链式抖动
    document.documentElement.style.overscrollBehavior = 'contain';
    document.body.style.overscrollBehavior = 'contain';

    const handleViewportResize = () => {
      if (!window.visualViewport) return;
      
      // 工业级裁剪：防范负值、Jitter 以及部分 Android 设备的视口微弱回弹
      const keyboardHeight = Math.max(
        0,
        window.innerHeight - window.visualViewport.height
      );
      
      // 动态注入真实键盘高度 + 16px 物理安全缓冲，彻底解决底部（如右水边）滚不动的死锁
      // 当键盘收起时，keyboardHeight 自动归零，body 垫底自然恢复，无须任何 focusout 逻辑干预
      document.body.style.paddingBottom = keyboardHeight > 0 ? `${keyboardHeight + 16}px` : '0px';
    };

    window.visualViewport?.addEventListener('resize', handleViewportResize);
    return () => {
      window.visualViewport?.removeEventListener('resize', handleViewportResize);
      document.documentElement.style.overscrollBehavior = '';
      document.body.style.overscrollBehavior = '';
    };
  }, []);

  /* ── 2. 帧同步单一输入框避让（requestAnimationFrame 零延时竞争） ── */
  useEffect(() => {
    const handleFocusIn = (e: FocusEvent) => {
      const target = e.target as HTMLElement;
      if (target && target.tagName === 'INPUT') {
        // 锁定聚焦前的起始滚动位置，供雷达排查使用
        diagnosticsLastFocusInScrollY.current = window.scrollY;
        
        // 强制将 scrollIntoView 挂载到浏览器的下一渲染帧（rAF），
        // 彻底消灭 setTimeout 的毫秒竞争与系统默认滚动的双重重叠抖动
        requestAnimationFrame(() => {
          target.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
        });
      }
    };
    document.addEventListener('focusin', handleFocusIn);
    return () => document.removeEventListener('focusin', handleFocusIn);
  }, []);

  /* ── 3. 🕵️‍♂️ 零抖动输入内核 - 工业级深空诊断雷达 (Forensic Loaded Diagnostics) ── */
  useEffect(() => {
    // 物理 DOMRect 手术刀级序列化辅助函数 (防止部分 WebKit 序列化输出空 {})
    const serializeRect = (r?: DOMRect | null) => {
      if (!r) return null;
      return {
        top: Math.round(r.top),
        bottom: Math.round(r.bottom),
        left: Math.round(r.left),
        right: Math.round(r.right),
        width: Math.round(r.width),
        height: Math.round(r.height)
      };
    };

    const runDiagnostics = (eventName: string) => {
      setTimeout(() => {
        const activeEl = document.activeElement as HTMLElement;
        if (!activeEl) return;
        
        const card = activeEl.closest('[id^="vertical-"]') as HTMLElement | null;
        const rect = activeEl.getBoundingClientRect();
        
        const viewportBottom = window.visualViewport
          ? window.visualViewport.height
          : window.innerHeight;

        // 精确计算输入框底部被遮挡的物理像素差 (Overlap Pixels)
        const overlapPixels = Math.max(0, rect.bottom - viewportBottom);

        const diagnosticsData = {
          event: eventName,
          userAgent: navigator.userAgent,
          
          // 1. 视口物理尺寸与宿主容器
          windowInnerHeight: window.innerHeight,
          hasVisualViewport: !!window.visualViewport,
          viewportHeight: window.visualViewport?.height || 'N/A',
          viewportScale: window.visualViewport?.scale || 1,
          viewportBottom: Math.round(viewportBottom),
          visualViewportOffsetTop: window.visualViewport?.offsetTop ?? 0,
          
          // 2. 页面滚动坐标与承载介质排查
          windowScrollY: window.scrollY,
          bodyScrollTop: document.body.scrollTop,
          documentElementScrollTop: document.documentElement.scrollTop,
          scrollingElement: document.scrollingElement?.tagName || 'UNKNOWN',
          
          // 3. 页面物理高度与垫底检查
          bodyScrollHeight: document.body.scrollHeight,
          bodyClientHeight: document.body.clientHeight,
          documentElementScrollHeight: document.documentElement.scrollHeight,
          bodyPaddingBottom: document.body.style.paddingBottom || '0px',
          
          // 4. 当前聚焦元素及卡片链条物理坐标信息
          activeElementTagName: activeEl.tagName,
          activeInputId: activeEl.id || 'none',
          activeInputClassName: activeEl.className || 'none',
          activeElementRect: serializeRect(rect),
          overlapPixels: Math.round(overlapPixels),
          
          closestVerticalCardId: card?.id || 'none',
          closestVerticalCardHeight: card?.offsetHeight || 0,
          closestVerticalCardRect: serializeRect(card?.getBoundingClientRect()),
          
          // 5. 扫描可能存在的局部 overflow 滚动容器，提取其物理高度和当前滚动坐标
          overflowParents: (() => {
            let p = activeEl.parentElement;
            const res = [];
            while (p && p !== document.body) {
              const style = window.getComputedStyle(p);
              const overflowY = style.overflowY;
              const overflowX = style.overflowX;
              const overflow = style.overflow;
              if (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'hidden' || overflow === 'auto' || overflow === 'scroll') {
                res.push({
                  tag: p.tagName,
                  className: p.className,
                  overflow,
                  overflowX,
                  overflowY,
                  scrollTop: p.scrollTop,
                  scrollHeight: p.scrollHeight,
                  clientHeight: p.clientHeight
                });
              }
              p = p.parentElement;
            }
            return res.length > 0 ? res : 'NONE';
          })()
        };
        console.error('🔬 [OTA DIAGNOSTICS LOG]:\n', JSON.stringify(diagnosticsData, null, 2));
      }, 400); // 400ms 保证软键盘弹出与默认滚动完全就位后抓取真实的物理截面快照
    };

    const handleFocusIn = (e: FocusEvent) => {
      const target = e.target as HTMLElement;
      if (target && target.tagName === 'INPUT') {
        runDiagnostics('FOCUS_IN');
      }
    };

    const handleViewportResize = () => {
      diagnosticsResizeCount.current++; // 信号自增
      runDiagnostics('VIEWPORT_RESIZE');
    };

    window.visualViewport?.addEventListener('resize', handleViewportResize);
    document.addEventListener('focusin', handleFocusIn);

    return () => {
      window.visualViewport?.removeEventListener('resize', handleViewportResize);
      document.removeEventListener('focusin', handleFocusIn);
    };
  }, []);

  /* ── OTA 静默防回退探针：冷启动时后台自检沙盒版本 ── */
  useEffect(() => {
    silentBootProbe();
  }, []);

  /* ── Android 物理返回键系统级接管 ── */
  useEffect(() => {
    let handle: { remove: () => void } | null = null;
    CapApp.addListener('backButton', () => {
      // 优先检查是否有展开的 UI 抽屉/面板
      if (showOtaMenu) {
        setShowOtaMenu(false);
        return;
      }
      if (showCFDSheet) {
        setShowCFDSheet(false);
        return;
      }
      if (showImportMenu) {
        setShowImportMenu(false);
        return;
      }
      if (showTemplateMenu) {
        setShowTemplateMenu(false);
        return;
      }
      // 无展开面板时，退出应用
      CapApp.exitApp();
    }).then((h) => {
      handle = h;
    });
    return () => {
      handle?.remove();
    };
  }, [showCFDSheet, showImportMenu, showTemplateMenu, showOtaMenu]);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
    localStorage.setItem('theme', darkMode ? 'dark' : 'light');
  }, [darkMode]);

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

  /* 点击外部关闭 OTA 控制台菜单 */
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (otaMenuRef.current && !otaMenuRef.current.contains(e.target as Node)) {
        setShowOtaMenu(false);
      }
    }
    if (showOtaMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showOtaMenu]);

  const showToast = (msg: string, persistent = false) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast({ show: true, message: msg });
    if (!persistent) {
      toastTimerRef.current = setTimeout(() => setToast({ show: false, message: '' }), 2000);
    }
  };

  const hideToast = () => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast({ show: false, message: '' });
  };

  /* ── 极简一键 OTA 触发器 ── */
  const handleDirectOTA = async () => {
    if (isCheckingOTA) return;
    setIsCheckingOTA(true);
    showToast('正在查询云端计算引擎...', true);
    
    try {
      const result = await checkAndTriggerUpdate();
      if (result.hasUpdate) {
        showToast(result.updateType === 'zip' ? '正在静默同步新引擎...' : '正在下载完整安装包...', true);
        setTimeout(() => setIsCheckingOTA(false), 5000);
      } else {
        showToast(result.message);
        setIsCheckingOTA(false);
      }
    } catch (err) {
      showToast('更新检测失败，请检查网络');
      setIsCheckingOTA(false);
    }
  };

  /* ── 模板：保存当前断面几何骨架 ── */
  const handleSaveTemplate = () => {
    const tpl = useHydroStore.getState().saveTemplate();
    setTemplates(loadTemplates());
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
    setTemplates(loadTemplates());
    showToast('🗑️ 模板已删除');
  };

  /* ── 导入外部 JSON ── */
  const handleImportClick = () => {
    document.getElementById('hydro-import-input')?.click();
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
      className="min-h-screen bg-[#F2F2F7] dark:bg-gray-950 transition-[padding,colors] duration-300"
      style={{
        paddingLeft: 'env(safe-area-inset-left)',
        paddingRight: 'env(safe-area-inset-right)',
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
    >
      <Toast message={toast.message} show={toast.show} />

      {/* 背景装饰 */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-0 right-0 w-[300px] h-[300px] bg-hydro-blue/3 dark:bg-hydro-blue/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/3" />
      </div>

      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="relative z-10">
        {/* 标题栏 — 随屏滚动 */}
        <header className="relative bg-[#F2F2F7] dark:bg-gray-950 pt-safe border-b border-slate-200/60 dark:border-gray-800/60">
          <div className="px-2 py-1.5 flex flex-wrap items-center justify-between gap-1.5">
            {/* 双轨 OTA 液态玻璃控制台 */}
            <div className="relative shrink-0" ref={otaMenuRef}>
              <button
                onClick={() => setShowOtaMenu(!showOtaMenu)}
                className="flex items-center gap-1.5 p-1 -ml-1 rounded-xl hover:bg-slate-200/50 dark:hover:bg-gray-800/50 active:scale-95 transition-all outline-none"
                title="更新控制台"
              >
                <div className="shrink-0 w-7 h-7 rounded-lg bg-gradient-to-br from-hydro-blue to-hydro-blue-dark flex items-center justify-center shadow-sm shadow-hydro-blue/20">
                  {isCheckingOTA ? (
                    <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    <svg className="w-4 h-4 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M3 18 Q8 6 12 12 Q16 18 21 6" strokeLinecap="round" />
                      <circle cx="12" cy="6" r="2" fill="currentColor" />
                    </svg>
                  )}
                </div>
                <div className="text-left shrink-0 whitespace-nowrap">
                  <h1 className="text-sm font-bold text-slate-800 dark:text-white leading-none mb-0.5">水文测验</h1>
                  <p className="text-xs text-slate-400 dark:text-slate-500 leading-none">GB 50179-2015</p>
                </div>
              </button>

              <AnimatePresence>
                {showOtaMenu && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.92, y: -4 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.92, y: -4 }}
                    transition={{ duration: 0.15, ease: 'easeOut' }}
                    className="absolute left-0 top-full z-[120] mt-2 w-52 rounded-2xl 
                      bg-white/45 dark:bg-gray-900/45 backdrop-blur-xl 
                      border border-white/40 dark:border-white/10 
                      shadow-[0_8px_32px_0_rgba(31,38,135,0.15)] 
                      ring-1 ring-white/50 origin-top-left p-1.5 flex flex-col gap-1"
                  >
                    <button
                      onClick={() => { handleDirectOTA(); setShowOtaMenu(false); }}
                      disabled={isCheckingOTA}
                      className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-left text-xs font-semibold
                        text-slate-700 dark:text-slate-200 hover:bg-white/40 dark:hover:bg-white/10 transition-colors disabled:opacity-50"
                    >
                      <span className="text-sm">☁️</span>
                      <div className="min-w-0">
                        <div className="font-bold">腾讯云核心节点</div>
                        <div className="text-[10px] text-slate-400 dark:text-slate-500">OTA 热更 / XOR 混淆大包</div>
                      </div>
                    </button>
                    <button
                      onClick={handleGitHubOTA}
                      disabled={isCheckingOTA}
                      className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-left text-xs font-semibold
                        text-slate-700 dark:text-slate-200 hover:bg-white/40 dark:hover:bg-white/10 transition-colors disabled:opacity-50"
                    >
                      <span className="text-sm">🐙</span>
                      <div className="min-w-0">
                        <div className="font-bold">GitHub 备用节点</div>
                        <div className="text-[10px] text-slate-400 dark:text-slate-500">开源仓库直连 / 原生 APK</div>
                      </div>
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* 操作按钮区 */}
            <div className="flex items-center gap-1 flex-wrap justify-end flex-1 min-w-[200px]">
              {/* 存为模板 — 断面几何骨架快照 */}
              <button onClick={handleSaveTemplate}
                className="p-1.5 rounded-md bg-white/60 dark:bg-gray-800/60 border border-white/80 dark:border-gray-700 text-slate-500 dark:text-slate-400 hover:text-violet-600 dark:hover:text-violet-400 hover:bg-violet-50 dark:hover:bg-violet-900/30 transition-colors"
                title="存为常用断面模板">
                <BookmarkPlus className="w-4 h-4" />
              </button>

              {/* 载入模板 — 断面模板悬浮菜单 */}
              <div ref={templateMenuRef} className="md:relative">
                <button
                  onClick={() => setShowTemplateMenu(!showTemplateMenu)}
                  className="p-1.5 rounded-md bg-white/60 dark:bg-gray-800/60 border border-white/80 dark:border-gray-700 text-slate-500 dark:text-slate-400 hover:text-violet-600 dark:hover:text-violet-400 hover:bg-violet-50 dark:hover:bg-violet-900/30 transition-colors"
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
                              className="flex-1 flex items-center gap-3 px-2 py-2.5 text-left text-sm text-slate-700 dark:text-slate-200 
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
                              className="p-1.5 mr-1 rounded hover:bg-red-50 dark:hover:bg-red-900/30 text-slate-400 dark:text-slate-500 hover:text-red-500 shrink-0"
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
              <div className="md:relative" ref={importMenuRef}>
                <button
                  onClick={() => setShowImportMenu(!showImportMenu)}
                  className="p-1.5 rounded-md bg-white/60 dark:bg-gray-800/60 border border-white/80 dark:border-gray-700 text-slate-500 dark:text-slate-400 hover:text-amber-600 dark:hover:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/30 transition-colors"
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
                className="p-1.5 rounded-md bg-white/60 dark:bg-gray-800/60 border border-white/80 dark:border-gray-700 text-slate-500 dark:text-slate-400 hover:text-hydro-blue dark:hover:text-hydro-blue-light transition-colors"
                title="导出当前测次 JSON">
                <Upload className="w-4 h-4" />
              </button>

              {/* Numbers 导出 */}
              <button onClick={exportData}
                className="p-1.5 rounded-md bg-white/60 dark:bg-gray-800/60 border border-white/80 dark:border-gray-700 text-slate-500 dark:text-slate-400 hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors"
                title="导出 Numbers / Excel">
                <NumbersIcon className="w-4 h-4" />
              </button>

              {/* 暗黑模式切换 */}
              <button onClick={() => setDarkMode(!darkMode)}
                className="p-1.5 rounded-md bg-white/60 dark:bg-gray-800/60 border border-white/80 dark:border-gray-700 text-slate-500 dark:text-yellow-400 hover:bg-slate-100 dark:hover:bg-gray-800 transition-colors"
                title={darkMode ? '切换亮色模式' : '切换深色模式'}>
                {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              </button>
            </div>
          </div>
          
          {/* 🔍 Apple Safari 风格：液态微光真实进度条（紧贴 Header 底部） */}
          {downloadProgress !== null && (
            <div className="absolute bottom-0 left-0 right-0 h-[2.5px] bg-slate-200/20 dark:bg-gray-800/20 overflow-hidden z-[130]">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${downloadProgress}%` }}
                transition={{ duration: 0.1, ease: 'linear' }}
                className="h-full bg-gradient-to-r from-cyan-400 to-blue-500 shadow-[0_0_8px_rgba(34,211,238,0.8)]"
              />
            </div>
          )}
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
                className="p-1.5 rounded-lg bg-white/60 dark:bg-gray-900/60 border border-white/80 dark:border-gray-700/80 max-h-64 overflow-y-auto shadow-sm">
                <div className="flex flex-col gap-1">
                  {sortedRuns.map((run, index) => (
                    <div key={run.id} className={`flex items-center gap-1 px-1.5 py-1 rounded-md ${
                      run.id === currentRun.id
                        ? 'bg-blue-50/80 dark:bg-blue-900/40 ring-1 ring-blue-500 shadow-sm'
                        : 'bg-slate-50 dark:bg-gray-800 hover:bg-slate-100 dark:hover:bg-gray-700'
                    }`}>
                      <button onClick={() => { loadRun(run.id); toggleHistoryPanel(); }}
                        className="flex-1 flex items-center justify-between text-left min-w-0">
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
          {/* V-Field 成果图按钮 — 粒子微光动效 */}
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => setShowCFDSheet(true)}
            className="relative flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold
              overflow-hidden
              bg-gradient-to-r from-cyan-600/80 to-blue-600/80
              border border-cyan-400/40
              text-white
              shadow-lg shadow-cyan-500/20
              hover:shadow-cyan-500/40
              transition-shadow duration-300"
          >
            {/* 粒子微光背景 */}
            <span className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent animate-shimmer" />
            <Activity className="relative w-3.5 h-3.5" />
            <span className="relative">V-Field</span>
            {/* 脉冲光点 */}
            <span className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-cyan-300 animate-ping" />
            <span className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-cyan-200" />
          </motion.button>
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
                style={{ height: `${sheetHeight}vh` }}
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
                        onClick={() => setShowCFDSheet(false)}
                        onPointerDown={(e) => e.stopPropagation()}
                        className="p-1.5 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 text-white/60 hover:text-white transition-colors cursor-pointer"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>

                {/* 图表区 — flex-1 自动撑满，压扁防线 min-h-[20px] */}
                <div className="flex-1 min-h-[20px] p-2">
                  <SectionCFDChart onSnapChange={setSnappedPoint} />
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

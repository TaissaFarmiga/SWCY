/**
 * Dashboard 极致紧凑顶部看板与操作枢纽 (Liquid Glass & Mobile First)
 *
 * v5.0 — 任务一重构：
 * 1. 全站唯一操作栏（+新建/历史/打卡/设置），强制 320px 不溢出。
 * 2. Apple-style 液态玻璃质感 (backdrop-blur-md + border-white/80)。
 * 3. 按钮全部挂载 Zustand store actions，与 HydroTable 面板联动。
 */
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, Plus, History, Play, Square } from 'lucide-react';
import { useState } from 'react';
import { useHydroStore } from '../store/hydroStore';
import SaveHub from './SaveHub';

// Liquid Glass 风格微缩数据块 (统一宽度)
function StatPill({ label, value, unit }: { label: string; value?: string; unit: string }) {
  return (
    <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-white/60 dark:bg-gray-800/60 backdrop-blur-md border border-white/80 dark:border-gray-700/60 shadow-sm w-full">
      {/* 1. 左侧标签：固定宽度，严格靠左对齐 */}
      <span className="text-[11px] text-slate-500 dark:text-slate-400 font-medium w-12 text-left shrink-0">
        {label}
      </span>
      {/* 2. 中间数字骨架：整体居中，内部靠左 */}
      <div className="flex-1 flex justify-center min-w-0">
        <div className="w-16 text-left font-mono text-sm font-black text-blue-600 dark:text-cyan-400">
          {value || '--'}
        </div>
      </div>
      {/* 3. 右侧单位：固定宽度，严格靠右对齐 */}
      <span className="text-[10px] text-slate-400 dark:text-slate-500 w-10 text-right shrink-0 whitespace-nowrap">
        {unit}
      </span>
    </div>
  );
}

// Liquid Glass 风格操作按钮
function GlassButton({
  children,
  onClick,
  className = '',
  highlight = false,
  disabled = false,
  title,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  className?: string;
  highlight?: boolean;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg backdrop-blur-md border shadow-sm transition-all active:scale-95 shrink-0 disabled:opacity-40 ${
        highlight
          ? 'bg-blue-600 text-white border-blue-500 shadow-blue-500/20 hover:bg-blue-700'
          : 'bg-white/60 dark:bg-gray-800/60 border-white/80 dark:border-gray-600/50 text-slate-700 dark:text-slate-200 hover:bg-white/80 dark:hover:bg-gray-700/80'
      } ${className}`}
    >
      {children}
    </button>
  );
}

export default function Dashboard() {
  const currentRun = useHydroStore((s) => s.currentRun);
  const runsLen = useHydroStore((s) => s.runs.length);
  const createRun = useHydroStore((s) => s.createRun);
  const markTime = useHydroStore((s) => s.markTime);
  const toggleHistoryPanel = useHydroStore((s) => s.toggleHistoryPanel);
  const [expanded, setExpanded] = useState(false);

  // 格式化时间显示 (HH:mm) — 兼容 ISO 与 MM/DD HH:mm 两种格式
  const formatTime = (timeStr?: string) => {
    if (!timeStr) return '--:--';
    // 格式 "MM/DD HH:mm"
    const mmddMatch = timeStr.match(/\d{1,2}\/\d{1,2}\s(\d{2}:\d{2})/);
    if (mmddMatch) return mmddMatch[1];
    // 格式 ISO "YYYY-MM-DDTHH:mm..."
    const isoMatch = timeStr.match(/T(\d{2}:\d{2})/);
    if (isoMatch) return isoMatch[1];
    // 兜底：尝试直接解析 Date
    const d = new Date(timeStr);
    if (!isNaN(d.getTime())) {
      return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    }
    return '--:--';
  };

  const primaryStats = [
    { label: '流量', value: currentRun.totalDischarge, unit: 'm³/s' },
    { label: '面积', value: currentRun.totalArea, unit: 'm²' },
  ];

  const secondaryStats = [
    { label: '最大速', value: currentRun.maxVelocity, unit: 'm/s' },
    { label: '均速', value: currentRun.meanVelocity, unit: 'm/s' },
    { label: '水面宽', value: currentRun.surfaceWidth, unit: 'm' },
    { label: '最大深', value: currentRun.maxDepth, unit: 'm' },
  ];

  return (
    <div className="relative z-10 px-2 py-2 space-y-2 bg-gradient-to-b from-[#F2F2F7]/80 dark:from-gray-950/80 to-transparent backdrop-blur-sm">
      {/* 第一行：核心数据 + 展开按钮 */}
      <div className="relative pr-10">
        <div className="grid grid-cols-2 gap-2">
          {primaryStats.map((s) => (
            <StatPill key={s.label} {...s} />
          ))}
        </div>
        <button
          onClick={() => setExpanded(!expanded)}
          className="absolute right-0 top-1/2 -translate-y-1/2 p-1 rounded-lg bg-white/40 dark:bg-gray-800/40 border border-white/60 dark:border-gray-700/60 shadow-sm active:scale-95 transition-all shrink-0"
          title={expanded ? '收起' : '展开更多数据'}
        >
          <ChevronDown
            className={`w-3.5 h-3.5 text-slate-500 transition-transform ${expanded ? 'rotate-180' : ''}`}
          />
        </button>
      </div>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <div className="pr-10">
              <div className="grid grid-cols-2 gap-2 pb-1">
                {secondaryStats.map((s) => (
                  <StatPill key={s.label} {...s} />
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

     {/* 第二行：全站唯一操作栏 [+][历史] | [▶ 开始][⏹ 结束] */}
      <div className="flex items-center gap-1.5 w-full">
        {/* 左侧可滑动区域（如果屏幕极窄） */}
        <div className="flex-1 flex items-center gap-1.5 overflow-x-auto no-scrollbar">
          {/* 新建 */}
          <GlassButton onClick={() => createRun()} highlight className="px-2.5" title="新建测次">
            <Plus className="w-4 h-4 stroke-[2.5]" />
          </GlassButton>

          {/* 历史记录 */}
          <GlassButton onClick={toggleHistoryPanel} className="min-w-[50px]" title="历史记录">
            <History className="w-3.5 h-3.5" />
            <span className="text-[11px] font-bold font-mono">{runsLen}</span>
          </GlassButton>

          {/* 分隔符 */}
          <div className="w-px h-5 bg-slate-300/50 dark:bg-gray-600/50 mx-0.5 shrink-0" />

          {/* 开始打卡 */}
          <GlassButton
            onClick={() => markTime('start')}
            className="bg-green-50/60 dark:bg-green-900/20 border-green-200/50 dark:border-green-800/50 hover:bg-green-100/80 dark:hover:bg-green-900/40"
            title="记录开始时间"
          >
            <Play className="w-3.5 h-3.5 text-green-600 dark:text-green-400 fill-current" />
            <span className="text-[11px] font-mono font-bold text-green-700 dark:text-green-300">
              {formatTime(currentRun.startTime)}
            </span>
          </GlassButton>

          {/* 结束打卡 */}
          <GlassButton
            onClick={() => markTime('end')}
            disabled={!currentRun.startTime}
            className="bg-red-50/60 dark:bg-red-900/20 border-red-200/50 dark:border-red-800/50 hover:bg-red-100/80 dark:hover:bg-red-900/40"
            title="记录结束时间"
          >
            <Square className="w-3.5 h-3.5 text-red-500 dark:text-red-400 fill-current" />
            <span className="text-[11px] font-mono font-bold text-red-600 dark:text-red-300">
              {formatTime(currentRun.endTime)}
            </span>
          </GlassButton>
        </div>

        {/* 右侧固定区域：SaveHub 独立于滚动容器外，绝对防止气泡被溢出裁切 */}
        <SaveHub />
      </div>
    </div>
  );
}
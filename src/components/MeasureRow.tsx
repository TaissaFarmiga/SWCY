import { motion } from 'framer-motion';
import { RefreshCw, Calculator } from 'lucide-react';
import { MeasurePoint, VelocityInputMode } from '../types';
import { useHydroStore } from '../store/hydroStore';
import { calculateVelocityFromFormula } from '../lib/HydroEngine';
import { roundVelocity } from '../lib/rounding';

interface Props {
  verticalId: string;
  point: MeasurePoint;
  index: number;
}

export default function MeasureRow({ verticalId, point, index }: Props) {
  const updateMeasurePoint = useHydroStore((s) => s.updateMeasurePoint);
  const meterFormula = useHydroStore((s) => s.currentRun.meterFormula);

  const mode: VelocityInputMode = point.mode || 'direct';
  const n = point.n || '';
  const t = point.t || '100';

  const handleModeToggle = () => {
    const newMode: VelocityInputMode = mode === 'direct' ? 'formula' : 'direct';
    updateMeasurePoint(verticalId, point.id, { mode: newMode, velocity: '', n: '', t: '100' });
  };

  const handleVelocityChange = (value: string) => {
    updateMeasurePoint(verticalId, point.id, { velocity: value, mode: 'direct' });
  };

  const handleNChange = (value: string) => {
    const updates: Partial<MeasurePoint> = { n: value };
    if (value && t) { 
      const tv = parseFloat(t); 
      if (!isNaN(tv) && tv > 0) updates.velocity = roundVelocity(calculateVelocityFromFormula(value, t, meterFormula)); 
    }
    updateMeasurePoint(verticalId, point.id, updates);
  };

  const handleTChange = (value: string) => {
    const updates: Partial<MeasurePoint> = { t: value };
    if (n && value) { 
      const tv = parseFloat(value); 
      if (!isNaN(tv) && tv > 0) updates.velocity = roundVelocity(calculateVelocityFromFormula(n, value, meterFormula)); 
    }
    updateMeasurePoint(verticalId, point.id, updates);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.02 }}
      className="flex flex-col gap-1.5 px-1 py-1 rounded-lg bg-white/60 dark:bg-gray-800/60 backdrop-blur-sm border border-slate-200/60 dark:border-gray-700/50 shadow-sm overflow-hidden w-full min-w-0"
    >
      {/* ========= 公式模式：第一行 [ Kα | ▾⇊ | 🔄(靠右) ] ========= */}
      {mode === 'formula' && (
        <>
          <div className="flex items-center gap-1.5 w-full">
            {/* Kα - 自动比例填充 */}
            <div className="flex items-center px-1.5 py-1 rounded-lg bg-slate-100/80 dark:bg-gray-700 border border-slate-200 dark:border-gray-600 flex-1 min-w-[55px] focus-within:border-hydro-blue focus-within:ring-1 focus-within:ring-hydro-blue/30 transition-colors">
              <span className="text-[9px] text-slate-400 font-bold mr-1">Kα</span>
              <input
                type="text" inputMode="decimal" step="0.01" min="0" max="1"
                value={(() => {
                  const v = useHydroStore.getState().currentRun.verticals.find(v => v.id === verticalId);
                  return v?.deflectionCoefficient || '1.0';
                })()}
                onChange={(e) => {
                  useHydroStore.getState().updateVertical(verticalId, { deflectionCoefficient: e.target.value });
                }}
                className="w-full bg-transparent text-[11px] font-mono text-slate-600 dark:text-slate-300 text-center outline-none"
              />
            </div>

            {/* 深度胶囊 - 自动比例填充 */}
            <div className="flex items-center rounded-lg bg-white/80 dark:bg-gray-900/50 border border-slate-200/80 dark:border-gray-600 shadow-inner overflow-hidden flex-[1.5] min-w-[110px] focus-within:border-hydro-blue focus-within:ring-1 focus-within:ring-hydro-blue/30 transition-colors">
              <div className="flex items-center px-1 py-0.5 bg-blue-50/50 dark:bg-cyan-900/20 focus-within:bg-blue-100/50 transition-colors">
                <span className="text-[11px] text-blue-500 dark:text-cyan-400 mr-0.5">▾</span>
                <input type="text" inputMode="decimal" step="0.1" value={point.relativeDepth}
                  onChange={(e) => updateMeasurePoint(verticalId, point.id, { relativeDepth: e.target.value })}
                  className="w-7 bg-transparent text-[11px] font-mono text-blue-600 dark:text-cyan-300 font-bold outline-none text-center" />
              </div>
              <div className="w-px h-3.5 bg-slate-200 dark:bg-gray-600 shrink-0" />
              <div className="flex items-center px-1 py-0.5 focus-within:bg-slate-50 dark:focus-within:bg-gray-800 transition-colors">
                <span className="text-[11px] text-slate-400 dark:text-slate-500 mr-0.5">⇊</span>
                <input type="text" inputMode="decimal" step="0.01" value={point.absoluteDepth || ''}
                  onChange={(e) => updateMeasurePoint(verticalId, point.id, { absoluteDepth: e.target.value })}
                  placeholder="--"
                  className="w-8 bg-transparent text-[11px] font-mono text-slate-600 dark:text-slate-300 outline-none text-center" />
              </div>
            </div>

            {/* 模式切换按钮推到最右 */}
            <button onClick={handleModeToggle} className="p-1 rounded bg-blue-500 text-white shadow-sm shrink-0 ml-auto transition-colors">
              <Calculator className="w-4 h-4" />
            </button>
          </div>

          {/* ========= 公式模式：第二行 [ N|T 胶囊 ] → [ V 计算结果 ] ========= */}
          <div className="flex items-center gap-1.5 w-full">
            {/* N|T 胶囊 — 比例铺满与圆角高亮 */}
            <div className="flex items-center rounded-lg bg-white/80 dark:bg-gray-900/50 border border-slate-200/80 dark:border-gray-600 shadow-inner overflow-hidden flex-[1.5] min-w-[110px] focus-within:border-hydro-blue focus-within:ring-1 focus-within:ring-hydro-blue/30 transition-colors">
              <div className="flex items-center px-1.5 py-1 focus-within:bg-slate-50 dark:focus-within:bg-gray-800 transition-colors flex-1">
                <span className="text-[10px] text-slate-400 font-bold mr-1">N</span>
                <input type="text" inputMode="numeric" value={n}
                  onChange={(e) => handleNChange(e.target.value)}
                  className="w-full bg-transparent text-[13px] font-mono font-bold text-slate-700 dark:text-slate-200 text-center outline-none" />
              </div>
              <div className="w-px h-4 bg-slate-200 dark:bg-gray-600 shrink-0" />
              <div className="flex items-center px-1.5 py-1 focus-within:bg-slate-50 dark:focus-within:bg-gray-800 transition-colors flex-1">
                <span className="text-[10px] text-slate-400 font-bold mr-1">T</span>
                <input type="text" inputMode="decimal" value={t}
                  onChange={(e) => handleTChange(e.target.value)}
                  className="w-full bg-transparent text-[13px] font-mono font-bold text-slate-700 dark:text-slate-200 text-center outline-none" />
              </div>
            </div>

            {/* 小箭头 */}
            <span className="text-sm text-slate-300 dark:text-slate-600 shrink-0 font-bold">→</span>

            {/* V 计算结果胶囊 — 统一圆角样式 */}
            <div className="flex items-center justify-center px-2 py-1 rounded-lg bg-blue-50 dark:bg-cyan-900/30 border border-blue-100 dark:border-cyan-800 flex-1 min-w-[80px]">
              <span className="font-mono text-[14px] font-black text-blue-700 dark:text-cyan-300 break-all">
                {point.velocity ? point.velocity : '--'}
              </span>
              <span className="text-xs text-slate-400 dark:text-slate-500 whitespace-nowrap ml-1">m/s</span>
            </div>
          </div>
        </>
      )}

      {/* ========= 直接输入模式：双容器响应式布局 [ 左侧参数块 | 右侧流速组合 ] ========= */}
      {mode === 'direct' && (
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-2 w-full">
          {/* 左侧参数块：Kα + 深度连体胶囊 */}
          <div className="flex items-center gap-1.5 grow flex-[1.3] min-w-[135px]">
            {/* 1. Kα 输入块 - 拓宽防溢出与圆角高亮 */}
            <div className="flex items-center justify-center px-1 py-1 rounded-lg bg-slate-100/80 dark:bg-gray-700 border border-slate-200 dark:border-gray-600 w-[55px] shrink-0 shadow-sm focus-within:border-hydro-blue focus-within:ring-1 focus-within:ring-hydro-blue/30 transition-colors">
              <span className="text-[9px] text-slate-400 font-bold mr-0.5">Kα</span>
              <input
                type="text" inputMode="decimal"
                value={(() => {
                  const v = useHydroStore.getState().currentRun.verticals.find(v => v.id === verticalId);
                  return v?.deflectionCoefficient || '1.0';
                })()}
                onChange={(e) => {
                  useHydroStore.getState().updateVertical(verticalId, { deflectionCoefficient: e.target.value });
                }}
                className="w-full min-w-0 bg-transparent text-[11px] font-mono text-slate-600 dark:text-slate-300 text-center outline-none"
              />
            </div>

            {/* 2. 深度连体胶囊 - 升级圆角与高亮 */}
            <div className="flex items-center rounded-lg bg-white/80 dark:bg-gray-900/50 border border-slate-200/80 dark:border-gray-600 shadow-inner overflow-hidden flex-1 min-w-[40px] divide-x divide-slate-200/50 dark:divide-gray-700/50 focus-within:border-hydro-blue focus-within:ring-1 focus-within:ring-hydro-blue/30 transition-colors">
              <div className="flex items-center px-1 py-1 flex-1 min-w-[40px]">
                <span className="text-[11px] text-blue-500 dark:text-cyan-400 mr-0.5 shrink-0">▾</span>
                <input type="text" inputMode="decimal" value={point.relativeDepth}
                  onChange={(e) => updateMeasurePoint(verticalId, point.id, { relativeDepth: e.target.value })}
                  className="w-full min-w-[40px] bg-transparent text-[11px] font-mono text-blue-600 dark:text-cyan-300 font-bold outline-none text-center" />
              </div>
              <div className="flex items-center px-1 py-1 flex-1 min-w-[40px]">
                <span className="text-[11px] text-slate-400 dark:text-slate-500 mr-0.5 shrink-0">⇊</span>
                <input type="text" inputMode="decimal" value={point.absoluteDepth || ''}
                  onChange={(e) => updateMeasurePoint(verticalId, point.id, { absoluteDepth: e.target.value })}
                  placeholder="--"
                  className="w-full min-w-[40px] bg-transparent text-[11px] font-mono text-slate-600 dark:text-slate-300 outline-none text-center" />
              </div>
            </div>
          </div>

          {/* 右侧流速组合容器 - 优化最小宽度释放 10px 空间防止按钮越界 */}
          <div className="flex items-center gap-1.5 whitespace-nowrap grow flex-1 min-w-[95px]">
            {/* V 直接输入 */}
            <div className="relative flex-1 min-w-0">
              <input
                type="text" inputMode="decimal"
                value={point.velocity}
                onChange={(e) => handleVelocityChange(e.target.value)}
                placeholder=""
                className="w-full min-w-[55px] pl-1.5 pr-9 py-1 rounded-lg bg-blue-50/80 dark:bg-cyan-900/30 border border-blue-200/60 dark:border-cyan-800/50 shadow-inner text-[12px] font-black text-blue-700 dark:text-cyan-300 font-mono text-center outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400/30 transition-all"
              />
              <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[10px] text-slate-400 dark:text-slate-500 pointer-events-none whitespace-nowrap">m/s</span>
            </div>

            {/* 模式切换按钮 - 升级圆角 */}
            <button onClick={handleModeToggle} className="p-1.5 rounded-lg bg-slate-100 dark:bg-gray-700 text-slate-400 hover:text-blue-500 shrink-0 transition-colors">
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}
    </motion.div>
  );
}
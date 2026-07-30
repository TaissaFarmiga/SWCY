import { memo } from 'react';
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

const MeasureRow = ({ verticalId, point, index }: Props) => {
  const updateMeasurePoint = useHydroStore((s) => s.updateMeasurePoint);
  const meterFormula = useHydroStore((s) => s.currentRun.meterFormula);

  const mode: VelocityInputMode = point.mode || 'direct';
  const n = point.n || '';
  const t = point.t !== undefined ? point.t : '100';

  const handleModeToggle = () => {
    const newMode: VelocityInputMode = mode === 'direct' ? 'formula' : 'direct';
    const updates: Partial<MeasurePoint> = { mode: newMode };
    
    // 🚀 核心优化：从"直读流速"切换为"公式参数"时，若已有流速 V，自动反向推导计算出转数 N，防止数据断档
    if (newMode === 'formula' && point.velocity) {
      const v = parseFloat(point.velocity);
      const k = meterFormula?.k ?? 0.4280;
      const c = meterFormula?.c ?? 0.0057;
      const currentT = point.t || '100'; // 锁定当前历时时间，默认为100秒
      const tv = parseFloat(currentT);
      
      if (!isNaN(v) && k > 0 && !isNaN(tv) && tv > 0) {
        // N = (V - c) * T / K
        const computedN = ((v - c) * tv) / k;
        const calculatedN = !isNaN(computedN) ? Math.max(0, Math.round(computedN)) : 0;
        updates.n = String(calculatedN);
        updates.t = currentT;
      }
    }
    
    updateMeasurePoint(verticalId, point.id, updates);
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

  const handleFormulaVelocityChange = (value: string) => {
    const updates: Partial<MeasurePoint> = { velocity: value };
    if (!value) {
      updates.n = '';
      updateMeasurePoint(verticalId, point.id, updates);
      return;
    }
    const v = parseFloat(value);
    const k = meterFormula?.k ?? 0.4280;
    const c = meterFormula?.c ?? 0.0057;
    
    if (!isNaN(v) && k > 0) {
      if (t) {
        const tv = parseFloat(t);
        if (!isNaN(tv) && tv > 0) {
          // N = (V - c) * T / K
          const computedN = ((v - c) * tv) / k;
          updates.n = !isNaN(computedN) ? Math.max(0, Math.round(computedN)).toString() : '';
        }
      }
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
                  const isIce = useHydroStore.getState().currentRun.flowPeriod === 'ice';
                  return v?.deflectionCoefficient ?? (isIce ? '0.9' : '1.0');
                })()}
                onChange={(e) => {
                  useHydroStore.getState().updateVertical(verticalId, { deflectionCoefficient: e.target.value });
                }}
                className="w-full bg-transparent text-[11px] font-mono text-slate-600 dark:text-slate-300 text-center border-none outline-none focus:outline-none focus:ring-0 focus:border-transparent"
              />
            </div>

            {/* 深度胶囊 - 自动比例填充并锁定子胶囊物理下限 */}
            <div className="flex items-center rounded-lg bg-white/80 dark:bg-gray-900/50 border border-slate-200/80 dark:border-gray-600 shadow-inner overflow-hidden flex-[1.5] min-w-[125px] focus-within:border-hydro-blue focus-within:ring-1 focus-within:ring-hydro-blue/30 transition-colors">
              <div className="flex items-center px-1 py-0.5 bg-blue-50/50 dark:bg-cyan-900/20 focus-within:bg-blue-100/50 transition-colors flex-1 min-w-[50px]">
                <span className="text-[11px] text-blue-500 dark:text-cyan-400 mr-0.5 shrink-0">▾</span>
                <input type="text" inputMode="decimal" step="0.1" value={point.relativeDepth}
                  onChange={(e) => updateMeasurePoint(verticalId, point.id, { relativeDepth: e.target.value })}
                  className="w-full bg-transparent text-[11px] font-mono text-blue-600 dark:text-cyan-300 font-bold border-none outline-none focus:outline-none focus:ring-0 focus:border-transparent text-center" />
              </div>
              <div className="w-px h-3.5 bg-slate-200 dark:bg-gray-600 shrink-0" />
              <div className="flex items-center px-1 py-0.5 focus-within:bg-slate-50 dark:focus-within:bg-gray-800 transition-colors flex-1 min-w-[60px]">
                <span className="text-[11px] text-slate-400 dark:text-slate-500 mr-0.5 shrink-0">⇊</span>
                <input type="text" inputMode="decimal" step="0.01" value={point.absoluteDepth || ''}
                  onChange={(e) => updateMeasurePoint(verticalId, point.id, { absoluteDepth: e.target.value })}
                  placeholder="--"
                  className="w-full bg-transparent text-[11px] font-mono text-slate-600 dark:text-slate-300 border-none outline-none focus:outline-none focus:ring-0 focus:border-transparent text-center" />
              </div>
            </div>

            {/* 模式切换按钮推到最右 */}
            <button aria-label="切换为直接流速输入" onClick={handleModeToggle} className="flex min-h-11 min-w-11 items-center justify-center rounded bg-blue-500 text-white shadow-sm shrink-0 ml-auto transition-colors">
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
                  className="w-full bg-transparent text-[13px] font-mono font-bold text-slate-700 dark:text-slate-200 text-center border-none outline-none focus:outline-none focus:ring-0 focus:border-transparent" />
              </div>
              <div className="w-px h-4 bg-slate-200 dark:bg-gray-600 shrink-0" />
              <div className="flex items-center px-1.5 py-1 focus-within:bg-slate-50 dark:focus-within:bg-gray-800 transition-colors flex-1">
                <span className="text-[10px] text-slate-400 font-bold mr-1">T</span>
                <input type="text" inputMode="decimal" value={t}
                  onChange={(e) => handleTChange(e.target.value)}
                  className="w-full bg-transparent text-[13px] font-mono font-bold text-slate-700 dark:text-slate-200 text-center border-none outline-none focus:outline-none focus:ring-0 focus:border-transparent" />
              </div>
            </div>

            {/* 小箭头 */}
            <span className="text-sm text-slate-300 dark:text-slate-600 shrink-0 font-bold">→</span>

            {/* V 反算输入框 — 深度打通双向解算 */}
            <label className="flex min-h-10 min-w-[124px] flex-1 items-center gap-1 rounded-xl border border-blue-200/60 bg-blue-50/80 px-2 shadow-inner dark:border-cyan-800/50 dark:bg-cyan-900/30">
              <span className="text-xs font-bold text-blue-500 dark:text-cyan-400">V</span>
              <input
                data-testid="flow-formula-velocity-input"
                type="text" inputMode="decimal"
                value={point.velocity || ''}
                onChange={(e) => handleFormulaVelocityChange(e.target.value)}
                placeholder="--"
                className="min-w-0 flex-1 bg-transparent text-center font-mono text-base font-black text-blue-700 outline-none dark:text-cyan-300"
              />
              <span className="shrink-0 text-xs text-slate-400 dark:text-slate-500">m/s</span>
            </label>
          </div>
        </>
      )}

      {/* ========= 直接输入模式：双容器响应式布局 [ 左侧参数块 | 右侧流速组合 ] ========= */}
      {mode === 'direct' && (
        <div className="grid w-full grid-cols-1 items-center gap-2 min-[390px]:grid-cols-[minmax(0,1fr)_minmax(174px,0.9fr)]">
          {/* 左侧参数块：Kα + 深度连体胶囊 */}
          <div className="flex min-w-0 items-center gap-1.5">
            {/* 1. Kα 输入块 - 拓宽防溢出与圆角高亮 */}
            <div className="flex items-center justify-center px-1 py-1 rounded-lg bg-slate-100/80 dark:bg-gray-700 border border-slate-200 dark:border-gray-600 w-[55px] shrink-0 shadow-sm focus-within:border-hydro-blue focus-within:ring-1 focus-within:ring-hydro-blue/30 transition-colors">
              <span className="text-[9px] text-slate-400 font-bold mr-0.5">Kα</span>
              <input
                type="text" inputMode="decimal"
                value={(() => {
                  const v = useHydroStore.getState().currentRun.verticals.find(v => v.id === verticalId);
                  const isIce = useHydroStore.getState().currentRun.flowPeriod === 'ice';
                  return v?.deflectionCoefficient ?? (isIce ? '0.9' : '1.0');
                })()}
                onChange={(e) => {
                  useHydroStore.getState().updateVertical(verticalId, { deflectionCoefficient: e.target.value });
                }}
                className="w-full min-w-0 bg-transparent text-[11px] font-mono text-slate-600 dark:text-slate-300 text-center border-none outline-none focus:outline-none focus:ring-0 focus:border-transparent"
              />
            </div>

            {/* 2. 深度连体胶囊 - 升级圆角与高亮 */}
            <div className="flex min-w-0 flex-1 items-center divide-x divide-slate-200/50 overflow-hidden rounded-lg border border-slate-200/80 bg-white/80 shadow-inner transition-colors focus-within:border-hydro-blue focus-within:ring-1 focus-within:ring-hydro-blue/30 dark:divide-gray-700/50 dark:border-gray-600 dark:bg-gray-900/50">
              <div className="flex min-w-0 flex-1 items-center px-1 py-1">
                <span className="text-[11px] text-blue-500 dark:text-cyan-400 mr-0.5 shrink-0">▾</span>
                <input type="text" inputMode="decimal" value={point.relativeDepth}
                  onChange={(e) => updateMeasurePoint(verticalId, point.id, { relativeDepth: e.target.value })}
                  className="w-full min-w-0 bg-transparent text-center font-mono text-sm font-bold text-blue-600 outline-none dark:text-cyan-300" />
              </div>
              <div className="flex min-w-0 flex-1 items-center px-1 py-1">
                <span className="text-[11px] text-slate-400 dark:text-slate-500 mr-0.5 shrink-0">⇊</span>
                <input type="text" inputMode="decimal" value={point.absoluteDepth || ''}
                  onChange={(e) => updateMeasurePoint(verticalId, point.id, { absoluteDepth: e.target.value })}
                  placeholder="--"
                  className="w-full min-w-0 bg-transparent text-center font-mono text-sm text-slate-600 outline-none dark:text-slate-300" />
              </div>
            </div>
          </div>

          {/* 右侧流速组合容器 - 优化最小宽度释放 10px 空间防止按钮越界 */}
          <div className="flex min-w-[174px] items-center gap-1.5 whitespace-nowrap">
            {/* V 直接输入 */}
            <label className="flex min-h-10 min-w-[124px] flex-1 items-center gap-1 rounded-xl border border-blue-200/60 bg-blue-50/80 px-2 shadow-inner dark:border-cyan-800/50 dark:bg-cyan-900/30">
              <span className="text-xs font-bold text-blue-500 dark:text-cyan-400">V</span>
              <input
                data-testid="flow-velocity-input"
                type="text" inputMode="decimal"
                value={point.velocity}
                onChange={(e) => handleVelocityChange(e.target.value)}
                placeholder=""
                className="min-w-0 flex-1 bg-transparent text-center font-mono text-base font-black text-blue-700 outline-none dark:text-cyan-300"
              />
              <span className="shrink-0 text-xs text-slate-400 dark:text-slate-500">m/s</span>
            </label>

            {/* 模式切换按钮 - 升级圆角 */}
            <button aria-label="切换为转数历时公式输入" onClick={handleModeToggle} className="glass-icon-button shrink-0">
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}
    </motion.div>
  );
};

export default memo(MeasureRow, (prev, next) => {
  return prev.point === next.point && prev.index === next.index;
});

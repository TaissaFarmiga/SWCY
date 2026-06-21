/**
 * 测点流速输入行 v2.0 — 符号降维 & 液态胶囊合并
 *
 * 核心重构：
 * 1. 汉字 → 物理符号：相对→▾, 绝对→⇊, 流速→Vitalic
 * 2. 深度合并胶囊：[▾ inp ∣ ⇊ inp] 单边框
 * 3. N/T 合并胶囊：[N inp ∣ T inp] 单边框
 * 4. 流速输入高亮：微蓝底色 + focus-within:ring-1
 * 5. 野外单手全选：全部 input onFocus={e => e.target.select()}
 */
import { motion } from 'framer-motion';
import { RefreshCw, Calculator } from 'lucide-react';
import { MeasurePoint, VelocityInputMode } from '../types';
import { useHydroStore } from '../store/hydroStore';
import { calculateVelocityFromFormula } from '../lib/HydroEngine';
import { roundVelocity } from '../lib/rounding';
import { Decimal } from 'decimal.js';

interface Props {
  verticalId: string;
  point: MeasurePoint;
  index: number;
  effectiveDepth?: string;
}

export default function MeasureRow({ verticalId, point, index, effectiveDepth }: Props) {
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
    if (value && t) { const tv = parseFloat(t); if (!isNaN(tv) && tv > 0) updates.velocity = roundVelocity(calculateVelocityFromFormula(value, t, meterFormula)); }
    updateMeasurePoint(verticalId, point.id, updates);
  };

  const handleTChange = (value: string) => {
    const updates: Partial<MeasurePoint> = { t: value };
    if (n && value) { const tv = parseFloat(value); if (!isNaN(tv) && tv > 0) updates.velocity = roundVelocity(calculateVelocityFromFormula(n, value, meterFormula)); }
    updateMeasurePoint(verticalId, point.id, updates);
  };

  const handleAbsoluteDepthChange = (value: string) => {
    updateMeasurePoint(verticalId, point.id, { absoluteDepth: value });
  };

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: index * 0.02 }}
      className="flex items-center gap-1.5 px-1 py-0.5 rounded-lg bg-white/60 dark:bg-gray-800/60 backdrop-blur-md border border-white/80 dark:border-gray-700/60 shadow-sm min-w-0 overflow-x-auto no-scrollbar"
    >
      {/* ▾▾▾ 深度合并胶囊 [▾ inp ∣ ⇊ inp] ▾▾▾ */}
      <div className="flex items-center rounded-lg bg-white/80 dark:bg-gray-800/80 border border-slate-200/60 dark:border-gray-700/60 overflow-hidden shrink-0">
        {/* 相对深度 */}
        <div className="flex items-center gap-0.5 px-1">
          <span className="text-[10px] text-hydro-blue dark:text-cyan-400 font-bold select-none leading-none">▾</span>
          <input type="number" inputMode="decimal" step="0.1" min="0" max="1"
            value={point.relativeDepth}
            onChange={(e) => updateMeasurePoint(verticalId, point.id, { relativeDepth: e.target.value })}
            onFocus={(e) => e.target.select()}
            className="w-9 px-0.5 py-0.5 text-xs bg-transparent dark:text-slate-200 text-center font-mono text-hydro-blue dark:text-cyan-400 font-medium outline-none"
          />
        </div>

        {/* w-px 分割线 */}
        <div className="w-px h-4 bg-slate-200 dark:bg-gray-600 shrink-0" />

        {/* 绝对深度 */}
        <div className="flex items-center gap-0.5 px-1">
          <span className="text-[10px] text-slate-400 dark:text-slate-500 font-bold select-none leading-none">⇊</span>
          <input type="number" inputMode="decimal" step="0.01" min="0" placeholder="--"
            value={point.absoluteDepth || ''}
            onChange={(e) => handleAbsoluteDepthChange(e.target.value)}
            onFocus={(e) => e.target.select()}
            className="w-10 px-0.5 py-0.5 text-xs bg-transparent dark:text-slate-200 text-center font-mono text-slate-500 dark:text-slate-300 outline-none"
          />
        </div>
      </div>

      {/* ▾▾▾ 流速区域（条件渲染）▾▾▾ */}
      {mode === 'direct' ? (
        /* 直接输入模式：高亮流速输入框 */
        <div className="flex items-center gap-0.5 rounded-lg bg-blue-50/60 dark:bg-cyan-950/30 border border-blue-200/50 dark:border-cyan-800/50 px-1.5 py-0.5 shrink-0 focus-within:border-blue-400 focus-within:ring-1 focus-within:ring-blue-400/30 transition-shadow">
          <span className="text-[10px] text-blue-500 dark:text-cyan-400 font-bold italic select-none leading-none">V</span>
          <input type="number" inputMode="decimal" step="0.001" min="0" placeholder="0.000"
            value={point.velocity} onChange={(e) => handleVelocityChange(e.target.value)}
            onFocus={(e) => e.target.select()}
            className="w-12 px-0.5 py-0.5 text-xs bg-transparent text-center font-mono font-bold text-blue-600 dark:text-cyan-300 outline-none"
          />
          <span className="text-[9px] text-blue-400 dark:text-cyan-500/70 font-medium">m/s</span>
        </div>
      ) : (
        /* 公式模式：N/T 合并胶囊 + 右侧只读结果 */
        <div className="flex items-center gap-1 shrink-0">
          {/* N/T 合并胶囊 */}
          <div className="flex items-center rounded-lg bg-white/80 dark:bg-gray-800/80 border border-slate-200/60 dark:border-gray-700/60 overflow-hidden">
            {/* N 转数 */}
            <div className="flex items-center gap-0.5 px-1">
              <span className="text-[10px] text-slate-400 dark:text-slate-500 font-bold select-none leading-none">N</span>
              <input type="number" inputMode="numeric" step="1" min="0" placeholder="0"
                value={n} onChange={(e) => handleNChange(e.target.value)}
                onFocus={(e) => e.target.select()}
                className="w-9 px-0.5 py-0.5 text-xs bg-transparent dark:text-slate-200 text-center font-mono outline-none"
              />
            </div>

            {/* w-px 分割线 */}
            <div className="w-px h-4 bg-slate-200 dark:bg-gray-600 shrink-0" />

            {/* T 历时 */}
            <div className="flex items-center gap-0.5 px-1">
              <span className="text-[10px] text-slate-400 dark:text-slate-500 font-bold select-none leading-none">T</span>
              <input type="number" inputMode="decimal" step="1" min="1" placeholder="100"
                value={t} onChange={(e) => handleTChange(e.target.value)}
                onFocus={(e) => e.target.select()}
                className="w-9 px-0.5 py-0.5 text-xs bg-transparent dark:text-slate-200 text-center font-mono outline-none"
              />
            </div>
          </div>

          {/* 计算结果只读胶囊 */}
          <div className="flex items-baseline gap-0.5 rounded-lg bg-blue-50/60 dark:bg-cyan-950/30 border border-blue-200/50 dark:border-cyan-800/50 px-1.5 py-0.5 shrink-0">
            <span className="font-mono text-xs text-hydro-blue dark:text-cyan-400 font-bold">{point.velocity || '--'}</span>
            <span className="text-[9px] text-blue-400 dark:text-cyan-500/70 font-medium">m/s</span>
          </div>
        </div>
      )}

      {/* ▾▾▾ 模式切换按钮 ▾▾▾ */}
      <button onClick={handleModeToggle}
        className={`p-1 rounded-md transition-colors shrink-0 ${
          mode === 'formula'
            ? 'bg-hydro-blue text-white shadow-sm'
            : 'bg-slate-100 dark:bg-gray-700 text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-gray-600'
        }`}
        title={mode === 'direct' ? '切换为公式计算' : '切换为直接输入'}>
        {mode === 'direct' ? <RefreshCw className="w-3 h-3" /> : <Calculator className="w-3 h-3" />}
      </button>
    </motion.div>
  );
}
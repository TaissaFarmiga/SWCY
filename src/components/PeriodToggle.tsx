/**
 * 测流期模式切换组件 - 紧凑版
 * 
 * Fix: 切期时保留用户录入的 velocity/id/n/t（按索引合并），
 * 不再清空冰厚数据。
 */
import { motion } from 'framer-motion';
import { Sun, Snowflake, Settings } from 'lucide-react';
import { FlowPeriod } from '../types';
import { useHydroStore } from '../store/hydroStore';
import { createDefaultMeasurePoints } from '../lib/HydroEngine';

export default function PeriodToggle() {
  const flowPeriod = useHydroStore((s) => s.currentRun.flowPeriod);
  const updateRun = useHydroStore((s) => s.updateRun);
  const currentRun = useHydroStore((s) => s.currentRun);
  const toggleMetaPanel = useHydroStore((s) => s.toggleMetaPanel);

  const handleToggle = (period: FlowPeriod) => {
    if (period === flowPeriod) return;

    const updatedVerticals = currentRun.verticals.map((v) => {
      if (v.type !== 'measure') return v;

      // 五点法→冰期 / 六点法→畅流期 降级为一点法
      let newMethod = v.measureMethod;
      if (period === 'ice' && v.measureMethod === 'five_point') {
        newMethod = 'one_point';
      } else if (period === 'open' && v.measureMethod === 'six_point') {
        newMethod = 'one_point';
      }

      // 获取新期别下的默认测点结构（带正确的 relativeDepth）
      const newDefaultPoints = createDefaultMeasurePoints(newMethod, period);
      const waterDepthNum = parseFloat(v.waterDepth || '0');

      // 核心修复：按索引合并，保留旧测点数据
      const mergedPoints = newDefaultPoints.map((newPt, index) => {
        const oldPt = v.measurePoints[index];
        if (oldPt) {
          return {
            ...newPt,
            id: oldPt.id,
            velocity: oldPt.velocity,
            mode: oldPt.mode || 'direct',
            n: oldPt.n || '',
            t: oldPt.t || '100',
            absoluteDepth: !isNaN(waterDepthNum)
              ? (waterDepthNum * parseFloat(newPt.relativeDepth)).toFixed(2)
              : '',
          };
        }
        return newPt;
      });

      return {
        ...v,
        measureMethod: newMethod,
        measurePoints: mergedPoints,
      };
    });

    updateRun({ flowPeriod: period, verticals: updatedVerticals });
  };

  return (
    <div className="flex justify-center py-0.5">
      <div className="flex items-center rounded-xl border border-white/80 bg-white/60 p-0.5 shadow-glass backdrop-blur-xl dark:border-gray-700/70 dark:bg-gray-800/60">
        <button onClick={() => handleToggle('open')}
          className={`relative flex min-h-9 items-center gap-1 rounded-lg px-3 py-0.5 text-xs transition-colors ${flowPeriod === 'open' ? 'text-white' : 'text-slate-500 hover:text-slate-700'}`}>
          {flowPeriod === 'open' && <motion.div layoutId="period-bg" className="absolute inset-0 rounded-lg bg-hydro-blue/90 shadow-sm" transition={{ duration: 0.2 }} />}
          <Sun className="relative w-3.5 h-3.5" />
          <span className="relative font-medium">畅流期</span>
        </button>
        <button onClick={() => handleToggle('ice')}
          className={`relative flex min-h-9 items-center gap-1 rounded-lg px-3 py-0.5 text-xs transition-colors ${flowPeriod === 'ice' ? 'text-white' : 'text-slate-500 hover:text-slate-700'}`}>
          {flowPeriod === 'ice' && <motion.div layoutId="period-bg" className="absolute inset-0 rounded-lg bg-hydro-blue/90 shadow-sm" transition={{ duration: 0.2 }} />}
          <Snowflake className="relative w-3.5 h-3.5" />
          <span className="relative font-medium">冰期</span>
        </button>
        {/* 齿轮：设置与元信息面板 */}
        <button
          onClick={toggleMetaPanel}
          className="glass-icon-button ml-1 !min-h-9 !min-w-9 shrink-0 text-slate-500 hover:text-hydro-blue dark:text-slate-400 dark:hover:text-cyan-400"
          title="设置与元信息"
        >
          <Settings className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

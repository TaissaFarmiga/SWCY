/**
 * 测流期模式切换组件 - 紧凑版
 * 
 * Fix: 切期时保留用户录入的 velocity/id/n/t（按索引合并），
 * 不再清空冰厚数据。
 */
import { motion } from 'framer-motion';
import { Sun, Snowflake } from 'lucide-react';
import { FlowPeriod } from '../types';
import { useHydroStore } from '../store/hydroStore';
import { createDefaultMeasurePoints } from '../lib/HydroEngine';

export default function PeriodToggle() {
  const flowPeriod = useHydroStore((s) => s.currentRun.flowPeriod);
  const updateRun = useHydroStore((s) => s.updateRun);
  const currentRun = useHydroStore((s) => s.currentRun);

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
    <div className="flex justify-center py-1">
      <div className="flex items-center p-0.5 rounded-lg bg-white/60 border border-white/80">
        <button onClick={() => handleToggle('open')}
          className={`relative flex items-center gap-1 px-3 py-1 rounded-md text-xs transition-colors ${flowPeriod === 'open' ? 'text-white' : 'text-slate-500 hover:text-slate-700'}`}>
          {flowPeriod === 'open' && <motion.div layoutId="period-bg" className="absolute inset-0 bg-hydro-blue rounded-md" transition={{ duration: 0.2 }} />}
          <Sun className="relative w-3.5 h-3.5" />
          <span className="relative font-medium">畅流期</span>
        </button>
        <button onClick={() => handleToggle('ice')}
          className={`relative flex items-center gap-1 px-3 py-1 rounded-md text-xs transition-colors ${flowPeriod === 'ice' ? 'text-white' : 'text-slate-500 hover:text-slate-700'}`}>
          {flowPeriod === 'ice' && <motion.div layoutId="period-bg" className="absolute inset-0 bg-hydro-blue rounded-md" transition={{ duration: 0.2 }} />}
          <Snowflake className="relative w-3.5 h-3.5" />
          <span className="relative font-medium">冰期</span>
        </button>
      </div>
    </div>
  );
}
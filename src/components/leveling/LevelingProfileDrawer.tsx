import { motion } from 'framer-motion';
import { LineChart, X } from 'lucide-react';
import { useLevelingStore } from '../../store/levelingStore';

const VIEW_WIDTH = 640;
const VIEW_HEIGHT = 340;
const MARGIN = { left: 68, right: 24, top: 32, bottom: 62 };

export function LevelingProfileDrawer({ onClose }: { onClose: () => void }) {
  const points = useLevelingStore((state) => state.currentRoute.calculation.profilePoints);
  const validPoints = points.filter((point) => point.elevation !== null && Number.isFinite(point.elevation));
  const elevations = validPoints.map((point) => point.elevation as number);
  const distances = validPoints.map((point) => point.distanceKm);
  const elevationMin = elevations.length > 0 ? Math.min(...elevations) : 0;
  const elevationMax = elevations.length > 0 ? Math.max(...elevations) : 0;
  const elevationSpan = elevationMax - elevationMin;
  const elevationPadding = Math.max(elevationSpan * 0.12, 0.01);
  const yMin = elevationMin - elevationPadding;
  const yMax = elevationMax + elevationPadding;
  const distanceMin = distances.length > 0 ? Math.min(...distances) : 0;
  const distanceMax = distances.length > 0 ? Math.max(...distances) : 0;
  const plotWidth = VIEW_WIDTH - MARGIN.left - MARGIN.right;
  const plotHeight = VIEW_HEIGHT - MARGIN.top - MARGIN.bottom;
  const useOrderForX = distanceMax === distanceMin;
  const x = (distance: number, index: number) => {
    if (validPoints.length <= 1) return MARGIN.left + plotWidth / 2;
    const ratio = useOrderForX
      ? index / (validPoints.length - 1)
      : (distance - distanceMin) / (distanceMax - distanceMin);
    return MARGIN.left + ratio * plotWidth;
  };
  const y = (elevation: number) => MARGIN.top + (yMax - elevation) / (yMax - yMin) * plotHeight;
  const polyline = validPoints.map((point, index) => `${x(point.distanceKm, index)},${y(point.elevation as number)}`).join(' ');
  const labelEvery = Math.max(1, Math.ceil(validPoints.length / 8));
  const yTicks = Array.from({ length: 5 }, (_, index) => yMin + (yMax - yMin) * index / 4);

  return (
    <>
      <motion.button type="button" aria-label="点击遮罩关闭纵断面" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} className="fixed inset-0 z-40 bg-slate-950/35 backdrop-blur-sm" />
      <motion.section
        role="dialog"
        aria-modal="true"
        aria-label="水准纵断面"
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 28, stiffness: 260 }}
        className="fixed inset-x-0 bottom-0 z-50 mx-auto max-h-[86dvh] w-full max-w-2xl overflow-hidden rounded-t-[28px] border border-white/80 bg-[#f7f9fc]/95 shadow-2xl backdrop-blur-2xl dark:border-gray-700 dark:bg-gray-950/95"
      >
        <header className="flex items-center justify-between border-b border-slate-200/70 px-4 pb-3 pt-4 dark:border-gray-800">
          <div>
            <p className="text-[10px] font-bold tracking-[0.18em] text-indigo-500">统一路线成果</p>
            <h2 className="flex items-center gap-2 text-lg font-black text-slate-800 dark:text-slate-100"><LineChart className="h-5 w-5" />水准纵断面</h2>
          </div>
          <button type="button" aria-label="关闭纵断面" onClick={onClose} className="flex min-h-11 min-w-11 items-center justify-center rounded-2xl bg-white/80 text-slate-500 shadow-sm dark:bg-gray-800 dark:text-slate-300"><X className="h-5 w-5" /></button>
        </header>

        <div className="overflow-y-auto overflow-x-hidden px-2 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 min-[360px]:px-4">
          {validPoints.length === 0 ? (
            <div className="flex min-h-64 flex-col items-center justify-center rounded-3xl border border-dashed border-slate-300 bg-white/50 px-4 text-center text-sm text-slate-400 dark:border-gray-700 dark:bg-gray-900/40">
              暂无可绘制高程。请先设置起点高程并完成测站读数。
            </div>
          ) : (
            <div className="rounded-3xl border border-white/80 bg-white/75 p-1 shadow-glass backdrop-blur-xl dark:border-gray-700 dark:bg-gray-900/70">
              <svg viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`} className="block h-auto w-full" role="img" aria-label="累计里程与测点高程纵断面图">
                <defs>
                  <linearGradient id="profile-fill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#4f46e5" stopOpacity="0.24" />
                    <stop offset="100%" stopColor="#06b6d4" stopOpacity="0.02" />
                  </linearGradient>
                </defs>
                {yTicks.map((tick) => {
                  const tickY = y(tick);
                  return (
                    <g key={tick}>
                      <line x1={MARGIN.left} y1={tickY} x2={VIEW_WIDTH - MARGIN.right} y2={tickY} stroke="#cbd5e1" strokeDasharray="4 5" strokeWidth="1" />
                      <text x={MARGIN.left - 8} y={tickY + 4} textAnchor="end" fill="#64748b" fontSize="12" fontFamily="monospace">{tick.toFixed(elevationSpan < 0.1 ? 3 : 2)}</text>
                    </g>
                  );
                })}
                <line x1={MARGIN.left} y1={MARGIN.top} x2={MARGIN.left} y2={VIEW_HEIGHT - MARGIN.bottom} stroke="#94a3b8" />
                <line x1={MARGIN.left} y1={VIEW_HEIGHT - MARGIN.bottom} x2={VIEW_WIDTH - MARGIN.right} y2={VIEW_HEIGHT - MARGIN.bottom} stroke="#94a3b8" />
                {validPoints.length > 1 && (
                  <polygon points={`${MARGIN.left},${VIEW_HEIGHT - MARGIN.bottom} ${polyline} ${x(validPoints[validPoints.length - 1].distanceKm, validPoints.length - 1)},${VIEW_HEIGHT - MARGIN.bottom}`} fill="url(#profile-fill)" />
                )}
                <polyline points={polyline} fill="none" stroke="#4f46e5" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                {validPoints.map((point, index) => {
                  const pointX = x(point.distanceKm, index);
                  const pointY = y(point.elevation as number);
                  const showLabel = index === 0 || index === validPoints.length - 1 || index % labelEvery === 0;
                  return (
                    <g key={point.id}>
                      <circle cx={pointX} cy={pointY} r={index === 0 || index === validPoints.length - 1 ? 6 : 4} fill={point.direction === 'return' ? '#8b5cf6' : '#06b6d4'} stroke="white" strokeWidth="2" />
                      {showLabel && (
                        <>
                          <text x={pointX} y={VIEW_HEIGHT - MARGIN.bottom + 20} textAnchor="middle" fill="#475569" fontSize="11">{point.name.length > 8 ? `${point.name.slice(0, 8)}…` : point.name}</text>
                          <text x={pointX} y={VIEW_HEIGHT - MARGIN.bottom + 36} textAnchor="middle" fill="#94a3b8" fontSize="9" fontFamily="monospace">{point.distanceKm.toFixed(3)}km</text>
                        </>
                      )}
                    </g>
                  );
                })}
                <text x="16" y={MARGIN.top - 10} fill="#64748b" fontSize="11">高程(m)</text>
                <text x={VIEW_WIDTH - MARGIN.right} y={VIEW_HEIGHT - 8} textAnchor="end" fill="#64748b" fontSize="11">累计里程(km)</text>
              </svg>
            </div>
          )}
          <p className="mt-3 px-2 text-[10px] leading-5 text-slate-400">纵轴按当前高程范围自动缩放，不强制从 0 开始。紫色点表示返测，青色点表示往测。</p>
        </div>
      </motion.section>
    </>
  );
}

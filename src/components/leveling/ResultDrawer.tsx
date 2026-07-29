import { motion } from 'framer-motion';
import { useState } from 'react';
import { CheckCircle2, Download, FileCheck2, X, AlertTriangle } from 'lucide-react';
import { useLevelingStore } from '../../store/levelingStore';

function formatMetric(value: number | null, decimals: number, suffix = ''): string {
  return value === null || !Number.isFinite(value) ? '--' : `${value.toFixed(decimals)}${suffix}`;
}

export function ResultDrawer({ onClose }: { onClose: () => void }) {
  const currentRoute = useLevelingStore((state) => state.currentRoute);
  const exportData = useLevelingStore((state) => state.exportData);
  const completeRoute = useLevelingStore((state) => state.completeRoute);
  const calculation = currentRoute.calculation;
  const [exportStatus, setExportStatus] = useState<'idle' | 'working' | 'success' | 'error'>('idle');
  const [exportError, setExportError] = useState('');

  const handleExport = async () => {
    setExportStatus('working');
    setExportError('');
    try {
      await exportData();
      setExportStatus('success');
    } catch (error: unknown) {
      setExportStatus('error');
      setExportError(error instanceof Error ? error.message : '生成 Excel 失败');
    }
  };

  return (
    <>
      <motion.button
        type="button"
        aria-label="点击遮罩关闭成果抽屉"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 z-40 bg-slate-950/35 backdrop-blur-sm"
      />
      <motion.section
        role="dialog"
        aria-modal="true"
        aria-label="水准测量成果"
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 28, stiffness: 260 }}
        className="fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[88dvh] w-full max-w-2xl flex-col overflow-hidden rounded-t-[28px] border border-white/80 bg-[#f7f9fc]/95 shadow-2xl backdrop-blur-2xl dark:border-gray-700 dark:bg-gray-950/95"
      >
        <header className="flex shrink-0 items-center justify-between border-b border-slate-200/70 px-4 pb-3 pt-4 dark:border-gray-800">
          <div className="min-w-0">
            <p className="text-[10px] font-bold tracking-[0.18em] text-emerald-600">统一计算成果</p>
            <h2 className="truncate text-lg font-black text-slate-800 dark:text-slate-100">{currentRoute.name || '未命名水准路线'}</h2>
          </div>
          <button type="button" aria-label="关闭成果抽屉" onClick={onClose} className="flex min-h-11 min-w-11 items-center justify-center rounded-2xl bg-white/80 text-slate-500 shadow-sm dark:bg-gray-800 dark:text-slate-300">
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="overflow-y-auto overflow-x-hidden px-3 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 min-[360px]:px-4">
          <div className="grid grid-cols-2 gap-2 min-[390px]:grid-cols-4">
            <Metric label="路线长度" value={formatMetric(calculation.totalDistanceKm, 3, ' km')} />
            <Metric label="高差总和" value={formatMetric(calculation.totalDeltaHeightM, 4, ' m')} />
            <Metric label="平均视距" value={formatMetric(calculation.meanSightDistanceM, 1, ' m')} />
            <Metric label="完整测站" value={`${calculation.completeStationCount}/${currentRoute.stations.length}`} />
          </div>

          <div className={`mt-3 rounded-2xl border p-3 ${calculation.isWithinTolerance === false ? 'border-red-200 bg-red-50 text-red-700' : calculation.isWithinTolerance === true ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-200 bg-amber-50 text-amber-700'}`}>
            <div className="flex items-center gap-2 font-bold">
              {calculation.isWithinTolerance === false ? <AlertTriangle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
              <span>{calculation.isWithinTolerance === null ? '闭合结果待完整数据' : calculation.isWithinTolerance ? '闭合结果符合当前限差参数' : '闭合结果超限'}</span>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2 font-mono text-xs">
              <span>闭合差：{formatMetric(calculation.closureErrorMm, 1, ' mm')}</span>
              <span>允许值：{calculation.allowableErrorMm === null ? '--' : `±${calculation.allowableErrorMm.toFixed(1)} mm`}</span>
              {currentRoute.routeType === 'round-trip' && (
                <span className="col-span-2">往返高差不符值：{formatMetric(calculation.roundTripDiscrepancyMm, 1, ' mm')}</span>
              )}
              <span className="col-span-2">采用高程：{formatMetric(calculation.adoptedElevation, 3, ' m')}</span>
            </div>
          </div>

          {calculation.errorMessages.length > 0 && (
            <div className="mt-3 rounded-2xl bg-amber-50 p-3 text-xs leading-5 text-amber-700">
              {calculation.errorMessages.map((message) => <p key={message}>• {message}</p>)}
            </div>
          )}

          <section className="mt-4">
            <h3 className="mb-2 px-1 text-xs font-black tracking-[0.14em] text-slate-500">测点高程与里程</h3>
            {calculation.profilePoints.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 py-8 text-center text-sm text-slate-400">暂无测点数据</div>
            ) : (
              <div className="space-y-2">
                {calculation.profilePoints.map((point) => (
                  <article key={point.id} className="grid min-h-14 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-2xl border border-white/80 bg-white/75 px-3 py-2 shadow-sm dark:border-gray-700 dark:bg-gray-900/70">
                    <div className="min-w-0">
                      <strong className="block truncate text-sm text-slate-700 dark:text-slate-200" title={point.name}>{point.name}</strong>
                      <span className="text-[10px] text-slate-400">{point.direction === 'return' ? '返测' : '往测'} · {formatMetric(point.distanceKm, 3, ' km')}</span>
                    </div>
                    <span className="whitespace-nowrap font-mono text-sm font-black text-blue-600 dark:text-cyan-400">{formatMetric(point.elevation, 3, ' m')}</span>
                  </article>
                ))}
              </div>
            )}
          </section>

          <div className="mt-4 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={completeRoute}
              disabled={!calculation.isComplete || currentRoute.completionStatus === 'completed'}
              className="flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-emerald-500 px-3 text-sm font-bold text-white shadow-lg shadow-emerald-500/20 active:scale-95 disabled:opacity-40"
            >
              <FileCheck2 className="h-4 w-4" />
              {currentRoute.completionStatus === 'completed' ? '已完成' : '完成任务'}
            </button>
            <button
              type="button"
              onClick={() => void handleExport()}
              disabled={exportStatus === 'working'}
              className="flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-blue-500 px-3 text-sm font-bold text-white shadow-lg shadow-blue-500/20 active:scale-95 disabled:opacity-60"
            >
              <Download className="h-4 w-4" />{exportStatus === 'working' ? '正在生成…' : '导出 Excel'}
            </button>
          </div>
          <div aria-live="polite" className="mt-2 min-h-5 px-1 text-center text-xs">
            {exportStatus === 'success' && <span className="text-emerald-600">Excel 已生成并交给系统下载</span>}
            {exportStatus === 'error' && <span className="text-red-600">导出失败：{exportError}</span>}
          </div>
        </div>
      </motion.section>
    </>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-2xl border border-white/80 bg-white/75 p-3 shadow-sm dark:border-gray-700 dark:bg-gray-900/70">
      <span className="block truncate text-[10px] text-slate-400">{label}</span>
      <strong className="mt-1 block truncate font-mono text-sm text-slate-700 dark:text-slate-200" title={value}>{value}</strong>
    </div>
  );
}

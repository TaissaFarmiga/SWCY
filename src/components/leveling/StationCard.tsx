/**
 * 水准测量单站输入卡片 (Station Card) - Liquid Glass V2
 *
 * 左右极简分栏：左侧后视 / 右侧前视
 * 智能交互：K值自动嗅探、红黑面超限红框警告（不阻塞）
 */
import { useState, useCallback, useRef, useEffect, memo } from 'react';
import { AnimatePresence } from 'framer-motion'; // 只留给内部结果展开用，外部进出场不归它管
import { ChevronDown, ChevronUp, Trash2, Gauge, AlertCircle } from 'lucide-react';
import { useLevelingStore } from '../../store/levelingStore';
import type { LevelingGrade, LevelingStation, LevelingReadings } from '../../types/leveling';
import { gradeTolerance } from '../../lib/levelingRules';
import { triggerCenterFeedback } from '../../lib/mobileFeedback';

interface Props {
  station: LevelingStation;
  index: number;
  grade: LevelingGrade;
}

/** 极简带单位输入框 */
function GlassInput({
  label, value, onChange, placeholder = '', unit = '', isError = false
}: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; unit?: string; isError?: boolean
}) {
  return (
    <label className="grid w-full grid-cols-[2.25rem_minmax(0,1fr)] items-center gap-1.5">
      <span className="text-xs font-medium text-slate-500 dark:text-slate-400">{label}</span>
      <span className="relative min-w-0">
        <input
          type={label.includes('测点') ? 'text' : 'number'}
          inputMode={label.includes('测点') ? 'text' : 'decimal'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={`min-h-10 w-full rounded-xl border px-2 ${unit ? 'pr-8' : ''} text-center font-mono text-base font-bold outline-none transition-colors ${
            isError
              ? 'bg-red-50/80 dark:bg-red-900/30 border border-red-400 text-red-600 dark:text-red-400'
              : 'bg-white/80 dark:bg-gray-900/50 border-slate-200 dark:border-gray-700 text-slate-700 dark:text-slate-100 focus:border-hydro-blue'
          }`}
        />
        {unit && <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-slate-400">{unit}</span>}
      </span>
    </label>
  );
}

/** 结果展示小方块 */
function ResultTile({ label, value, unit, highlight = false, isError = false }: { label: string; value: string; unit: string; highlight?: boolean; isError?: boolean }) {
  return (
    <div className={`flex flex-col justify-center px-1.5 py-1 min-w-0 ${highlight ? 'bg-hydro-blue/[0.04] dark:bg-cyan-400/[0.05]' : ''}`}>
      <span className={`block text-[9px] font-medium leading-tight mb-0.5 whitespace-nowrap overflow-hidden text-ellipsis ${isError ? 'text-red-500' : (highlight ? 'text-hydro-blue dark:text-cyan-400' : 'text-slate-400 dark:text-slate-500')}`}>
        {label}
      </span>
      <div className="flex flex-wrap items-baseline gap-x-[2px] leading-none">
        <span className={`font-mono text-[12px] font-bold break-keep ${isError ? 'text-red-500' : (highlight ? 'text-blue-600 dark:text-cyan-300' : 'text-slate-700 dark:text-slate-200')}`}>
          {value}
        </span>
        <span className="font-sans text-[9px] opacity-70 whitespace-nowrap">{unit}</span>
      </div>
    </div>
  );
}

function formatMetric(value: number | null, decimals: number): string {
  return value === null || !Number.isFinite(value) ? '--' : value.toFixed(decimals);
}

/** 防误触删除按钮 */
function ConfirmDeleteButton({ onDelete }: { onDelete: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);
  return confirming ? (
    <button aria-label="确认删除测站" onClick={() => { if (timerRef.current) clearTimeout(timerRef.current); setConfirming(false); onDelete(); }}
      className="glass-danger-button shrink-0">确认删除</button>
  ) : (
    <button aria-label="删除测站" onClick={(e) => { e.stopPropagation(); setConfirming(true); timerRef.current = setTimeout(() => setConfirming(false), 3000); }}
      className="glass-icon-button text-slate-400 hover:text-red-500">
      <Trash2 className="w-3.5 h-3.5" />
    </button>
  );
}

const StationCardComponent = ({ station, index, grade }: Props) => {
  const { updateStationReading, deleteStation, addIntermediate, updateIntermediate, removeIntermediate, setStationDirection } = useLevelingStore();
  const ruleProfileSnapshot = useLevelingStore((state) => state.currentRoute.ruleProfileSnapshot);
  const [showResults, setShowResults] = useState(false);

  const readings = station.readings;
  const result = station.result;
  const hasError = result.isComplete && !result.isValid;
  const isIncomplete = !result.isComplete;
  const tolerance = gradeTolerance(grade, ruleProfileSnapshot);

  const handleChange = useCallback((field: keyof LevelingReadings) => (val: string) => {
    updateStationReading(station.id, { [field]: val });
  }, [station.id, updateStationReading]);

  return (
    <article
      data-testid="leveling-station-card"
      id={`station-${station.id}`} // 🚀 新增：测站唯一 DOM 识别符号，支持自动滚动对焦
      className={`overflow-hidden rounded-2xl border shadow-glass transition-colors ${
        hasError
          ? 'border-red-300/60 dark:border-red-800/50 bg-red-50/30 dark:bg-red-950/20'
          : isIncomplete
            ? 'border-amber-200/70 dark:border-amber-800/40 bg-amber-50/20 dark:bg-amber-950/10'
            : 'border-white/80 dark:border-gray-700/80 bg-white/70 dark:bg-gray-900/70'
      }`}
    >
      {/* 头部：站号 + 绝对高程 */}
      <div className="flex items-center justify-between border-b border-slate-100/50 px-2 py-1 dark:border-gray-700/50">
        <div className="flex items-center gap-2">
          <div className="flex items-center justify-center w-5 h-5 rounded-md bg-blue-500 text-white text-[11px] font-bold shadow-sm shadow-blue-500/20">
            {index + 1}
          </div>
          <button
            type="button"
            data-testid="leveling-direction-toggle"
            aria-label={`当前${station.direction === 'return' ? '返测' : '往测'}，点击切换`}
            title="点击切换往测或返测"
            onClick={() => {
              setStationDirection(station.id, station.direction === 'return' ? 'forward' : 'return');
              void triggerCenterFeedback();
            }}
            className={`flex min-h-8 items-center rounded-full px-2 text-[10px] font-black transition-colors active:scale-95 ${station.direction === 'return'
              ? 'bg-violet-100 text-violet-700 dark:bg-violet-900/45 dark:text-violet-300'
              : 'bg-blue-100 text-blue-700 dark:bg-blue-900/45 dark:text-blue-300'}`}
          >
            {station.direction === 'return' ? '返测' : '往测'}
          </button>
          {(hasError || isIncomplete) && <AlertCircle className={`w-3.5 h-3.5 ${hasError ? 'text-red-500' : 'text-amber-500'}`} />}
        </div>
        <div className="text-[10px] font-mono font-bold text-slate-500 dark:text-slate-400">
          高程: <span className="text-blue-600 dark:text-cyan-400 text-xs">{formatMetric(result.elevation, 3)}</span> m
        </div>
      </div>

      {/* 核心输入区：左右分栏 (后视 | 前视) */}
      <div className="grid grid-cols-2 divide-x divide-slate-100 dark:divide-gray-700/50">
        {/* 左侧：后视 */}
        <div className="flex flex-col gap-1 p-1.5">
          <div className="text-[10px] font-bold text-blue-600 dark:text-cyan-400 mb-0.5 text-center bg-blue-50/50 dark:bg-blue-900/20 rounded py-0.5 transition-colors">
            后视 {result.sniffedBackK ? `(${result.sniffedBackK})` : '(K值)'}
          </div>
          <GlassInput label="测点" value={readings.backPoint} onChange={handleChange('backPoint')} placeholder="如: 基3" />
          {(grade === '3' || grade === '4') && (
            <>
              <GlassInput label="上丝" value={readings.backUpper || ''} onChange={handleChange('backUpper')} />
              <GlassInput label="下丝" value={readings.backLower || ''} onChange={handleChange('backLower')} />
            </>
          )}
          <GlassInput label="黑面" value={readings.backBlack} onChange={handleChange('backBlack')} />
          <GlassInput label="红面" value={readings.backRed} onChange={handleChange('backRed')} />

          {grade === 'out' ? (
            <GlassInput label="视距" value={readings.backDistance} onChange={handleChange('backDistance')} unit="m" />
          ) : (
            <div className="flex items-center gap-1.5 w-full bg-slate-50/60 dark:bg-gray-800/40 rounded-md py-1 px-1 border border-slate-200/50 dark:border-gray-700/50 shadow-inner">
              <span className="text-[10px] text-slate-400 dark:text-slate-500 w-6 shrink-0 text-center">视距</span>
              <div className="flex-1 flex justify-center items-baseline gap-0.5">
                <span className="font-mono text-[12px] font-black text-indigo-500 dark:text-indigo-400">{formatMetric(result.backDistance, 1)}</span>
                <span className="text-[9px] text-slate-400">m</span>
              </div>
            </div>
          )}
        </div>

        {/* 右侧：前视 */}
        <div className="flex flex-col gap-1 p-1.5">
          <div className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 mb-0.5 text-center bg-emerald-50/50 dark:bg-emerald-900/20 rounded py-0.5 transition-colors">
            前视 {result.sniffedForeK ? `(${result.sniffedForeK})` : '(K值)'}
          </div>
          <GlassInput label="测点" value={readings.forePoint} onChange={handleChange('forePoint')} placeholder="如: 转" />
          {(grade === '3' || grade === '4') && (
            <>
              <GlassInput label="上丝" value={readings.foreUpper || ''} onChange={handleChange('foreUpper')} />
              <GlassInput label="下丝" value={readings.foreLower || ''} onChange={handleChange('foreLower')} />
            </>
          )}
          <GlassInput label="黑面" value={readings.foreBlack} onChange={handleChange('foreBlack')} />
          <GlassInput label="红面" value={readings.foreRed} onChange={handleChange('foreRed')} />

          {grade === 'out' ? (
            <GlassInput label="视距" value={readings.foreDistance} onChange={handleChange('foreDistance')} unit="m" />
          ) : (
            <div className="flex items-center gap-1.5 w-full bg-slate-50/60 dark:bg-gray-800/40 rounded-md py-1 px-1 border border-slate-200/50 dark:border-gray-700/50 shadow-inner">
              <span className="text-[10px] text-slate-400 dark:text-slate-500 w-6 shrink-0 text-center">视距</span>
              <div className="flex-1 flex justify-center items-baseline gap-0.5">
                <span className="font-mono text-[12px] font-black text-indigo-500 dark:text-indigo-400">{formatMetric(result.foreDistance, 1)}</span>
                <span className="text-[9px] text-slate-400">m</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 间视动态展开区 (紫水晶风格) */}
      {(readings.intermediates?.length || 0) > 0 && (
        <div className="flex flex-col border-t border-violet-100/50 dark:border-violet-900/30 bg-violet-50/30 dark:bg-violet-900/10">
          {(readings.intermediates || []).map((inter, i) => {
            const interResult = (result.intermediateResults || []).find(r => r.id === inter.id);
            const isStaffErr = interResult?.staffDiff != null
              && tolerance.maxBlackRedDiff !== null
              && interResult.staffDiff > tolerance.maxBlackRedDiff;

            return (
              <div data-testid="leveling-intermediate-readings" key={inter.id} className="relative flex flex-col gap-1 border-b border-violet-100/50 p-1.5 last:border-0 dark:border-violet-900/30">
                <div className="flex items-center justify-between px-1">
                  <div className="text-[10px] font-bold text-violet-600 dark:text-violet-400">
                    🟣 间视 {i + 1} {interResult?.sniffedK ? `(${interResult.sniffedK})` : ''}
                  </div>
                  <div className="flex items-center gap-1">
                    {interResult && <div className="text-[10px] font-mono text-slate-500">
                      高程: <span className="text-violet-600 dark:text-violet-400 font-bold">{formatMetric(interResult.elevation, 3)}</span>
                    </div>}
                    <button type="button" onClick={() => removeIntermediate(station.id, inter.id)} aria-label={`删除间视 ${i + 1}`} className="glass-icon-button !min-h-9 !min-w-9 text-slate-400 hover:text-red-500">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                <GlassInput label="测点" value={inter.point} onChange={(v) => updateIntermediate(station.id, inter.id, 'point', v)} isError={isStaffErr} />
                <div className="grid grid-cols-2 gap-2">
                  <GlassInput label="黑面" value={inter.black} onChange={(v) => updateIntermediate(station.id, inter.id, 'black', v)} isError={isStaffErr} />
                  <GlassInput label="红面" value={inter.red} onChange={(v) => updateIntermediate(station.id, inter.id, 'red', v)} isError={isStaffErr} />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 底部：计算结果折叠栏 */}
      <div className="flex items-center justify-between gap-1.5 border-t border-slate-100/50 bg-slate-50/80 px-2 py-1 dark:border-gray-700/50 dark:bg-gray-800/50">
        <button type="button" onClick={() => setShowResults(!showResults)} aria-expanded={showResults} className="flex min-h-9 min-w-0 flex-1 items-center gap-1 rounded-full px-2 text-left text-xs font-semibold text-slate-600 hover:bg-white/75 dark:text-slate-300 dark:hover:bg-gray-700/70">
          <Gauge className="w-3.5 h-3.5" /><span>计算结果</span>
          {showResults ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </button>
        <div className="flex items-center gap-1 shrink-0">
          <button data-testid="leveling-add-intermediate" type="button"
            onClick={() => addIntermediate(station.id)}
            className="glass-pill-button text-violet-700 dark:text-violet-300"
          >
            <span className="text-base leading-none">+</span> 间视
          </button>
          <ConfirmDeleteButton onDelete={() => deleteStation(station.id)} />
        </div>
      </div>

      <AnimatePresence>
        {showResults && (
          <div className="overflow-hidden bg-slate-50/40 dark:bg-gray-900/40 px-1.5 pb-1.5">

            <div className="mt-1 grid grid-cols-2 divide-x divide-y divide-slate-200/60 rounded-xl border border-slate-200/80 bg-white/60 shadow-sm dark:divide-gray-700/60 dark:border-gray-700/80 dark:bg-gray-800/60 min-[390px]:grid-cols-4 min-[390px]:divide-y-0">
              <ResultTile label="黑面高差" value={formatMetric(result.blackDelta, 3)} unit="m" />
              <ResultTile label="红面高差" value={formatMetric(result.redDelta, 3)} unit="m" />
              <ResultTile label="后(K+黑-红)" value={formatMetric(result.backDiff, 1)} unit="mm" isError={result.backDiff !== null && tolerance.maxBlackRedDiff !== null && result.backDiff > tolerance.maxBlackRedDiff} />
              <ResultTile label="前(K+黑-红)" value={formatMetric(result.foreDiff, 1)} unit="mm" isError={result.foreDiff !== null && tolerance.maxBlackRedDiff !== null && result.foreDiff > tolerance.maxBlackRedDiff} />
            </div>

            {/* 🎯 三/四等专属扩展栏：视距差与高差之差 (高度还原纸质手簿) */}
            {(grade === '3' || grade === '4') && (
              <div className="mt-1 grid grid-cols-3 divide-x divide-slate-200/60 rounded-xl border border-slate-200/80 bg-slate-100/60 shadow-sm dark:divide-gray-700/60 dark:border-gray-700/80 dark:bg-gray-800/40">
                <ResultTile label="视距差 d" value={formatMetric(result.distanceDiff, 1)} unit="m" isError={result.distanceDiff !== null && Math.abs(result.distanceDiff) > tolerance.maxDistanceDiff} />
                <ResultTile label="累计视距差 Σd" value={formatMetric(result.accumulatedDistanceDiff, 1)} unit="m" isError={result.accumulatedDistanceDiff !== null && Math.abs(result.accumulatedDistanceDiff) > tolerance.maxAccumulatedDiff} />
                <ResultTile label="高差之差" value={formatMetric(result.deltaDiff, 1)} unit="mm" isError={result.deltaDiff !== null && tolerance.maxDeltaDiff !== null && result.deltaDiff > tolerance.maxDeltaDiff} />
              </div>
            )}

            <div className="mt-1 flex items-center justify-between rounded-lg border border-blue-100 bg-blue-50/60 px-2 py-1 dark:border-blue-800/50 dark:bg-blue-900/20">
               <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400">{grade === 'out' ? '平均高差' : '高差中数'}</span>
               <span className="text-[13px] font-mono font-black text-blue-600 dark:text-cyan-400">{formatMetric(result.meanDeltaHeight, 3)} <span className="text-[10px] font-normal text-slate-400">m</span></span>
            </div>

            {/* 间视结果展示区 */}
            {result.intermediateResults && result.intermediateResults.length > 0 && (
              <div className="mt-1 flex flex-col gap-1">
                {(readings.intermediates || []).map((inter, i) => {
                  const interResult = result.intermediateResults.find(r => r.id === inter.id);
                  if (!interResult) return null;

                   return (
                     <div key={inter.id} className="grid grid-cols-2 divide-x divide-y divide-violet-200/60 rounded-xl border border-violet-100/80 bg-violet-50/40 shadow-sm dark:divide-violet-900/40 dark:border-violet-800/30 dark:bg-violet-900/10 min-[390px]:grid-cols-4 min-[390px]:divide-y-0">
                       <ResultTile label="间视点" value={inter.point || String(i + 1)} unit="" />
                       <ResultTile label="高差中数" value={formatMetric(interResult.deltaHeight, 3)} unit="m" />
                       <ResultTile label={`尺差(${inter.point || i + 1})`} value={formatMetric(interResult.staffDiff, 1)} unit="mm" isError={interResult.staffDiff !== null && tolerance.maxBlackRedDiff !== null && interResult.staffDiff > tolerance.maxBlackRedDiff} />
                       <ResultTile label="推算高程" value={formatMetric(interResult.elevation, 3)} unit="m" highlight />
                     </div>
                   );
                })}
              </div>
            )}

            {hasError && result.errorMessages.length > 0 && (
              <div className="mt-1.5 px-2 py-1 rounded bg-red-100/60 dark:bg-red-900/30 text-[10px] text-red-600 dark:text-red-400 space-y-0.5">
                {result.errorMessages.map((message) => <div key={`${station.id}:${message}`}>⚠️ {message}</div>)}
              </div>
            )}
          </div>
        )}
      </AnimatePresence>
    </article>
  );
};

export const StationCard = memo(StationCardComponent, (prev, next) => {
  return prev.station === next.station && prev.index === next.index && prev.grade === next.grade;
});

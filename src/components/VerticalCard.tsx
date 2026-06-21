/**
 * 垂线卡片组件
 * 紧凑3行布局 + 防误触删除 + 深色模式 + 起点距倒挂红线警告（全覆盖）
 */
import { motion, AnimatePresence } from 'framer-motion';
import { useState, useEffect, useRef } from 'react';
import { ChevronDown, ChevronUp, Trash2, Plus, Target, Waves, Gauge, ArrowLeftRight } from 'lucide-react';
import { Vertical, MeasureMethod, METHOD_LABELS, getAvailableMethods } from '../types';
import { useHydroStore } from '../store/hydroStore';
interface Props { vertical: Vertical; index: number; isLast?: boolean }

/** 辅助：计算倒挂状态 */
function calcDistanceError(verticals: Vertical[], idx: number): boolean {
  if (idx <= 0) return false;
  const cur = verticals[idx];
  const prev = verticals[idx - 1];
  if (!cur || !prev) return false;
  // 空字符串或有内容但不为合法数字 → 不报错
  if (cur.startDistance === '' || prev.startDistance === '') return false;
  const curVal = parseFloat(cur.startDistance);
  const prevVal = parseFloat(prev.startDistance);
  if (isNaN(curVal) || isNaN(prevVal)) return false;
  return curVal < prevVal;
}

/** 起点距输入框（含倒挂警告） */
function DistanceInput({
  value, onChange, isDistanceError, isShallow, placeholder, additionalClass,
}: {
  value: string; onChange: (v: string) => void; isDistanceError: boolean;
  isShallow?: boolean; placeholder?: string; additionalClass?: string;
}) {
  return (
    <div className="flex items-center gap-1 min-w-0">
      <span className="text-xs text-slate-400 dark:text-slate-500 whitespace-nowrap">起点距</span>
      <input type="number" inputMode="decimal" step="0.01" min="0" placeholder={placeholder || 'm'}
        value={value} onChange={(e) => onChange(e.target.value)}
        className={`w-14 min-w-[44px] px-1 py-0.5 text-xs md:text-sm rounded-md bg-white/80 dark:bg-gray-800/80 dark:text-slate-200 text-right font-mono outline-none ${
          isDistanceError
            ? 'border-red-500 text-red-600 bg-red-50 dark:bg-red-950/50 dark:text-red-400 dark:border-red-500'
            : isShallow
              ? 'border-amber-400 text-amber-700 dark:text-amber-400'
              : 'border-slate-200 dark:border-gray-600 focus:border-hydro-blue'
        } ${additionalClass || ''}`}
      />
      {isDistanceError && <span className="text-[9px] text-red-500 dark:text-red-400 font-bold whitespace-nowrap">⚠️</span>}
    </div>
  );
}

/** 岸边垂线卡片 — 新增右水边倒挂警告 + 结束岸计算结果面板 */
function EdgeCard({ vertical, index, isLast }: { vertical: Vertical; index: number; isLast?: boolean }) {
  const updateVertical = useHydroStore((s) => s.updateVertical);
  const swapEdges = useHydroStore((s) => s.swapEdges);
  const swapEdgeCoefficients = useHydroStore((s) => s.swapEdgeCoefficients);
  const toggleVerticalResults = useHydroStore((s) => s.toggleVerticalResults);
  const verticals = useHydroStore((s) => s.currentRun.verticals);

  const isDistanceError = calcDistanceError(verticals, index);
  const isEndBank = isLast && vertical.type === 'edge';
  const showResults = vertical.showResults || false;

  return (
    <motion.div id={`vertical-${vertical.id}`} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="rounded-lg bg-gradient-to-r from-amber-50/90 to-orange-50/70 dark:from-amber-950/80 dark:to-orange-950/70 border border-amber-200/60 dark:border-amber-800/40 overflow-hidden"
    >
      <div className="flex items-center justify-between gap-2 px-1.5 py-1">
        <div className="flex items-center gap-2 min-w-0">
          <button onClick={swapEdges}
            className="flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-amber-100/60 dark:bg-amber-900/40 hover:bg-amber-200/60 dark:hover:bg-amber-800/40 transition-colors shrink-0"
            title="点击互换左右水边">
            <Waves className="w-3 h-3 text-amber-600 dark:text-amber-400" />
            <span className="text-sm font-bold text-amber-700 dark:text-amber-300">{vertical.name}</span>
            <ArrowLeftRight className="w-2.5 h-2.5 text-amber-400" />
          </button>
          <DistanceInput
            value={vertical.startDistance}
            onChange={(v) => updateVertical(vertical.id, { startDistance: v })}
            isDistanceError={isDistanceError}
            additionalClass="bg-white/60 dark:bg-gray-800/60 text-amber-700 dark:text-amber-300 border-amber-300/50 dark:border-amber-700/50"
          />
        </div>
        <button onClick={swapEdgeCoefficients} className="flex items-center gap-1.5 shrink-0" title="岸边系数（点击互换左右）">
          <span className="text-xs text-amber-600 dark:text-amber-400">岸边系数 η</span>
          <input type="number" inputMode="decimal" step="0.01" min="0" max="1"
            value={vertical.shoreCoefficient || '0.70'}
            onChange={(e) => updateVertical(vertical.id, { shoreCoefficient: e.target.value })}
            onClick={(e) => e.stopPropagation()}
            className="w-12 px-1 py-0.5 text-sm rounded-md bg-white/60 dark:bg-gray-800/60 dark:text-amber-200 border-0 border-b border-amber-300/50 dark:border-amber-700/50 text-center font-mono text-amber-700 dark:text-amber-300 focus:border-amber-400 outline-none"
          />
        </button>
      </div>

      {/* 结束岸计算结果面板 — 仅展示部分面积和部分流量 */}
      {isEndBank && (
        <>
          <button onClick={() => toggleVerticalResults(vertical.id)}
            className="w-full flex items-center justify-between px-1.5 py-0.5 bg-gradient-to-r from-amber-50/30 dark:from-amber-900/20 to-transparent hover:from-amber-50/50 dark:hover:from-amber-900/30 transition-colors">
            <div className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
              <Gauge className="w-3 h-3" /><span>结束岸结果</span>
            </div>
            {showResults ? <ChevronUp className="w-3 h-3 text-amber-400" /> : <ChevronDown className="w-3 h-3 text-amber-400" />}
          </button>
          <AnimatePresence>
            {showResults && (
              <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.15 }}
                className="overflow-hidden bg-amber-50/30 dark:bg-amber-950/30 px-1.5 py-1">
                <div className="grid grid-cols-2 gap-1.5 text-xs">
                  <ResultTile label="部分面积" value={vertical.partialArea} unit="m²" />
                  <ResultTile label="部分流量" value={vertical.partialDischarge} unit="m³/s" highlight />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </>
      )}
    </motion.div>
  );
}

/** 防误触删除按钮 */
function ConfirmDeleteButton({ onDelete }: { onDelete: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);
  return confirming ? (
    <button onClick={() => { if (timerRef.current) clearTimeout(timerRef.current); setConfirming(false); onDelete(); }}
      className="p-0.5 rounded bg-red-500 dark:bg-red-600 text-white text-[10px] font-bold animate-pulse shrink-0">确认删除？</button>
  ) : (
    <button onClick={(e) => { e.stopPropagation(); setConfirming(true); timerRef.current = setTimeout(() => setConfirming(false), 3000); }}
      className="p-0.5 rounded hover:bg-red-50 dark:hover:bg-red-900/30 text-slate-400 dark:text-slate-500 hover:text-red-500 dark:hover:text-red-400" title="删除此垂线（需二次确认）">
      <Trash2 className="w-3.5 h-3.5" />
    </button>
  );
}

/** 测速垂线卡片 */
function MeasureCard({ vertical, index }: Props) {
  const flowPeriod = useHydroStore((s) => s.currentRun.flowPeriod);
  const updateVertical = useHydroStore((s) => s.updateVertical);
  const updateMeasurePoint = useHydroStore((s) => s.updateMeasurePoint);
  const deleteVertical = useHydroStore((s) => s.deleteVertical);
  const insertVerticalAfter = useHydroStore((s) => s.insertVerticalAfter);
  const toggleVerticalResults = useHydroStore((s) => s.toggleVerticalResults);
  const changeMeasureMethod = useHydroStore((s) => s.changeMeasureMethod);
  const verticals = useHydroStore((s) => s.currentRun.verticals);

  const availableMethods = getAvailableMethods(flowPeriod);
  const showResults = vertical.showResults || false;
  const waterDepthNum = parseFloat(vertical.waterDepth || '0');
  const isShallow = waterDepthNum > 0 && waterDepthNum < 0.2;
  const isDistanceError = calcDistanceError(verticals, index);

  return (
    <motion.div id={`vertical-${vertical.id}`} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="rounded-lg bg-white/70 dark:bg-gray-900/70 border border-white/80 dark:border-gray-700/80 overflow-hidden"
    >
      <div className="flex flex-wrap items-center gap-1.5 px-1.5 py-1 border-b border-slate-100/50 dark:border-gray-700/50">
        <div className="flex items-center justify-center w-5 h-5 rounded-md bg-hydro-blue text-white text-sm font-bold shrink-0">
          {vertical.verticalNumber}
        </div>
        <DistanceInput
          value={vertical.startDistance}
          onChange={(v) => updateVertical(vertical.id, { startDistance: v })}
          isDistanceError={isDistanceError}
          isShallow={isShallow}
        />
        <div className="flex items-center gap-1 min-w-0">
          <span className="text-xs text-slate-400 dark:text-slate-500 whitespace-nowrap">水深</span>
          <input type="number" inputMode="decimal" step="0.001" min="0" placeholder="m"
            value={vertical.waterDepth} onChange={(e) => updateVertical(vertical.id, { waterDepth: e.target.value })}
            className={`w-14 min-w-[44px] px-1 py-0.5 text-xs md:text-sm rounded-md bg-white/80 dark:bg-gray-800/80 dark:text-slate-200 border-0 border-b text-right font-mono outline-none ${
              isShallow ? 'border-amber-400 text-amber-700 dark:text-amber-400 bg-amber-50/50 dark:bg-amber-950/50' : 'border-slate-200 dark:border-gray-600 focus:border-hydro-blue'
            }`}
          />
        </div>
        <select value={vertical.measureMethod} onChange={(e) => changeMeasureMethod(vertical.id, e.target.value as MeasureMethod)}
          className="px-1 py-0.5 text-xs rounded-md bg-slate-50 dark:bg-gray-800 border-0 dark:text-slate-300 outline-none cursor-pointer min-w-0">
          {availableMethods.map((m) => (<option key={m} value={m}>{METHOD_LABELS[m]}</option>))}
        </select>
        <div className="flex items-center gap-0.5 ml-auto shrink-0">
          <ConfirmDeleteButton onDelete={() => deleteVertical(vertical.id)} />
          <button onClick={() => insertVerticalAfter(vertical.id)}
            className="p-0.5 rounded hover:bg-emerald-50 dark:hover:bg-emerald-900/30 text-slate-400 dark:text-slate-500 hover:text-emerald-600 dark:hover:text-emerald-400" title="在下方插入新垂线">
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* 冰期参数探测层 (紧贴水深下方，冰期展示) */}
      {flowPeriod === 'ice' && (
        <div className="grid grid-cols-3 gap-2 p-2 bg-cyan-50/50 dark:bg-cyan-950/30 rounded-md border border-cyan-100 dark:border-cyan-900 mx-2 mt-1 mb-2">
          <IceField 
            label="冰厚" 
            value={vertical.iceThickness || ''} 
            onChange={(v) => updateVertical(vertical.id, { iceThickness: v })} 
          />
          <IceField 
            label="水浸" 
            value={vertical.waterIceThickness || ''} 
            onChange={(v) => updateVertical(vertical.id, { waterIceThickness: v })} 
          />
          <IceField 
            label="冰花" 
            value={vertical.iceFlowerThickness || ''} 
            onChange={(v) => updateVertical(vertical.id, { iceFlowerThickness: v })} 
          />
        </div>
      )}

      {/* 测点与流速 (视觉核心增强) */}
      <div className="flex flex-col gap-y-1 px-1.5 py-1 border-b border-slate-100/50 dark:border-gray-700/50">
        {vertical.measurePoints.map((mp, _i) => (
          <div key={mp.id} className="flex items-center justify-between gap-1 px-2 py-1.5 mt-1 bg-white/60 dark:bg-gray-800/60 rounded-xl border border-slate-200/80 dark:border-gray-700/50 shadow-sm">
            
            {/* 左侧：辅助参数与位置 (紧凑、文字标签回归) */}
            <div className="flex items-center gap-1.5 shrink-0">
              {/* Kα 区域 (带获取焦点全选) */}
              <div className="flex items-center">
                <span className="text-[10px] text-slate-500 font-medium mr-0.5">Kα</span>
                <input
                  type="number"
                  value={vertical.deflectionCoefficient || '1.0'}
                  onChange={(e) => updateVertical(vertical.id, { deflectionCoefficient: e.target.value })}
                  onFocus={(e) => e.target.select()}
                  className="w-8 h-6 px-1 text-[11px] text-center rounded-md bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-700 text-slate-700 dark:text-slate-300 shadow-sm focus:outline-none focus:ring-1 focus:ring-hydro-blue/50"
                />
              </div>

              <div className="w-px h-4 bg-slate-200 dark:bg-gray-700" />

              {/* 深度标识与输入 */}
              <div className="flex items-center gap-1.5">
                {/* 相对深度 (可修改, 带全选) */}
                <div className="flex items-center">
                  <span className="text-[10px] text-slate-500 mr-0.5">相对</span>
                  <input
                    type="number"
                    value={mp.relativeDepth || ''}
                    onChange={(e) => updateMeasurePoint(vertical.id, mp.id, { relativeDepth: e.target.value })}
                    onFocus={(e) => e.target.select()}
                    className="w-8 h-6 px-1 text-[11px] font-bold text-center rounded-md bg-blue-50 text-hydro-blue dark:bg-blue-900/30 dark:text-blue-400 border border-blue-100 dark:border-blue-800 focus:outline-none focus:ring-1 focus:ring-blue-400"
                  />
                </div>
                
                {/* 绝对深度 (只读展示) */}
                <div className="flex items-center">
                  <span className="text-[10px] text-slate-500 mr-0.5">绝对</span>
                  <div className="flex items-center h-6 px-1.5 bg-slate-100/50 dark:bg-gray-800 rounded-md border border-slate-200/50 dark:border-gray-700">
                    <span className="text-[11px] font-mono text-slate-600 dark:text-slate-400">
                      {mp.absoluteDepth || '0.00'}
                    </span>
                    <span className="text-[9px] text-slate-400 ml-0.5">m</span>
                  </div>
                </div>
              </div>
            </div>

            {/* 右侧：高清晰度液态玻璃流速框 (Apple Liquid Glass) */}
            <div className="relative flex items-center shrink w-[90px] h-8 bg-gradient-to-b from-blue-50 to-white dark:from-blue-900/40 dark:to-gray-900/60 rounded-lg border border-blue-200/80 dark:border-blue-700/60 shadow-[0_2px_4px_rgba(59,130,246,0.1),inset_0_1px_0_rgba(255,255,255,1)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.1)] transition-all focus-within:ring-2 focus-within:ring-blue-400/50 focus-within:border-blue-400">
              <input
                type="number"
                value={mp.velocity || ''}
                onChange={(e) => updateMeasurePoint(vertical.id, mp.id, { velocity: e.target.value })}
                placeholder="流速"
                className="w-full h-full pl-2 pr-7 bg-transparent border-none text-sm font-bold text-slate-900 dark:text-white text-right focus:ring-0 placeholder:text-slate-300 dark:placeholder:text-slate-600 placeholder:font-normal"
              />
              <div className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[10px] font-bold text-blue-500/80 dark:text-blue-400 pointer-events-none">
                m/s
              </div>
            </div>

          </div>
        ))}
      </div>

      {/* 计算结果 */}
      <button onClick={() => toggleVerticalResults(vertical.id)}
        className="w-full flex items-center justify-between px-1.5 py-0.5 bg-gradient-to-r from-blue-50/20 dark:from-blue-950/20 to-transparent hover:from-blue-50/40 dark:hover:from-blue-950/40 transition-colors">
        <div className="flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
          <Gauge className="w-3 h-3" /><span>计算结果</span>
          {isShallow && <span className="px-1 py-0.5 rounded bg-amber-100 dark:bg-amber-900/50 text-amber-600 dark:text-amber-400 text-[10px]">浅水区</span>}
        </div>
        {showResults ? <ChevronUp className="w-3 h-3 text-slate-400" /> : <ChevronDown className="w-3 h-3 text-slate-400" />}
      </button>

      <AnimatePresence>
        {showResults && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.15 }}
            className="overflow-hidden bg-blue-50/20 dark:bg-blue-950/20 px-1.5 py-1">
            <div className="grid grid-cols-4 gap-1.5 text-xs">
              <ResultTile label="有效水深" value={vertical.effectiveDepth} unit="m" />
              <ResultTile label="修正流速" value={vertical.correctedVelocity} unit="m/s" highlight />
              <ResultTile label="部分面积" value={vertical.partialArea} unit="m²" />
              <ResultTile label="部分流量" value={vertical.partialDischarge} unit="m³/s" highlight />
            </div>
            <div className="flex items-center gap-2 mt-1.5 pt-1 border-t border-blue-100/50 dark:border-blue-800/50">
              <div className="flex items-center gap-1 text-slate-400 dark:text-slate-500"><Target className="w-3 h-3" /><span className="text-xs">{vertical.measurePoints.length}测点</span></div>
              {vertical.deflectionCoefficient && vertical.deflectionCoefficient !== '1.0' && <div className="text-xs text-slate-500 dark:text-slate-400">Kα = {vertical.deflectionCoefficient}</div>}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function IceField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-0.5">
      <span className="text-[9px] text-cyan-600 dark:text-cyan-400">{label}</span>
      <input type="number" inputMode="decimal" step="0.001" value={value} onChange={(e) => onChange(e.target.value)}
        className="w-10 px-1 py-0.5 text-[10px] rounded-md bg-white/80 dark:bg-gray-800/80 border-0 border-b border-cyan-200 dark:border-cyan-800 text-center font-mono outline-none dark:text-slate-200" />
    </div>
  );
}

function ResultTile({ label, value, unit, highlight }: { label: string; value?: string; unit: string; highlight?: boolean }) {
  return (
    <div className={`p-1 rounded-md bg-white/60 dark:bg-gray-800/60 border ${highlight ? 'border-hydro-blue/30 dark:border-hydro-blue/50' : 'border-blue-100 dark:border-blue-800'}`}>
      <span className={`block ${highlight ? 'text-hydro-blue dark:text-hydro-blue-light' : 'text-slate-400 dark:text-slate-500'}`}>{label}</span>
      <span className={`font-mono text-sm font-bold ${highlight ? 'text-hydro-blue dark:text-cyan-400' : 'text-slate-700 dark:text-slate-200'}`}>
        {value || '--'}<span className="font-normal text-[10px] opacity-60">{unit}</span>
      </span>
    </div>
  );
}

export default function VerticalCard(props: Props) {
  if (props.vertical.type === 'edge') return <EdgeCard vertical={props.vertical} index={props.index} isLast={props.isLast} />;
  return <MeasureCard {...props} />;
}

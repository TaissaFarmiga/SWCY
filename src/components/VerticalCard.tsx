/**
 * 垂线卡片组件
 * 紧凑3行布局 + 防误触删除 + 深色模式 + 起点距倒挂红线警告（全覆盖）
 */
import { motion, AnimatePresence } from 'framer-motion';
import { useState, useEffect, useRef, memo } from 'react';
import { ChevronDown, ChevronUp, Trash2, Plus, Target, Gauge, ArrowLeftRight } from 'lucide-react';
import { Vertical, MeasureMethod, METHOD_LABELS, getAvailableMethods } from '../types';
import MeasureRow from './MeasureRow';
import { useHydroStore } from '../store/hydroStore';

// PWA 卡片界面使用的国标格式化函数
function roundGBUI(num: number, decimals: number): string {
  const p = Math.pow(10, decimals);
  const n = num * p;
  const r = Math.round(n);
  let resultNum = 0;
  if (Math.abs(n - Math.floor(n) - 0.5) < 1e-9) {
    const floor = Math.floor(n);
    resultNum = (floor % 2 === 0 ? floor : floor + 1) / p;
  } else {
    resultNum = r / p;
  }
  return decimals >= 0 ? resultNum.toFixed(decimals) : String(resultNum);
}

function getGbDecimalsUI(num: number, sigFigs: number, maxDecimals: number): number {
  if (num === 0) return maxDecimals;
  const exponent = Math.floor(Math.log10(Math.abs(num)));
  const requiredDecimals = sigFigs - 1 - exponent;
  return Math.min(maxDecimals, requiredDecimals);
}

const formatAreaUI = (val: string | number | undefined | null): string => {
  if (val == null || val === '') return '';
  const num = parseFloat(String(val));
  if (isNaN(num)) return '';
  if (num === 0) return '0.00';
  const dec = getGbDecimalsUI(num, 3, 2);
  return roundGBUI(num, dec);
};

const formatDischargeUI = (val: string | number | undefined | null): string => {
  if (val == null || val === '') return '';
  const num = parseFloat(String(val));
  if (isNaN(num)) return '';
  if (num === 0) return '0.000';
  const dec = getGbDecimalsUI(num, 3, 3);
  return roundGBUI(num, dec);
};

const formatVelocityUI = (val: string | number | undefined | null): string => {
  if (val == null || val === '') return '';
  const num = parseFloat(String(val));
  if (isNaN(num)) return '';
  if (num === 0) return '0.00';
  return num.toFixed(2);
};

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
    <div className="flex-1 min-w-[100px] flex items-center gap-1">
      <span className="text-xs text-slate-400 dark:text-slate-500 whitespace-nowrap flex-shrink-0">起点距</span>
      <div className="relative w-full">
        <input type="text" inputMode="decimal" step="0.01" min="0" placeholder={placeholder || ''}
          value={value} onChange={(e) => onChange(e.target.value)}
          className={`w-full min-w-[60px] px-1 py-1 pr-7 rounded-md shadow-inner bg-white/80 dark:bg-gray-900/50 dark:text-slate-200 text-center font-mono text-[11px] font-bold outline-none ${
            isDistanceError
              ? 'border border-red-500 text-red-600 bg-red-50 dark:bg-red-950/50 dark:text-red-400 dark:border-red-500'
              : isShallow
                ? 'border border-amber-400 text-amber-700 dark:text-amber-400'
                : 'border border-slate-300 dark:border-gray-600 focus-within:border-hydro-blue'
          } ${additionalClass || ''}`}
        />
        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-slate-400 dark:text-slate-500 pointer-events-none">m</span>
      </div>
      {isDistanceError && <span className="text-[9px] text-red-500 dark:text-red-400 font-bold whitespace-nowrap">⚠️</span>}
    </div>
  );
}

/** 岸边垂线卡片 — 新增右水边倒挂警告 + 结束岸计算结果面板 */
function EdgeCard({ vertical, index, isLast }: { vertical: Vertical; index: number; isLast?: boolean }) {
  const updateVertical = useHydroStore((s) => s.updateVertical);
  const swapEdges = useHydroStore((s) => s.swapEdges);
  const swapEdgeCoefficients = useHydroStore((s) => s.swapEdgeCoefficients);
  const verticals = useHydroStore((s) => s.currentRun.verticals);

  const isDistanceError = calcDistanceError(verticals, index);
  const isEndBank = isLast && vertical.type === 'edge';
  const [showResults, setShowResults] = useState(false);

  return (
    <motion.div id={`vertical-${vertical.id}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="rounded-lg bg-gradient-to-r from-amber-50/90 to-orange-50/70 dark:from-amber-950/80 dark:to-orange-950/70 border border-amber-200/60 dark:border-amber-800/40"
    >
      <div className="w-full flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-1.5 py-2">
        <button onClick={swapEdges}
          className="flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-amber-100/60 dark:bg-amber-900/40 hover:bg-amber-200/60 dark:hover:bg-amber-800/40 transition-colors flex-shrink-0"
          title="点击互换左右水边">
          <span className="text-sm font-bold text-amber-700 dark:text-amber-300">{vertical.name}</span>
          <ArrowLeftRight className="w-2.5 h-2.5 text-amber-400" />
        </button>
        <DistanceInput
          value={vertical.startDistance}
          onChange={(v) => updateVertical(vertical.id, { startDistance: v })}
          isDistanceError={isDistanceError}
          additionalClass="bg-white/60 dark:bg-gray-800/60 text-amber-700 dark:text-amber-300 border border-amber-300/50 dark:border-amber-700/50"
        />
        <div className="flex-1 min-w-0 flex items-center gap-1.5" onClick={swapEdgeCoefficients} title="岸边系数（点击互换左右）">
          <span className="text-xs text-amber-600 dark:text-amber-400 flex-shrink-0 cursor-pointer">系数 η</span>
          <div className="relative w-full">
            <input type="text" inputMode="decimal" step="0.01" min="0" max="1"
              value={vertical.shoreCoefficient !== undefined ? vertical.shoreCoefficient : '0.70'}
              onChange={(e) => updateVertical(vertical.id, { shoreCoefficient: e.target.value })}
              onClick={(e) => e.stopPropagation()}
              className="w-full px-1 py-0.5 text-sm rounded-md bg-white/60 dark:bg-gray-800/60 dark:text-amber-200 border-0 border-b border-amber-300/50 dark:border-amber-700/50 text-center font-mono text-amber-700 dark:text-amber-300 focus:border-amber-400 outline-none"
            />
          </div>
        </div>
      </div>

      {/* 结束岸计算结果面板 — 仅展示部分面积和部分流量 */}
      {isEndBank && (
        <>
          <button onClick={() => setShowResults(!showResults)}
            className="w-full flex items-center justify-between px-1.5 py-0.5 bg-gradient-to-r from-amber-50/30 dark:from-amber-900/20 to-transparent hover:from-amber-50/50 dark:hover:from-amber-900/30 transition-colors">
            <div className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
              <Gauge className="w-3 h-3" /><span>结束岸结果</span>
            </div>
            {showResults ? <ChevronUp className="w-3 h-3 text-amber-400" /> : <ChevronDown className="w-3 h-3 text-amber-400" />}
          </button>
          <AnimatePresence>
            {showResults && (
              <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.15 }} style={{ willChange: 'height, opacity' }}
                className="overflow-hidden bg-amber-50/30 dark:bg-amber-950/30 px-1.5 py-1">
                <div className="grid grid-cols-3 divide-x divide-amber-200/50 dark:divide-amber-800/30 rounded-md bg-white/60 dark:bg-gray-800/60 border border-amber-200/80 dark:border-amber-800/50 shadow-sm overflow-hidden">
                  <ResultTile label="部分流速" value={formatVelocityUI(vertical.partialMeanVelocity)} unit="m/s" />
                  <ResultTile label="部分面积" value={formatAreaUI(vertical.partialArea)} unit="m²" />
                  <ResultTile label="部分流量" value={formatDischargeUI(vertical.partialDischarge)} unit="m³/s" highlight />
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

/** 测法选择器 Popover（废弃原生 select） */
function MeasureMethodPopover({ value, methods, onChange }: { value: MeasureMethod; methods: MeasureMethod[]; onChange: (m: MeasureMethod) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    if (open) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div className="relative w-[72px] shrink-0" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-1.5 py-0.5 text-[11px] rounded-md bg-slate-50 dark:bg-gray-800 border border-slate-200 dark:border-gray-700 dark:text-slate-300 outline-none cursor-pointer shrink-0 hover:border-hydro-blue/50 transition-colors"
      >
        <span className="font-medium">{METHOD_LABELS[value]}</span>
        <ChevronDown className={`w-3 h-3 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: -2 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -2 }}
            transition={{ duration: 0.12 }}
            className="absolute z-50 mt-1 left-0 min-w-[100px] backdrop-blur-xl bg-white/75 dark:bg-gray-800/80 border border-white/30 dark:border-gray-600 shadow-2xl rounded-xl overflow-hidden"
          >
            {methods.map((m) => (
              <button
                key={m}
                onClick={() => { onChange(m); setOpen(false); }}
                className={`w-full text-left px-3 py-1.5 text-xs transition-colors ${
                  m === value
                    ? 'bg-blue-50/80 dark:bg-blue-900/40 text-hydro-blue dark:text-cyan-400 font-bold'
                    : 'text-slate-700 dark:text-slate-200 hover:bg-white/50 dark:hover:bg-gray-700/50'
                }`}
              >
                {METHOD_LABELS[m]}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** 测速垂线卡片 */
function MeasureCard({ vertical, index }: Props) {
  const flowPeriod = useHydroStore((s) => s.currentRun.flowPeriod);
  const updateVertical = useHydroStore((s) => s.updateVertical);
  const deleteVertical = useHydroStore((s) => s.deleteVertical);
  const insertVerticalAfter = useHydroStore((s) => s.insertVerticalAfter);
  const changeMeasureMethod = useHydroStore((s) => s.changeMeasureMethod);
  const verticals = useHydroStore((s) => s.currentRun.verticals);

  const availableMethods = getAvailableMethods(flowPeriod);
  const [showResults, setShowResults] = useState(false);
  const waterDepthNum = parseFloat(vertical.waterDepth || '0');
  const isShallow = waterDepthNum > 0 && waterDepthNum < 0.2;
  const isDistanceError = calcDistanceError(verticals, index);

  // 计算 measure-only 垂线序号（排除岸边占位，确保第一条测速垂线 = 1）
  const measureIndex = verticals.slice(0, index + 1).filter((v) => v.type === 'measure').length;

  return (
    <motion.div id={`vertical-${vertical.id}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="rounded-lg bg-white/70 dark:bg-gray-900/70 border border-white/80 dark:border-gray-700/80"
    >
      <div className="w-full flex flex-wrap items-center justify-between gap-x-2 gap-y-2 px-1.5 py-2 border-b border-slate-100/50 dark:border-gray-700/50">
        <div className="flex items-center justify-center w-5 h-5 rounded-md bg-hydro-blue text-white text-sm font-bold flex-shrink-0">
          {measureIndex}
        </div>
        <DistanceInput
          value={vertical.startDistance}
          onChange={(v) => updateVertical(vertical.id, { startDistance: v })}
          isDistanceError={isDistanceError}
          isShallow={isShallow}
        />
        <div className="flex-1 min-w-[90px] flex items-center gap-1">
          <span className="text-xs text-slate-400 dark:text-slate-500 whitespace-nowrap flex-shrink-0">水深</span>
          <div className="relative w-full">
            <input type="text" inputMode="decimal" step="0.001" min="0" placeholder=""
              value={vertical.waterDepth} onChange={(e) => updateVertical(vertical.id, { waterDepth: e.target.value })}
              className={`w-full min-w-[50px] px-1 py-1 pr-7 rounded-md shadow-inner bg-white/80 dark:bg-gray-900/50 dark:text-slate-200 text-center font-mono text-[11px] font-bold outline-none ${
                isShallow ? 'border border-amber-400 text-amber-700 dark:text-amber-400 bg-amber-50/50 dark:bg-amber-950/50' : 'border border-slate-300 dark:border-gray-600 focus-within:border-hydro-blue'
              }`}
            />
            <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-slate-400 dark:text-slate-500 pointer-events-none">m</span>
          </div>
        </div>
        <MeasureMethodPopover
          value={vertical.measureMethod}
          methods={availableMethods}
          onChange={(m) => changeMeasureMethod(vertical.id, m)}
        />
      </div>

      {/* 冰期参数探测层 (极致瘦身版) */}
      {flowPeriod === 'ice' && (
        <div className="flex flex-wrap items-center justify-between gap-x-1.5 gap-y-2 px-2 py-2 bg-cyan-50/40 dark:bg-cyan-950/20 border-b border-cyan-100/50 dark:border-cyan-900/50">
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
        {vertical.measurePoints.map((point, i) => (
          <MeasureRow key={point.id} verticalId={vertical.id} point={point} index={i} />
        ))}
      </div>

      {/* 计算结果 — 整行点击展开/折叠，右侧放置操作按钮 */}
      <div onClick={() => setShowResults(!showResults)}
        className="w-full flex items-center justify-between cursor-pointer select-none py-2 px-3 bg-gray-50 dark:bg-gray-800/50 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800/70 transition-colors">
        <div className="flex items-center gap-1">
          <div className="flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
            <Gauge className="w-3 h-3" /><span>计算结果</span>
            {isShallow && <span className="px-1 py-0.5 rounded bg-amber-100 dark:bg-amber-900/50 text-amber-600 dark:text-amber-400 text-[10px]">浅水区</span>}
          </div>
          {showResults ? <ChevronUp className="w-3 h-3 text-slate-400" /> : <ChevronDown className="w-3 h-3 text-slate-400" />}
        </div>
        <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
          <ConfirmDeleteButton onDelete={() => deleteVertical(vertical.id)} />
          <button onClick={(e) => { e.stopPropagation(); insertVerticalAfter(vertical.id); }}
            className="p-0.5 rounded hover:bg-emerald-50 dark:hover:bg-emerald-900/30 text-slate-400 dark:text-slate-500 hover:text-emerald-600 dark:hover:text-emerald-400" title="在下方插入新垂线">
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <AnimatePresence>
        {showResults && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.15 }} style={{ willChange: 'height, opacity' }}
            className="overflow-hidden bg-blue-50/20 dark:bg-blue-950/20 px-1.5 py-1">
            <div className="grid grid-cols-4 divide-x divide-blue-100/60 dark:divide-blue-800/40 rounded-md bg-white/60 dark:bg-gray-800/60 border border-blue-100/80 dark:border-blue-800/50 shadow-sm overflow-hidden">
              <ResultTile label="垂线流速" value={vertical.correctedVelocity} unit="m/s" />
              <ResultTile label="部分流速" value={vertical.partialMeanVelocity} unit="m/s" highlight />
              <ResultTile label="部分面积" value={formatAreaUI(vertical.partialArea)} unit="m²" />
              <ResultTile label="部分流量" value={formatDischargeUI(vertical.partialDischarge)} unit="m³/s" highlight />
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
    <div className="flex items-center gap-1 flex-1 min-w-[80px]">
      <span className="text-[10px] font-medium text-cyan-700 dark:text-cyan-500 shrink-0">{label}</span>
      <div className="relative flex-1 min-w-[45px]">
        <input 
          type="text" 
          inputMode="decimal" 
          value={value} 
          onChange={(e) => onChange(e.target.value)}
          placeholder="--"
          className="w-full pl-1 pr-3.5 py-0.5 rounded-[4px] bg-white/60 dark:bg-gray-800/50 border border-cyan-200 dark:border-cyan-800 shadow-inner text-center font-mono text-[11px] font-semibold text-cyan-700 dark:text-cyan-400 outline-none focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400/30 transition-all" 
        />
        <span className="absolute right-1 top-1/2 -translate-y-1/2 text-[8px] text-cyan-600/40 dark:text-cyan-400/40 pointer-events-none font-sans">m</span>
      </div>
    </div>
  );
}

function ResultTile({ label, value, unit, highlight }: { label: string; value?: string; unit: string; highlight?: boolean }) {
  return (
    <div className={`flex flex-col justify-center px-1.5 py-1 min-w-0 ${highlight ? 'bg-hydro-blue/[0.04] dark:bg-cyan-400/[0.05]' : ''}`}>
      <span className={`block text-[10px] font-medium leading-tight mb-0.5 whitespace-nowrap overflow-hidden text-ellipsis ${highlight ? 'text-hydro-blue dark:text-cyan-400' : 'text-slate-400 dark:text-slate-500'}`}>
        {label}
      </span>
      <div className="flex flex-wrap items-baseline gap-x-[2px] leading-none">
        <span className={`font-mono text-[13px] font-bold break-keep ${highlight ? 'text-blue-600 dark:text-cyan-300' : 'text-slate-700 dark:text-slate-200'}`}>
          {value || '--'}
        </span>
        <span className="font-sans text-[9px] opacity-70 whitespace-nowrap">
          {unit}
        </span>
      </div>
    </div>
  );
}

const VerticalCard = (props: Props) => {
  if (props.vertical.type === 'edge') return <EdgeCard vertical={props.vertical} index={props.index} isLast={props.isLast} />;
  return <MeasureCard {...props} />;
};

export default memo(VerticalCard, (prev, next) => {
  return prev.vertical === next.vertical && prev.index === next.index && prev.isLast === next.isLast;
});

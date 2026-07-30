/**
 * 水文数据录入表格 - 紧凑布局，深色模式适配
 * 历史记录：强化命名 + 防误触删除
 */
import { motion, AnimatePresence } from 'framer-motion';
import { useEffect, useState } from 'react';
import { Plus, MapPin, Gauge, Calendar } from 'lucide-react';
import { useHydroStore } from '../store/hydroStore';
import VerticalCard from './VerticalCard';

export default function HydroTable() {
  const currentRun = useHydroStore((s) => s.currentRun);

  const addVertical = useHydroStore((s) => s.addVertical);
  const updateRunMeta = useHydroStore((s) => s.updateRunMeta);
  const lastAddedVerticalId = useHydroStore((s) => s.lastAddedVerticalId);
  const setLastAddedVerticalId = useHydroStore((s) => s.setLastAddedVerticalId);

  const showMetaPanel = useHydroStore((s) => s.showMetaPanel);
  const [formulaDraft, setFormulaDraft] = useState(() => ({
    k: String(currentRun.meterFormula?.k ?? 0.428),
    c: String(currentRun.meterFormula?.c ?? 0.0057),
  }));

  useEffect(() => {
    setFormulaDraft({
      k: String(currentRun.meterFormula?.k ?? 0.428),
      c: String(currentRun.meterFormula?.c ?? 0.0057),
    });
  }, [currentRun.id, currentRun.meterFormula?.c, currentRun.meterFormula?.k]);

  const commitFormula = () => {
    const k = Number(formulaDraft.k);
    const c = Number(formulaDraft.c);
    if (formulaDraft.k.trim() !== '' && formulaDraft.c.trim() !== '' && Number.isFinite(k) && Number.isFinite(c)) {
      useHydroStore.getState().updateMeterFormula({ k, c });
      return;
    }
    setFormulaDraft({
      k: String(currentRun.meterFormula?.k ?? 0.428),
      c: String(currentRun.meterFormula?.c ?? 0.0057),
    });
  };
  // datetime-local 格式化器
  const formatDatetimeLocal = (isoStr: string) => {
    if (!isoStr) return '';
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return '';
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  };

  useEffect(() => {
    if (lastAddedVerticalId) {
      const t = setTimeout(() => {
        document.getElementById(`vertical-${lastAddedVerticalId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setLastAddedVerticalId(null);
      }, 100);
      return () => clearTimeout(t);
    }
  }, [lastAddedVerticalId, setLastAddedVerticalId]);

  return (
    <div className="flex flex-col gap-1.5 px-2 pb-20">

      {/* 水位/断面折叠面板 */}
      <AnimatePresence>
        {showMetaPanel && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} style={{ willChange: 'height, opacity' }}
            className="p-1.5 rounded-lg bg-white/60 dark:bg-gray-900/60 border border-white/80 dark:border-gray-700/80">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
              {/* 🔴 新增时间设置占满整行 */}
              <div className="col-span-1 md:col-span-4 flex items-center gap-1.5 border-b border-slate-200/50 dark:border-gray-700/50 pb-2 mb-1">
                <Calendar className="w-4 h-4 text-hydro-blue shrink-0" />
                <input 
                  type="datetime-local" 
                  value={formatDatetimeLocal(currentRun.timestamp)}
                  onChange={(e) => {
                    const date = new Date(e.target.value);
                    if (Number.isFinite(date.getTime())) updateRunMeta(currentRun.id, 'timestamp', date.toISOString());
                  }}
                  className="flex-1 min-w-0 px-2 py-1 text-sm rounded-md bg-white/80 dark:bg-gray-800/80 dark:text-slate-200 border border-slate-200 dark:border-gray-600 focus:border-hydro-blue focus:ring-1 focus:ring-hydro-blue/30 outline-none font-sans" 
                />
              </div>
              <div className="flex items-center gap-1.5"><MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                <input type="text" placeholder="断面位置" value={currentRun.location || ''}
                  onChange={(e) => updateRunMeta(currentRun.id, 'location', e.target.value)}
                  className="flex-1 min-w-0 px-1.5 py-0.5 text-sm rounded-md bg-white/80 dark:bg-gray-800/80 dark:text-slate-200 border border-slate-200 dark:border-gray-600 focus:border-hydro-blue focus:ring-1 focus:ring-hydro-blue/30 outline-none" />
              </div>
              <div className="flex items-center gap-1.5"><Gauge className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                <input type="text" inputMode="decimal" step="0.001" placeholder="水位(m)" value={currentRun.waterLevel || ''}
                  onChange={(e) => updateRunMeta(currentRun.id, 'waterLevel', e.target.value)}
                  className="flex-1 min-w-0 px-1.5 py-0.5 text-sm rounded-md bg-white/80 dark:bg-gray-800/80 dark:text-slate-200 border border-slate-200 dark:border-gray-600 focus:border-hydro-blue focus:ring-1 focus:ring-hydro-blue/30 outline-none font-mono" />
              </div>
              <div className="flex items-center gap-1.5"><span className="text-xs text-slate-400 font-mono shrink-0">K (a)</span>
                <input type="text" inputMode="decimal" value={formulaDraft.k}
                  onChange={(e) => setFormulaDraft((value) => ({ ...value, k: e.target.value }))} onBlur={commitFormula}
                  className="flex-1 min-w-0 px-1.5 py-0.5 text-sm rounded-md bg-white/80 dark:bg-gray-800/80 dark:text-slate-200 border border-slate-200 dark:border-gray-600 focus:border-hydro-blue focus:ring-1 focus:ring-hydro-blue/30 outline-none font-mono text-hydro-blue dark:text-cyan-400" />
              </div>
              <div className="flex items-center gap-1.5"><span className="text-xs text-slate-400 font-mono shrink-0">C (b)</span>
                <input type="text" inputMode="decimal" value={formulaDraft.c}
                  onChange={(e) => setFormulaDraft((value) => ({ ...value, c: e.target.value }))} onBlur={commitFormula}
                  className="flex-1 min-w-0 px-1.5 py-0.5 text-sm rounded-md bg-white/80 dark:bg-gray-800/80 dark:text-slate-200 border border-slate-200 dark:border-gray-600 focus:border-hydro-blue focus:ring-1 focus:ring-hydro-blue/30 outline-none font-mono text-hydro-blue dark:text-cyan-400" />
              </div>
              <div className="col-span-1 md:col-span-4 mt-1 border-t border-slate-200/60 pt-2 dark:border-gray-700/60">
                <div className="mb-2 rounded-md bg-cyan-50/70 px-2 py-1 text-[10px] leading-4 text-cyan-700 dark:bg-cyan-950/30 dark:text-cyan-300">
                  当前仪器：{currentRun.instrumentSnapshot?.name ?? '未登记流速仪'}{currentRun.instrumentSnapshot?.serialNumber ? ` · ${currentRun.instrumentSnapshot.serialNumber}` : ''} · 状态 {currentRun.instrumentSnapshot?.status ?? 'unregistered'}
                </div>
                <div className="grid grid-cols-1 gap-2 min-[360px]:grid-cols-2">
                  {([
                    ['stationCode', '测站编码'], ['riverName', '河流名称'], ['operator', '施测人员'], ['recorder', '记录人员'],
                    ['reviewer', '复核人员'], ['weather', '天气'], ['waterCondition', '水情'],
                  ] as const).map(([key, placeholder]) => <input key={key} type="text" value={currentRun[key] ?? ''} placeholder={placeholder} onChange={(event) => updateRunMeta(currentRun.id, key, event.target.value)} className="min-h-11 min-w-0 rounded-md border border-slate-200 bg-white/80 px-2 text-sm outline-none focus:border-hydro-blue dark:border-gray-600 dark:bg-gray-800/80 dark:text-slate-200" />)}
                  <textarea value={currentRun.notes ?? ''} placeholder="备注" onChange={(event) => updateRunMeta(currentRun.id, 'notes', event.target.value)} className="min-h-16 min-w-0 resize-y rounded-md border border-slate-200 bg-white/80 px-2 py-2 text-sm outline-none focus:border-hydro-blue dark:border-gray-600 dark:bg-gray-800/80 dark:text-slate-200 min-[360px]:col-span-2" />
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 垂线列表 */}
      <div className="flex flex-col gap-1.5">
        <AnimatePresence>
          {currentRun.verticals.map((vertical, idx) => (
            <VerticalCard key={vertical.id} vertical={vertical} index={idx} isLast={idx === currentRun.verticals.length - 1} />
          ))}
        </AnimatePresence>
      </div>

      <button data-testid="flow-add-vertical" onClick={addVertical}
        className="flex min-h-11 items-center justify-center gap-1 p-1.5 rounded-lg bg-white/40 dark:bg-gray-900/40 border border-dashed border-slate-300 dark:border-gray-600 text-sm text-slate-500 dark:text-slate-400 hover:border-hydro-blue dark:hover:border-hydro-blue-light hover:text-hydro-blue dark:hover:text-cyan-400 transition-colors">
        <Plus className="w-3.5 h-3.5" /><span>添加测速垂线</span>
      </button>
    </div>
  );
}

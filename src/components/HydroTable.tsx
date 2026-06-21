/**
 * 水文数据录入表格 - 紧凑布局，深色模式适配
 * 历史记录：强化命名 + 防误触删除
 */
import { motion, AnimatePresence } from 'framer-motion';
import { useEffect, useState, useRef } from 'react';
import { Plus, MapPin, Gauge, Trash2 } from 'lucide-react';
import { useHydroStore } from '../store/hydroStore';
import VerticalCard from './VerticalCard';

/** 防误触删除按钮（复用组件） */
function DeleteRunButton({ onDelete }: { onDelete: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);
  const tap1 = () => { setConfirming(true); timerRef.current = setTimeout(() => setConfirming(false), 3000); };
  const tap2 = () => { if (timerRef.current) clearTimeout(timerRef.current); setConfirming(false); onDelete(); };
  return confirming ? (
    <button onClick={tap2} className="p-0.5 rounded bg-red-500 dark:bg-red-600 text-white text-[9px] font-bold animate-pulse shrink-0">确认删除</button>
  ) : (
    <button onClick={(e) => { e.stopPropagation(); tap1(); }} className="p-0.5 rounded hover:bg-red-50 dark:hover:bg-red-900/30 text-slate-400 dark:text-slate-500 hover:text-red-500 shrink-0" title="删除测次（二次确认）">
      <Trash2 className="w-3 h-3" />
    </button>
  );
}

export default function HydroTable() {
  const currentRun = useHydroStore((s) => s.currentRun);

  const addVertical = useHydroStore((s) => s.addVertical);
  const deleteRun = useHydroStore((s) => s.deleteRun);
  const runs = useHydroStore((s) => s.runs);
  const loadRun = useHydroStore((s) => s.loadRun);
  const updateRunMeta = useHydroStore((s) => s.updateRunMeta);
  const lastAddedVerticalId = useHydroStore((s) => s.lastAddedVerticalId);
  const setLastAddedVerticalId = useHydroStore((s) => s.setLastAddedVerticalId);

  const showHistory = useHydroStore((s) => s.showHistoryPanel);
  const showMetaPanel = useHydroStore((s) => s.showMetaPanel);
  const toggleHistoryPanel = useHydroStore((s) => s.toggleHistoryPanel);
  const toggleMetaPanel = useHydroStore((s) => s.toggleMetaPanel);

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

      {/* 历史记录 — 强化命名 + 防误触删除 */}
      <AnimatePresence>
        {showHistory && runs.length > 0 && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
            className="p-1.5 rounded-lg bg-white/60 dark:bg-gray-900/60 border border-white/80 dark:border-gray-700/80 max-h-64 overflow-y-auto">
            <div className="flex flex-col gap-1">
              {runs.slice(0, 10).map((run) => (
                <div key={run.id} className="flex items-center gap-1 px-1.5 py-1 rounded-md bg-slate-50 dark:bg-gray-800 hover:bg-slate-100 dark:hover:bg-gray-700">
                  <button onClick={() => { loadRun(run.id); toggleHistoryPanel(); }}
                    className="flex-1 flex items-center justify-between text-left min-w-0">
                    <div className="flex items-center gap-1.5 min-w-0 flex-1">
                      <span className="text-xs font-bold text-hydro-blue dark:text-cyan-400 shrink-0">#{run.runNumber}</span>
                      <span className="text-xs text-slate-600 dark:text-slate-300 truncate">{run.location || '未知断面'}</span>
                      <span className="text-[10px] text-slate-400 dark:text-slate-500 shrink-0">{run.totalDischarge || '--'} m³/s</span>
                    </div>
                    <span className="text-xs font-mono text-slate-500 shrink-0 ml-1">{run.startTime ? run.startTime : new Date(run.timestamp).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).replace(/\//g, '-')}</span>
                  </button>
                  <DeleteRunButton onDelete={() => deleteRun(run.id)} />
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 水位/断面折叠面板 */}
      <AnimatePresence>
        {showMetaPanel && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
            className="p-1.5 rounded-lg bg-white/60 dark:bg-gray-900/60 border border-white/80 dark:border-gray-700/80">
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1.5 flex-1"><MapPin className="w-3.5 h-3.5 text-slate-400" />
                  <input type="text" placeholder="断面位置" value={currentRun.location || ''}
                    onChange={(e) => updateRunMeta(currentRun.id, 'location', e.target.value)}
                    className="flex-1 px-1.5 py-0.5 text-sm rounded-md bg-white/80 dark:bg-gray-800/80 dark:text-slate-200 border border-slate-200 dark:border-gray-600 focus:border-hydro-blue focus:ring-1 focus:ring-hydro-blue/30 outline-none" />
                </div>
                <div className="flex items-center gap-1.5 flex-1"><Gauge className="w-3.5 h-3.5 text-slate-400" />
                  <input type="number" inputMode="decimal" step="0.001" placeholder="水位(m)" value={currentRun.waterLevel || ''}
                    onChange={(e) => updateRunMeta(currentRun.id, 'waterLevel', e.target.value)}
                    className="flex-1 px-1.5 py-0.5 text-sm rounded-md bg-white/80 dark:bg-gray-800/80 dark:text-slate-200 border border-slate-200 dark:border-gray-600 focus:border-hydro-blue focus:ring-1 focus:ring-hydro-blue/30 outline-none font-mono" />
                </div>
              </div>
              <div className="flex items-center gap-3 pt-2 border-t border-slate-100 dark:border-gray-700">
                <div className="flex items-center gap-1.5 flex-1"><span className="text-xs text-slate-400 font-mono">K (a)</span>
                  <input type="number" inputMode="decimal" step="0.0001" value={currentRun.meterFormula?.k ?? 0.4280}
                    onChange={(e) => useHydroStore.getState().updateMeterFormula({ ...currentRun.meterFormula!, k: parseFloat(e.target.value) || 0 })}
                    className="flex-1 px-1.5 py-0.5 text-sm rounded-md bg-white/80 dark:bg-gray-800/80 dark:text-slate-200 border border-slate-200 dark:border-gray-600 focus:border-hydro-blue focus:ring-1 focus:ring-hydro-blue/30 outline-none font-mono text-hydro-blue dark:text-cyan-400" />
                </div>
                <div className="flex items-center gap-1.5 flex-1"><span className="text-xs text-slate-400 font-mono">C (b)</span>
                  <input type="number" inputMode="decimal" step="0.0001" value={currentRun.meterFormula?.c ?? 0.0057}
                    onChange={(e) => useHydroStore.getState().updateMeterFormula({ ...currentRun.meterFormula!, c: parseFloat(e.target.value) || 0 })}
                    className="flex-1 px-1.5 py-0.5 text-sm rounded-md bg-white/80 dark:bg-gray-800/80 dark:text-slate-200 border border-slate-200 dark:border-gray-600 focus:border-hydro-blue focus:ring-1 focus:ring-hydro-blue/30 outline-none font-mono text-hydro-blue dark:text-cyan-400" />
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 垂线列表 */}
      <div className="flex flex-col gap-1.5">
        <AnimatePresence mode="popLayout">
          {currentRun.verticals.map((vertical, idx) => (
            <VerticalCard key={vertical.id} vertical={vertical} index={idx} isLast={idx === currentRun.verticals.length - 1} />
          ))}
        </AnimatePresence>
      </div>

      <button onClick={addVertical}
        className="flex items-center justify-center gap-1 p-1.5 rounded-lg bg-white/40 dark:bg-gray-900/40 border border-dashed border-slate-300 dark:border-gray-600 text-sm text-slate-500 dark:text-slate-400 hover:border-hydro-blue dark:hover:border-hydro-blue-light hover:text-hydro-blue dark:hover:text-cyan-400 transition-colors">
        <Plus className="w-3.5 h-3.5" /><span>添加测速垂线</span>
      </button>
    </div>
  );
}
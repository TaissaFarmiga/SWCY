/**
 * 水文测验数据状态管理 v4.0
 *
 * v4 变更：
 *   - 冰期默认值强锁：addVertical / insertVerticalAfter / changePeriod 中 flowPeriod === 'ice' 时，
 *     新增垂线 deflectionCoefficient 强锁 '0.9'，relativeDepth 强锁 '0.5'
 *   - 新增 changePeriod 动作：切换测流期并同步修正全部测速垂线默认值
 *   - 新增 discardRun 动作：彻底清空当前工作区（不归档），用于防误触删除流程
 */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { Run, Vertical, MeasurePoint, FlowPeriod, MeasureMethod, MeterFormula } from '../types';
import { createNewRun, createMeasureVertical, processRun, createDefaultMeasurePoints } from '../lib/HydroEngine';
import { DEFAULT_METER_FORMULA } from '../types';
import { downloadExcel } from '../lib/exportExcel';

const STORAGE_KEY = 'hydrology-data';

interface HydroState {
  currentRun: Run; runs: Run[]; expandedVerticalIds: Set<string>; lastAddedVerticalId: string | null;
  /** Dashboard 与 HydroTable 之间的面板通信 */
  showHistoryPanel: boolean;
  showMetaPanel: boolean;
  toggleHistoryPanel: () => void;
  toggleMetaPanel: () => void;
  createRun: (fp?: FlowPeriod) => void;
  /** 彻底清空当前工作区数据，不归档，直接重置为空白测次 */
  discardRun: () => void;
  updateRun: (u: Partial<Run>) => void;
  updateRunMeta: (rid: string, k: 'waterLevel' | 'location' | 'startTime' | 'endTime' | 'duration', v: string) => void;
  updateMeterFormula: (f: MeterFormula) => void;
  deleteRun: (rid: string) => void;
  loadRun: (rid: string) => void;
  addVertical: () => void;
  insertVerticalAfter: (aid: string) => void;
  updateVertical: (vid: string, u: Partial<Vertical>) => void;
  deleteVertical: (vid: string) => void;
  toggleVerticalExpand: (vid: string) => void;
  toggleVerticalResults: (vid: string) => void;
  updateMeasurePoint: (vid: string, pid: string, u: Partial<MeasurePoint>) => void;
  changeMeasureMethod: (vid: string, m: MeasureMethod) => void;
  changePeriod: (fp: FlowPeriod) => void;
  swapEdges: () => void;
  swapEdgeCoefficients: () => void;
  setLastAddedVerticalId: (id: string | null) => void;
  recalculate: () => void;
  exportData: () => Promise<void>;
  getProcessedRun: () => Run;
  markTime: (type: 'start' | 'end') => void;
  importBackup: (backupData: any) => void;
}

function calcAbs(wd: string, rd: string) { const w = +wd, r = +rd; return (!isNaN(w) && !isNaN(r)) ? (w * r).toFixed(2) : undefined; }

export const useHydroStore = create<HydroState>()(persist((set, get) => ({
  currentRun: createNewRun(1, 'open'), runs: [], expandedVerticalIds: new Set(), lastAddedVerticalId: null,
  showHistoryPanel: false,
  showMetaPanel: false,
  toggleHistoryPanel: () => set((s) => ({ showHistoryPanel: !s.showHistoryPanel })),
  toggleMetaPanel: () => set((s) => ({ showMetaPanel: !s.showMetaPanel })),
  setLastAddedVerticalId: (id) => set({ lastAddedVerticalId: id }),

  /**
   * 新建测次（保存并归档当前测次）— 递增测次号 + 新时间戳 + 继承位置/公式
   */
  createRun: (fp) => {
    const s = get();
    const maxNo = s.runs.reduce((max, r) => Math.max(max, parseInt(r.runNumber) || 0), 0);
    const nextNo = maxNo + 1;
    
    // 【强制深拷贝】彻底切断内存引用，防止修改联动和全量删除 Bug
    const currentToSave = JSON.parse(JSON.stringify(s.currentRun));
    const newRuns = s.currentRun.verticals.filter(v => v.type === 'measure').length > 0 
      ? [...s.runs, currentToSave] 
      : s.runs;

    const newRun: Run = {
      ...createNewRun(nextNo, fp || s.currentRun.flowPeriod),
      id: crypto.randomUUID(), // 【强制重新分配唯一ID】
      timestamp: new Date().toISOString(),
      startTime: '',
      endTime: '',
      duration: '',
      location: s.currentRun.location || '',
      meterFormula: { ...(s.currentRun.meterFormula || DEFAULT_METER_FORMULA) },
    };

    set({ currentRun: newRun, runs: newRuns, expandedVerticalIds: new Set(), lastAddedVerticalId: null });
  },

  /**
   * 彻底清空当前工作区数据 — 不归档，直接覆盖为空白测次
   * 用于"删除当前测流信息"防误触流程的确认操作
   */
  discardRun: () => {
    const s = get();
    const newRun: Run = {
      ...createNewRun(1, s.currentRun.flowPeriod),
      timestamp: new Date().toISOString(),
      location: '',
      meterFormula: { ...(s.currentRun.meterFormula || DEFAULT_METER_FORMULA) },
    };
    set({ currentRun: newRun, expandedVerticalIds: new Set(), lastAddedVerticalId: null });
  },

  updateRun: (u) => { set(s => ({ currentRun: { ...s.currentRun, ...u } })); get().recalculate(); },
  updateRunMeta: (rid, k, v) => set(s => s.currentRun.id === rid ? { currentRun: { ...s.currentRun, [k]: v } } : { runs: s.runs.map(r => r.id === rid ? { ...r, [k]: v } : r) }),
  updateMeterFormula: (f) => { set(s => ({ currentRun: { ...s.currentRun, meterFormula: f } })); get().recalculate(); },
  deleteRun: (rid) => {
    set(s => ({
      runs: s.runs.filter(r => r.id !== rid) // 由于 createRun 已经修复为唯一 ID，这里的过滤将绝对精准
    }));
  },

  loadRun: (rid) => {
    const r = get().runs.find(x => x.id === rid);
    if (!r) return;
    const cloned: Run = {
      ...r,
      verticals: r.verticals.map(v => ({
        ...v,
        measurePoints: v.measurePoints.map(mp => ({ ...mp })),
      })),
      meterFormula: r.meterFormula ? { ...r.meterFormula } : undefined,
    };
    set({
      currentRun: cloned,
      expandedVerticalIds: new Set(cloned.verticals.filter(v => v.type === 'measure').map(v => v.id)),
      lastAddedVerticalId: null,
    });
  },

  addVertical: () => {
    const s = get(), { verticals, flowPeriod } = s.currentRun;
    const ri = verticals.findIndex(v => v.type === 'edge' && v.name === '右水边');
    const li = verticals.findIndex(v => v.type === 'edge' && v.name === '左水边');
    const ins = ri >= 0 && li >= 0 ? Math.max(ri, li) : (ri >= 0 ? ri : (li >= 0 ? li : verticals.length - 1));
    const measures = verticals.filter(v => v.type === 'measure'), nn = measures.length + 1, pm = measures.length > 0 ? measures[measures.length - 1] : void 0;
    let autoDist = '';
    if (ins > 1) {
      const lastV = verticals[ins - 1], prevV = verticals[ins - 2];
      let step = Math.abs(parseFloat(lastV.startDistance) - parseFloat(prevV.startDistance));
      if (isNaN(step)) step = 5;
      const lastDist = parseFloat(lastV.startDistance);
      if (!isNaN(lastDist)) autoDist = (lastDist + step).toString();
    } else if (ins === 1) {
      const prevV = verticals[0];
      const lastDist = parseFloat(prevV.startDistance);
      if (!isNaN(lastDist)) autoDist = (lastDist + 5).toString();
    }

    const isIce = flowPeriod === 'ice';
    const deflCoeff = isIce ? '0.9' : (pm?.deflectionCoefficient || '1.0');
    const measureMethod = pm?.measureMethod || 'one_point';

    const nv = createMeasureVertical(nn, flowPeriod, measureMethod, deflCoeff);
    nv.startDistance = autoDist;

    if (isIce) {
      nv.measurePoints = nv.measurePoints.map(mp => ({
        ...mp,
        relativeDepth: '0.5',
        absoluteDepth: ((+nv.waterDepth || 0) * 0.5).toFixed(2),
      }));
    }

    const arr = [...verticals]; arr.splice(ins, 0, nv);
    set(s2 => ({ currentRun: { ...s2.currentRun, verticals: arr }, expandedVerticalIds: new Set([...s2.expandedVerticalIds, nv.id]), lastAddedVerticalId: nv.id }));
    get().recalculate();
  },

  insertVerticalAfter: (aid) => {
    const s = get(), { verticals, flowPeriod } = s.currentRun, ai = verticals.findIndex(v => v.id === aid); if (ai < 0) return;
    const t = verticals[ai]; if (t?.type === 'edge') return;

    const isIce = flowPeriod === 'ice';
    const deflCoeff = isIce ? '0.9' : (t.deflectionCoefficient || '1.0');

    const nv = createMeasureVertical(0, flowPeriod, t.measureMethod, deflCoeff);
    nv.startDistance = ''; nv.waterDepth = ''; nv.deflectionCoefficient = deflCoeff;

    if (isIce) {
      nv.measurePoints = nv.measurePoints.map(mp => ({
        ...mp,
        relativeDepth: '0.5',
        absoluteDepth: ((+nv.waterDepth || 0) * 0.5).toFixed(2),
      }));
    }

    const arr = [...verticals]; arr.splice(ai + 1, 0, nv);
    let mi = 0; const renum = arr.map(v => { if (v.type === 'measure') { mi++; return { ...v, verticalNumber: String(mi) } } return v });
    set(s2 => ({ currentRun: { ...s2.currentRun, verticals: renum }, expandedVerticalIds: new Set([...s2.expandedVerticalIds, nv.id]), lastAddedVerticalId: nv.id }));
    get().recalculate();
  },

  updateVertical: (vid, updates) => {
    set(s => {
      const t = s.currentRun.verticals.find(v => v.id === vid);
      if (!t) return { currentRun: { ...s.currentRun, verticals: s.currentRun.verticals.map(v => v.id === vid ? { ...v, ...updates } : v) } };
      if (t.type === 'measure' && updates.waterDepth !== undefined) {
        const depthVal = parseFloat(updates.waterDepth), oldDepth = parseFloat(t.waterDepth || '0');
        if (isNaN(depthVal)) return { currentRun: { ...s.currentRun, verticals: s.currentRun.verticals.map(v => v.id === vid ? { ...v, ...updates } : v) } };
        const fu: Partial<Vertical> = { ...updates };
        if (depthVal > 0 && depthVal < 0.2) {
          fu.measureMethod = 'one_point'; fu.deflectionCoefficient = '0.9';
          fu.measurePoints = [{ id: crypto.randomUUID(), relativeDepth: '0.5', absoluteDepth: (depthVal * 0.5).toFixed(2), mode: 'direct' as const, velocity: '', n: '', t: '100' }];
        } else if (depthVal >= 0.2 && oldDepth > 0 && oldDepth < 0.2) {
          fu.deflectionCoefficient = '1.0'; fu.measurePoints = createDefaultMeasurePoints('one_point', s.currentRun.flowPeriod);
        }
        const sp = fu.measurePoints || t.measurePoints;
        fu.measurePoints = sp.map(mp => { const rv = parseFloat(mp.relativeDepth || '0'); return isNaN(rv) ? mp : { ...mp, absoluteDepth: (depthVal * rv).toFixed(2) }; });
        return { currentRun: { ...s.currentRun, verticals: s.currentRun.verticals.map(v => v.id === vid ? { ...v, ...fu } : v) } };
      }
      return { currentRun: { ...s.currentRun, verticals: s.currentRun.verticals.map(v => v.id === vid ? { ...v, ...updates } : v) } };
    });
    get().recalculate();
  },

  deleteVertical: (vid) => { set(s => { const t = s.currentRun.verticals.find(v => v.id === vid); if (t?.type === 'edge') return s; const arr = s.currentRun.verticals.filter(v => v.id !== vid); let mi = 0; const rn = arr.map(v => { if (v.type === 'measure') { mi++; return { ...v, verticalNumber: String(mi) } } return v }); return { currentRun: { ...s.currentRun, verticals: rn }, expandedVerticalIds: new Set([...s.expandedVerticalIds].filter(id => id !== vid)), lastAddedVerticalId: null } }); get().recalculate(); },
  toggleVerticalExpand: (vid) => set(s => { const n = new Set(s.expandedVerticalIds); n.has(vid) ? n.delete(vid) : n.add(vid); return { expandedVerticalIds: n } }),
  toggleVerticalResults: (vid) => set(s => ({ currentRun: { ...s.currentRun, verticals: s.currentRun.verticals.map(v => v.id === vid ? { ...v, showResults: !v.showResults } : v) } })),

  updateMeasurePoint: (vid, pid, updates) => {
    set(s => {
      const v = s.currentRun.verticals.find(x => x.id === vid);
      if (!v || v.type !== 'measure') return { currentRun: { ...s.currentRun, verticals: s.currentRun.verticals.map(x => x.id === vid ? { ...x, measurePoints: x.measurePoints.map(mp => mp.id === pid ? { ...mp, ...updates } : mp) } : x) } };
      const hasUserAbs = updates.absoluteDepth !== undefined;
      const fu = { ...updates };
      if (!hasUserAbs && updates.relativeDepth !== undefined) { const a = calcAbs(v.waterDepth, updates.relativeDepth); if (a !== undefined) fu.absoluteDepth = a; }
      return { currentRun: { ...s.currentRun, verticals: s.currentRun.verticals.map(x => x.id === vid ? { ...x, measurePoints: x.measurePoints.map(mp => mp.id === pid ? { ...mp, ...fu } : mp) } : x) } };
    });
    get().recalculate();
  },

  changeMeasureMethod: (vid, method) => {
    const s = get(); const v = s.currentRun.verticals.find(x => x.id === vid); if (!v || v.type !== 'measure') return;
    const pts = createDefaultMeasurePoints(method, s.currentRun.flowPeriod);
    const wd = +v.waterDepth || 0;
    const withAbs = isNaN(wd) ? pts : pts.map(mp => { const r = +mp.relativeDepth; return isNaN(r) ? mp : { ...mp, absoluteDepth: (wd * r).toFixed(2) } });
    set(s2 => ({ currentRun: { ...s2.currentRun, verticals: s2.currentRun.verticals.map(x => x.id === vid ? { ...x, measureMethod: method, measurePoints: withAbs } : x) } }));
    get().recalculate();
  },

  changePeriod: (fp: FlowPeriod) => {
    set(s => {
      const { verticals, flowPeriod } = s.currentRun;
      if (fp === flowPeriod) return { currentRun: s.currentRun };

      const updatedVerticals = verticals.map(v => {
        if (v.type !== 'measure') return v;
        if (fp === 'ice') {
          const icePoints = v.measurePoints.map(mp => ({
            ...mp,
            relativeDepth: '0.5',
            absoluteDepth: ((+v.waterDepth || 0) * 0.5).toFixed(2),
          }));
          return { ...v, deflectionCoefficient: '0.9', measureMethod: 'one_point' as MeasureMethod, measurePoints: icePoints };
        } else {
          const openPoints = createDefaultMeasurePoints('one_point', 'open');
          return { ...v, deflectionCoefficient: '1.0', measureMethod: 'one_point' as MeasureMethod, measurePoints: openPoints };
        }
      });

      return { currentRun: { ...s.currentRun, flowPeriod: fp, verticals: updatedVerticals } };
    });
    get().recalculate();
  },

  swapEdges: () => set(s => { const a = [...s.currentRun.verticals]; const li = a.findIndex(v => v.type === 'edge' && v.name === '左水边'), ri = a.findIndex(v => v.type === 'edge' && v.name === '右水边'); if (li >= 0 && ri >= 0) { a[li] = { ...a[li], name: '右水边' }; a[ri] = { ...a[ri], name: '左水边' } } return { currentRun: { ...s.currentRun, verticals: a } } }),
  swapEdgeCoefficients: () => set(s => { const a = [...s.currentRun.verticals]; const li = a.findIndex(v => v.type === 'edge' && v.name === '左水边'), ri = a.findIndex(v => v.type === 'edge' && v.name === '右水边'); if (li >= 0 && ri >= 0) { const lc = a[li].shoreCoefficient, rc = a[ri].shoreCoefficient; a[li] = { ...a[li], shoreCoefficient: rc }; a[ri] = { ...a[ri], shoreCoefficient: lc } } return { currentRun: { ...s.currentRun, verticals: a } } }),

  recalculate: () => set(s => { return { currentRun: processRun({ ...s.currentRun }) } }),

  exportData: async () => { const p = processRun(get().currentRun); try { await downloadExcel(p); return } catch { } const b = new Blob(['csv'], { type: 'text/csv' }); const u = URL.createObjectURL(b); const a = document.createElement('a'); a.href = u; a.download = 'hydro.csv'; a.click(); URL.revokeObjectURL(u) },
  getProcessedRun: () => processRun(get().currentRun),

  markTime: (type) => {
    const s = get();
    const now = new Date();
    
    // 格式化为 MM/DD HH:mm (去掉了秒)
    const fmt = `${now.getMonth() + 1}/${now.getDate()} ${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
    
    if (type === 'start') {
      set({ currentRun: { ...s.currentRun, startTime: fmt, endTime: '', duration: '' } });
    } else {
      const startStr = s.currentRun.startTime;
      if (!startStr) return;
      
      // 解析历时 (支持跨天)
      const yyyy = now.getFullYear();
      const startMs = new Date(`${yyyy}/${startStr}`).getTime();
      const endMs = now.getTime();
      const diffMs = Math.max(0, endMs - startMs);
      
      const h = Math.floor(diffMs / 3600000).toString().padStart(2, '0');
      const m = Math.floor((diffMs % 3600000) / 60000).toString().padStart(2, '0');
      
      // 更新结束时间与历时
      set({ currentRun: { ...s.currentRun, endTime: fmt, duration: `${h}小时${m}分` } });
      
      // 【新增】：测流结束，强制刷新本地 LocalStorage 存档
      setTimeout(() => {
        const state = useHydroStore.getState();
        localStorage.setItem('hydrology-data', JSON.stringify({ state, version: 0 }));
      }, 100);
    }
  },

  importBackup: (backupData) => {
    try {
      if (backupData && backupData.currentRun && backupData.runs) {
        set({
          currentRun: backupData.currentRun,
          runs: backupData.runs,
          expandedVerticalIds: new Set(),
          lastAddedVerticalId: null
        });
        get().recalculate();
      }
    } catch (e) {
      console.error('导入失败', e);
    }
  },
}), { name: STORAGE_KEY, storage: createJSONStorage(() => localStorage, { reviver: (k, v) => k === 'expandedVerticalIds' && Array.isArray(v) ? new Set(v as unknown[]) : v, replacer: (k, v) => k === 'expandedVerticalIds' && v instanceof Set ? [...v] : v }), partialize: (s) => ({ currentRun: s.currentRun, runs: s.runs }) }));

/**
 * 水文测验数据状态管理 v4.1
 *
 * v4.1 变更：
 *   - 新增 exportCurrentRunJSON：单击测次分享（仅打包当前工作区测次为纯净 JSON）
 *   - 重构 importBackup：智能嗅探全量旧备份 vs 单测次分享包，支持双格式导入
 *
 * v4 变更：
 *   - 冰期默认值强锁：addVertical / insertVerticalAfter / changePeriod 中 flowPeriod === 'ice' 时，
 *     新增垂线 deflectionCoefficient 强锁 '0.9'，relativeDepth 强锁 '0.5'
 *   - 新增 changePeriod 动作：切换测流期并同步修正全部测速垂线默认值
 *   - 新增 discardRun 动作：彻底清空当前工作区（不归档），用于防误触删除流程
 */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { Preferences } from '@capacitor/preferences';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { Run, Vertical, MeasurePoint, FlowPeriod, MeasureMethod, MeterFormula } from '../types';
import { createNewRun, createMeasureVertical, processRun, createDefaultMeasurePoints } from '../lib/HydroEngine';
import { DEFAULT_METER_FORMULA } from '../types';
import { downloadExcel } from '../lib/exportExcel';

const STORAGE_KEY = 'hydrology-data';
const TEMPLATES_KEY = 'hydrology-templates';

/** 断面模板：仅存几何参数，严禁存流速/水深/冰厚等实测值 */
export interface SectionTemplate {
  id: string;
  name: string;
  createdAt: number;
  leftBankCoefficient: string;
  rightBankCoefficient: string;
  verticals: Array<{
    id: string;
    type: Vertical['type'];
    name?: string;
    startDistance: string;
    measureMethod: MeasureMethod;
    deflectionCoefficient?: string;
    shoreCoefficient?: string;
    waterDepth: '';                          // 强制置空
    iceThickness: '';                        // 强制置空
    waterIceThickness: '';                   // 强制置空
    iceFlowerThickness: '';                  // 强制置空
    measurePoints: Array<{
      id: string;
      relativeDepth: string;
      mode: string;
      velocity: '';                          // 强制置空
      absoluteDepth: '';                     // 强制置空
      n: '';                                 // 强制置空
      t: '';                                 // 强制置空
    }>;
  }>;
}

interface HydroState {
  currentRun: Run; runs: Run[]; expandedVerticalIds: Set<string>; lastAddedVerticalId: string | null;
  /** 水合完成标志：防止 Capacitor 原生端白屏闪烁 */
  _hasHydrated: boolean;
  setHasHydrated: (state: boolean) => void;
  /** Dashboard 与 HydroTable 之间的面板通信 */
  showHistoryPanel: boolean;
  showMetaPanel: boolean;
  toggleHistoryPanel: () => void;
  toggleMetaPanel: () => void;
  createRun: (fp?: FlowPeriod) => void;
  /** 彻底清空当前工作区数据，不归档，直接重置为空白测次 */
  discardRun: () => void;
  updateRun: (u: Partial<Run>) => void;
  updateRunMeta: (rid: string, k: 'waterLevel' | 'location' | 'startTime' | 'endTime' | 'duration' | 'timestamp', v: string) => void;
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
  exportCurrentRunJSON: () => void;
  getProcessedRun: () => Run;
  markTime: (type: 'start' | 'end') => void;
  importBackup: (backupData: any) => void;
  /** 断面模板引擎 */
  saveTemplate: () => SectionTemplate;
  deleteTemplate: (id: string) => void;
  loadTemplate: (template: SectionTemplate) => void;
}

/** 无损继承：按 relativeDepth 将旧测点中的用户录入数据合并到新模板点中 */
function mergeByRelativeDepth(newPts: MeasurePoint[], oldPts: MeasurePoint[]): MeasurePoint[] {
  return newPts.map(newPt => {
    const oldPt = oldPts.find(op => op.relativeDepth === newPt.relativeDepth);
    if (oldPt) {
      return { ...newPt, velocity: oldPt.velocity, n: oldPt.n, t: oldPt.t, mode: oldPt.mode, id: oldPt.id };
    }
    return newPt;
  });
}

function calcAbs(wd: string, rd: string) { const w = +wd, r = +rd; return (!isNaN(w) && !isNaN(r)) ? (w * r).toFixed(2) : undefined; }

/** 自定义跨端存储引擎：原生走 Capacitor Preferences，浏览器降级回 localStorage */
const capacitorStorage = {
  getItem: async (name: string): Promise<string | null> => {
    if (Capacitor.isNativePlatform()) {
      const { value } = await Preferences.get({ key: name });
      return value;
    }
    return localStorage.getItem(name);
  },
  setItem: async (name: string, value: string): Promise<void> => {
    if (Capacitor.isNativePlatform()) {
      await Preferences.set({ key: name, value });
    } else {
      localStorage.setItem(name, value);
    }
  },
  removeItem: async (name: string): Promise<void> => {
    if (Capacitor.isNativePlatform()) {
      await Preferences.remove({ key: name });
    } else {
      localStorage.removeItem(name);
    }
  },
};

export const useHydroStore = create<HydroState>()(persist((set, get) => ({
  currentRun: createNewRun(1, 'open'), runs: [], expandedVerticalIds: new Set(), lastAddedVerticalId: null,
  _hasHydrated: false,
  setHasHydrated: (state) => set({ _hasHydrated: state }),
  showHistoryPanel: false,
  showMetaPanel: false,
  toggleHistoryPanel: () => set((s) => ({ showHistoryPanel: !s.showHistoryPanel })),
  toggleMetaPanel: () => set((s) => ({ showMetaPanel: !s.showMetaPanel })),
  setLastAddedVerticalId: (id) => set({ lastAddedVerticalId: id }),

  /**
   * 1. 新建测次：自动解毒历史脏数据 + 纯净默认名称
   */
  createRun: (fp) => {
    const s = get();
    // 🚨 自动修复历史遗留的克隆ID（核心解毒剂）
    const seenIds = new Set();
    let newRuns = s.runs.map(r => {
      if (seenIds.has(r.id)) return { ...r, id: crypto.randomUUID() };
      seenIds.add(r.id);
      return r;
    });

    // 1. 保存当前工作区
    const currentToSave = JSON.parse(JSON.stringify(s.currentRun));
    const existIdx = newRuns.findIndex(r => r.id === currentToSave.id);
    const hasMeasure = currentToSave.verticals.some((v: any) => v.type === 'measure');
    if (existIdx >= 0) {
      newRuns[existIdx] = currentToSave;
    } else if (hasMeasure) {
      newRuns.push(currentToSave);
    }

    // 2. 获取绝对最大序号
    const maxNo = newRuns.reduce((max, r) => Math.max(max, parseInt(String(r.runNumber)) || 0), 0);
    const nextNo = maxNo + 1;
    
    // 3. 智能默认名称：永远寻找干净的 "未知断面N"
    let counter = 1;
    while (newRuns.some(r => r.location === `未知断面${counter}`)) {
      counter++;
    }
    const newLocation = `未知断面${counter}`;

    const newRun: Run = {
      ...createNewRun(nextNo, fp || s.currentRun.flowPeriod),
      id: crypto.randomUUID(), 
      timestamp: new Date().toISOString(),
      startTime: '',
      endTime: '',
      duration: '',
      location: newLocation,
      meterFormula: { ...(s.currentRun.meterFormula || DEFAULT_METER_FORMULA) },
    };

    set({ currentRun: newRun, runs: newRuns, expandedVerticalIds: new Set(), lastAddedVerticalId: null });
  },

  /**
   * 2. 清空工作区：同样分配未知断面N
   */
  discardRun: () => {
    const s = get();
    const maxNo = s.runs.reduce((max, r) => Math.max(max, parseInt(String(r.runNumber)) || 0), 0);
    let counter = 1;
    while (s.runs.some(r => r.location === `未知断面${counter}`)) counter++;
    
    const newRun: Run = {
      ...createNewRun(maxNo + 1, s.currentRun.flowPeriod),
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      location: `未知断面${counter}`,
      meterFormula: { ...(s.currentRun.meterFormula || DEFAULT_METER_FORMULA) },
    };
    set({ currentRun: newRun, expandedVerticalIds: new Set(), lastAddedVerticalId: null });
  },

  updateRun: (u) => { set(s => ({ currentRun: { ...s.currentRun, ...u } })); get().recalculate(); },
  
  /** 
   * 3. 元数据更新：智能重名避让引擎 
   */
  updateRunMeta: (rid, k, v) => {
    set(s => {
      let finalV = v;
      // 🚨 如果修改的是断面名称，触发智能重名避让（如：郑家屯重名 -> 郑家屯测次1）
      if (k === 'location' && v.trim() !== '') {
        const otherRuns = s.runs.filter(r => r.id !== rid);
        let testV = v;
        let counter = 1;
        while (otherRuns.some(r => r.location === testV)) {
          testV = `${v}测次${counter}`;
          counter++;
        }
        finalV = testV;
      }

      if (s.currentRun.id === rid) return { currentRun: { ...s.currentRun, [k]: finalV } };
      return { runs: s.runs.map(r => r.id === rid ? { ...r, [k]: finalV } : r) };
    });
    get().recalculate(); 
  },
  
  updateMeterFormula: (f) => { set(s => ({ currentRun: { ...s.currentRun, meterFormula: f } })); get().recalculate(); },
  
  /**
   * 4. 彻底安全的删除逻辑：含旧数据解毒机制
   */
  deleteRun: (rid) => {
    set(s => {
      // 🚨 在过滤前，先对可能存在的历史脏数据进行解毒
      const seen = new Set();
      const repairedRuns = s.runs.map(r => {
        if (seen.has(r.id)) return { ...r, id: crypto.randomUUID() };
        seen.add(r.id);
        return r;
      });

      const newRuns = repairedRuns.filter(r => r.id !== rid);
      
      // 如果删除的是当前区，重新分配干净的未知断面
      if (s.currentRun.id === rid) {
        const maxNo = newRuns.reduce((max, r) => Math.max(max, parseInt(String(r.runNumber)) || 0), 0);
        let counter = 1;
        while (newRuns.some(r => r.location === `未知断面${counter}`)) counter++;
        
        const resetRun: Run = {
          ...createNewRun(maxNo + 1, s.currentRun.flowPeriod),
          id: crypto.randomUUID(),
          timestamp: new Date().toISOString(),
          location: `未知断面${counter}`,
          meterFormula: { ...(s.currentRun.meterFormula || DEFAULT_METER_FORMULA) },
        };
        return { runs: newRuns, currentRun: resetRun, expandedVerticalIds: new Set(), lastAddedVerticalId: null };
      }
      return { runs: newRuns };
    });
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
          const shallowPts = [{ id: crypto.randomUUID(), relativeDepth: '0.5', absoluteDepth: (depthVal * 0.5).toFixed(2), mode: 'direct' as const, velocity: '', n: '', t: '100' }];
          fu.measurePoints = mergeByRelativeDepth(shallowPts, t.measurePoints || []);
        } else if (depthVal >= 0.2 && oldDepth > 0 && oldDepth < 0.2) {
          fu.deflectionCoefficient = '1.0';
          const recoveryPts = createDefaultMeasurePoints('one_point', s.currentRun.flowPeriod);
          fu.measurePoints = mergeByRelativeDepth(recoveryPts, t.measurePoints || []);
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
    const mergedPts = mergeByRelativeDepth(pts, v.measurePoints || []);
    const wd = +v.waterDepth || 0;
    const withAbs = isNaN(wd) ? mergedPts : mergedPts.map(mp => { const r = +mp.relativeDepth; return isNaN(r) ? mp : { ...mp, absoluteDepth: (wd * r).toFixed(2) } });
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
          const iceTemplate = createDefaultMeasurePoints('one_point', 'ice');
          const icePoints = mergeByRelativeDepth(iceTemplate, v.measurePoints || []);
          const iceWithAbs = icePoints.map(mp => ({
            ...mp,
            absoluteDepth: ((+v.waterDepth || 0) * (+mp.relativeDepth || 0.5)).toFixed(2),
          }));
          return { ...v, deflectionCoefficient: '0.9', measureMethod: 'one_point' as MeasureMethod, measurePoints: iceWithAbs };
        } else {
          const openTemplate = createDefaultMeasurePoints('one_point', 'open');
          const openPoints = mergeByRelativeDepth(openTemplate, v.measurePoints || []);
          return { ...v, deflectionCoefficient: '1.0', measureMethod: 'one_point' as MeasureMethod, measurePoints: openPoints };
        }
      });

      return { currentRun: { ...s.currentRun, flowPeriod: fp, verticals: updatedVerticals } };
    });
    get().recalculate();
  },

  swapEdges: () => set(s => { const a = [...s.currentRun.verticals]; const li = a.findIndex(v => v.type === 'edge' && v.name === '左水边'), ri = a.findIndex(v => v.type === 'edge' && v.name === '右水边'); if (li >= 0 && ri >= 0) { a[li] = { ...a[li], name: '右水边' }; a[ri] = { ...a[ri], name: '左水边' } } return { currentRun: { ...s.currentRun, verticals: a } } }),
  swapEdgeCoefficients: () => set(s => { const a = [...s.currentRun.verticals]; const li = a.findIndex(v => v.type === 'edge' && v.name === '左水边'), ri = a.findIndex(v => v.type === 'edge' && v.name === '右水边'); if (li >= 0 && ri >= 0) { const lc = a[li].shoreCoefficient, rc = a[ri].shoreCoefficient; a[li] = { ...a[li], shoreCoefficient: rc }; a[ri] = { ...a[ri], shoreCoefficient: lc } } return { currentRun: { ...s.currentRun, verticals: a } } }),

  /**
   * 【重构】自动无缝镜像引擎：每次触发重算时，自动将最新状态覆盖到历史列表中
   */
  recalculate: () => set(s => { 
    const processed = processRun({ ...s.currentRun });
    const newRuns = [...s.runs];
    const existIdx = newRuns.findIndex(r => r.id === processed.id);
    
    // 只有当存在有效测速数据时，才进行历史列表的同步
    const hasData = processed.verticals.some((v: any) => v.type === 'measure');
    if (existIdx >= 0) {
      newRuns[existIdx] = processed;
    } else if (hasData) {
      newRuns.push(processed);
    }
    
    return { currentRun: processed, runs: newRuns };
  }),

  exportData: async () => { 
    try { 
      // 🚨 无需再传入任何参数，downloadExcel 会自行去 Store 提货
      await downloadExcel(); 
      return; 
    } catch (e) {
      console.error("模板导出失败，启动 CSV 备用机制", e);
    } 
    const b = new Blob(['csv'], { type: 'text/csv' }); 
    const u = URL.createObjectURL(b); 
    const a = document.createElement('a'); 
    a.href = u; 
    a.download = 'hydro.csv'; 
    a.click(); 
    URL.revokeObjectURL(u); 
  },

  /**
   * 【原生 JSON 导出】使用 Capacitor Filesystem 写入临时文件后唤起系统原生分享面板。
   * 废弃了 Web 端 document.createElement('a') + URL.createObjectURL 方案，
   * 因为该方案在 Android/iOS WebView 中会被拦截，无法触发下载。
   */
  exportCurrentRunJSON: async () => {
    try {
      const { currentRun } = get();
      const pureRun = JSON.parse(JSON.stringify(currentRun));
      const dataStr = JSON.stringify(pureRun, null, 2);

      // 命名规则：地点_YYYYMMDDHHmm.json（与 Excel 导出规则一致）
      const d = new Date(currentRun.timestamp);
      let timeMark = String(Date.now());
      if (!isNaN(d.getTime())) {
        timeMark = d.toLocaleString('zh-CN', {
          year: 'numeric', month: '2-digit', day: '2-digit',
          hour: '2-digit', minute: '2-digit', second: '2-digit',
          hour12: false
        }).replace(/\D/g, '').substring(0, 12);
      }
      const locName = currentRun.location?.trim() || '未知断面';
      const fileName = `${locName}_${timeMark}.json`;

      // Step 1: 将 JSON 字符串写入设备 Cache 目录下的临时文件（writeFile 直接返回 uri）
      const writeResult = await Filesystem.writeFile({
        path: fileName,
        data: dataStr,
        directory: Directory.Cache,
        encoding: Encoding.UTF8,
      });

      // Step 2: 唤起 iOS/Android 原生系统分享面板
      await Share.share({
        url: writeResult.uri,
      });

      // Step 4: 分享完成后清理临时文件（不阻塞返回）
      Filesystem.deleteFile({
        path: fileName,
        directory: Directory.Cache,
      }).catch(() => {
        // 静默处理删除失败：Cache 目录文件会在系统空间紧张时自动清理
      });
    } catch (err) {
      console.error('原生分享 JSON 失败，降级为 Web 下载:', err);
      // 降级兜底：浏览器 PWA 环境或 Capacitor 插件不可用时回退至传统下载
      const { currentRun } = get();
      const pureRun = JSON.parse(JSON.stringify(currentRun));
      const dataStr = JSON.stringify(pureRun, null, 2);
      const blob = new Blob([dataStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const d = new Date(currentRun.timestamp);
      let timeMark = String(Date.now());
      if (!isNaN(d.getTime())) {
        timeMark = d.toLocaleString('zh-CN', {
          year: 'numeric', month: '2-digit', day: '2-digit',
          hour: '2-digit', minute: '2-digit', second: '2-digit',
          hour12: false
        }).replace(/\D/g, '').substring(0, 12);
      }
      const locName = currentRun.location?.trim() || '未知断面';
      a.download = `${locName}_${timeMark}.json`;
      a.click();
      URL.revokeObjectURL(url);
    }
  },

  getProcessedRun: () => processRun(get().currentRun),

  markTime: (type) => {
    const s = get();
    const now = new Date();
    const fmt = `${now.getMonth() + 1}/${now.getDate()} ${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
    
    if (type === 'start') {
      // 联动更新 timestamp 为当前 ISO，供面板时间选择器使用
      set({ currentRun: { ...s.currentRun, startTime: fmt, endTime: '', duration: '', timestamp: now.toISOString() } });
      get().recalculate(); // 强制触发同步
    } else {
      const startStr = s.currentRun.startTime;
      if (!startStr) return;
      const yyyy = now.getFullYear();
      const startMs = new Date(`${yyyy}/${startStr}`).getTime();
      const endMs = now.getTime();
      const diffMs = Math.max(0, endMs - startMs);
      
      const h = Math.floor(diffMs / 3600000).toString().padStart(2, '0');
      const m = Math.floor((diffMs % 3600000) / 60000).toString().padStart(2, '0');
      
      set({ currentRun: { ...s.currentRun, endTime: fmt, duration: `${h}小时${m}分` } });
      get().recalculate(); // 强制触发同步
      
      setTimeout(() => {
        const state = useHydroStore.getState();
        localStorage.setItem('hydrology-data', JSON.stringify({ state, version: 0 }));
      }, 100);
    }
  },

  // 【重构】智能导入引擎：兼容老版全量库 & 新版单测次分享包
  importBackup: (backupData) => {
    try {
      if (!backupData) return;
      const s = get();
      const currentRuns = [...s.runs];
      const seenLocations = new Set(currentRuns.map(r => r.location?.trim() || ''));
      
      let runsToImport: any[] = [];

      // 嗅探 1：如果是包含 runs 的全量旧备份
      if (backupData.runs && Array.isArray(backupData.runs)) {
        runsToImport = [...backupData.runs];
        if (backupData.currentRun && backupData.currentRun.verticals) {
          runsToImport.push(backupData.currentRun);
        }
      } 
      // 嗅探 2：如果是同事分享的单测次包 (包含 verticals 数组)
      else if (backupData.verticals && Array.isArray(backupData.verticals)) {
        runsToImport.push(backupData);
      } else {
        console.warn("无法识别的文件格式");
        return;
      }

      // 追加处理：颁发新身份证 + 智能避让重名
      const appendedRuns = runsToImport.map((r: any) => {
        let safeLoc = (r.location || '未知断面').trim();
        if (seenLocations.has(safeLoc)) {
          let counter = 1;
          let testLoc = `${safeLoc}测次${counter}`;
          while (seenLocations.has(testLoc)) {
            counter++;
            testLoc = `${safeLoc}测次${counter}`;
          }
          safeLoc = testLoc;
        }
        seenLocations.add(safeLoc);

        // 绝对隔绝克隆病毒，变为全新测次
        return { ...r, id: crypto.randomUUID(), location: safeLoc };
      });

      if (appendedRuns.length > 0) {
        // 将最新导入的一个测次直接设为 currentRun，方便用户导入后立刻查看
        const importedRun = appendedRuns[appendedRuns.length - 1];
        set({ 
          runs: [...currentRuns, ...appendedRuns],
          currentRun: importedRun,
          expandedVerticalIds: new Set(),
          lastAddedVerticalId: null
        });
        get().recalculate(); 
      }
    } catch (e) {
      console.error('导入失败', e);
    }
  },

  /** 【断面模板引擎 v2】保存：深拷贝 → 数据清洗（流速/水深/冰厚置空） → 持久化 */
  saveTemplate: () => {
    const { currentRun } = get();
    // 深拷贝所有垂线
    const clonedVerticals: any[] = JSON.parse(JSON.stringify(currentRun.verticals));
    // 数据清洗：保留 id, startDistance, measureMethod, deflectionCoefficient, shoreCoefficient, type, name
    //            必须将 waterDepth, iceThickness, waterIceThickness, iceFlowerThickness 置空
    //            遍历 measurePoints，保留 id, relativeDepth, mode，将 velocity, absoluteDepth, n, t 置空
    const cleanedVerticals = clonedVerticals.map((v: any) => {
      const base: any = {
        id: v.id,
        type: v.type,
        name: v.name,
        startDistance: v.startDistance,
        measureMethod: v.measureMethod,
        deflectionCoefficient: v.deflectionCoefficient,
        shoreCoefficient: v.shoreCoefficient,
        waterDepth: v.waterDepth || '',          // 📐 仅保留几何水深
        iceThickness: '',                        // 模板不记录冰厚
        waterIceThickness: '',                   // 模板不记录水浸
        iceFlowerThickness: '',                  // 模板不记录冰花
        measurePoints: (v.measurePoints || []).map((mp: any) => ({
          id: mp.id,
          relativeDepth: mp.relativeDepth,
          mode: mp.mode || 'direct',
          velocity: '',
          absoluteDepth: '',
          n: '',
          t: '',
        })),
      };
      return base;
    });

    // 提取左右岸系数（从第一条/最后一条 edge 垂线）
    const leftEdge = currentRun.verticals.find(v => v.type === 'edge' && v.name === '左水边');
    const rightEdge = currentRun.verticals.find(v => v.type === 'edge' && v.name === '右水边');

    const template: SectionTemplate = {
      id: crypto.randomUUID(),
      name: currentRun.location?.trim() || '未命名断面',
      createdAt: Date.now(),
      leftBankCoefficient: leftEdge?.shoreCoefficient || '0.70',
      rightBankCoefficient: rightEdge?.shoreCoefficient || '0.70',
      verticals: cleanedVerticals,
    };

    const raw = localStorage.getItem(TEMPLATES_KEY);
    const existing: SectionTemplate[] = raw ? JSON.parse(raw) : [];
    existing.unshift(template);
    localStorage.setItem(TEMPLATES_KEY, JSON.stringify(existing));
    return template;
  },

  /** 删除指定模板 */
  deleteTemplate: (id: string) => {
    const raw = localStorage.getItem(TEMPLATES_KEY);
    if (!raw) return;
    const existing: SectionTemplate[] = JSON.parse(raw);
    localStorage.setItem(TEMPLATES_KEY, JSON.stringify(existing.filter(t => t.id !== id)));
  },

  /** 【载入模板 v2】使用 set 方法直接完整覆盖 currentRun，强制深拷贝触发 React 重渲染 */
  loadTemplate: (template: SectionTemplate) => {
    // 深拷贝模板垂线，确保不与原对象共享引用
    const clonedVerticals = JSON.parse(JSON.stringify(template.verticals));
    // 保留原有 waterfrontDepth / ice 等动态计算属性为空
    const restoredVerticals: Vertical[] = clonedVerticals.map((v: any) => ({
      ...v,
      // 确保必填字段存在
      verticalNumber: v.verticalNumber || '',
      waterDepth: v.waterDepth || '',
      measureMethod: v.measureMethod || 'one_point',
      measurePoints: (v.measurePoints || []).map((mp: any) => ({
        id: mp.id || crypto.randomUUID(),
        relativeDepth: mp.relativeDepth,
        mode: mp.mode || 'direct',
        velocity: mp.velocity || '',
        absoluteDepth: mp.absoluteDepth || '',
        n: mp.n || '',
        t: mp.t || '',
      })),
    }));

    // 使用 set 直接覆盖 currentRun，强制 React 重渲染
    set((state) => ({
      currentRun: {
        ...state.currentRun,
        leftBankCoefficient: template.leftBankCoefficient,
        rightBankCoefficient: template.rightBankCoefficient,
        location: template.name,
        verticals: restoredVerticals,
      },
      expandedVerticalIds: new Set(restoredVerticals.filter(v => v.type === 'measure').map(v => v.id)),
    }));
    get().recalculate();
  },
}), { 
  name: STORAGE_KEY,
  storage: createJSONStorage(() => capacitorStorage, { 
    reviver: (k, v) => k === 'expandedVerticalIds' && Array.isArray(v) ? new Set(v as unknown[]) : v, 
    replacer: (k, v) => k === 'expandedVerticalIds' && v instanceof Set ? [...v] : v 
  }), 
  partialize: (s) => ({ currentRun: s.currentRun, runs: s.runs }),
  onRehydrateStorage: () => (state) => {
    if (state) {
      state.setHasHydrated(true);
    }
  },
}));

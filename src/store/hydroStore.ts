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
import { DEFAULT_METER_FORMULA, DEFAULT_SHORE_COEFFICIENT } from '../types';
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
    verticalNumber?: string;
    startDistance: string;
    measureMethod: MeasureMethod;
    deflectionCoefficient?: string;
    shoreCoefficient?: string;
    waterDepth: string;                      // 可保留断面几何水深
    iceThickness: '';                        // 强制置空
    waterIceThickness: '';                   // 强制置空
    iceFlowerThickness: '';                  // 强制置空
    measurePoints: Array<{
      id: string;
      relativeDepth: string;
      mode: MeasurePoint['mode'];
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
  importBackup: (backupData: unknown) => void;
  /** 工作台隔离机制 */
  isDirty: boolean;
  commitCurrentRun: (mode: 'overwrite' | 'new') => void;
  revertCurrentRun: () => void;
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

function calcAbs(wd: string, rd: string): string | undefined {
  if (wd.trim() === '' || rd.trim() === '') return undefined;
  const w = Number(wd);
  const r = Number(rd);
  return Number.isFinite(w) && Number.isFinite(r) ? (w * r).toFixed(2) : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function stringValue(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return fallback;
}

function optionalString(value: unknown): string | undefined {
  const parsed = stringValue(value);
  return parsed === '' ? undefined : parsed;
}

function measureMethodValue(value: unknown): MeasureMethod {
  return value === 'two_point' || value === 'three_point' || value === 'five_point' || value === 'six_point'
    ? value
    : 'one_point';
}

function normalizeMeasurePoint(value: unknown): MeasurePoint | null {
  if (!isRecord(value)) return null;
  return {
    id: stringValue(value.id, crypto.randomUUID()),
    relativeDepth: stringValue(value.relativeDepth),
    velocity: stringValue(value.velocity),
    mode: value.mode === 'formula' ? 'formula' : 'direct',
    n: optionalString(value.n),
    t: optionalString(value.t),
    absoluteDepth: optionalString(value.absoluteDepth),
    absolutePosition: optionalString(value.absolutePosition),
  };
}

function normalizeVertical(value: unknown, index: number): Vertical | null {
  if (!isRecord(value)) return null;
  const type: Vertical['type'] = value.type === 'edge' || stringValue(value.name).includes('水边') ? 'edge' : 'measure';
  const measurePoints = Array.isArray(value.measurePoints)
    ? value.measurePoints.map(normalizeMeasurePoint).filter((point): point is MeasurePoint => point !== null)
    : [];
  const samplerType = value.samplerType === 'horizontal' || value.samplerType === 'bottle' || value.samplerType === 'other'
    ? value.samplerType
    : undefined;
  return {
    id: stringValue(value.id, crypto.randomUUID()),
    verticalNumber: stringValue(value.verticalNumber, type === 'edge' ? '' : String(index + 1)),
    startDistance: stringValue(value.startDistance),
    waterDepth: stringValue(value.waterDepth, type === 'edge' ? '0' : ''),
    measureMethod: measureMethodValue(value.measureMethod),
    measurePoints,
    type,
    name: optionalString(value.name),
    interval: optionalString(value.interval),
    shoreCoefficient: optionalString(value.shoreCoefficient),
    deflectionCoefficient: optionalString(value.deflectionCoefficient),
    iceThickness: optionalString(value.iceThickness),
    waterIceThickness: optionalString(value.waterIceThickness),
    iceFlowerThickness: optionalString(value.iceFlowerThickness),
    samplerType,
    singleSampleConc: optionalString(value.singleSampleConc),
    sandBucketNo: optionalString(value.sandBucketNo),
    sandBucketWeight: optionalString(value.sandBucketWeight),
    sampleVolume: optionalString(value.sampleVolume),
    effectiveDepth: optionalString(value.effectiveDepth),
    meanVelocity: optionalString(value.meanVelocity),
    correctedVelocity: optionalString(value.correctedVelocity),
    partialArea: optionalString(value.partialArea),
    partialDischarge: optionalString(value.partialDischarge),
    partialMeanVelocity: optionalString(value.partialMeanVelocity),
    totalSedimentDischarge: optionalString(value.totalSedimentDischarge),
    meanSedimentConc: optionalString(value.meanSedimentConc),
    isExpanded: typeof value.isExpanded === 'boolean' ? value.isExpanded : undefined,
    showResults: typeof value.showResults === 'boolean' ? value.showResults : undefined,
  };
}

function normalizeImportedRun(value: unknown): Run | null {
  if (!isRecord(value) || !Array.isArray(value.verticals)) return null;
  const flowPeriod: FlowPeriod = value.flowPeriod === 'ice' ? 'ice' : 'open';
  const base = createNewRun(1, flowPeriod);
  const verticals = value.verticals
    .map(normalizeVertical)
    .filter((vertical): vertical is Vertical => vertical !== null);
  const meterFormula = isRecord(value.meterFormula)
    && typeof value.meterFormula.k === 'number'
    && Number.isFinite(value.meterFormula.k)
    && typeof value.meterFormula.c === 'number'
    && Number.isFinite(value.meterFormula.c)
    ? { k: value.meterFormula.k, c: value.meterFormula.c }
    : { ...DEFAULT_METER_FORMULA };
  const defaultSamplerType = value.defaultSamplerType === 'horizontal'
    || value.defaultSamplerType === 'bottle'
    || value.defaultSamplerType === 'other'
    ? value.defaultSamplerType
    : undefined;
  return {
    ...base,
    id: stringValue(value.id, crypto.randomUUID()),
    parentId: optionalString(value.parentId),
    runNumber: stringValue(value.runNumber, '1'),
    timestamp: stringValue(value.timestamp, new Date().toISOString()),
    flowPeriod,
    verticals: verticals.length > 0 ? verticals : base.verticals,
    leftBankCoefficient: stringValue(value.leftBankCoefficient, DEFAULT_SHORE_COEFFICIENT),
    rightBankCoefficient: stringValue(value.rightBankCoefficient, DEFAULT_SHORE_COEFFICIENT),
    waterLevel: optionalString(value.waterLevel),
    location: optionalString(value.location),
    meterFormula,
    sedimentEnabled: typeof value.sedimentEnabled === 'boolean' ? value.sedimentEnabled : undefined,
    defaultSamplerType,
    defaultSampleVolume: optionalString(value.defaultSampleVolume),
    totalDischarge: optionalString(value.totalDischarge),
    totalArea: optionalString(value.totalArea),
    meanVelocity: optionalString(value.meanVelocity),
    surfaceWidth: optionalString(value.surfaceWidth),
    maxDepth: optionalString(value.maxDepth),
    maxVelocity: optionalString(value.maxVelocity),
    totalSedimentDischarge: optionalString(value.totalSedimentDischarge),
    meanSedimentConc: optionalString(value.meanSedimentConc),
    startTime: optionalString(value.startTime),
    endTime: optionalString(value.endTime),
    duration: optionalString(value.duration),
  };
}

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
  isDirty: false,
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
    let newRuns = [...s.runs];
    
    // 🚨 防呆机制：如果有未保存的修改，静默快照并建立亲子绑定关系
    const hasMeasure = s.currentRun.verticals.some((v) => v.type === 'measure');
    if (s.isDirty && hasMeasure) {
      const snapshot = JSON.parse(JSON.stringify(s.currentRun));
      const existIdx = newRuns.findIndex(r => r.id === snapshot.id);
      if (existIdx >= 0) {
        // 历史草稿防丢：静默另存为未归档副本，自动避让同名草稿
        const baseLocation = (snapshot.location || '未知断面').replace('_未归档', '').trim();
        const otherRuns = newRuns.filter(r => r.id !== snapshot.id);
        let finalLocation = baseLocation + '_未归档';
        let counter = 1;
        while (otherRuns.some(r => r.location === finalLocation)) {
          finalLocation = `${baseLocation}测次${counter}_未归档`;
          counter++;
        }
        snapshot.parentId = s.currentRun.id;
        snapshot.id = crypto.randomUUID();
        snapshot.location = finalLocation;
        newRuns.push(snapshot);
      } else {
        // 全新测次防丢：直接归档，同样静默避让已有重名
        const baseLocation = (snapshot.location || '未知断面').trim();
        const otherRuns = newRuns.filter(r => r.id !== snapshot.id);
        let finalLocation = baseLocation;
        let counter = 1;
        while (otherRuns.some(r => r.location === finalLocation)) {
          finalLocation = `${baseLocation}测次${counter}`;
          counter++;
        }
        snapshot.id = crypto.randomUUID();
        snapshot.location = finalLocation;
        newRuns.push(snapshot);
      }
    }

    // 🚨 自动修复历史遗留的克隆ID
    const seenIds = new Set();
    newRuns = newRuns.map(r => {
      if (seenIds.has(r.id)) return { ...r, id: crypto.randomUUID() };
      seenIds.add(r.id);
      return r;
    });

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

    set({ currentRun: newRun, runs: newRuns, expandedVerticalIds: new Set(), lastAddedVerticalId: null, isDirty: false });
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
   * 3. 元数据更新：纯净手输原样，不干扰用户键盘打字输入
   */
  updateRunMeta: (rid, k, v) => {
    set(s => {
      if (s.currentRun.id === rid) return { currentRun: { ...s.currentRun, [k]: v } };
      return { runs: s.runs.map(r => r.id === rid ? { ...r, [k]: v } : r) };
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
    
    // 🚀 核心剥离：载入工作区时，强行用正则洗掉 location 里的 "测次N" 和 "_未归档" 后缀
    // 确保折叠面板输入框里 100% 永远是用户手打的最干净位置，拒接任何后缀污染
    cloned.location = (cloned.location || '')
      .replace(/测次\d+/g, '')
      .replace('_未归档', '')
      .trim();

    set({
      currentRun: cloned,
      expandedVerticalIds: new Set(cloned.verticals.filter(v => v.type === 'measure').map(v => v.id)),
      lastAddedVerticalId: null,
      isDirty: false,
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
        absoluteDepth: calcAbs(nv.waterDepth, '0.5') ?? '',
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
        absoluteDepth: calcAbs(nv.waterDepth, '0.5') ?? '',
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
        if (!Number.isFinite(depthVal)) {
          const cleared = t.measurePoints.map((point) => ({ ...point, absoluteDepth: '' }));
          return { currentRun: { ...s.currentRun, verticals: s.currentRun.verticals.map(v => v.id === vid ? { ...v, ...updates, measurePoints: cleared } : v) } };
        }
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
        fu.measurePoints = sp.map((point) => ({ ...point, absoluteDepth: calcAbs(String(depthVal), point.relativeDepth) ?? '' }));
        return { currentRun: { ...s.currentRun, verticals: s.currentRun.verticals.map(v => v.id === vid ? { ...v, ...fu } : v) } };
      }
      return { currentRun: { ...s.currentRun, verticals: s.currentRun.verticals.map(v => v.id === vid ? { ...v, ...updates } : v) } };
    });
    get().recalculate();
  },

  deleteVertical: (vid) => { set(s => { const t = s.currentRun.verticals.find(v => v.id === vid); if (t?.type === 'edge') return s; const arr = s.currentRun.verticals.filter(v => v.id !== vid); let mi = 0; const rn = arr.map(v => { if (v.type === 'measure') { mi++; return { ...v, verticalNumber: String(mi) } } return v }); return { currentRun: { ...s.currentRun, verticals: rn }, expandedVerticalIds: new Set([...s.expandedVerticalIds].filter(id => id !== vid)), lastAddedVerticalId: null } }); get().recalculate(); },
  toggleVerticalExpand: (vid) => set(s => {
    const expandedIds = new Set(s.expandedVerticalIds);
    if (expandedIds.has(vid)) expandedIds.delete(vid);
    else expandedIds.add(vid);
    return { expandedVerticalIds: expandedIds };
  }),

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
    const withAbs = mergedPts.map((point) => ({ ...point, absoluteDepth: calcAbs(v.waterDepth, point.relativeDepth) ?? '' }));
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
            absoluteDepth: calcAbs(v.waterDepth, mp.relativeDepth) ?? '',
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

  swapEdges: () => {
    set(s => {
      const a = [...s.currentRun.verticals];
      const li = a.findIndex(v => v.type === 'edge' && v.name === '左水边');
      const ri = a.findIndex(v => v.type === 'edge' && v.name === '右水边');
      if (li >= 0 && ri >= 0) {
        a[li] = { ...a[li], name: '右水边' };
        a[ri] = { ...a[ri], name: '左水边' };
      }
      return { currentRun: { ...s.currentRun, verticals: a } };
    });
    get().recalculate();
  },
  swapEdgeCoefficients: () => {
    set(s => {
      const a = [...s.currentRun.verticals];
      const li = a.findIndex(v => v.type === 'edge' && v.name === '左水边');
      const ri = a.findIndex(v => v.type === 'edge' && v.name === '右水边');
      if (li >= 0 && ri >= 0) {
        const lc = a[li].shoreCoefficient, rc = a[ri].shoreCoefficient;
        a[li] = { ...a[li], shoreCoefficient: rc };
        a[ri] = { ...a[ri], shoreCoefficient: lc };
      }
      return { currentRun: { ...s.currentRun, verticals: a } };
    });
    get().recalculate();
  },

  /**
   * 【重构】工作台机制：重新计算仅更新当前工作区，打上脏标记，绝不自动污染历史记录
   */
  recalculate: () => set(s => { 
    const processed = processRun({ ...s.currentRun });
    return { currentRun: processed, isDirty: true };
  }),
  
  commitCurrentRun: (mode) => set(s => {
    const snapshot = JSON.parse(JSON.stringify(s.currentRun));
    let newRuns = [...s.runs];
    
    if (mode === 'overwrite') {
      const targetId = snapshot.parentId || snapshot.id;
      const targetIdx = newRuns.findIndex(r => r.id === targetId);
      
      // 🚀 核心锁死：保存修改时，必须锁死并保留该记录在 runs 历史面板中原有的名称！
      // 绝对不能用当前工作区剥离了"测次N"的 currentRun.location 去覆盖它！
      const originalRun = newRuns[targetIdx];
      const finalLocation = originalRun ? originalRun.location : snapshot.location.replace('_未归档', '');
      
      if (targetIdx >= 0) {
        // 用当前草稿的数据覆盖原父次，保留原历史名称与父级 ID，清除草稿父子关联
        newRuns[targetIdx] = {
          ...snapshot,
          id: targetId,
          parentId: undefined,
          location: finalLocation
        };
        
        // 如果当前是草稿，覆盖原父次后，从列表中彻底删掉这个临时草稿本身！
        if (snapshot.parentId) {
          newRuns = newRuns.filter(r => r.id !== snapshot.id);
        }
      }
      
      const finalRun = {
        ...snapshot,
        id: targetId,
        parentId: undefined,
        // 工作台输入框保持最干净的去后缀名称
        location: finalLocation.replace(/测次\d+/g, '').replace('_未归档', '').trim()
      };
      return { currentRun: finalRun, runs: newRuns, isDirty: false };
    } else {
      // 另存新档：支持智能重名避让机制
      const baseLocation = snapshot.location.replace('_未归档', '').trim() || '未知断面';
      
      // 【核心修正】另存新档是要在列表中并存的！绝对不能过滤掉 parentId！
      // 我们只需要过滤掉当前"正在被删除/转正"的草稿 ID 本身
      const otherRuns = newRuns.filter(r => r.id !== snapshot.id);
      let finalLocation = baseLocation;
      let counter = 1;
      while (otherRuns.some(r => r.location === finalLocation)) {
        finalLocation = `${baseLocation}测次${counter}`;
        counter++;
      }
      
      const finalRun = {
        ...snapshot,
        id: crypto.randomUUID(), // 发放全新独立 ID
        parentId: undefined,     // 彻底自立门户，清除父子关联
        location: finalLocation
      };
      
      // 如果当前是草稿，另存转正后，从列表中删掉这个临时草稿
      if (snapshot.parentId) {
        newRuns = newRuns.filter(r => r.id !== snapshot.id);
      }
      
      newRuns.push(finalRun);
      return { currentRun: finalRun, runs: newRuns, isDirty: false };
    }
  }),
  
  revertCurrentRun: () => set(s => {
    const snapshot = JSON.parse(JSON.stringify(s.currentRun));
    let newRuns = [...s.runs];
    
    // 恢复原始：如果是草稿，彻底在列表中抹除它，并重定向加载原始父级
    const targetId = snapshot.parentId || snapshot.id;
    const origin = newRuns.find(r => r.id === targetId);
    
    if (!origin) return { isDirty: false };
    
    if (snapshot.parentId) {
      // 物理删除这页未归档临时草稿记录
      newRuns = newRuns.filter(r => r.id !== snapshot.id);
    }
    
    const cloned = JSON.parse(JSON.stringify(origin));
    return { currentRun: cloned, runs: newRuns, isDirty: false };
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
      if (!isRecord(backupData)) return;
      const s = get();
      const currentRuns = [...s.runs];
      const seenLocations = new Set(currentRuns.map(r => r.location?.trim() || ''));

      const candidates: unknown[] = [];

      // 嗅探 1：如果是包含 runs 的全量旧备份
      if (Array.isArray(backupData.runs)) {
        candidates.push(...backupData.runs);
        if (isRecord(backupData.currentRun) && Array.isArray(backupData.currentRun.verticals)) {
          candidates.push(backupData.currentRun);
        }
      }
      // 嗅探 2：如果是同事分享的单测次包 (包含 verticals 数组)
      else if (Array.isArray(backupData.verticals)) {
        candidates.push(backupData);
      } else {
        console.warn('无法识别的文件格式');
        return;
      }

      const runsToImport = candidates
        .map(normalizeImportedRun)
        .filter((run): run is Run => run !== null);

      // 追加处理：颁发新身份证 + 智能避让重名
      const appendedRuns = runsToImport.map((run) => {
        let safeLoc = (run.location || '未知断面').trim();
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
        return { ...run, id: crypto.randomUUID(), location: safeLoc };
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
    // 数据清洗：保留 id, startDistance, measureMethod, deflectionCoefficient, shoreCoefficient, type, name
    //            必须将 waterDepth, iceThickness, waterIceThickness, iceFlowerThickness 置空
    //            遍历 measurePoints，保留 id, relativeDepth, mode，将 velocity, absoluteDepth, n, t 置空
    const cleanedVerticals: SectionTemplate['verticals'] = currentRun.verticals.map((vertical) => ({
      id: vertical.id,
      type: vertical.type,
      name: vertical.name,
      verticalNumber: vertical.verticalNumber,
      startDistance: vertical.startDistance,
      measureMethod: vertical.measureMethod,
      deflectionCoefficient: vertical.deflectionCoefficient,
      shoreCoefficient: vertical.shoreCoefficient,
      waterDepth: vertical.waterDepth || '',
      iceThickness: '',
      waterIceThickness: '',
      iceFlowerThickness: '',
      measurePoints: vertical.measurePoints.map((point) => ({
        id: point.id,
        relativeDepth: point.relativeDepth,
        mode: point.mode,
        velocity: '',
        absoluteDepth: '',
        n: '',
        t: '',
      })),
    }));

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
    // 保留原有 waterfrontDepth / ice 等动态计算属性为空
    const restoredVerticals: Vertical[] = template.verticals.map((vertical) => ({
      ...vertical,
      // 确保必填字段存在
      id: vertical.id || crypto.randomUUID(),
      verticalNumber: vertical.verticalNumber || '',
      waterDepth: vertical.waterDepth || '',
      measureMethod: vertical.measureMethod || 'one_point',
      measurePoints: vertical.measurePoints.map((point) => ({
        id: point.id || crypto.randomUUID(),
        relativeDepth: point.relativeDepth,
        mode: point.mode || 'direct',
        velocity: point.velocity || '',
        absoluteDepth: point.absoluteDepth || '',
        n: point.n || '',
        t: point.t || '',
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

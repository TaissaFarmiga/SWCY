/**
 * 水文测验数据类型定义
 * Run -> Verticals[左水边 | 测速垂线... | 右水边] -> MeasurePoints[]
 */

export type MeasureMethod = 'one_point' | 'two_point' | 'three_point' | 'five_point' | 'six_point';
export type FlowPeriod = 'open' | 'ice';
export type VelocityInputMode = 'direct' | 'formula';
export type SamplerType = 'horizontal' | 'bottle' | 'other';

export const HYDRO_SCHEMA_VERSION = 2;

export interface MeterFormula { k: number; c: number; }

import type { InstrumentSnapshot, RecordLifecycleStatus } from './governance';

export const SHORE_COEFFICIENT_OPTIONS = [
  { value: '0.70', label: '平缓岸', range: '0.67~0.75' },
  { value: '0.80', label: '陡岸不平整', range: '0.80' },
  { value: '0.90', label: '陡岸光滑', range: '0.90' },
  { value: '0.60', label: '死水区', range: '0.60' },
] as const;

export const DEFAULT_SHORE_COEFFICIENT = '0.70';
export const SHALLOW_CORRECTION_FACTOR = 0.9;

export interface DepthPoint { relativeDepth: string; label: string; }

export const OPEN_WATER_METHODS: Record<MeasureMethod, DepthPoint[]> = {
  one_point: [{ relativeDepth: '0.6', label: '0.6' }],
  two_point: [{ relativeDepth: '0.2', label: '0.2' }, { relativeDepth: '0.8', label: '0.8' }],
  three_point: [{ relativeDepth: '0.2', label: '0.2' }, { relativeDepth: '0.6', label: '0.6' }, { relativeDepth: '0.8', label: '0.8' }],
  five_point: [{ relativeDepth: '0.0', label: '水面' }, { relativeDepth: '0.2', label: '0.2' }, { relativeDepth: '0.6', label: '0.6' }, { relativeDepth: '0.8', label: '0.8' }, { relativeDepth: '1.0', label: '河底' }],
  six_point: [],
};

export const ICE_PERIOD_METHODS: Record<MeasureMethod, DepthPoint[]> = {
  one_point: [{ relativeDepth: '0.5', label: '0.5' }],
  two_point: [{ relativeDepth: '0.15', label: '0.15' }, { relativeDepth: '0.85', label: '0.85' }],
  three_point: [{ relativeDepth: '0.15', label: '0.15' }, { relativeDepth: '0.5', label: '0.5' }, { relativeDepth: '0.85', label: '0.85' }],
  five_point: [],
  six_point: [{ relativeDepth: '0.0', label: '冰底' }, { relativeDepth: '0.2', label: '0.2' }, { relativeDepth: '0.4', label: '0.4' }, { relativeDepth: '0.6', label: '0.6' }, { relativeDepth: '0.8', label: '0.8' }, { relativeDepth: '1.0', label: '河底' }],
};

export interface MeasurePoint {
  id: string;
  relativeDepth: string;
  velocity: string;
  mode: VelocityInputMode;
  n?: string;
  t?: string;
  absoluteDepth?: string;      // 绝对水深 = 水深 × 相对水深（用户可覆写）
  absolutePosition?: string;   // 绝对位置 = 有效水深 × 相对水深（引擎计算）
}

export type VerticalType = 'edge' | 'measure';

export interface Vertical {
  id: string;
  verticalNumber: string;
  startDistance: string;
  waterDepth: string;
  measureMethod: MeasureMethod;
  measurePoints: MeasurePoint[];
  type: VerticalType;
  name?: string;
  interval?: string;
  shoreCoefficient?: string;
  deflectionCoefficient?: string;
  iceThickness?: string;
  waterIceThickness?: string;
  iceFlowerThickness?: string;
  samplerType?: SamplerType;
  singleSampleConc?: string;
  sandBucketNo?: string;
  sandBucketWeight?: string;
  sampleVolume?: string;
  effectiveDepth?: string;
  meanVelocity?: string;
  correctedVelocity?: string;
  partialArea?: string;
  partialDischarge?: string;
  partialMeanVelocity?: string;
  totalSedimentDischarge?: string;
  meanSedimentConc?: string;
  isExpanded?: boolean;
  showResults?: boolean;
}

export interface Run {
  schemaVersion: number;
  id: string;
  parentId?: string;           // 🧬 亲子指针：草稿分支指向原始父级测次 ID
  runNumber: string;
  timestamp: string;
  flowPeriod: FlowPeriod;
  verticals: Vertical[];
  leftBankCoefficient: string;
  rightBankCoefficient: string;
  waterLevel?: string;
  location?: string;
  meterFormula?: MeterFormula;
  meterFormulaSnapshot?: MeterFormula;
  instrumentProfileId?: string;
  instrumentSnapshot?: InstrumentSnapshot;
  recordStatus: RecordLifecycleStatus;
  revision: number;
  completedAt?: string;
  stationCode?: string;
  riverName?: string;
  operator?: string;
  recorder?: string;
  reviewer?: string;
  weather?: string;
  waterCondition?: string;
  notes?: string;
  sedimentEnabled?: boolean;
  defaultSamplerType?: SamplerType;
  defaultSampleVolume?: string;
  totalDischarge?: string;
  totalArea?: string;
  meanVelocity?: string;
  surfaceWidth?: string;
  maxDepth?: string;
  maxVelocity?: string;
  totalSedimentDischarge?: string;
  meanSedimentConc?: string;
  startTime?: string;
  endTime?: string;
  startAt?: string;
  endAt?: string;
  duration?: string;
}

export function getAvailableMethods(flowPeriod: FlowPeriod): MeasureMethod[] {
  return flowPeriod === 'ice' ? ['one_point', 'two_point', 'three_point', 'six_point'] : ['one_point', 'two_point', 'three_point', 'five_point'];
}

export function getMethodDepthPoints(method: MeasureMethod, flowPeriod: FlowPeriod): DepthPoint[] {
  return flowPeriod === 'ice' ? ICE_PERIOD_METHODS[method] : OPEN_WATER_METHODS[method];
}

export const METHOD_LABELS: Record<MeasureMethod, string> = {
  one_point: '一点法', two_point: '二点法', three_point: '三点法', five_point: '五点法', six_point: '六点法',
};

export const SAMPLER_LABELS: Record<SamplerType, string> = {
  horizontal: '横式', bottle: '瓶式', other: '其他',
};

export const DEFAULT_METER_FORMULA: MeterFormula = { k: 0.4280, c: 0.0057 };

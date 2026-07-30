import type { LevelingGrade } from '../types/leveling';
import type { GradeToleranceProfile, LevelingRuleProfile, RuleProfileSnapshot } from '../types/governance';

export const LEVELING_RULE_SOURCE = '现有项目参数；待对照单位现行规范原文复核';
export const ROUTE_CLOSURE_RULE_SOURCE = '现有项目参数；平原/山地和单位现行规范版本待业务复核';

export const DEFAULT_LEVELING_RULE_PROFILE: Readonly<LevelingRuleProfile> = Object.freeze({
  id: 'leveling-current-unverified',
  version: '1.0.0',
  name: '现有三四等水准规则（待业务复核）',
  approved: false,
  source: `${LEVELING_RULE_SOURCE}；${ROUTE_CLOSURE_RULE_SOURCE}`,
  createdAt: '2026-07-29T00:00:00.000Z',
  tolerances: Object.freeze({
    '3': Object.freeze({ maxSightDistance: 75, maxDistanceDiff: 2, maxAccumulatedDiff: 5, maxBlackRedDiff: 2, maxDeltaDiff: 3 }),
    '4': Object.freeze({ maxSightDistance: 100, maxDistanceDiff: 3, maxAccumulatedDiff: 10, maxBlackRedDiff: 3, maxDeltaDiff: 5 }),
    out: Object.freeze({ maxSightDistance: 150, maxDistanceDiff: 5, maxAccumulatedDiff: 30, maxBlackRedDiff: null, maxDeltaDiff: null }),
  }),
  closureRules: Object.freeze({
    '3': Object.freeze({ distanceCoefficient: 12, stationCoefficient: 4, useStationFormulaAlways: false }),
    '4': Object.freeze({ distanceCoefficient: 20, stationCoefficient: 6, useStationFormulaAlways: false }),
    out: Object.freeze({ distanceCoefficient: null, stationCoefficient: 3, useStationFormulaAlways: true }),
  }),
  staffConstants: Object.freeze([4687, 4787] as const),
});

export function createRuleProfileSnapshot(
  profile: LevelingRuleProfile = DEFAULT_LEVELING_RULE_PROFILE,
  capturedAt = new Date().toISOString(),
): RuleProfileSnapshot {
  return JSON.parse(JSON.stringify({ ...profile, capturedAt })) as RuleProfileSnapshot;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function normalizeRuleProfileSnapshot(value: unknown): RuleProfileSnapshot {
  if (!isRecord(value) || !isRecord(value.tolerances) || !isRecord(value.closureRules)) {
    return createRuleProfileSnapshot();
  }
  const tolerances = value.tolerances;
  const closureRules = value.closureRules;
  const grades: LevelingGrade[] = ['3', '4', 'out'];
  const validTolerance = grades.every((grade) => {
    const tolerance = tolerances[grade];
    return isRecord(tolerance)
      && typeof tolerance.maxSightDistance === 'number' && Number.isFinite(tolerance.maxSightDistance)
      && typeof tolerance.maxDistanceDiff === 'number' && Number.isFinite(tolerance.maxDistanceDiff)
      && typeof tolerance.maxAccumulatedDiff === 'number' && Number.isFinite(tolerance.maxAccumulatedDiff)
      && (tolerance.maxBlackRedDiff === null || typeof tolerance.maxBlackRedDiff === 'number')
      && (tolerance.maxDeltaDiff === null || typeof tolerance.maxDeltaDiff === 'number');
  });
  const validClosure = grades.every((grade) => {
    const closure = closureRules[grade];
    return isRecord(closure)
      && (closure.distanceCoefficient === null || typeof closure.distanceCoefficient === 'number')
      && typeof closure.stationCoefficient === 'number' && Number.isFinite(closure.stationCoefficient)
      && typeof closure.useStationFormulaAlways === 'boolean';
  });
  const validConstants = Array.isArray(value.staffConstants)
    && value.staffConstants.length > 0
    && value.staffConstants.every((constant) => constant === 4687 || constant === 4787);
  if (!validTolerance || !validClosure || !validConstants) return createRuleProfileSnapshot();
  return JSON.parse(JSON.stringify({
    id: typeof value.id === 'string' && value.id ? value.id : DEFAULT_LEVELING_RULE_PROFILE.id,
    version: typeof value.version === 'string' && value.version ? value.version : DEFAULT_LEVELING_RULE_PROFILE.version,
    name: typeof value.name === 'string' && value.name ? value.name : DEFAULT_LEVELING_RULE_PROFILE.name,
    approved: value.approved === true,
    source: typeof value.source === 'string' && value.source ? value.source : DEFAULT_LEVELING_RULE_PROFILE.source,
    createdAt: typeof value.createdAt === 'string' && Number.isFinite(Date.parse(value.createdAt)) ? new Date(value.createdAt).toISOString() : DEFAULT_LEVELING_RULE_PROFILE.createdAt,
    tolerances,
    closureRules,
    staffConstants: value.staffConstants,
    capturedAt: typeof value.capturedAt === 'string' && Number.isFinite(Date.parse(value.capturedAt)) ? new Date(value.capturedAt).toISOString() : new Date().toISOString(),
  })) as RuleProfileSnapshot;
}

export function normalizeLevelingRuleProfile(value: unknown): LevelingRuleProfile | null {
  if (!isRecord(value)
    || typeof value.id !== 'string' || value.id.trim() === ''
    || typeof value.version !== 'string' || value.version.trim() === ''
    || typeof value.name !== 'string' || value.name.trim() === ''
    || typeof value.source !== 'string' || value.source.trim() === ''
    || !isRecord(value.tolerances)
    || !isRecord(value.closureRules)) return null;
  const normalized = normalizeRuleProfileSnapshot(value);
  return {
    id: normalized.id,
    version: normalized.version,
    name: normalized.name,
    approved: normalized.approved,
    source: normalized.source,
    createdAt: normalized.createdAt,
    tolerances: normalized.tolerances,
    closureRules: normalized.closureRules,
    staffConstants: normalized.staffConstants,
  };
}

export function gradeTolerance(
  grade: LevelingGrade,
  profile?: LevelingRuleProfile | RuleProfileSnapshot,
): GradeToleranceProfile {
  return (profile ?? DEFAULT_LEVELING_RULE_PROFILE).tolerances[grade];
}

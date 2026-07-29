import type {
  LevelingGrade,
  LevelingReadings,
  LevelingStation,
  StaffConstant,
  StationResult,
} from '../types/leveling';
import { Decimal, toFiniteDecimal } from './rounding';

export interface GradeTolerance {
  readonly maxSightDistance: number;
  readonly maxDistanceDiff: number;
  readonly maxAccumulatedDiff: number;
  readonly maxBlackRedDiff: number | null;
  readonly maxDeltaDiff: number | null;
}

/**
 * 沿用项目现有外业限差。来源标记为待规范原文复核，避免把未核对参数伪称为规范原值。
 */
export const LEVELING_RULE_SOURCE = '现有项目参数；待对照单位现行规范原文复核';

export const TOLERANCE_MATRIX: Readonly<Record<LevelingGrade, GradeTolerance>> = Object.freeze({
  '3': Object.freeze({
    maxSightDistance: 75,
    maxDistanceDiff: 2,
    maxAccumulatedDiff: 5,
    maxBlackRedDiff: 2,
    maxDeltaDiff: 3,
  }),
  '4': Object.freeze({
    maxSightDistance: 100,
    maxDistanceDiff: 3,
    maxAccumulatedDiff: 10,
    maxBlackRedDiff: 3,
    maxDeltaDiff: 5,
  }),
  out: Object.freeze({
    maxSightDistance: 150,
    maxDistanceDiff: 5,
    maxAccumulatedDiff: 30,
    maxBlackRedDiff: null,
    maxDeltaDiff: null,
  }),
});

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
}

function parseNonNegativeDecimal(raw: unknown): Decimal | null {
  const value = toFiniteDecimal(raw);
  return value && !value.isNegative() ? value : null;
}

/** 兼容现有录入：带小数点按米，无小数点按毫米。 */
export function parseStaffReadingMm(raw: string): number | null {
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  const value = parseNonNegativeDecimal(raw.trim());
  if (!value) return null;
  const millimeters = raw.includes('.') ? value.times(1000) : value;
  return millimeters.isFinite() ? millimeters.toNumber() : null;
}

function parseDistanceMeters(raw: string): number | null {
  const value = parseNonNegativeDecimal(raw);
  return value ? value.toNumber() : null;
}

function metersFromMillimeters(value: number): number {
  return new Decimal(value).div(1000).toNumber();
}

function bankersRoundMillimeter(value: number): number {
  return new Decimal(value).toDecimalPlaces(0, Decimal.ROUND_HALF_EVEN).toNumber();
}

function sniffStaffK(blackMm: number | null, redMm: number | null): StaffConstant | null {
  if (blackMm === null || redMm === null) return null;
  const difference = redMm - blackMm;
  return Math.abs(difference - 4687) <= Math.abs(difference - 4787) ? 4687 : 4787;
}

function valueLabel(raw: string, label: string, errors: string[]): number | null {
  const value = parseStaffReadingMm(raw);
  if (value === null) errors.push(`${label}读数缺失或不是有限非负数`);
  return value;
}

export function validateReadings(readings: LevelingReadings, grade: LevelingGrade): ValidationResult {
  const errors: string[] = [];
  if (readings.backPoint.trim() === '') errors.push('后视测点名称缺失');
  if (readings.forePoint.trim() === '') errors.push('前视测点名称缺失');
  if (grade === '3' || grade === '4') {
    const backUpper = valueLabel(readings.backUpper, '后视上丝', errors);
    const backLower = valueLabel(readings.backLower, '后视下丝', errors);
    const foreUpper = valueLabel(readings.foreUpper, '前视上丝', errors);
    const foreLower = valueLabel(readings.foreLower, '前视下丝', errors);
    valueLabel(readings.backBlack, '后视黑面', errors);
    valueLabel(readings.foreBlack, '前视黑面', errors);
    valueLabel(readings.backRed, '后视红面', errors);
    valueLabel(readings.foreRed, '前视红面', errors);
    if (backUpper !== null && backLower !== null && backLower <= backUpper) {
      errors.push('后视下丝必须大于后视上丝');
    }
    if (foreUpper !== null && foreLower !== null && foreLower <= foreUpper) {
      errors.push('前视下丝必须大于前视上丝');
    }
  } else {
    valueLabel(readings.backBlack, '后视黑面', errors);
    valueLabel(readings.foreBlack, '前视黑面', errors);
    if (readings.backDistance.trim() !== '' && parseDistanceMeters(readings.backDistance) === null) {
      errors.push('后视距不是有限非负数');
    }
    if (readings.foreDistance.trim() !== '' && parseDistanceMeters(readings.foreDistance) === null) {
      errors.push('前视距不是有限非负数');
    }
  }

  for (const intermediate of readings.intermediates ?? []) {
    if (parseStaffReadingMm(intermediate.black) === null) {
      errors.push(`间视[${intermediate.point || '未命名'}]黑面读数缺失或无效`);
    }
    if ((grade === '3' || grade === '4') && parseStaffReadingMm(intermediate.red) === null) {
      errors.push(`间视[${intermediate.point || '未命名'}]红面读数缺失或无效`);
    }
  }

  return { isValid: errors.length === 0, errors };
}

export function createEmptyStationResult(): StationResult {
  return {
    backDistance: null,
    foreDistance: null,
    distanceDiff: null,
    accumulatedDistanceDiff: null,
    blackDelta: null,
    redDelta: null,
    backDiff: null,
    foreDiff: null,
    deltaDiff: null,
    meanDeltaHeight: null,
    sniffedBackK: null,
    sniffedForeK: null,
    elevation: null,
    intermediateResults: [],
    isComplete: false,
    isValid: false,
    missingFields: [],
    errorMessages: [],
  };
}

export function processStation(
  station: LevelingStation,
  grade: LevelingGrade,
  previousAccumulatedDiff: number | null = 0,
  previousElevation: number | null = null,
): StationResult {
  const { readings } = station;
  const tolerance = TOLERANCE_MATRIX[grade];
  const validation = validateReadings(readings, grade);
  const limitErrors: string[] = [];

  const backUpperMm = parseStaffReadingMm(readings.backUpper);
  const backLowerMm = parseStaffReadingMm(readings.backLower);
  const foreUpperMm = parseStaffReadingMm(readings.foreUpper);
  const foreLowerMm = parseStaffReadingMm(readings.foreLower);

  const backDistance = grade === 'out'
    ? parseDistanceMeters(readings.backDistance)
    : backUpperMm !== null && backLowerMm !== null && backLowerMm > backUpperMm
      ? (backLowerMm - backUpperMm) / 10
      : null;
  const foreDistance = grade === 'out'
    ? parseDistanceMeters(readings.foreDistance)
    : foreUpperMm !== null && foreLowerMm !== null && foreLowerMm > foreUpperMm
      ? (foreLowerMm - foreUpperMm) / 10
      : null;
  const distanceDiff = backDistance !== null && foreDistance !== null
    ? new Decimal(backDistance).minus(foreDistance).toNumber()
    : null;
  const accumulatedDistanceDiff = distanceDiff !== null && previousAccumulatedDiff !== null
    ? new Decimal(previousAccumulatedDiff).plus(distanceDiff).toNumber()
    : null;

  if (backDistance !== null && backDistance > tolerance.maxSightDistance) {
    limitErrors.push(`后视距 ${backDistance.toFixed(1)}m 超限（最大 ${tolerance.maxSightDistance.toFixed(1)}m）`);
  }
  if (foreDistance !== null && foreDistance > tolerance.maxSightDistance) {
    limitErrors.push(`前视距 ${foreDistance.toFixed(1)}m 超限（最大 ${tolerance.maxSightDistance.toFixed(1)}m）`);
  }
  if (distanceDiff !== null && Math.abs(distanceDiff) > tolerance.maxDistanceDiff) {
    limitErrors.push(`单站视距差 ${Math.abs(distanceDiff).toFixed(1)}m 超限（最大 ${tolerance.maxDistanceDiff.toFixed(1)}m）`);
  }
  if (accumulatedDistanceDiff !== null && Math.abs(accumulatedDistanceDiff) > tolerance.maxAccumulatedDiff) {
    limitErrors.push(`累计视距差 ${Math.abs(accumulatedDistanceDiff).toFixed(1)}m 超限（最大 ${tolerance.maxAccumulatedDiff.toFixed(1)}m）`);
  }

  const backBlackMm = parseStaffReadingMm(readings.backBlack);
  const foreBlackMm = parseStaffReadingMm(readings.foreBlack);
  const backRedMm = parseStaffReadingMm(readings.backRed);
  const foreRedMm = parseStaffReadingMm(readings.foreRed);
  const blackDeltaMm = backBlackMm !== null && foreBlackMm !== null ? backBlackMm - foreBlackMm : null;
  const redDeltaMm = backRedMm !== null && foreRedMm !== null ? backRedMm - foreRedMm : null;
  const blackDelta = blackDeltaMm === null ? null : metersFromMillimeters(blackDeltaMm);
  const redDelta = redDeltaMm === null ? null : metersFromMillimeters(redDeltaMm);

  const sniffedBackK = sniffStaffK(backBlackMm, backRedMm);
  const sniffedForeK = sniffStaffK(foreBlackMm, foreRedMm);
  const backDiff = sniffedBackK !== null && backBlackMm !== null && backRedMm !== null
    ? Math.abs(backBlackMm + sniffedBackK - backRedMm)
    : null;
  const foreDiff = sniffedForeK !== null && foreBlackMm !== null && foreRedMm !== null
    ? Math.abs(foreBlackMm + sniffedForeK - foreRedMm)
    : null;
  const compensationMm = sniffedBackK !== null && sniffedForeK !== null
    ? sniffedForeK - sniffedBackK
    : null;
  const deltaDiff = blackDeltaMm !== null && redDeltaMm !== null && compensationMm !== null
    ? Math.abs(blackDeltaMm - (redDeltaMm + compensationMm))
    : null;

  if (tolerance.maxBlackRedDiff !== null) {
    if (backDiff !== null && backDiff > tolerance.maxBlackRedDiff) {
      limitErrors.push(`后尺黑红面读数差 ${backDiff.toFixed(1)}mm 超限（最大 ${tolerance.maxBlackRedDiff.toFixed(1)}mm）`);
    }
    if (foreDiff !== null && foreDiff > tolerance.maxBlackRedDiff) {
      limitErrors.push(`前尺黑红面读数差 ${foreDiff.toFixed(1)}mm 超限（最大 ${tolerance.maxBlackRedDiff.toFixed(1)}mm）`);
    }
  }
  if (tolerance.maxDeltaDiff !== null && deltaDiff !== null && deltaDiff > tolerance.maxDeltaDiff) {
    limitErrors.push(`黑红面高差较差 ${deltaDiff.toFixed(1)}mm 超限（最大 ${tolerance.maxDeltaDiff.toFixed(1)}mm）`);
  }

  const meanDeltaMm = grade === 'out'
    ? blackDeltaMm
    : blackDeltaMm !== null && redDeltaMm !== null && compensationMm !== null
      ? bankersRoundMillimeter((blackDeltaMm + redDeltaMm + compensationMm) / 2)
      : null;
  const meanDeltaHeight = meanDeltaMm === null ? null : metersFromMillimeters(meanDeltaMm);
  const elevation = previousElevation !== null && meanDeltaHeight !== null
    ? new Decimal(previousElevation).plus(meanDeltaHeight).toNumber()
    : null;

  const intermediateResults = (readings.intermediates ?? []).map((intermediate) => {
    const blackMm = parseStaffReadingMm(intermediate.black);
    const redMm = parseStaffReadingMm(intermediate.red);
    const sniffedK = sniffStaffK(blackMm, redMm);
    const staffDiff = sniffedK !== null && blackMm !== null && redMm !== null
      ? Math.abs(blackMm + sniffedK - redMm)
      : null;
    const isComplete = blackMm !== null && (grade === 'out' || redMm !== null);
    let deltaMm: number | null = null;
    if (backBlackMm !== null && blackMm !== null) {
      if (grade === 'out') {
        deltaMm = backBlackMm - blackMm;
      } else if (backRedMm !== null && redMm !== null && sniffedBackK !== null && sniffedK !== null) {
        const blackDifference = backBlackMm - blackMm;
        const redDifference = (backRedMm - sniffedBackK) - (redMm - sniffedK);
        deltaMm = bankersRoundMillimeter((blackDifference + redDifference) / 2);
      }
    }
    if (tolerance.maxBlackRedDiff !== null && staffDiff !== null && staffDiff > tolerance.maxBlackRedDiff) {
      limitErrors.push(`间视[${intermediate.point || '未命名'}]尺差 ${staffDiff.toFixed(1)}mm 超限`);
    }
    return {
      id: intermediate.id,
      sniffedK,
      staffDiff,
      deltaHeight: deltaMm === null ? null : metersFromMillimeters(deltaMm),
      elevation: deltaMm !== null && previousElevation !== null
        ? new Decimal(previousElevation).plus(metersFromMillimeters(deltaMm)).toNumber()
        : null,
      isComplete,
    };
  });

  const isComplete = validation.isValid && meanDeltaHeight !== null;
  const allErrors = [...validation.errors, ...limitErrors];
  return {
    backDistance,
    foreDistance,
    distanceDiff,
    accumulatedDistanceDiff,
    blackDelta,
    redDelta,
    backDiff,
    foreDiff,
    deltaDiff,
    meanDeltaHeight,
    sniffedBackK,
    sniffedForeK,
    elevation,
    intermediateResults,
    isComplete,
    isValid: isComplete && limitErrors.length === 0,
    missingFields: validation.errors,
    errorMessages: allErrors,
  };
}

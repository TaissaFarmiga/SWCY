import type {
  LevelingGrade,
  LevelingProfilePoint,
  LevelingRoute,
  LevelingRouteCalculation,
  LevelingStation,
  LevelingTrajectoryPoint,
  SurveyDirection,
} from '../types/leveling';
import { LEVELING_SCHEMA_VERSION } from '../types/leveling';
import { Decimal } from './rounding';
import { processStation } from './LevelingEngine';

interface ClosureRule {
  readonly distanceCoefficient: number | null;
  readonly stationCoefficient: number;
  readonly useStationFormulaAlways: boolean;
}

/** 沿用现有项目公式参数；规范原文与地区条件仍须业务方复核。 */
export const ROUTE_CLOSURE_RULE_SOURCE = '现有项目参数；平原/山地和单位现行规范版本待业务复核';

export const ROUTE_CLOSURE_RULES: Readonly<Record<LevelingGrade, ClosureRule>> = Object.freeze({
  '3': Object.freeze({ distanceCoefficient: 12, stationCoefficient: 4, useStationFormulaAlways: false }),
  '4': Object.freeze({ distanceCoefficient: 20, stationCoefficient: 6, useStationFormulaAlways: false }),
  out: Object.freeze({ distanceCoefficient: null, stationCoefficient: 3, useStationFormulaAlways: true }),
});

export interface RouteClosureResult {
  totalDeltaHeight: number | null;
  measuredClosureError: number | null;
  allowableClosureError: number | null;
  isPassed: boolean | null;
  errorMessage?: string;
}

function finiteOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function canonicalPointName(value: string): string {
  return value.trim().replace(/^[往返]\s*/, '').trim();
}

function isSamePoint(left: string, right: string): boolean {
  const leftTrimmed = left.trim();
  const rightTrimmed = right.trim();
  if (!leftTrimmed || !rightTrimmed) return false;
  return leftTrimmed === rightTrimmed || canonicalPointName(leftTrimmed) === canonicalPointName(rightTrimmed);
}

function findKnownElevation(route: LevelingRoute, name: string): number | null {
  if (!name) return null;
  const trimmedName = name.trim();
  const point = route.knownPoints.find((candidate) => candidate.name.trim() === trimmedName)
    ?? route.knownPoints.find((candidate) => isSamePoint(candidate.name, trimmedName));
  return finiteOrNull(point?.elevation);
}

function sumStationDelta(stations: LevelingStation[]): number | null {
  if (stations.length === 0) return null;
  let sum = new Decimal(0);
  for (const station of stations) {
    if (station.result.meanDeltaHeight === null) return null;
    sum = sum.plus(station.result.meanDeltaHeight);
  }
  return sum.toNumber();
}

function sumDirection(stations: LevelingStation[], direction: SurveyDirection): number | null {
  return sumStationDelta(stations.filter((station) => station.direction === direction));
}

export function calculateAllowableError(
  grade: LevelingGrade,
  totalDistanceKm: number,
  stationCount: number,
): number | null {
  if (stationCount <= 0 || !Number.isFinite(totalDistanceKm) || totalDistanceKm < 0) return null;
  const rule = ROUTE_CLOSURE_RULES[grade];
  const stationsPerKm = totalDistanceKm > 0 ? stationCount / totalDistanceKm : Number.MAX_SAFE_INTEGER;
  if (rule.useStationFormulaAlways || stationsPerKm > 16 || rule.distanceCoefficient === null) {
    return rule.stationCoefficient * Math.sqrt(stationCount);
  }
  return rule.distanceCoefficient * Math.sqrt(Math.max(totalDistanceKm, 1));
}

export function createEmptyRouteCalculation(): LevelingRouteCalculation {
  return {
    startPointName: '',
    endPointName: '',
    startElevation: null,
    knownEndElevation: null,
    computedEndElevation: null,
    adoptedElevation: null,
    totalDistanceKm: 0,
    meanSightDistanceM: null,
    totalDeltaHeightM: null,
    forwardDeltaHeightM: null,
    returnDeltaHeightM: null,
    closureErrorMm: null,
    roundTripDiscrepancyMm: null,
    allowableErrorMm: null,
    isWithinTolerance: null,
    completeStationCount: 0,
    incompleteStationCount: 0,
    isComplete: false,
    profilePoints: [],
    trajectoryPoints: [],
    errorMessages: [],
  };
}

/** 唯一路线重算入口。Store、成果、图形和导出均读取这里生成的快照。 */
export function recalculateLevelingRoute(inputRoute: LevelingRoute): LevelingRoute {
  const orderedStations = [...inputRoute.stations]
    .sort((left, right) => left.stationNumber - right.stationNumber)
    .map((station, index) => ({ ...station, stationNumber: index + 1 }));
  const firstKnownName = inputRoute.knownPoints[0]?.name.trim() ?? '';
  const secondKnownName = inputRoute.knownPoints[1]?.name.trim() ?? '';
  const startPointName = orderedStations[0]?.readings.backPoint.trim() || firstKnownName;
  const endPointName = orderedStations[orderedStations.length - 1]?.readings.forePoint.trim() || secondKnownName;
  const startElevation = findKnownElevation(inputRoute, startPointName);
  const knownEndElevation = findKnownElevation(inputRoute, endPointName);

  let previousAccumulatedDiff: number | null = 0;
  let previousElevation = startElevation;
  let cumulativeDistanceKm = 0;
  let totalSightDistanceM = new Decimal(0);
  let sightCount = 0;
  const stationDistances: number[] = [];
  const processedStations: LevelingStation[] = [];
  const continuityErrors: string[] = [];
  let previousForePointName = '';

  for (const [index, station] of orderedStations.entries()) {
    const backPointName = station.readings.backPoint.trim();
    const hasContinuityError = index > 0 && !isSamePoint(previousForePointName, backPointName);
    const stationBaseElevation = hasContinuityError ? null : previousElevation;
    let result = processStation(station, inputRoute.grade, previousAccumulatedDiff, stationBaseElevation);
    if (hasContinuityError) {
      const message = `第 ${index + 1} 站后视点“${backPointName || '未命名'}”与上一站前视点“${previousForePointName || '未命名'}”不连续`;
      continuityErrors.push(message);
      result = {
        ...result,
        elevation: null,
        isValid: false,
        errorMessages: [...result.errorMessages, message],
      };
    }
    const processed = { ...station, result };
    processedStations.push(processed);
    previousAccumulatedDiff = result.accumulatedDistanceDiff;
    previousElevation = result.elevation;
    previousForePointName = station.readings.forePoint.trim();

    if (result.backDistance !== null) {
      totalSightDistanceM = totalSightDistanceM.plus(result.backDistance);
      sightCount += 1;
    }
    if (result.foreDistance !== null) {
      totalSightDistanceM = totalSightDistanceM.plus(result.foreDistance);
      sightCount += 1;
    }
    if (result.backDistance !== null && result.foreDistance !== null) {
      cumulativeDistanceKm = new Decimal(cumulativeDistanceKm)
        .plus(new Decimal(result.backDistance).plus(result.foreDistance).div(1000))
        .toNumber();
    }
    stationDistances.push(cumulativeDistanceKm);
  }

  const hasBrokenRoute = continuityErrors.length > 0;
  const totalDeltaHeightM = hasBrokenRoute ? null : sumStationDelta(processedStations);
  const forwardDeltaHeightM = hasBrokenRoute ? null : sumDirection(processedStations, 'forward');
  const returnDeltaHeightM = hasBrokenRoute ? null : sumDirection(processedStations, 'return');
  const computedEndElevation = processedStations.length > 0
    ? processedStations[processedStations.length - 1].result.elevation
    : null;
  let closureErrorMm: number | null = null;
  let roundTripDiscrepancyMm: number | null = null;
  let adoptedElevation: number | null = computedEndElevation;

  if (inputRoute.routeType === 'attached' && totalDeltaHeightM !== null && startElevation !== null && knownEndElevation !== null) {
    closureErrorMm = new Decimal(totalDeltaHeightM)
      .minus(new Decimal(knownEndElevation).minus(startElevation))
      .times(1000)
      .toNumber();
    adoptedElevation = knownEndElevation;
  } else if (inputRoute.routeType === 'closed' && totalDeltaHeightM !== null) {
    closureErrorMm = new Decimal(totalDeltaHeightM).times(1000).toNumber();
    adoptedElevation = startElevation;
  } else if (inputRoute.routeType === 'round-trip' && forwardDeltaHeightM !== null && returnDeltaHeightM !== null) {
    roundTripDiscrepancyMm = new Decimal(forwardDeltaHeightM).plus(returnDeltaHeightM).times(1000).toNumber();
    closureErrorMm = roundTripDiscrepancyMm;
    adoptedElevation = startElevation === null
      ? null
      : new Decimal(startElevation)
          .plus(new Decimal(forwardDeltaHeightM).minus(returnDeltaHeightM).div(2))
          .toNumber();
  }

  const allowableErrorMm = inputRoute.routeType === 'open'
    ? null
    : calculateAllowableError(inputRoute.grade, cumulativeDistanceKm, processedStations.length);
  const isWithinTolerance = closureErrorMm !== null && allowableErrorMm !== null
    ? Math.abs(closureErrorMm) <= allowableErrorMm
    : null;

  const profilePoints: LevelingProfilePoint[] = [];
  if (startPointName || processedStations.length > 0) {
    profilePoints.push({
      id: `start:${inputRoute.id}`,
      stationId: null,
      order: 0,
      name: startPointName || '起点',
      distanceKm: 0,
      elevation: startElevation,
      kind: 'start',
      direction: processedStations[0]?.direction ?? inputRoute.direction,
    });
  }
  processedStations.forEach((station, index) => {
    profilePoints.push({
      id: `fore:${station.id}`,
      stationId: station.id,
      order: index + 1,
      name: station.readings.forePoint.trim() || `测点${index + 1}`,
      distanceKm: stationDistances[index] ?? 0,
      elevation: station.result.elevation,
      kind: index === processedStations.length - 1 ? 'end' : 'turning',
      direction: station.direction,
    });
  });

  const trajectoryPoints: LevelingTrajectoryPoint[] = processedStations.map((station, index) => ({
    id: station.id,
    stationNumber: station.stationNumber,
    label: station.readings.forePoint.trim() || `站${station.stationNumber}`,
    direction: station.direction,
    elevation: station.result.elevation,
    distanceKm: stationDistances[index] ?? 0,
    progress: processedStations.length <= 1 ? 1 : index / (processedStations.length - 1),
    isComplete: station.result.isComplete,
    isValid: station.result.isValid,
    ...(finiteOrNull(station.lat) === null ? {} : { lat: station.lat }),
    ...(finiteOrNull(station.lng) === null ? {} : { lng: station.lng }),
  }));

  const completeStationCount = processedStations.filter((station) => station.result.isComplete).length;
  const incompleteStationCount = processedStations.length - completeStationCount;
  const errors: string[] = [...continuityErrors];
  if (!startPointName) errors.push('未设置起点名称');
  if (startElevation === null) errors.push('未找到起点已知高程');
  if (inputRoute.routeType === 'attached' && knownEndElevation === null) errors.push('附合路线未找到终点已知高程');
  if (inputRoute.routeType === 'round-trip' && (forwardDeltaHeightM === null || returnDeltaHeightM === null)) {
    errors.push('往返路线必须同时包含完整的往测和返测测站');
  }
  if (incompleteStationCount > 0) errors.push(`${incompleteStationCount} 个测站读数不完整`);

  const closureReady = inputRoute.routeType === 'open'
    || (closureErrorMm !== null && allowableErrorMm !== null);
  const calculation: LevelingRouteCalculation = {
    startPointName,
    endPointName,
    startElevation,
    knownEndElevation,
    computedEndElevation,
    adoptedElevation,
    totalDistanceKm: cumulativeDistanceKm,
    meanSightDistanceM: sightCount > 0 ? totalSightDistanceM.div(sightCount).toNumber() : null,
    totalDeltaHeightM,
    forwardDeltaHeightM,
    returnDeltaHeightM,
    closureErrorMm,
    roundTripDiscrepancyMm,
    allowableErrorMm,
    isWithinTolerance,
    completeStationCount,
    incompleteStationCount,
    isComplete: processedStations.length > 0
      && incompleteStationCount === 0
      && startElevation !== null
      && !hasBrokenRoute
      && closureReady,
    profilePoints,
    trajectoryPoints,
    errorMessages: errors,
  };

  return {
    ...inputRoute,
    schemaVersion: LEVELING_SCHEMA_VERSION,
    stations: processedStations,
    totalDistance: calculation.totalDistanceKm,
    totalDeltaHeight: calculation.totalDeltaHeightM,
    closureError: calculation.closureErrorMm,
    allowableError: calculation.allowableErrorMm,
    calculation,
    updatedAt: new Date().toISOString(),
  };
}

export function evaluateRouteClosure(route: LevelingRoute): RouteClosureResult {
  const { calculation } = route;
  const errorMessage = calculation.isWithinTolerance === false
    && calculation.closureErrorMm !== null
    && calculation.allowableErrorMm !== null
    ? `实测闭合差 ${calculation.closureErrorMm >= 0 ? '+' : ''}${calculation.closureErrorMm.toFixed(1)}mm 超限（允许 ±${calculation.allowableErrorMm.toFixed(1)}mm）`
    : undefined;
  return {
    totalDeltaHeight: calculation.totalDeltaHeightM,
    measuredClosureError: calculation.closureErrorMm,
    allowableClosureError: calculation.allowableErrorMm,
    isPassed: calculation.isWithinTolerance,
    errorMessage,
  };
}

export function formatClosureResult(result: RouteClosureResult): string {
  if (result.measuredClosureError === null || result.allowableClosureError === null) return '闭合差待完整数据计算';
  if (result.isPassed === false) return result.errorMessage ?? '闭合差超限';
  const sign = result.measuredClosureError >= 0 ? '+' : '';
  return `闭合差 ${sign}${result.measuredClosureError.toFixed(1)}mm，允许 ±${result.allowableClosureError.toFixed(1)}mm`;
}

export function calculateRouteDistance(route: LevelingRoute): number {
  return route.calculation.totalDistanceKm;
}

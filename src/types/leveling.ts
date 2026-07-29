/** 水准测量领域类型。录入值保留字符串；派生值缺失时使用 null。 */

export const LEVELING_SCHEMA_VERSION = 2;

export type LevelingGrade = '3' | '4' | 'out';
export type StaffConstant = 4687 | 4787;
export type SurveyDirection = 'forward' | 'return';
export type LevelingRouteType = 'attached' | 'closed' | 'round-trip' | 'open';
export type LevelingCompletionStatus = 'draft' | 'completed';

export interface IntermediateReading {
  id: string;
  point: string;
  black: string;
  red: string;
  distance: string;
}

export interface IntermediateResult {
  id: string;
  sniffedK: StaffConstant | null;
  staffDiff: number | null;
  deltaHeight: number | null;
  elevation: number | null;
  isComplete: boolean;
}

export interface LevelingReadings {
  backPoint: string;
  forePoint: string;
  backUpper: string;
  backLower: string;
  foreUpper: string;
  foreLower: string;
  backDistance: string;
  foreDistance: string;
  intermediates: IntermediateReading[];
  backBlack: string;
  foreBlack: string;
  foreRed: string;
  backRed: string;
}

export interface StationResult {
  backDistance: number | null;
  foreDistance: number | null;
  distanceDiff: number | null;
  accumulatedDistanceDiff: number | null;
  blackDelta: number | null;
  redDelta: number | null;
  backDiff: number | null;
  foreDiff: number | null;
  deltaDiff: number | null;
  meanDeltaHeight: number | null;
  sniffedBackK: StaffConstant | null;
  sniffedForeK: StaffConstant | null;
  elevation: number | null;
  intermediateResults: IntermediateResult[];
  isComplete: boolean;
  isValid: boolean;
  missingFields: string[];
  errorMessages: string[];
}

export interface LevelingStation {
  id: string;
  stationNumber: number;
  direction: SurveyDirection;
  readings: LevelingReadings;
  result: StationResult;
  timestamp: number;
  lat?: number;
  lng?: number;
}

export interface KnownPoint {
  id: string;
  name: string;
  elevation: number | null;
  lat?: number;
  lng?: number;
}

export interface LevelingProfilePoint {
  id: string;
  stationId: string | null;
  order: number;
  name: string;
  distanceKm: number;
  elevation: number | null;
  kind: 'start' | 'turning' | 'end';
  direction: SurveyDirection;
}

export interface LevelingTrajectoryPoint {
  id: string;
  stationNumber: number;
  label: string;
  direction: SurveyDirection;
  elevation: number | null;
  distanceKm: number;
  progress: number;
  isComplete: boolean;
  isValid: boolean;
  lat?: number;
  lng?: number;
}

export interface LevelingRouteCalculation {
  startPointName: string;
  endPointName: string;
  startElevation: number | null;
  knownEndElevation: number | null;
  computedEndElevation: number | null;
  adoptedElevation: number | null;
  totalDistanceKm: number;
  meanSightDistanceM: number | null;
  totalDeltaHeightM: number | null;
  forwardDeltaHeightM: number | null;
  returnDeltaHeightM: number | null;
  closureErrorMm: number | null;
  roundTripDiscrepancyMm: number | null;
  allowableErrorMm: number | null;
  isWithinTolerance: boolean | null;
  completeStationCount: number;
  incompleteStationCount: number;
  isComplete: boolean;
  profilePoints: LevelingProfilePoint[];
  trajectoryPoints: LevelingTrajectoryPoint[];
  errorMessages: string[];
}

export interface LevelingRoute {
  schemaVersion: number;
  id: string;
  name: string;
  grade: LevelingGrade;
  routeType: LevelingRouteType;
  direction: SurveyDirection;
  completionStatus: LevelingCompletionStatus;
  instrument: string;
  location?: string;
  staffNumber?: string;
  waterLevel?: string;
  waterEdgeReading?: string;
  observer?: string;
  recorder?: string;
  stations: LevelingStation[];
  knownPoints: KnownPoint[];
  totalDistance: number;
  totalDeltaHeight: number | null;
  closureError: number | null;
  allowableError: number | null;
  calculation: LevelingRouteCalculation;
  createdAt: string;
  updatedAt: string;
  startTime?: string;
  endTime?: string;
  completedAt?: string;
  parentId?: string;
}

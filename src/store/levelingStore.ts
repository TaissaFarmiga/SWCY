import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type {
  IntermediateReading,
  KnownPoint,
  LevelingGrade,
  LevelingReadings,
  LevelingRoute,
  LevelingRouteType,
  LevelingStation,
  SurveyDirection,
} from '../types/leveling';
import { LEVELING_SCHEMA_VERSION } from '../types/leveling';
import { createEmptyStationResult } from '../lib/LevelingEngine';
import { createEmptyRouteCalculation, recalculateLevelingRoute } from '../lib/RouteClosureEngine';
import { hasValidCoordinates } from '../lib/levelingVisuals';
import { createPlatformStateStorage } from '../lib/persistence';
import { DEFAULT_LEVELING_RULE_PROFILE, createRuleProfileSnapshot, normalizeRuleProfileSnapshot } from '../lib/levelingRules';
import { normalizeInstrumentSnapshot, useGovernanceStore } from './governanceStore';

function generateUUID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (character) => {
    const random = Math.floor(Math.random() * 16);
    const value = character === 'x' ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function asTimestamp(value: unknown): number {
  const parsed = asFiniteNumber(value);
  return parsed === null ? Date.now() : parsed;
}

function asIsoDate(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : fallback;
}

function normalizeGrade(value: unknown): LevelingGrade {
  return value === '3' || value === '4' || value === 'out' ? value : '4';
}

export function createEmptyLevelingReadings(): LevelingReadings {
  return {
    backPoint: '',
    forePoint: '',
    backUpper: '',
    backLower: '',
    foreUpper: '',
    foreLower: '',
    backDistance: '',
    foreDistance: '',
    intermediates: [],
    backBlack: '',
    foreBlack: '',
    foreRed: '',
    backRed: '',
  };
}

export interface NewStationLocation {
  lat: number;
  lng: number;
  accuracyM?: number;
  capturedAt?: string;
  source?: 'native-gps' | 'browser-gps';
}

export function createEmptyLevelingStation(
  stationNumber: number,
  direction: SurveyDirection,
  location?: NewStationLocation,
): LevelingStation {
  const coordinates = { lat: location?.lat, lng: location?.lng };
  return {
    id: generateUUID(),
    stationNumber,
    direction,
    readings: createEmptyLevelingReadings(),
    result: createEmptyStationResult(),
    timestamp: Date.now(),
    ...(hasValidCoordinates(coordinates)
      ? {
          ...coordinates,
          ...(typeof location?.accuracyM === 'number' && Number.isFinite(location.accuracyM) && location.accuracyM >= 0
            ? { locationAccuracyM: location.accuracyM }
            : {}),
          ...(typeof location?.capturedAt === 'string' && Number.isFinite(Date.parse(location.capturedAt))
            ? { locationCapturedAt: new Date(location.capturedAt).toISOString() }
            : {}),
          ...(location?.source ? { locationSource: location.source } : {}),
        }
      : {}),
  };
}

export function createEmptyLevelingRoute(grade: LevelingGrade = '4'): LevelingRoute {
  const now = new Date().toISOString();
  return {
    schemaVersion: LEVELING_SCHEMA_VERSION,
    id: generateUUID(),
    name: '',
    grade,
    routeType: 'attached',
    direction: 'forward',
    completionStatus: 'draft',
    revision: 0,
    instrument: '',
    instrumentProfileId: 'unregistered-level',
    ruleProfileId: DEFAULT_LEVELING_RULE_PROFILE.id,
    ruleProfileSnapshot: createRuleProfileSnapshot(),
    location: '',
    staffNumber: '',
    waterLevel: '',
    waterEdgeReading: '',
    observer: '',
    recorder: '',
    stations: [],
    knownPoints: [
      { id: generateUUID(), name: '', elevation: null },
      { id: generateUUID(), name: '', elevation: null },
    ],
    totalDistance: 0,
    totalDeltaHeight: null,
    closureError: null,
    allowableError: null,
    calculation: createEmptyRouteCalculation(),
    createdAt: now,
    updatedAt: now,
  };
}

function normalizeIntermediate(value: unknown): IntermediateReading {
  const source = isRecord(value) ? value : {};
  return {
    id: asString(source.id) || generateUUID(),
    point: asString(source.point),
    black: asString(source.black),
    red: asString(source.red),
    distance: asString(source.distance),
  };
}

function normalizeReadings(value: unknown): LevelingReadings {
  const source = isRecord(value) ? value : {};
  const intermediates = Array.isArray(source.intermediates)
    ? source.intermediates.map(normalizeIntermediate)
    : [];
  return {
    backPoint: asString(source.backPoint),
    forePoint: asString(source.forePoint),
    backUpper: asString(source.backUpper),
    backLower: asString(source.backLower),
    foreUpper: asString(source.foreUpper),
    foreLower: asString(source.foreLower),
    backDistance: asString(source.backDistance),
    foreDistance: asString(source.foreDistance),
    intermediates,
    backBlack: asString(source.backBlack),
    foreBlack: asString(source.foreBlack),
    foreRed: asString(source.foreRed),
    backRed: asString(source.backRed),
  };
}

function explicitDirection(value: unknown): SurveyDirection | null {
  return value === 'forward' || value === 'return' ? value : null;
}

/** Legacy only. New records never infer direction from point names. */
function inferLegacyDirection(readings: LevelingReadings): SurveyDirection | null {
  return /^\s*返/.test(readings.backPoint) || /^\s*返/.test(readings.forePoint) ? 'return' : null;
}

function normalizeStation(value: unknown, index: number, direction: SurveyDirection): LevelingStation {
  const source = isRecord(value) ? value : {};
  const readings = normalizeReadings(source.readings);
  const coordinates = { lat: asFiniteNumber(source.lat) ?? undefined, lng: asFiniteNumber(source.lng) ?? undefined };
  return {
    id: asString(source.id) || generateUUID(),
    stationNumber: index + 1,
    direction,
    readings,
    result: createEmptyStationResult(),
    timestamp: asTimestamp(source.timestamp),
    ...(hasValidCoordinates(coordinates)
      ? {
          ...coordinates,
          ...(asFiniteNumber(source.locationAccuracyM) !== null && asFiniteNumber(source.locationAccuracyM)! >= 0
            ? { locationAccuracyM: asFiniteNumber(source.locationAccuracyM)! }
            : {}),
          ...(typeof source.locationCapturedAt === 'string' && Number.isFinite(Date.parse(source.locationCapturedAt))
            ? { locationCapturedAt: new Date(source.locationCapturedAt).toISOString() }
            : {}),
          ...(source.locationSource === 'native-gps' || source.locationSource === 'browser-gps'
            ? { locationSource: source.locationSource }
            : {}),
        }
      : {}),
  };
}

function normalizeStations(value: unknown, routeDirection: SurveyDirection): LevelingStation[] {
  if (!Array.isArray(value)) return [];
  const sources = value.map((station) => isRecord(station) ? station : {});
  // Legacy routes may retain a route-level "return" flag while only later
  // stations have the old name marker. Preserve the forward leg before it.
  const legacyReturnIndex = sources.findIndex((source) => (
    !explicitDirection(source.direction) && inferLegacyDirection(normalizeReadings(source.readings)) === 'return'
  ));
  let inheritedDirection: SurveyDirection = legacyReturnIndex >= 0 ? 'forward' : routeDirection;
  let legacyReturnStarted = false;
  return sources.map((source, index) => {
    const readings = normalizeReadings(source.readings);
    const explicit = explicitDirection(source.direction);
    const legacy = explicit ? null : inferLegacyDirection(readings);
    if (legacy === 'return') legacyReturnStarted = true;
    const direction = explicit ?? (legacyReturnStarted ? 'return' : inheritedDirection);
    inheritedDirection = direction;
    return normalizeStation(source, index, direction);
  });
}

function deriveReturnStartStationId(stations: LevelingStation[]): string | undefined {
  const firstReturnIndex = stations.findIndex((station) => station.direction === 'return');
  return firstReturnIndex > 0 ? stations[firstReturnIndex - 1]?.id : undefined;
}

function normalizeKnownPoint(value: unknown): KnownPoint {
  const source = isRecord(value) ? value : {};
  const name = asString(source.name);
  const parsedElevation = asFiniteNumber(source.elevation);
  const elevation = name === '' && parsedElevation === 0 ? null : parsedElevation;
  const coordinates = { lat: asFiniteNumber(source.lat) ?? undefined, lng: asFiniteNumber(source.lng) ?? undefined };
  return {
    id: asString(source.id) || generateUUID(),
    name,
    elevation,
    ...(hasValidCoordinates(coordinates) ? coordinates : {}),
  };
}

function inferRouteType(stations: LevelingStation[], knownPoints: KnownPoint[]): LevelingRouteType {
  if (stations.some((station) => station.direction === 'return')) return 'round-trip';
  const start = stations[0]?.readings.backPoint.trim() ?? '';
  const end = stations[stations.length - 1]?.readings.forePoint.trim() ?? '';
  if (start && start === end) return 'closed';
  if (end && knownPoints.some((point) => point.name.trim() === end && point.elevation !== null)) return 'attached';
  return 'open';
}

function normalizeRouteType(value: unknown, fallback: LevelingRouteType): LevelingRouteType {
  return value === 'attached' || value === 'closed' || value === 'round-trip' || value === 'open'
    ? value
    : fallback;
}

function normalizeCompletionStatus(value: unknown): LevelingRoute['completionStatus'] {
  return value === 'completed' || value === 'pending_review' || value === 'reviewed'
    || value === 'archived' || value === 'revision' ? value : 'draft';
}

export function normalizeLevelingRoute(value: unknown): LevelingRoute {
  const source = isRecord(value) ? value : {};
  const grade = normalizeGrade(source.grade);
  const base = createEmptyLevelingRoute(grade);
  const persistedDirection = explicitDirection(source.direction);
  const stations = normalizeStations(source.stations, persistedDirection ?? 'forward');
  const direction = persistedDirection ?? stations[stations.length - 1]?.direction ?? 'forward';
  const knownPoints = Array.isArray(source.knownPoints)
    ? source.knownPoints.map(normalizeKnownPoint)
    : base.knownPoints;
  while (knownPoints.length < 2) knownPoints.push({ id: generateUUID(), name: '', elevation: null });
  const now = new Date().toISOString();
  const inferredType = inferRouteType(stations, knownPoints);
  const route: LevelingRoute = {
    ...base,
    id: asString(source.id) || base.id,
    name: asString(source.name),
    grade,
    routeType: normalizeRouteType(source.routeType, inferredType),
    direction,
    returnStartStationId: asOptionalString(source.returnStartStationId)
      ?? deriveReturnStartStationId(stations),
    returnStartedAt: asOptionalString(source.returnStartedAt),
    completionStatus: normalizeCompletionStatus(source.completionStatus),
    revision: typeof source.revision === 'number' && Number.isInteger(source.revision) && source.revision >= 0 ? source.revision : 0,
    instrument: asString(source.instrument),
    instrumentProfileId: asOptionalString(source.instrumentProfileId) ?? 'unregistered-level',
    instrumentSnapshot: normalizeInstrumentSnapshot(source.instrumentSnapshot),
    ruleProfileId: asString(source.ruleProfileId) || base.ruleProfileId,
    ruleProfileSnapshot: normalizeRuleProfileSnapshot(source.ruleProfileSnapshot),
    taskNumber: asOptionalString(source.taskNumber),
    organization: asOptionalString(source.organization),
    surveyor: asOptionalString(source.surveyor),
    checker: asOptionalString(source.checker),
    backStaffNumber: asOptionalString(source.backStaffNumber),
    foreStaffNumber: asOptionalString(source.foreStaffNumber),
    weather: asOptionalString(source.weather),
    terrain: asOptionalString(source.terrain),
    notes: asOptionalString(source.notes),
    location: asOptionalString(source.location),
    staffNumber: asOptionalString(source.staffNumber),
    waterLevel: asOptionalString(source.waterLevel),
    waterEdgeReading: asOptionalString(source.waterEdgeReading),
    observer: asOptionalString(source.observer),
    recorder: asOptionalString(source.recorder),
    stations,
    knownPoints,
    createdAt: asIsoDate(source.createdAt, now),
    updatedAt: asIsoDate(source.updatedAt, now),
    startTime: asOptionalString(source.startTime),
    endTime: asOptionalString(source.endTime),
    completedAt: asOptionalString(source.completedAt),
    parentId: asOptionalString(source.parentId),
  };
  return recalculateLevelingRoute(route);
}

function deepCloneRoute(route: LevelingRoute): LevelingRoute {
  if (typeof structuredClone === 'function') return structuredClone(route);
  return JSON.parse(JSON.stringify(route)) as LevelingRoute;
}

function applySelectedLevelingInstrument(route: LevelingRoute): LevelingRoute {
  const governance = useGovernanceStore.getState();
  const instrumentProfileId = governance.selectedLevelingInstrumentId;
  const instrumentSnapshot = governance.captureInstrument(instrumentProfileId);
  return {
    ...route,
    instrumentProfileId,
    instrumentSnapshot,
    instrument: instrumentSnapshot?.name ?? route.instrument,
  };
}

function createConfiguredRoute(grade: LevelingGrade): LevelingRoute {
  return applySelectedLevelingInstrument(createEmptyLevelingRoute(grade));
}

function prepareEditableRoute(route: LevelingRoute): LevelingRoute {
  if (route.completionStatus === 'draft' || route.completionStatus === 'revision') return route;
  const revised: LevelingRoute = {
    ...deepCloneRoute(route),
    id: generateUUID(),
    parentId: route.id,
    completionStatus: 'revision',
    revision: route.revision + 1,
    completedAt: undefined,
    updatedAt: new Date().toISOString(),
  };
  useGovernanceStore.getState().recordAudit({
    module: 'leveling', recordId: route.id, action: 'revise', before: route, after: revised,
  });
  return revised;
}

function sanitizeFilename(value: string): string {
  const invalid = '<>:"/\\|?*';
  const cleaned = Array.from(value, (character) => invalid.includes(character) || character.charCodeAt(0) < 32 ? '_' : character)
    .join('')
    .replace(/[. ]+$/g, '')
    .trim();
  return cleaned || '水准测量';
}

export interface PersistedLevelingState {
  currentRoute: LevelingRoute;
  routes: LevelingRoute[];
  isDirty: boolean;
}

export function migrateLevelingPersistedState(value: unknown): PersistedLevelingState {
  const source = isRecord(value) ? value : {};
  const routes = Array.isArray(source.routes) ? source.routes.filter(isRecord).map(normalizeLevelingRoute) : [];
  const currentRoute = source.currentRoute
    ? normalizeLevelingRoute(source.currentRoute)
    : createEmptyLevelingRoute('4');
  return { currentRoute, routes, isDirty: source.isDirty === true };
}

export interface LevelingState {
  currentRoute: LevelingRoute;
  routes: LevelingRoute[];
  isDirty: boolean;
  hasHydrated: boolean;
  lastAddedStationId: string | null;
  showHistoryPanel: boolean;
  setHasHydrated: (hydrated: boolean) => void;
  setLastAddedStationId: (id: string | null) => void;
  createRoute: (grade: LevelingGrade) => void;
  updateRouteMeta: (updates: Partial<LevelingRoute>) => void;
  addKnownPoint: (insertAfterId?: string) => void;
  updateKnownPoint: (id: string, field: keyof KnownPoint, value: string | number | null) => void;
  removeKnownPoint: (id: string) => void;
  /** All UI entry points call this one method; current route direction controls appended stations. */
  addStation: (insertAfterId?: string, location?: NewStationLocation) => void;
  beginReturnLeg: () => void;
  setStationDirection: (stationId: string, direction: SurveyDirection) => void;
  updateStationReading: (stationId: string, updates: Partial<LevelingReadings>) => void;
  deleteStation: (stationId: string) => void;
  addIntermediate: (stationId: string) => void;
  updateIntermediate: (stationId: string, intermediateId: string, field: keyof Omit<IntermediateReading, 'id'>, value: string) => void;
  removeIntermediate: (stationId: string, intermediateId: string) => void;
  commitRoute: (mode: 'overwrite' | 'new') => void;
  completeRoute: () => void;
  applySelectedInstrument: () => void;
  transitionRouteStatus: (status: 'pending_review' | 'reviewed' | 'archived') => void;
  loadRoute: (routeId: string) => void;
  exportCurrentRouteJSON: () => void;
  exportData: () => Promise<void>;
  importBackup: (data: unknown) => void;
  toggleHistoryPanel: () => void;
  markTime: (type: 'start' | 'end') => void;
  deleteRoute: (routeId: string) => void;
  revertCurrentRoute: () => void;
}

const storage = createPlatformStateStorage();

export const useLevelingStore = create<LevelingState>()(
  persist(
    (set, get) => ({
      currentRoute: createConfiguredRoute('4'),
      routes: [],
      isDirty: false,
      hasHydrated: false,
      lastAddedStationId: null,
      showHistoryPanel: false,
      setHasHydrated: (hasHydrated) => set({ hasHydrated }),
      setLastAddedStationId: (lastAddedStationId) => set({ lastAddedStationId }),
      toggleHistoryPanel: () => set((state) => ({ showHistoryPanel: !state.showHistoryPanel })),
      markTime: (type) => set((state) => {
        const now = new Date().toISOString();
        const editable = prepareEditableRoute(state.currentRoute);
        const route = {
          ...editable,
          [type === 'start' ? 'startTime' : 'endTime']: now,
          ...(type === 'start' ? { createdAt: now } : {}),
        };
        return { currentRoute: recalculateLevelingRoute(route), isDirty: true };
      }),
      deleteRoute: (routeId) => set((state) => ({ routes: state.routes.filter((route) => route.id !== routeId) })),
      revertCurrentRoute: () => set((state) => {
        const original = state.routes.find((route) => route.id === state.currentRoute.id || route.id === state.currentRoute.parentId);
        return {
          currentRoute: original ? recalculateLevelingRoute(deepCloneRoute(original)) : createConfiguredRoute(state.currentRoute.grade),
          isDirty: false,
        };
      }),
      createRoute: (grade) => set({ currentRoute: createConfiguredRoute(grade), isDirty: false, lastAddedStationId: null }),
      updateRouteMeta: (updates) => set((state) => {
        const editable = prepareEditableRoute(state.currentRoute);
        return {
          currentRoute: recalculateLevelingRoute({ ...editable, ...updates }),
          isDirty: true,
        };
      }),
      addKnownPoint: (insertAfterId) => set((state) => {
        const editable = prepareEditableRoute(state.currentRoute);
        const points = [...editable.knownPoints];
        const newPoint: KnownPoint = { id: generateUUID(), name: '', elevation: null };
        const index = insertAfterId ? points.findIndex((point) => point.id === insertAfterId) : -1;
        if (index >= 0) points.splice(index + 1, 0, newPoint);
        else points.push(newPoint);
        return { currentRoute: recalculateLevelingRoute({ ...editable, knownPoints: points }), isDirty: true };
      }),
      updateKnownPoint: (id, field, value) => set((state) => {
        const editable = prepareEditableRoute(state.currentRoute);
        const points = editable.knownPoints.map((point) => {
          if (point.id !== id) return point;
          if (field === 'elevation' || field === 'lat' || field === 'lng') {
            return { ...point, [field]: asFiniteNumber(value) };
          }
          return { ...point, [field]: asString(value) };
        });
        return { currentRoute: recalculateLevelingRoute({ ...editable, knownPoints: points }), isDirty: true };
      }),
      removeKnownPoint: (id) => set((state) => {
        const editable = prepareEditableRoute(state.currentRoute);
        return {
          currentRoute: recalculateLevelingRoute({
            ...editable,
            knownPoints: editable.knownPoints.filter((point) => point.id !== id),
          }),
          isDirty: true,
        };
      }),
      beginReturnLeg: () => set((state) => {
        const editable = prepareEditableRoute(state.currentRoute);
        const lastForward = [...editable.stations].reverse().find((station) => station.direction === 'forward');
        if (!lastForward) return state;
        const now = new Date().toISOString();
        return {
          currentRoute: recalculateLevelingRoute({
            ...editable,
            routeType: 'round-trip',
            direction: 'return',
            returnStartStationId: editable.returnStartStationId ?? lastForward.id,
            returnStartedAt: editable.returnStartedAt ?? now,
            updatedAt: now,
          }),
          isDirty: true,
        };
      }),
      addStation: (insertAfterId, location) => set((state) => {
        const editable = prepareEditableRoute(state.currentRoute);
        const stations = [...editable.stations];
        const insertIndex = insertAfterId ? stations.findIndex((item) => item.id === insertAfterId) : -1;
        // Historical insertion inherits its surrounding leg. Footer creation appends using current leg.
        const direction = insertIndex >= 0 ? stations[insertIndex].direction : editable.direction;
        const station = createEmptyLevelingStation(0, direction, location);
        if (insertIndex >= 0) {
          station.readings.backPoint = stations[insertIndex].readings.forePoint;
          stations.splice(insertIndex + 1, 0, station);
        } else {
          station.readings.backPoint = stations[stations.length - 1]?.readings.forePoint ?? '';
          stations.push(station);
        }
        const ordered = stations.map((item, index) => ({ ...item, stationNumber: index + 1 }));
        return {
          currentRoute: recalculateLevelingRoute({ ...editable, stations: ordered }),
          isDirty: true,
          lastAddedStationId: station.id,
        };
      }),
      setStationDirection: (stationId, direction) => set((state) => {
        const editable = prepareEditableRoute(state.currentRoute);
        return {
          currentRoute: recalculateLevelingRoute({
            ...editable,
            stations: editable.stations.map((station) => station.id === stationId ? { ...station, direction } : station),
          }),
          isDirty: true,
        };
      }),
      updateStationReading: (stationId, updates) => set((state) => {
        const editable = prepareEditableRoute(state.currentRoute);
        return {
          currentRoute: recalculateLevelingRoute({
            ...editable,
            stations: editable.stations.map((station) => station.id === stationId
              ? { ...station, readings: { ...station.readings, ...updates } }
              : station),
          }),
          isDirty: true,
        };
      }),
      deleteStation: (stationId) => set((state) => {
        const editable = prepareEditableRoute(state.currentRoute);
        const stations = editable.stations
          .filter((station) => station.id !== stationId)
          .map((station, index) => ({ ...station, stationNumber: index + 1 }));
        return {
          currentRoute: recalculateLevelingRoute({
            ...editable,
            stations,
            returnStartStationId: editable.returnStartStationId === stationId
              ? deriveReturnStartStationId(stations)
              : editable.returnStartStationId,
          }),
          isDirty: true,
        };
      }),
      addIntermediate: (stationId) => set((state) => {
        const editable = prepareEditableRoute(state.currentRoute);
        return {
          currentRoute: recalculateLevelingRoute({
          ...editable,
          stations: editable.stations.map((station) => station.id === stationId
            ? {
                ...station,
                readings: {
                  ...station.readings,
                  intermediates: [...station.readings.intermediates, { id: generateUUID(), point: '', black: '', red: '', distance: '' }],
                },
              }
            : station),
          }),
          isDirty: true,
        };
      }),
      updateIntermediate: (stationId, intermediateId, field, value) => set((state) => {
        const editable = prepareEditableRoute(state.currentRoute);
        return {
          currentRoute: recalculateLevelingRoute({
          ...editable,
          stations: editable.stations.map((station) => station.id === stationId
            ? {
                ...station,
                readings: {
                  ...station.readings,
                  intermediates: station.readings.intermediates.map((intermediate) => intermediate.id === intermediateId
                    ? { ...intermediate, [field]: value }
                    : intermediate),
                },
              }
            : station),
          }),
          isDirty: true,
        };
      }),
      removeIntermediate: (stationId, intermediateId) => set((state) => {
        const editable = prepareEditableRoute(state.currentRoute);
        return {
          currentRoute: recalculateLevelingRoute({
          ...editable,
          stations: editable.stations.map((station) => station.id === stationId
            ? {
                ...station,
                readings: {
                  ...station.readings,
                  intermediates: station.readings.intermediates.filter((intermediate) => intermediate.id !== intermediateId),
                },
              }
            : station),
          }),
          isDirty: true,
        };
      }),
      commitRoute: (mode) => set((state) => {
        const now = new Date().toISOString();
        const recalculated = recalculateLevelingRoute({ ...state.currentRoute, updatedAt: now });
        if (mode === 'overwrite') {
          const committed = deepCloneRoute(recalculated);
          const exists = state.routes.some((route) => route.id === committed.id);
          return {
            routes: exists
              ? state.routes.map((route) => route.id === committed.id ? committed : route)
              : [committed, ...state.routes],
            currentRoute: deepCloneRoute(committed),
            isDirty: false,
          };
        }
        const id = generateUUID();
        const committed = recalculateLevelingRoute({
          ...recalculated,
          id,
          parentId: recalculated.completionStatus === 'revision' ? recalculated.parentId : undefined,
          createdAt: now,
          updatedAt: now,
        });
        return { routes: [deepCloneRoute(committed), ...state.routes], currentRoute: committed, isDirty: false };
      }),
      completeRoute: () => set((state) => {
        if (!state.currentRoute.calculation.isComplete) return state;
        const now = new Date().toISOString();
        const completed = recalculateLevelingRoute(applySelectedLevelingInstrument({
            ...state.currentRoute,
            completionStatus: 'completed',
            completedAt: now,
            endTime: state.currentRoute.endTime ?? now,
            updatedAt: now,
          }));
        useGovernanceStore.getState().recordAudit({
          module: 'leveling', recordId: completed.id, action: 'complete', reason: '完成水准成果', before: state.currentRoute, after: completed,
        });
        const snapshot = deepCloneRoute(completed);
        return {
          currentRoute: deepCloneRoute(snapshot),
          routes: state.routes.some((route) => route.id === snapshot.id)
            ? state.routes.map((route) => route.id === snapshot.id ? snapshot : route)
            : [snapshot, ...state.routes],
          isDirty: false,
        };
      }),
      applySelectedInstrument: () => set((state) => {
        const editable = prepareEditableRoute(state.currentRoute);
        return {
          currentRoute: recalculateLevelingRoute(applySelectedLevelingInstrument(editable)),
          isDirty: true,
        };
      }),
      transitionRouteStatus: (status) => set((state) => {
        if (state.currentRoute.completionStatus === 'draft' || state.currentRoute.completionStatus === 'revision') return state;
        const before = state.currentRoute;
        const after = recalculateLevelingRoute({ ...before, completionStatus: status, updatedAt: new Date().toISOString() });
        useGovernanceStore.getState().recordAudit({
          module: 'leveling', recordId: before.id, action: status === 'archived' ? 'archive' : 'review', before, after,
        });
        const snapshot = deepCloneRoute(after);
        return {
          currentRoute: deepCloneRoute(snapshot),
          routes: state.routes.map((route) => route.id === snapshot.id ? snapshot : route),
          isDirty: false,
        };
      }),
      loadRoute: (routeId) => set((state) => {
        const route = state.routes.find((candidate) => candidate.id === routeId);
        return route ? { currentRoute: recalculateLevelingRoute(deepCloneRoute(route)), isDirty: false } : state;
      }),
      exportCurrentRouteJSON: () => {
        const route = get().currentRoute;
        const blob = new Blob([JSON.stringify(route, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        const date = new Date(route.startTime ?? route.createdAt);
        const datePart = Number.isFinite(date.getTime())
          ? `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}_${String(date.getHours()).padStart(2, '0')}${String(date.getMinutes()).padStart(2, '0')}`
          : '未定时间';
        anchor.href = url;
        anchor.download = `${sanitizeFilename([route.location, route.name, datePart].filter(Boolean).join('_'))}.json`;
        anchor.click();
        setTimeout(() => URL.revokeObjectURL(url), 0);
      },
      exportData: async () => {
        const route = deepCloneRoute(get().currentRoute);
        const { exportLevelingExcel } = await import('../lib/exportLeveling');
        await exportLevelingExcel(route);
      },
      importBackup: (data) => set((state) => {
        const source = isRecord(data) && data.currentRoute ? data.currentRoute : data;
        const imported = normalizeLevelingRoute(source);
        const now = new Date().toISOString();
        const id = generateUUID();
        const route = recalculateLevelingRoute({
          ...imported,
          id,
          parentId: id,
          completionStatus: 'draft',
          createdAt: now,
          updatedAt: now,
        });
        return { currentRoute: route, routes: [deepCloneRoute(route), ...state.routes], isDirty: false };
      }),
    }),
    {
      name: 'leveling-data',
      version: LEVELING_SCHEMA_VERSION,
      storage: createJSONStorage(() => storage),
      migrate: (persistedState) => migrateLevelingPersistedState(persistedState),
      partialize: (state) => ({ currentRoute: state.currentRoute, routes: state.routes, isDirty: state.isDirty }),
      onRehydrateStorage: () => (state, error) => {
        if (error) {
          console.error('[levelingStore] 持久化数据恢复失败', error);
          useGovernanceStore.getState().recordDiagnostic('persistence');
        }
        state?.setHasHydrated(true);
      },
    },
  ),
);

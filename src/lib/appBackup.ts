import { App as CapacitorApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { integrityHash } from './dataIntegrity';
import { migrateHydroPersistedState, useHydroStore } from '../store/hydroStore';
import type { PersistedHydroState } from '../store/hydroStore';
import { migrateLevelingPersistedState, useLevelingStore } from '../store/levelingStore';
import type { PersistedLevelingState } from '../store/levelingStore';
import { migrateGovernanceState, useGovernanceStore } from '../store/governanceStore';
import type { GovernancePersistedState } from '../store/governanceStore';
import { BACKUP_SCHEMA_VERSION } from '../types/governance';

const BACKUP_KIND = 'hydro-terminal-full-backup';
const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'test';

export interface FullBackupPayload {
  hydro: PersistedHydroState;
  leveling: PersistedLevelingState;
  governance: GovernancePersistedState;
}

export interface FullBackupFile {
  kind: typeof BACKUP_KIND;
  schemaVersion: number;
  appVersion: string;
  exportedAt: string;
  integrity: {
    algorithm: 'fnv1a64';
    value: string;
  };
  payload: FullBackupPayload;
}

export interface AppDiagnostic {
  schemaVersion: 1;
  appVersion: string;
  generatedAt: string;
  runtime: {
    platform: string;
    native: boolean;
    packageName?: string;
    packageVersion?: string;
    language: string;
    screen: { width: number; height: number; pixelRatio: number };
  };
  hydration: { flow: boolean; leveling: boolean; governance: boolean };
  counts: { flowRecords: number; levelingRecords: number; instruments: number; audits: number };
  recentErrorCategories: Array<{ timestamp: string; category: string }>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function clone<T>(value: T): T {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

function backupPayload(): FullBackupPayload {
  const hydro = useHydroStore.getState();
  const leveling = useLevelingStore.getState();
  const governance = useGovernanceStore.getState();
  return clone({
    hydro: { currentRun: hydro.currentRun, runs: hydro.runs, templates: hydro.templates },
    leveling: { currentRoute: leveling.currentRoute, routes: leveling.routes, isDirty: leveling.isDirty },
    governance: {
      instruments: governance.instruments,
      ruleProfiles: governance.ruleProfiles,
      audits: governance.audits,
      diagnostics: governance.diagnostics,
      activeActor: governance.activeActor,
      revisionReason: governance.revisionReason,
      selectedFlowInstrumentId: governance.selectedFlowInstrumentId,
      selectedLevelingInstrumentId: governance.selectedLevelingInstrumentId,
    },
  });
}

export function createFullBackup(exportedAt = new Date().toISOString()): FullBackupFile {
  const payload = backupPayload();
  return {
    kind: BACKUP_KIND,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    appVersion: APP_VERSION,
    exportedAt,
    integrity: { algorithm: 'fnv1a64', value: integrityHash(payload) },
    payload,
  };
}

export function validateFullBackup(value: unknown): FullBackupFile {
  if (!isRecord(value)
    || value.kind !== BACKUP_KIND
    || value.schemaVersion !== BACKUP_SCHEMA_VERSION
    || typeof value.appVersion !== 'string' || value.appVersion.trim() === ''
    || typeof value.exportedAt !== 'string' || !Number.isFinite(Date.parse(value.exportedAt))
    || !isRecord(value.integrity) || value.integrity.algorithm !== 'fnv1a64'
    || typeof value.integrity.value !== 'string'
    || !isRecord(value.payload)) throw new Error('不是受支持的完整备份文件');

  const payload = value.payload;
  if (!isRecord(payload.hydro) || !isRecord(payload.hydro.currentRun)
    || !Array.isArray(payload.hydro.currentRun.verticals) || !Array.isArray(payload.hydro.runs) || !Array.isArray(payload.hydro.templates)
    || !isRecord(payload.leveling) || !isRecord(payload.leveling.currentRoute)
    || !Array.isArray(payload.leveling.currentRoute.stations) || !Array.isArray(payload.leveling.routes)
    || !isRecord(payload.governance) || !Array.isArray(payload.governance.instruments)
    || !Array.isArray(payload.governance.ruleProfiles) || !Array.isArray(payload.governance.audits)
    || !Array.isArray(payload.governance.diagnostics)) throw new Error('完整备份数据结构不完整');

  if (integrityHash(payload) !== value.integrity.value) throw new Error('完整备份校验失败，文件可能已损坏或被修改');

  const normalizedPayload: FullBackupPayload = {
    hydro: migrateHydroPersistedState(payload.hydro),
    leveling: migrateLevelingPersistedState(payload.leveling),
    governance: migrateGovernanceState(payload.governance),
  };
  return {
    kind: BACKUP_KIND,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    appVersion: value.appVersion,
    exportedAt: new Date(value.exportedAt).toISOString(),
    integrity: { algorithm: 'fnv1a64', value: integrityHash(normalizedPayload) },
    payload: normalizedPayload,
  };
}

export function restoreFullBackup(value: unknown): FullBackupFile {
  const validated = validateFullBackup(value);
  const previous = backupPayload();
  try {
    const payload = clone(validated.payload);
    useHydroStore.setState({ ...payload.hydro, isDirty: false });
    useLevelingStore.setState({ ...payload.leveling, isDirty: false, lastAddedStationId: null, showHistoryPanel: false });
    useGovernanceStore.getState().replaceGovernance(payload.governance);
    useGovernanceStore.getState().recordAudit({
      module: 'backup', recordId: validated.exportedAt, action: 'restore', reason: `恢复 v${validated.appVersion} 完整备份`, before: previous, after: payload,
    });
    return validated;
  } catch (error) {
    useHydroStore.setState({ ...previous.hydro, isDirty: false });
    useLevelingStore.setState({ ...previous.leveling, isDirty: false });
    useGovernanceStore.getState().replaceGovernance(previous.governance);
    useGovernanceStore.getState().recordDiagnostic('backup');
    throw error;
  }
}

function safeFilePart(value: string): string {
  return Array.from(value, (character) => '<>:"/\\|?*'.includes(character) || character.charCodeAt(0) < 32 ? '_' : character)
    .join('').replace(/[. ]+$/g, '').trim() || 'hydro-terminal';
}

export async function shareJsonFile(fileName: string, value: unknown): Promise<void> {
  const safeName = safeFilePart(fileName);
  const data = JSON.stringify(value, null, 2);
  if (Capacitor.isNativePlatform()) {
    const result = await Filesystem.writeFile({ path: safeName, data, directory: Directory.Cache, encoding: Encoding.UTF8 });
    try {
      await Share.share({ url: result.uri });
    } finally {
      void Filesystem.deleteFile({ path: safeName, directory: Directory.Cache }).catch(() => undefined);
    }
    return;
  }
  const url = URL.createObjectURL(new Blob([data], { type: 'application/json;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = safeName;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export async function exportFullBackup(): Promise<FullBackupFile> {
  const backup = createFullBackup();
  const stamp = backup.exportedAt.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  await shareJsonFile(`水文测验终端_完整备份_${stamp}.json`, backup);
  return backup;
}

export async function createAppDiagnostic(): Promise<AppDiagnostic> {
  const hydro = useHydroStore.getState();
  const leveling = useLevelingStore.getState();
  const governance = useGovernanceStore.getState();
  let packageName: string | undefined;
  let packageVersion: string | undefined;
  if (Capacitor.isNativePlatform()) {
    try {
      const info = await CapacitorApp.getInfo();
      packageName = info.id;
      packageVersion = info.version;
    } catch {
      governance.recordDiagnostic('android-test');
    }
  }
  return {
    schemaVersion: 1,
    appVersion: APP_VERSION,
    generatedAt: new Date().toISOString(),
    runtime: {
      platform: Capacitor.getPlatform(),
      native: Capacitor.isNativePlatform(),
      packageName,
      packageVersion,
      language: typeof navigator === 'undefined' ? 'unknown' : navigator.language,
      screen: typeof window === 'undefined'
        ? { width: 0, height: 0, pixelRatio: 1 }
        : { width: window.screen.width, height: window.screen.height, pixelRatio: window.devicePixelRatio },
    },
    hydration: { flow: hydro._hasHydrated, leveling: leveling.hasHydrated, governance: governance.hydrated },
    counts: { flowRecords: hydro.runs.length, levelingRecords: leveling.routes.length, instruments: governance.instruments.length, audits: governance.audits.length },
    recentErrorCategories: governance.diagnostics.map(({ timestamp, category }) => ({ timestamp, category })),
  };
}

export async function exportAppDiagnostic(): Promise<AppDiagnostic> {
  const diagnostic = await createAppDiagnostic();
  await shareJsonFile(`水文测验终端_诊断_${diagnostic.generatedAt.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')}.json`, diagnostic);
  return diagnostic;
}

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { integrityHash } from '../lib/dataIntegrity';
import { DEFAULT_LEVELING_RULE_PROFILE, normalizeLevelingRuleProfile } from '../lib/levelingRules';
import { createPlatformStateStorage } from '../lib/persistence';
import type {
  DiagnosticEvent,
  InstrumentKind,
  InstrumentProfile,
  InstrumentSnapshot,
  InstrumentStatus,
  LevelingRuleProfile,
  RevisionAuditEntry,
} from '../types/governance';
import { GOVERNANCE_SCHEMA_VERSION } from '../types/governance';

function generateId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `local-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function deepClone<T>(value: T): T {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function optionalText(value: unknown): string | undefined {
  const valueText = text(value).trim();
  return valueText || undefined;
}

function instrumentKind(value: unknown): InstrumentKind {
  return value === 'current-meter' || value === 'level' || value === 'staff' || value === 'other' ? value : 'other';
}

function instrumentStatus(value: unknown): InstrumentStatus {
  return value === 'unregistered' || value === 'valid' || value === 'expired' || value === 'disabled' ? value : 'unregistered';
}

function isoOrNow(value: unknown, now: string): string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : now;
}

export function normalizeInstrumentProfile(value: unknown): InstrumentProfile | null {
  if (!isRecord(value)) return null;
  const now = new Date().toISOString();
  const meterFormula = isRecord(value.meterFormula)
    && typeof value.meterFormula.k === 'number' && Number.isFinite(value.meterFormula.k)
    && typeof value.meterFormula.c === 'number' && Number.isFinite(value.meterFormula.c)
    ? { k: value.meterFormula.k, c: value.meterFormula.c }
    : undefined;
  return {
    id: text(value.id) || generateId(),
    kind: instrumentKind(value.kind),
    name: text(value.name) || '未命名仪器',
    model: text(value.model),
    serialNumber: text(value.serialNumber),
    meterFormula,
    additiveConstant: optionalText(value.additiveConstant),
    certificateNumber: text(value.certificateNumber),
    verificationDate: optionalText(value.verificationDate),
    validUntil: optionalText(value.validUntil),
    status: instrumentStatus(value.status),
    notes: text(value.notes),
    createdAt: isoOrNow(value.createdAt, now),
    updatedAt: isoOrNow(value.updatedAt, now),
  };
}

export function normalizeInstrumentSnapshot(value: unknown): InstrumentSnapshot | undefined {
  if (!isRecord(value) || typeof value.id !== 'string' || value.id.trim() === ''
    || typeof value.name !== 'string' || value.name.trim() === ''
    || (value.kind !== 'current-meter' && value.kind !== 'level' && value.kind !== 'staff' && value.kind !== 'other')) return undefined;
  const profile = normalizeInstrumentProfile(value);
  if (!profile) return undefined;
  return {
    ...profile,
    capturedAt: isoOrNow(value.capturedAt, profile.updatedAt),
  };
}

export function effectiveInstrumentStatus(profile: InstrumentProfile, now = new Date()): InstrumentStatus {
  if (profile.status === 'disabled' || profile.status === 'unregistered') return profile.status;
  if (profile.validUntil) {
    const validUntil = new Date(`${profile.validUntil}T23:59:59.999`);
    if (Number.isFinite(validUntil.getTime()) && validUntil.getTime() < now.getTime()) return 'expired';
  }
  return profile.status;
}

function unregisteredInstrument(id: string, kind: InstrumentKind, name: string): InstrumentProfile {
  const createdAt = '2026-07-29T00:00:00.000Z';
  return {
    id,
    kind,
    name,
    model: '',
    serialNumber: '',
    certificateNumber: '',
    status: 'unregistered',
    notes: '旧数据或当前任务尚未选择已登记仪器',
    createdAt,
    updatedAt: createdAt,
  };
}

export const UNREGISTERED_FLOW_INSTRUMENT = unregisteredInstrument('unregistered-flow-meter', 'current-meter', '未登记流速仪');
export const UNREGISTERED_LEVEL_INSTRUMENT = unregisteredInstrument('unregistered-level', 'level', '未登记水准仪');

interface AuditInput {
  module: RevisionAuditEntry['module'];
  recordId: string;
  action: RevisionAuditEntry['action'];
  reason?: string;
  before: unknown;
  after: unknown;
}

export interface GovernancePersistedState {
  instruments: InstrumentProfile[];
  ruleProfiles: LevelingRuleProfile[];
  audits: RevisionAuditEntry[];
  diagnostics: DiagnosticEvent[];
  activeActor: string;
  revisionReason: string;
  selectedFlowInstrumentId: string;
  selectedLevelingInstrumentId: string;
}

export function migrateGovernanceState(value: unknown): GovernancePersistedState {
  const source = isRecord(value) ? value : {};
  const normalized = (Array.isArray(source.instruments) ? source.instruments : [])
    .map(normalizeInstrumentProfile)
    .filter((instrument): instrument is InstrumentProfile => instrument !== null);
  const candidateInstruments = [UNREGISTERED_FLOW_INSTRUMENT, UNREGISTERED_LEVEL_INSTRUMENT]
    .map(deepClone)
    .concat(normalized.filter((instrument) => !instrument.id.startsWith('unregistered-')));
  const seenInstrumentIds = new Set<string>();
  const instruments = candidateInstruments.filter((instrument) => {
    if (seenInstrumentIds.has(instrument.id)) return false;
    seenInstrumentIds.add(instrument.id);
    return true;
  });
  const customRules = (Array.isArray(source.ruleProfiles) ? source.ruleProfiles : [])
    .map(normalizeLevelingRuleProfile)
    .filter((profile): profile is LevelingRuleProfile => profile !== null && profile.id !== DEFAULT_LEVELING_RULE_PROFILE.id);
  const audits = (Array.isArray(source.audits) ? source.audits : []).flatMap((value): RevisionAuditEntry[] => {
    if (!isRecord(value)
      || typeof value.id !== 'string'
      || (value.module !== 'flow' && value.module !== 'leveling' && value.module !== 'governance' && value.module !== 'backup')
      || (value.action !== 'complete' && value.action !== 'revise' && value.action !== 'review' && value.action !== 'archive' && value.action !== 'restore' && value.action !== 'import')
      || typeof value.recordId !== 'string'
      || typeof value.timestamp !== 'string' || !Number.isFinite(Date.parse(value.timestamp))
      || typeof value.beforeHash !== 'string' || !value.beforeHash.startsWith('fnv1a64:')
      || typeof value.afterHash !== 'string' || !value.afterHash.startsWith('fnv1a64:')) return [];
    return [{
      id: value.id,
      module: value.module,
      recordId: value.recordId,
      action: value.action,
      actor: text(value.actor) || '未填写',
      reason: text(value.reason) || '未填写',
      timestamp: new Date(value.timestamp).toISOString(),
      beforeHash: value.beforeHash,
      afterHash: value.afterHash,
    }];
  }).slice(-500);
  const diagnostics = (Array.isArray(source.diagnostics) ? source.diagnostics : []).flatMap((value): DiagnosticEvent[] => {
    if (!isRecord(value)
      || typeof value.id !== 'string'
      || typeof value.timestamp !== 'string' || !Number.isFinite(Date.parse(value.timestamp))
      || (value.category !== 'javascript' && value.category !== 'promise' && value.category !== 'persistence' && value.category !== 'backup' && value.category !== 'android-test')) return [];
    return [{ id: value.id, timestamp: new Date(value.timestamp).toISOString(), category: value.category }];
  }).slice(-20);
  const ruleProfiles = [deepClone(DEFAULT_LEVELING_RULE_PROFILE), ...customRules.map(deepClone)]
    .filter((profile, index, all) => all.findIndex((candidate) => candidate.id === profile.id) === index);
  const selectedFlowCandidate = text(source.selectedFlowInstrumentId);
  const selectedLevelCandidate = text(source.selectedLevelingInstrumentId);
  const selectedFlowInstrumentId = instruments.some((instrument) => instrument.id === selectedFlowCandidate && instrument.kind === 'current-meter')
    ? selectedFlowCandidate : UNREGISTERED_FLOW_INSTRUMENT.id;
  const selectedLevelingInstrumentId = instruments.some((instrument) => instrument.id === selectedLevelCandidate && (instrument.kind === 'level' || instrument.kind === 'staff'))
    ? selectedLevelCandidate : UNREGISTERED_LEVEL_INSTRUMENT.id;
  return {
    instruments,
    ruleProfiles,
    audits,
    diagnostics,
    activeActor: text(source.activeActor),
    revisionReason: text(source.revisionReason),
    selectedFlowInstrumentId,
    selectedLevelingInstrumentId,
  };
}

export interface GovernanceState extends GovernancePersistedState {
  hydrated: boolean;
  setHydrated: (hydrated: boolean) => void;
  setActiveActor: (actor: string) => void;
  setRevisionReason: (reason: string) => void;
  setSelectedInstrument: (module: 'flow' | 'leveling', id: string) => void;
  addInstrument: (input: Omit<InstrumentProfile, 'id' | 'createdAt' | 'updatedAt'>) => InstrumentProfile;
  updateInstrument: (id: string, updates: Partial<InstrumentProfile>) => void;
  deleteInstrument: (id: string) => void;
  captureInstrument: (id: string) => InstrumentSnapshot | undefined;
  recordAudit: (input: AuditInput) => RevisionAuditEntry;
  recordDiagnostic: (category: DiagnosticEvent['category']) => void;
  replaceGovernance: (state: GovernancePersistedState) => void;
}

const storage = createPlatformStateStorage();

export const useGovernanceStore = create<GovernanceState>()(persist((set, get) => ({
  ...migrateGovernanceState({}),
  hydrated: false,
  setHydrated: (hydrated) => set({ hydrated }),
  setActiveActor: (activeActor) => set({ activeActor }),
  setRevisionReason: (revisionReason) => set({ revisionReason }),
  setSelectedInstrument: (module, id) => set((state) => {
    const candidate = state.instruments.find((instrument) => instrument.id === id);
    const allowed = candidate && (module === 'flow'
      ? candidate.kind === 'current-meter'
      : candidate.kind === 'level' || candidate.kind === 'staff');
    if (!allowed) return state;
    return module === 'flow' ? { selectedFlowInstrumentId: id } : { selectedLevelingInstrumentId: id };
  }),
  addInstrument: (input) => {
    const now = new Date().toISOString();
    const instrument: InstrumentProfile = { ...deepClone(input), id: generateId(), createdAt: now, updatedAt: now };
    set((state) => ({ instruments: [...state.instruments, instrument] }));
    return instrument;
  },
  updateInstrument: (id, updates) => set((state) => ({
    instruments: state.instruments.map((instrument) => instrument.id === id && !id.startsWith('unregistered-')
      ? { ...instrument, ...deepClone(updates), id, updatedAt: new Date().toISOString() }
      : instrument),
  })),
  deleteInstrument: (id) => set((state) => {
    if (id.startsWith('unregistered-')) return state;
    return {
      instruments: state.instruments.filter((instrument) => instrument.id !== id),
      selectedFlowInstrumentId: state.selectedFlowInstrumentId === id ? UNREGISTERED_FLOW_INSTRUMENT.id : state.selectedFlowInstrumentId,
      selectedLevelingInstrumentId: state.selectedLevelingInstrumentId === id ? UNREGISTERED_LEVEL_INSTRUMENT.id : state.selectedLevelingInstrumentId,
    };
  }),
  captureInstrument: (id) => {
    const instrument = get().instruments.find((candidate) => candidate.id === id);
    return instrument ? { ...deepClone(instrument), status: effectiveInstrumentStatus(instrument), capturedAt: new Date().toISOString() } : undefined;
  },
  recordAudit: (input) => {
    const entry: RevisionAuditEntry = {
      id: generateId(),
      module: input.module,
      recordId: input.recordId,
      action: input.action,
      actor: get().activeActor.trim() || '未填写',
      reason: input.reason?.trim() || get().revisionReason.trim() || '未填写',
      timestamp: new Date().toISOString(),
      beforeHash: integrityHash(input.before),
      afterHash: integrityHash(input.after),
    };
    set((state) => ({ audits: [...state.audits.slice(-499), entry] }));
    return entry;
  },
  recordDiagnostic: (category) => {
    const diagnostics = get().diagnostics;
    const last = diagnostics[diagnostics.length - 1];
    if (last?.category === category && Date.now() - Date.parse(last.timestamp) < 5_000) return;
    set((state) => ({
      diagnostics: [...state.diagnostics.slice(-19), { id: generateId(), timestamp: new Date().toISOString(), category }],
    }));
  },
  replaceGovernance: (state) => set({ ...migrateGovernanceState(state) }),
}), {
  name: 'hydro-governance',
  version: GOVERNANCE_SCHEMA_VERSION,
  storage: createJSONStorage(() => storage),
  migrate: (state) => migrateGovernanceState(state),
  partialize: (state) => ({
    instruments: state.instruments,
    ruleProfiles: state.ruleProfiles,
    audits: state.audits,
    diagnostics: state.diagnostics,
    activeActor: state.activeActor,
    revisionReason: state.revisionReason,
    selectedFlowInstrumentId: state.selectedFlowInstrumentId,
    selectedLevelingInstrumentId: state.selectedLevelingInstrumentId,
  }),
  onRehydrateStorage: () => (state, error) => {
    if (error) {
      console.error('[governanceStore] 持久化数据恢复失败', error);
      state?.recordDiagnostic('persistence');
    }
    state?.setHydrated(true);
  },
}));

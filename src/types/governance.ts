import type { LevelingGrade, StaffConstant } from './leveling';
import type { MeterFormula } from './index';

export const GOVERNANCE_SCHEMA_VERSION = 1;
export const BACKUP_SCHEMA_VERSION = 1;

export type RecordLifecycleStatus = 'draft' | 'completed' | 'pending_review' | 'reviewed' | 'archived' | 'revision';
export type InstrumentKind = 'current-meter' | 'level' | 'staff' | 'other';
export type InstrumentStatus = 'unregistered' | 'valid' | 'expired' | 'disabled';

export interface GradeToleranceProfile {
  maxSightDistance: number;
  maxDistanceDiff: number;
  maxAccumulatedDiff: number;
  maxBlackRedDiff: number | null;
  maxDeltaDiff: number | null;
}

export interface ClosureRuleProfile {
  distanceCoefficient: number | null;
  stationCoefficient: number;
  useStationFormulaAlways: boolean;
}

export interface LevelingRuleProfile {
  id: string;
  version: string;
  name: string;
  approved: boolean;
  source: string;
  createdAt: string;
  tolerances: Record<LevelingGrade, GradeToleranceProfile>;
  closureRules: Record<LevelingGrade, ClosureRuleProfile>;
  staffConstants: readonly StaffConstant[];
}

export interface RuleProfileSnapshot extends LevelingRuleProfile {
  capturedAt: string;
}

export interface InstrumentProfile {
  id: string;
  kind: InstrumentKind;
  name: string;
  model: string;
  serialNumber: string;
  meterFormula?: MeterFormula;
  additiveConstant?: string;
  certificateNumber: string;
  verificationDate?: string;
  validUntil?: string;
  status: InstrumentStatus;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface InstrumentSnapshot extends InstrumentProfile {
  capturedAt: string;
}

export interface RevisionAuditEntry {
  id: string;
  module: 'flow' | 'leveling' | 'governance' | 'backup';
  recordId: string;
  action: 'complete' | 'revise' | 'review' | 'archive' | 'restore' | 'import';
  actor: string;
  reason: string;
  timestamp: string;
  beforeHash: string;
  afterHash: string;
}

export interface DiagnosticEvent {
  id: string;
  timestamp: string;
  category: 'javascript' | 'promise' | 'persistence' | 'backup' | 'android-test';
}

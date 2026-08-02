import type { InstrumentKind, InstrumentSnapshot, InstrumentStatus } from '../types/governance';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function instrumentKind(value: unknown): InstrumentKind | null {
  return value === 'current-meter' || value === 'level' || value === 'staff' || value === 'other' ? value : null;
}

function instrumentStatus(value: unknown): InstrumentStatus {
  return value === 'valid' || value === 'expired' || value === 'disabled' ? value : 'unregistered';
}

function optionalText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function isoOrFallback(value: unknown, fallback: string): string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
    ? new Date(value).toISOString()
    : fallback;
}

/** Decode legacy task snapshots without loading removed governance features. */
export function normalizeInstrumentSnapshot(value: unknown): InstrumentSnapshot | undefined {
  if (!isRecord(value)) return undefined;
  const id = optionalText(value.id);
  const name = optionalText(value.name);
  const kind = instrumentKind(value.kind);
  if (!id || !name || !kind) return undefined;

  const now = new Date().toISOString();
  const updatedAt = isoOrFallback(value.updatedAt, now);
  const meterFormula = isRecord(value.meterFormula)
    && typeof value.meterFormula.k === 'number' && Number.isFinite(value.meterFormula.k)
    && typeof value.meterFormula.c === 'number' && Number.isFinite(value.meterFormula.c)
    ? { k: value.meterFormula.k, c: value.meterFormula.c }
    : undefined;

  return {
    id,
    kind,
    name,
    model: typeof value.model === 'string' ? value.model : '',
    serialNumber: typeof value.serialNumber === 'string' ? value.serialNumber : '',
    meterFormula,
    additiveConstant: optionalText(value.additiveConstant),
    certificateNumber: typeof value.certificateNumber === 'string' ? value.certificateNumber : '',
    verificationDate: optionalText(value.verificationDate),
    validUntil: optionalText(value.validUntil),
    status: instrumentStatus(value.status),
    notes: typeof value.notes === 'string' ? value.notes : '',
    createdAt: isoOrFallback(value.createdAt, updatedAt),
    updatedAt,
    capturedAt: isoOrFallback(value.capturedAt, updatedAt),
  };
}

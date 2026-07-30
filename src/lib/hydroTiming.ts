import type { Run } from '../types';

const LEGACY_TIME_PATTERN = /^(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})$/;

function validDate(value: Date): boolean {
  return Number.isFinite(value.getTime());
}

export function formatLegacyRunTime(value: Date): string {
  return `${value.getMonth() + 1}/${value.getDate()} ${String(value.getHours()).padStart(2, '0')}:${String(value.getMinutes()).padStart(2, '0')}`;
}

export function durationLabel(startAt: string, endAt: string): string {
  const start = new Date(startAt);
  const end = new Date(endAt);
  if (!validDate(start) || !validDate(end) || end.getTime() < start.getTime()) return '';
  const minutes = Math.floor((end.getTime() - start.getTime()) / 60_000);
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}小时${String(minutes % 60).padStart(2, '0')}分`;
}

/** 将旧 M/D HH:mm 字段恢复为最接近 reference 且不晚于 reference 的完整时间。 */
export function legacyTimeToIso(value: string | undefined, reference: Date): string | undefined {
  const match = value?.trim().match(LEGACY_TIME_PATTERN);
  if (!match || !validDate(reference)) return undefined;
  const [, monthText, dayText, hourText, minuteText] = match;
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return undefined;

  let candidate = new Date(reference.getFullYear(), month - 1, day, hour, minute, 0, 0);
  if (!validDate(candidate)
    || candidate.getMonth() !== month - 1
    || candidate.getDate() !== day) return undefined;
  if (candidate.getTime() > reference.getTime()) {
    candidate = new Date(reference.getFullYear() - 1, month - 1, day, hour, minute, 0, 0);
  }
  return validDate(candidate) ? candidate.toISOString() : undefined;
}

function legacyEndTimeToIso(value: string | undefined, startAt: string): string | undefined {
  const start = new Date(startAt);
  const match = value?.trim().match(LEGACY_TIME_PATTERN);
  if (!validDate(start) || !match) return undefined;
  const [, monthText, dayText, hourText, minuteText] = match;
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return undefined;
  let candidate = new Date(start.getFullYear(), month - 1, day, hour, minute, 0, 0);
  if (!validDate(candidate) || candidate.getMonth() !== month - 1 || candidate.getDate() !== day) return undefined;
  if (candidate.getTime() < start.getTime()) {
    candidate = new Date(start.getFullYear() + 1, month - 1, day, hour, minute, 0, 0);
  }
  return validDate(candidate) ? candidate.toISOString() : undefined;
}

export function normalizeRunTimestamps(run: Run): Run {
  const timestampReference = new Date(run.endAt || run.timestamp);
  const reference = validDate(timestampReference) ? timestampReference : new Date();
  const parsedStart = run.startAt && validDate(new Date(run.startAt))
    ? new Date(run.startAt).toISOString()
    : legacyTimeToIso(run.startTime, reference);
  const parsedEnd = run.endAt && validDate(new Date(run.endAt))
    ? new Date(run.endAt).toISOString()
    : parsedStart
      ? legacyEndTimeToIso(run.endTime, parsedStart)
      : legacyTimeToIso(run.endTime, reference);
  return {
    ...run,
    startAt: parsedStart,
    endAt: parsedEnd,
    duration: parsedStart && parsedEnd ? durationLabel(parsedStart, parsedEnd) : run.duration,
  };
}

export function markHydroRunTime(run: Run, type: 'start' | 'end', now = new Date()): Run {
  if (!validDate(now)) return run;
  const nowIso = now.toISOString();
  const legacy = formatLegacyRunTime(now);
  if (type === 'start') {
    return {
      ...run,
      timestamp: nowIso,
      startAt: nowIso,
      startTime: legacy,
      endAt: undefined,
      endTime: '',
      duration: '',
    };
  }

  const normalized = normalizeRunTimestamps(run);
  if (!normalized.startAt) return run;
  const duration = durationLabel(normalized.startAt, nowIso);
  if (!duration) return run;
  return {
    ...normalized,
    endAt: nowIso,
    endTime: legacy,
    duration,
  };
}

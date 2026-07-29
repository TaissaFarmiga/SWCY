/**
 * 水文测验数据修约工具 — GB 50179-2015 附录C 精度规范
 *
 * ┌──────────┬────────┬──────────┬──────────┐
 * │ 测验要素   │ 单位    │ 记录位数   │ 计算位数   │
 * ├──────────┼────────┼──────────┼──────────┤
 * │ 水深      │ m      │ 0.01     │ 0.01     │
 * │ 流速      │ m/s    │ 0.01     │ 0.001    │
 * │ 断面面积   │ m²     │ 0.01     │ 0.001    │
 * │ 流量      │ m³/s   │ 0.001    │ 0.0001   │
 * │ 含沙量    │ kg/m³  │ 0.001    │ 0.0001   │
 * └──────────┴────────┴──────────┴──────────┘
 *
 * 原则：
 *   - 中间计算过程必须使用【计算位数】
 *   - 最终归档存入记录时切换为【成果取位/记录位数】
 *   - 统一使用四舍六入五成双（GB/T 8170 Banker's Rounding）
 */
import Decimal from 'decimal.js';

Decimal.set({ rounding: Decimal.ROUND_HALF_EVEN });

export type NumericInput = number | string | Decimal;

/**
 * 严格转换有限数。空值、空字符串、NaN、Infinity 和非法文本返回 null。
 * 不把“未输入”降级为 0。
 */
export function toFiniteDecimal(value: unknown): Decimal | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  if (
    typeof value !== 'string'
    && typeof value !== 'number'
    && !(value instanceof Decimal)
  ) {
    return null;
  }

  try {
    const decimal = new Decimal(value);
    return decimal.isFinite() ? decimal : null;
  } catch {
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════
// 底层：四舍六入五成双（按小数位）
// ═══════════════════════════════════════════════════════════════════

export function roundBanker(value: NumericInput, decimals: number): string {
  const d = toFiniteDecimal(value);
  if (!d) throw new RangeError('只能修约有限数');
  return d.toDecimalPlaces(decimals, Decimal.ROUND_HALF_EVEN).toFixed(decimals);
}

export function roundBankerNumber(value: NumericInput, decimals: number): number {
  const d = toFiniteDecimal(value);
  if (!d) throw new RangeError('只能修约有限数');
  return d.toDecimalPlaces(decimals, Decimal.ROUND_HALF_EVEN).toNumber();
}

/** 显示层格式化；非法值明确显示占位符。 */
export function formatFinite(
  value: unknown,
  decimals: number,
  fallback = '--',
): string {
  const decimal = toFiniteDecimal(value);
  return decimal ? roundBanker(decimal, decimals) : fallback;
}

/** 固定位显示会变成假 0 时，改用同一五成双策略的科学计数法。 */
export function formatFiniteAdaptive(
  value: unknown,
  decimals: number,
  significantDigits = 6,
  fallback = '--',
): string {
  const decimal = toFiniteDecimal(value);
  if (!decimal) return fallback;
  const fixedDisplayThreshold = new Decimal(10).pow(-decimals);
  if (!decimal.isZero() && decimal.abs().lessThan(fixedDisplayThreshold)) {
    return decimal.toExponential(significantDigits - 1, Decimal.ROUND_HALF_EVEN);
  }
  return roundBanker(decimal, decimals);
}

// ═══════════════════════════════════════════════════════════════════
// 水深 — 记录位数 0.01，计算位数 0.01（记录=计算）
// ═══════════════════════════════════════════════════════════════════

/** 水深记录/成果取位：0.01 m */
export function roundDepth(value: NumericInput): string {
  return roundBanker(value, 2);
}

/** 水深数值修约：0.01 */
export function roundDepthNumber(value: NumericInput): number {
  return roundBankerNumber(value, 2);
}

// ═══════════════════════════════════════════════════════════════════
// 起点距 — 0.01 m
// ═══════════════════════════════════════════════════════════════════

export function roundDistance(value: NumericInput): string {
  return roundBanker(value, 2);
}

// ═══════════════════════════════════════════════════════════════════
// 流速 — 记录位数 0.01，计算位数 0.001
// ═══════════════════════════════════════════════════════════════════

/** 流速计算过程修约：0.001 m/s（中间计算使用） */
export function roundVelocityCalc(value: NumericInput): number {
  return roundBankerNumber(value, 3);
}

/** 流速成果/记录取位：0.01 m/s */
export function roundVelocity(value: NumericInput): string {
  return roundBanker(value, 2);
}

/** 流速数值修约（记录位数）：0.01 */
export function roundVelocityNumber(value: NumericInput): number {
  return roundBankerNumber(value, 2);
}

// ═══════════════════════════════════════════════════════════════════
// 断面面积 — 记录位数 0.01，计算位数 0.001
// ═══════════════════════════════════════════════════════════════════

/** 面积计算过程修约：0.001 m²（中间计算使用） */
export function roundAreaCalc(value: NumericInput): number {
  return roundBankerNumber(value, 3);
}

/** 面积成果/记录取位：0.01 m² */
export function roundArea(value: NumericInput): string {
  return roundBanker(value, 2);
}

/** 面积数值修约（记录位数）：0.01 */
export function roundAreaNumber(value: NumericInput): number {
  return roundBankerNumber(value, 2);
}

// ═══════════════════════════════════════════════════════════════════
// 流量 — 记录位数 0.001，计算位数 0.0001
// ═══════════════════════════════════════════════════════════════════

/** 流量计算过程修约：0.0001 m³/s（中间计算使用） */
export function roundDischargeCalc(value: NumericInput): number {
  return roundBankerNumber(value, 4);
}

/** 流量成果/记录取位：0.001 m³/s */
export function roundDischarge(value: NumericInput): string {
  return roundBanker(value, 3);
}

/** 流量数值修约（记录位数）：0.001 */
export function roundDischargeNumber(value: NumericInput): number {
  return roundBankerNumber(value, 3);
}

// ═══════════════════════════════════════════════════════════════════
// 辅助工具
// ═══════════════════════════════════════════════════════════════════

export function round(value: NumericInput, decimals: number): string {
  return roundBanker(value, decimals);
}

export function safeDivide(
  numerator: Decimal.Value,
  denominator: Decimal.Value,
): Decimal | null {
  const numeratorValue = toFiniteDecimal(numerator);
  const denominatorValue = toFiniteDecimal(denominator);
  if (!numeratorValue || !denominatorValue || denominatorValue.isZero()) return null;
  return numeratorValue.div(denominatorValue);
}

export function safeSum(...values: (Decimal.Value | undefined | null)[]): Decimal {
  return values
    .map(toFiniteDecimal)
    .filter((value): value is Decimal => value !== null)
    .reduce((sum, value) => sum.plus(value), new Decimal(0));
}

export function safeAverage(
  ...values: (Decimal.Value | undefined | null)[]
): Decimal | null {
  const validValues = values
    .map(toFiniteDecimal)
    .filter((value): value is Decimal => value !== null);
  if (validValues.length === 0) return null;
  return safeSum(...validValues).div(validValues.length);
}

export { Decimal };

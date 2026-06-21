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

// ═══════════════════════════════════════════════════════════════════
// 底层：四舍六入五成双（按小数位）
// ═══════════════════════════════════════════════════════════════════

export function roundBanker(value: number | string | Decimal, decimals: number): string {
  const d = new Decimal(value);
  if (d.isNaN()) return '0';
  return d.toDecimalPlaces(decimals, Decimal.ROUND_HALF_EVEN).toFixed(decimals);
}

export function roundBankerNumber(value: number | string | Decimal, decimals: number): number {
  const d = new Decimal(value);
  if (d.isNaN()) return 0;
  return d.toDecimalPlaces(decimals, Decimal.ROUND_HALF_EVEN).toNumber();
}

// ═══════════════════════════════════════════════════════════════════
// 水深 — 记录位数 0.01，计算位数 0.01（记录=计算）
// ═══════════════════════════════════════════════════════════════════

/** 水深记录/成果取位：0.01 m */
export function roundDepth(value: number | string | Decimal): string {
  return roundBanker(value, 2);
}

/** 水深数值修约：0.01 */
export function roundDepthNumber(value: number | string | Decimal): number {
  return roundBankerNumber(value, 2);
}

// ═══════════════════════════════════════════════════════════════════
// 起点距 — 0.01 m
// ═══════════════════════════════════════════════════════════════════

export function roundDistance(value: number | string | Decimal): string {
  return roundBanker(value, 2);
}

// ═══════════════════════════════════════════════════════════════════
// 流速 — 记录位数 0.01，计算位数 0.001
// ═══════════════════════════════════════════════════════════════════

/** 流速计算过程修约：0.001 m/s（中间计算使用） */
export function roundVelocityCalc(value: number | string | Decimal): number {
  return roundBankerNumber(value, 3);
}

/** 流速成果/记录取位：0.01 m/s */
export function roundVelocity(value: number | string | Decimal): string {
  return roundBanker(value, 2);
}

/** 流速数值修约（记录位数）：0.01 */
export function roundVelocityNumber(value: number | string | Decimal): number {
  return roundBankerNumber(value, 2);
}

// ═══════════════════════════════════════════════════════════════════
// 断面面积 — 记录位数 0.01，计算位数 0.001
// ═══════════════════════════════════════════════════════════════════

/** 面积计算过程修约：0.001 m²（中间计算使用） */
export function roundAreaCalc(value: number | string | Decimal): number {
  return roundBankerNumber(value, 3);
}

/** 面积成果/记录取位：0.01 m² */
export function roundArea(value: number | string | Decimal): string {
  return roundBanker(value, 2);
}

/** 面积数值修约（记录位数）：0.01 */
export function roundAreaNumber(value: number | string | Decimal): number {
  return roundBankerNumber(value, 2);
}

// ═══════════════════════════════════════════════════════════════════
// 流量 — 记录位数 0.001，计算位数 0.0001
// ═══════════════════════════════════════════════════════════════════

/** 流量计算过程修约：0.0001 m³/s（中间计算使用） */
export function roundDischargeCalc(value: number | string | Decimal): number {
  return roundBankerNumber(value, 4);
}

/** 流量成果/记录取位：0.001 m³/s */
export function roundDischarge(value: number | string | Decimal): string {
  return roundBanker(value, 3);
}

/** 流量数值修约（记录位数）：0.001 */
export function roundDischargeNumber(value: number | string | Decimal): number {
  return roundBankerNumber(value, 3);
}

// ═══════════════════════════════════════════════════════════════════
// 辅助工具
// ═══════════════════════════════════════════════════════════════════

export function round(value: number | string | Decimal, decimals: number): string {
  return roundBanker(value, decimals);
}

export function safeDivide(numerator: Decimal.Value, denominator: Decimal.Value): Decimal {
  const d = new Decimal(denominator);
  if (d.isZero()) return new Decimal(0);
  return new Decimal(numerator).div(d);
}

export function safeSum(...values: (Decimal.Value | undefined | null)[]): Decimal {
  return values
    .filter((v): v is Decimal.Value => v !== undefined && v !== null)
    .reduce((sum: Decimal, v: Decimal.Value) => sum.plus(v), new Decimal(0));
}

export function safeAverage(...values: (Decimal.Value | undefined | null)[]): Decimal {
  const validValues = values.filter((v): v is Decimal.Value => v !== undefined && v !== null && !new Decimal(v).isZero());
  if (validValues.length === 0) return new Decimal(0);
  return safeDivide(safeSum(...validValues), validValues.length);
}

export { Decimal };
import { Decimal, toFiniteDecimal } from './rounding';

export type FlowDeviationStatus = '实测偏高' | '实测偏低' | '一致';

export type FlowDeviationResult =
  | {
      kind: 'invalid';
      measured: Decimal | null;
      online: Decimal | null;
      message: string;
    }
  | {
      kind: 'valid';
      measured: Decimal;
      online: Decimal;
      delta: Decimal;
      signedRate: Decimal | null;
      absoluteRate: Decimal | null;
      status: FlowDeviationStatus;
      rateMessage: string | null;
    };

/**
 * 流量偏离率纯函数。计算过程保留 Decimal 精度；仅显示层修约。
 */
export function calculateFlowDeviation(
  measuredInput: unknown,
  onlineInput: unknown,
): FlowDeviationResult {
  const measured = toFiniteDecimal(measuredInput);
  const online = toFiniteDecimal(onlineInput);

  if (!measured || !online) {
    return {
      kind: 'invalid',
      measured,
      online,
      message: '请输入有限的实测流量和线上流量',
    };
  }

  const delta = measured.minus(online);
  const status: FlowDeviationStatus = delta.isZero()
    ? '一致'
    : delta.isPositive()
      ? '实测偏高'
      : '实测偏低';

  if (online.isZero()) {
    return {
      kind: 'valid',
      measured,
      online,
      delta,
      signedRate: null,
      absoluteRate: null,
      status,
      rateMessage: '线上流量为0，无法计算',
    };
  }

  return {
    kind: 'valid',
    measured,
    online,
    delta,
    signedRate: delta.div(online).times(100),
    absoluteRate: delta.abs().div(online.abs()).times(100),
    status,
    rateMessage: null,
  };
}

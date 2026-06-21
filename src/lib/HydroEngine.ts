/**
 * 水文测验核心计算引擎 — GB 50179-2015 终极合规版
 * 
 * 核心设计原则：
 * 1. 浮点隔离：所有数值计算强转 Decimal，杜绝原生 1.17 - 0.51 = 0.65999...
 * 2. 所见即所算：部分面积(Ai)与流量(qi)必须使用修约后的阶段值进行乘法，严禁全精度透传。
 * 3. 空间免疫：引擎内部强制按 `startDistance` 重排，无视 UI 卡片乱序。
 * 4. 国标修约：严格遵循“四舍六入五成双”（Banker's Rounding）及有效数字位宽限制。
 */

import { Decimal } from 'decimal.js';
import { Run, Vertical, MeasurePoint, FlowPeriod, MeasureMethod, MeterFormula, getMethodDepthPoints, DEFAULT_METER_FORMULA, DEFAULT_SHORE_COEFFICIENT } from '../types';

// 强制开启国标修约：四舍六入五成双 (Banker's Rounding)
Decimal.set({ rounding: Decimal.ROUND_HALF_EVEN });

// ============================================================================
// 模块一：安全数据转换与国标有效数字修约 (Significant Figures)
// ============================================================================

export function safeDecimal(val: any): Decimal {
    if (val === '' || val === null || val === undefined) return new Decimal(0);
    const num = Number(val);
    if (isNaN(num)) return new Decimal(0);
    return new Decimal(String(val));
}

export function roundGbArea(val: Decimal): number {
    if (val.isZero()) return 0;
    let r = val.toSignificantDigits(3, Decimal.ROUND_HALF_EVEN);
    if (r.decimalPlaces() > 2) r = r.toDecimalPlaces(2, Decimal.ROUND_HALF_EVEN);
    return r.toNumber();
}

export function roundGbVelocity(val: Decimal): number {
    if (val.isZero()) return 0;
    const sigFigs = val.absoluteValue().greaterThanOrEqualTo(1) ? 3 : 2;
    let r = val.toSignificantDigits(sigFigs, Decimal.ROUND_HALF_EVEN);
    if (r.decimalPlaces() > 3) r = r.toDecimalPlaces(3, Decimal.ROUND_HALF_EVEN);
    return r.toNumber();
}

export function roundGbDischarge(val: Decimal): number {
    if (val.isZero()) return 0;
    let r = val.toSignificantDigits(3, Decimal.ROUND_HALF_EVEN);
    if (r.decimalPlaces() > 3) r = r.toDecimalPlaces(3, Decimal.ROUND_HALF_EVEN);
    return r.toNumber();
}

export function calculateAbsolutePosition(effD: Decimal, rd: string): Decimal {
    return effD.times(safeDecimal(rd));
}

// ============================================================================
// 模块二：水深与点流速推导
// ============================================================================

export function calculateEffectiveDepth(v: Vertical, fp: FlowPeriod): Decimal {
    let d = safeDecimal(v.waterDepth);
    if (fp === 'ice') {
        d = d.minus(safeDecimal(v.waterIceThickness)).minus(safeDecimal(v.iceFlowerThickness));
    }
    return d.isNegative() ? new Decimal(0) : d;
}

export function calculateVelocityFromFormula(n: number | string, t: number | string, f: MeterFormula = DEFAULT_METER_FORMULA): Decimal {
    const nv = safeDecimal(n);
    const tv = safeDecimal(t || 100);
    if (tv.isZero() || tv.lessThan(0.1)) return new Decimal(0);
    return safeDecimal(f.k).times(nv).dividedBy(tv).plus(safeDecimal(f.c));
}

export function calculatePointVelocity(p: MeasurePoint, f: MeterFormula = DEFAULT_METER_FORMULA): Decimal {
    return (p.mode || 'direct') === 'direct'
        ? safeDecimal(p.velocity)
        : calculateVelocityFromFormula(p.n || 0, p.t || 100, f);
}

export function calculateVerticalMeanVelocity(pts: MeasurePoint[], _method: MeasureMethod, _fp: FlowPeriod, f: MeterFormula = DEFAULT_METER_FORMULA): Decimal {
    if (!pts || pts.length === 0) return new Decimal(0);
    const vels = pts.map(p => calculatePointVelocity(p, f));

    if (vels.length === 1) return vels[0];
    if (vels.length === 2) return vels[0].plus(vels[1]).dividedBy(2);
    if (vels.length === 3) return vels[0].plus(vels[1]).plus(vels[2]).dividedBy(3);
    if (vels.length === 5) {
        return vels[0].plus(vels[1].times(3)).plus(vels[2].times(3)).plus(vels[3].times(2)).plus(vels[4]).dividedBy(10);
    }
    if (vels.length === 6) {
        return vels[0].plus(vels[1].times(2)).plus(vels[2].times(2)).plus(vels[3].times(2)).plus(vels[4].times(2)).plus(vels[5]).dividedBy(10);
    }
    return new Decimal(0);
}

// ============================================================================
// 模块三：梯级截断积分推导 (所见即所算)
// ============================================================================

export function applyVelocityCorrection(vel: Decimal, v: Vertical, _effD: Decimal): Decimal {
    const coeff = safeDecimal(v.type === 'edge' ? (v.shoreCoefficient || DEFAULT_SHORE_COEFFICIENT) : (v.deflectionCoefficient || '1.0'));
    return vel.times(coeff);
}

function computeStep(prev: any, curr: any, dp: number, dc: number) {
    const distance = new Decimal(String(Math.abs(dc - dp)));
    if (distance.isZero()) return { areaNum: 0, meanVelNum: 0, dischargeNum: 0 };

    // 1. 求平均水深并立即修约
    const rawMeanDepth = prev.effDec.plus(curr.effDec).dividedBy(2);
    const roundedMeanDepth = rawMeanDepth.toDecimalPlaces(2, Decimal.ROUND_HALF_EVEN);

    // 2. 求部分面积并修约
    const partAreaDec = roundedMeanDepth.times(distance);
    const A_i = roundGbArea(partAreaDec);

    // 3. 求区间平均流速并修约
    let rawAvgVel = new Decimal(0);
   const prevIsBank = prev.effDec.isZero() || prev.vertical.type === 'edge';
    const currIsBank = curr.effDec.isZero() || curr.vertical.type === 'edge';
    const getKa = (v: any) => safeDecimal(v.type === 'edge' ? (v.shoreCoefficient || DEFAULT_SHORE_COEFFICIENT) : (v.deflectionCoefficient || '1.0'));

    if (prevIsBank) {
        rawAvgVel = curr.velDec.times(getKa(prev.vertical));
    } else if (currIsBank) {
        rawAvgVel = prev.velDec.times(getKa(curr.vertical));
    } else {
        if (prev.velDec.isZero() && !curr.velDec.isZero()) rawAvgVel = curr.velDec;
        else if (curr.velDec.isZero() && !prev.velDec.isZero()) rawAvgVel = prev.velDec;
        else rawAvgVel = prev.velDec.plus(curr.velDec).dividedBy(2);
    }
    const V_mean_i = roundGbVelocity(rawAvgVel);

    // 4. 求部分流量并修约
    const partDischargeDec = safeDecimal(A_i).times(safeDecimal(V_mean_i));
    const q_i = roundGbDischarge(partDischargeDec);

    return { areaNum: A_i, meanVelNum: V_mean_i, dischargeNum: q_i };
}

// ============================================================================
// 模块四：主计算引擎入口 & 状态工厂
// ============================================================================

export function processRun(run: any): any {
    const { verticals, flowPeriod, meterFormula = DEFAULT_METER_FORMULA } = run;
    if (!verticals || verticals.length < 2) return run;

    // 1. 后台物理排序
     const spatial = [...verticals].sort((a, b) => {
        const dA = parseFloat(a.startDistance);
        const dB = parseFloat(b.startDistance);
        // 根据 name 包含的“左”字来识别左水边，将其钉在最上方
        const valA = isNaN(dA) ? ((a.name || '').includes('左') ? -Infinity : Infinity) : dA;
        const valB = isNaN(dB) ? ((b.name || '').includes('左') ? -Infinity : Infinity) : dB;
        return valA - valB;
    });
    // 2. 预计算节点参数
    const steps: any[] = spatial.map(v => {
        const effDec = calculateEffectiveDepth(v, flowPeriod);
        let velDec = new Decimal(0);
        if (v.type === 'measure') {
            const rawVel = calculateVerticalMeanVelocity(v.measurePoints, v.measureMethod, flowPeriod, meterFormula);
            const unroundedVelDec = applyVelocityCorrection(rawVel, v, effDec);
            // 🔪 终极阻断：把全精度系数乘法的结果，强制转化为国标修约后的值！所见即所算！
            velDec = new Decimal(String(roundGbVelocity(unroundedVelDec)));
        }
        return { vertical: v, effDec, velDec, areaNum: 0, meanVelNum: 0, dischargeNum: 0 };
    });

    // 3. 梯级推导
    for (let i = 1; i < steps.length; i++) {
        const dp = parseFloat(steps[i - 1].vertical.startDistance) || 0;
        const dc = parseFloat(steps[i].vertical.startDistance) || 0;
        const res = computeStep(steps[i - 1], steps[i], dp, dc);
        steps[i].areaNum = res.areaNum;
        steps[i].meanVelNum = res.meanVelNum;
        steps[i].dischargeNum = res.dischargeNum;
    }

    const resultDict = new Map<string, any>();
    steps.forEach(s => resultDict.set(s.vertical.id, s));

    // 使用 Decimal 杜绝总面积/总流量的累加漂移
    let totalAreaDec = new Decimal(0);
    let totalDischargeDec = new Decimal(0);
    let maxDepth = 0;
    let maxVel = 0;

    const outputVerticals = run.verticals.map((ov: any) => {
        const s = resultDict.get(ov.id);
        if (!s) return { ...ov };

        const edNum = s.effDec.toNumber();
        const cvNum = s.velDec.toNumber();

        if (ov.type === 'measure') {
            if (edNum > maxDepth) maxDepth = edNum;
            if (cvNum > maxVel) maxVel = cvNum;
        }

        totalAreaDec = totalAreaDec.plus(s.areaNum);
        totalDischargeDec = totalDischargeDec.plus(s.dischargeNum);

        // 为了 UI 呈现美观，统一强制 toFixed() 输出格式
        return {
            ...ov,
            effectiveDepth: s.effDec.toDecimalPlaces(2, Decimal.ROUND_HALF_EVEN).toFixed(2),
            correctedVelocity: ov.type.includes('bank') || ov.type === 'edge' ? '0.00' : String(roundGbVelocity(s.velDec)),
            partialArea: safeDecimal(s.areaNum).toDecimalPlaces(2, Decimal.ROUND_HALF_EVEN).toString(),
            partialDischarge: safeDecimal(s.dischargeNum).toDecimalPlaces(3, Decimal.ROUND_HALF_EVEN).toString(),
            measurePoints: (ov.measurePoints || []).map((mp: any) => ({
                ...mp,
                absoluteDepth: calculateAbsolutePosition(s.effDec, mp.relativeDepth).toDecimalPlaces(2).toFixed(2)
            }))
        };
    });

// 5. 汇总断面特征值
    const totalAreaStr = roundGbArea(totalAreaDec).toString();
    const totalDischargeStr = roundGbDischarge(totalDischargeDec).toString();
    
    // 🔪 核心修复：强制读取刚刚修约好的字符串（所见即所算）来进行最终除法
    const finalAreaForCalc = safeDecimal(totalAreaStr);
    const finalDischargeForCalc = safeDecimal(totalDischargeStr);
    
    const meanVelDec = !finalAreaForCalc.isZero() ? finalDischargeForCalc.dividedBy(finalAreaForCalc) : new Decimal(0);
    const meanVelocityStr = roundGbVelocity(meanVelDec).toString();

    const startD = parseFloat(spatial[0].startDistance) || 0;
    const endD = parseFloat(spatial[spatial.length - 1].startDistance) || 0;
    const surfaceWidth = Math.abs(endD - startD).toFixed(2);

    return {
        ...run,
        verticals: outputVerticals,
        totalArea: totalAreaStr,
        totalDischarge: totalDischargeStr,
        meanVelocity: meanVelocityStr,
        surfaceWidth: surfaceWidth,
        maxDepth: maxDepth.toFixed(2),
        maxVelocity: maxVel.toFixed(2)
    };
}

// ============================================================================
// 状态工厂函数
// ============================================================================

export function createDefaultMeasurePoints(m: MeasureMethod, fp: FlowPeriod): MeasurePoint[] {
    return getMethodDepthPoints(m, fp).map((dp) => ({
        id: crypto.randomUUID(),
        relativeDepth: dp.relativeDepth,
        velocity: '',
        mode: 'direct' as const,
        n: '',
        t: '100',
    }));
}

export function createEdgeVertical(vn: string, name: '左水边' | '右水边', sc: string = DEFAULT_SHORE_COEFFICIENT): Vertical {
    return {
        id: crypto.randomUUID(),
        verticalNumber: vn,
        startDistance: '',
        waterDepth: '0',
        measureMethod: 'one_point',
        measurePoints: [],
        type: 'edge', // 兼容历史数据
        name,
        shoreCoefficient: sc,
        iceThickness: '',
        waterIceThickness: '',
        iceFlowerThickness: '',
        isExpanded: false,
        showResults: false,
    };
}

export function createMeasureVertical(vn: number, fp: FlowPeriod, method: MeasureMethod = 'one_point', dc: string = '1.0'): Vertical {
    return {
        id: crypto.randomUUID(),
        verticalNumber: String(vn),
        startDistance: '',
        waterDepth: '',
        measureMethod: method,
        measurePoints: createDefaultMeasurePoints(method, fp),
        type: 'measure',
        deflectionCoefficient: dc,
        iceThickness: '',
        waterIceThickness: '',
        iceFlowerThickness: '',
        isExpanded: true,
        showResults: false,
        interval: '',
    };
}

export function createNewRun(rn: number, fp: FlowPeriod = 'open'): Run {
    return {
        id: crypto.randomUUID(),
        runNumber: String(rn),
        timestamp: new Date().toISOString(),
        flowPeriod: fp,
        verticals: [
            createEdgeVertical('左', '左水边'),
            createEdgeVertical('右', '右水边'),
        ],
        leftBankCoefficient: DEFAULT_SHORE_COEFFICIENT,
        rightBankCoefficient: DEFAULT_SHORE_COEFFICIENT,
        waterLevel: '',
        location: '',
        meterFormula: { ...DEFAULT_METER_FORMULA },
        startTime: '',
        endTime: '',
        duration: '',
    };
}

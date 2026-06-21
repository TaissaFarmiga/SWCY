/**
 * 水文引擎真值对标测试
 * 
 * 数据来源：郑家屯(六)站 2026年5月31日 流量测验记载计算表
 * 
 * 档案真值：
 *   水面宽 15.0m  |  断面流量 0.911 m³/s  |  断面面积 4.21 m²
 *   平均水深 0.28m  |  最大水深 0.42m  |  平均流速 0.22 m/s
 * 
 * 流速仪公式：LS45 V = 0.4280*N/T + 0.0057
 * 畅流期 (open)，一点法 (0.6)
 * 岸边系数：左 0.70 右 0.70（默认平缓岸）
 */

import { Decimal } from 'decimal.js';
import { processRun, createNewRun } from './HydroEngine';
import type { Run } from '../types';

/**
 * 根据郑家屯记载表构建测试测次
 */
function buildZhengJiaTunRun(): Run {
  const run = createNewRun(1, 'open');
  
  // 设置流速仪公式
  run.meterFormula = { k: 0.4280, c: 0.0057 };
  
  // 按起点距从左到右排列（每根间距约3.0m，记载推算）
  // 记载表：
  //   右水边 10.0m  起点距
  //   1垂线 13.0m  水深0.18  一点法 相对0.6  流速(直接=0.020)
  //   2垂线 16.0m  水深0.41  一点法 相对0.6  流速(直接=0.21)
  //   3垂线 19.0m  水深0.42  一点法 相对0.6  流速(直接=0.35)
  //   4垂线 21.0m  水深0.36  一点法 相对0.6  流速(直接=0.29)
  //   5垂线 23.0m  水深0.32  一点法 相对0.6  流速(直接=0.19)
  //   左水边 25.0m  起点距
  
  // 注意：PDF中"右水边"在10.0，"左水边"在25.0，但标注方向取决于实测
  // 我们来构建：左→右严格按起点距升序
  // 0: 水边 10.0
  // 1: 测线 13.0  depth=0.18  velocity=0.020 (直接输入)
  // 2: 测线 16.0  depth=0.41  velocity=0.21
  // 3: 测线 19.0  depth=0.42  velocity=0.35
  // 4: 测线 21.0  depth=0.36  velocity=0.29
  // 5: 测线 23.0  depth=0.32  velocity=0.19
  // 6: 水边 25.0
  
  const createEdge = (startDistance: string, name: '左水边' | '右水边') => ({
    id: crypto.randomUUID(),
    verticalNumber: name === '左水边' ? '左' : '右',
    startDistance,
    waterDepth: '0',
    measureMethod: 'one_point' as const,
    measurePoints: [],
    type: 'edge' as const,
    name,
    shoreCoefficient: '0.70',
    iceThickness: '',
    waterIceThickness: '',
    iceFlowerThickness: '',
    isExpanded: false,
    showResults: false,
  });
  
  const createMeasure = (
    verticalNumber: string,
    startDistance: string,
    waterDepth: string,
    velocity: string
  ) => ({
    id: crypto.randomUUID(),
    verticalNumber,
    startDistance,
    waterDepth,
    measureMethod: 'one_point' as const,
    measurePoints: [{
      id: crypto.randomUUID(),
      relativeDepth: '0.6',
      velocity,
      mode: 'direct' as const,
    }],
    type: 'measure' as const,
    deflectionCoefficient: '1.0',
    iceThickness: '',
    waterIceThickness: '',
    iceFlowerThickness: '',
    isExpanded: true,
    showResults: false,
  });
  
  run.verticals = [
    createEdge('10.0', '右水边'),
    createMeasure('1', '13.0', '0.18', '0.020'),
    createMeasure('2', '16.0', '0.41', '0.21'),
    createMeasure('3', '19.0', '0.42', '0.35'),
    createMeasure('4', '21.0', '0.36', '0.29'),
    createMeasure('5', '23.0', '0.32', '0.19'),
    createEdge('25.0', '左水边'),
  ];
  
  return run;
}

/**
 * 运行郑家屯真值对标测试
 */
export function runZhengJiaTunBenchmark() {
  const run = buildZhengJiaTunRun();
  const result = processRun(run);
  
  // 档案真值
  const ARCHIVE = {
    totalDischarge: 0.911,
    totalArea: 4.21,
    surfaceWidth: 15.0,
    meanVelocity: 0.22,
    maxDepth: 0.42,
    maxVelocity: 0.35,
  };
  
  const computed = {
    totalDischarge: parseFloat(result.totalDischarge || '0'),
    totalArea: parseFloat(result.totalArea || '0'),
    surfaceWidth: parseFloat(result.surfaceWidth || '0'),
    meanVelocity: parseFloat(result.meanVelocity || '0'),
    maxDepth: parseFloat(result.maxDepth || '0'),
    maxVelocity: parseFloat(result.maxVelocity || '0'),
  };
  
  console.log('=== 郑家屯站 真值对标测试 ===');
  console.log('');
  
  const keys = Object.keys(ARCHIVE) as (keyof typeof ARCHIVE)[];
  let allPassed = true;
  
  keys.forEach(key => {
    const expected = ARCHIVE[key];
    const actual = computed[key];
    const error = Math.abs(actual - expected);
    const relError = expected !== 0 ? (error / Math.abs(expected)) * 100 : error * 100;
    const passed = relError < 5; // 5% 容差
    
    if (!passed) allPassed = false;
    
    console.log(
      `${key.padEnd(22)} 档案=${String(expected).padEnd(8)}  计算=${String(actual).padEnd(8)}  误差=${relError.toFixed(2)}%  ${passed ? '✓' : '✗'}`
    );
  });
  
  console.log('');
  console.log(allPassed ? '✓ 所有指标在 5% 容差内，对标通过' : '✗ 部分指标超出容差');
  
  // 打印梯级明细
  console.log('');
  console.log('=== 梯级明细 ===');
  result.verticals.forEach((v, i) => {
    if (v.type === 'measure') {
      console.log(
        `${v.verticalNumber.padStart(2)} 起点距=${v.startDistance.padStart(5)}  水深=${v.waterDepth.padStart(5)}  有效水深=${(v.effectiveDepth||'').padStart(6)}  修正流速=${(v.correctedVelocity||'').padStart(6)}  部分面积=${(v.partialArea||'').padStart(6)}  部分流量=${(v.partialDischarge||'').padStart(7)}`
      );
    } else {
      console.log(
        `${v.name?.padStart(4)||'水边'} 起点距=${v.startDistance.padStart(5)}  有效水深=${(v.effectiveDepth||'').padStart(6)}  部分面积=${(v.partialArea||'').padStart(6)}  部分流量=${(v.partialDischarge||'').padStart(7)}`
      );
    }
  });
  
  return { result, allPassed };
}

// 如果直接运行此模块
runZhengJiaTunBenchmark();
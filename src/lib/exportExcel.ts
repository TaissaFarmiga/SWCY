import ExcelJS from 'exceljs';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { Capacitor } from '@capacitor/core';
import type { Run, Vertical } from '../types';
import { useHydroStore } from '../store/hydroStore';

// ═══════════════════════════════════════════════════════════════════
//  【国标算法】GB/T 8170 数值修约规则 (完美兼容 Bank's Rounding 与负精度)
// ═══════════════════════════════════════════════════════════════════
function roundGB(val: string | number | undefined | null, decimals: number): string {
  if (val == null || val === '') return '';
  const num = parseFloat(String(val));
  if (isNaN(num)) return '';

  const p = Math.pow(10, decimals);
  const n = num * p;
  const r = Math.round(n);
  
  let resultNum = 0;
  // 四舍六入五留双 核心判定
  if (Math.abs(n - Math.floor(n) - 0.5) < 1e-9) {
    const floor = Math.floor(n);
    const isEven = floor % 2 === 0;
    resultNum = (isEven ? floor : floor + 1) / p;
  } else {
    resultNum = r / p;
  }
  
  // 支持有效数字计算出的负 decimals (如 1250 强转)
  return decimals >= 0 ? resultNum.toFixed(decimals) : String(resultNum);
}

// 【物理算法】计算有效数字所需的真实小数位数
function getGbDecimals(num: number, sigFigs: number, maxDecimals: number): number {
  if (num === 0) return maxDecimals;
  const exponent = Math.floor(Math.log10(Math.abs(num)));
  const requiredDecimals = sigFigs - 1 - exponent;
  return Math.min(maxDecimals, requiredDecimals);
}

// 断面面积/部分面积 (取 3 位有效数字，小数不过 2 位)
function formatArea(val: string | number | undefined | null): string {
  if (val == null || val === '') return '';
  const num = parseFloat(String(val));
  if (isNaN(num)) return '';
  if (num === 0) return '0.00';
  const dec = getGbDecimals(num, 3, 2);
  return roundGB(num, dec);
}

// 断面流量/部分流量 (取 3 位有效数字，小数不过 3 位)
function formatDischarge(val: string | number | undefined | null): string {
  if (val == null || val === '') return '';
  const num = parseFloat(String(val));
  if (isNaN(num)) return '';
  if (num === 0) return '0.000';
  const dec = getGbDecimals(num, 3, 3);
  return roundGB(num, dec);
}

// 流速 (>=1m/s取3位有效数字；<1m/s取2位有效数字；统一小数不过3位)
function formatVelocity(val: string | number | undefined | null): string {
  if (val == null || val === '') return '';
  const num = parseFloat(String(val));
  if (isNaN(num)) return '';
  if (num === 0) return ''; // 零值保留空白
  
  const sigFigs = Math.abs(num) >= 1.0 ? 3 : 2;
  const dec = getGbDecimals(num, sigFigs, 3);
  return roundGB(num, dec);
}

// 水面宽 (取 3 位有效数字；>=5m小数不过1位，<5m小数不过2位)
function formatWidth(val: string | number | undefined | null): string {
  if (val == null || val === '') return '';
  const num = parseFloat(String(val));
  if (isNaN(num)) return '';
  if (num === 0) return '0.0';
  
  const maxDec = Math.abs(num) >= 5.0 ? 1 : 2;
  const dec = getGbDecimals(num, 3, maxDec);
  return roundGB(num, dec);
}

async function loadTemplate(): Promise<ExcelJS.Workbook> {
  const response = await fetch('/template.xlsx');
  if (!response.ok) throw new Error(`模板加载失败: HTTP ${response.status}`);
  const buffer = await response.arrayBuffer();
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  return workbook;
}

function extractTimeDigits(timestamp: string): string {
  return new Date(timestamp).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).replace(/\D/g, '');
}

// 样式继承与黑色细实线边框 (强锁30列 AD 断面输沙率)
function copyRowStyle(sourceRow: ExcelJS.Row, targetRow: ExcelJS.Row) {
  targetRow.height = sourceRow.height || 20;
  for (let col = 1; col <= 30; col++) {
    const sCell = sourceRow.getCell(col);
    const tCell = targetRow.getCell(col);
    if (sCell && sCell.style) {
      tCell.style = JSON.parse(JSON.stringify(sCell.style));
    }
    tCell.border = {
      top: { style: 'thin' }, left: { style: 'thin' },
      bottom: { style: 'thin' }, right: { style: 'thin' }
    };
    tCell.alignment = { vertical: 'middle', horizontal: 'center' };
  }
}

// 将列索引转换为 Excel 字母 (如 1 -> A, 25 -> Y)
function colToLetter(col: number): string {
  let letter = '';
  while (col > 0) {
    const temp = (col - 1) % 26;
    letter = String.fromCharCode(temp + 65) + letter;
    col = (col - temp - 1) / 26;
  }
  return letter;
}

// 物理级平移合并格坐标：确保双行插行时，下方所有模板合并格式完美下移，绝不重叠
function shiftMergesDown(sheet: ExcelJS.Worksheet, afterRow: number, numRows: number) {
  const merges = sheet.model.merges;
  if (!merges || !Array.isArray(merges)) return;
  
  const toShift: { startCol: string, startRow: number, endCol: string, endRow: number }[] = [];
  const untouched: string[] = [];

  for (const merge of merges) {
    const parts = merge.split(':');
    if (parts.length !== 2) {
      untouched.push(merge);
      continue;
    }
    const [start, end] = parts;
    const startMatch = start.match(/^([A-Z]+)(\d+)$/);
    const endMatch = end.match(/^([A-Z]+)(\d+)$/);
    if (!startMatch || !endMatch) {
      untouched.push(merge);
      continue;
    }
    const startCol = startMatch[1];
    const startR = parseInt(startMatch[2]);
    const endCol = endMatch[1];
    const endR = parseInt(endMatch[2]);

    if (startR >= afterRow || endR >= afterRow) {
      toShift.push({ startCol, startRow: startR, endCol, endRow: endR });
    } else {
      untouched.push(merge);
    }
  }

  for (const m of toShift) {
    try {
      sheet.unMergeCells(`${m.startCol}${m.startRow}:${m.endCol}${m.endRow}`);
    } catch (error) {
      console.debug('[Excel] 跳过无效合并区域', error);
    }
  }

  sheet.model.merges = untouched;

  for (const m of toShift) {
    let sRow = m.startRow;
    let eRow = m.endRow;
    if (sRow >= afterRow) sRow += numRows;
    if (eRow >= afterRow) eRow += numRows;
    sheet.mergeCells(`${m.startCol}${sRow}:${m.endCol}${eRow}`);
  }
}

// ═══════════════════════════════════════════════════════════════════
//  表一：成果数据注入（WPS 直通对齐 + 国标圣经修约版）
// ═══════════════════════════════════════════════════════════════════
function buildSheet1(workbook: ExcelJS.Workbook, run: Run): void {
  const sheet1 = workbook.worksheets[0] || workbook.getWorksheet(1);
  if (!sheet1) return;

  const runDate = new Date(run.timestamp);
  const year = runDate.getFullYear();
  const dateStr = runDate.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit' });
  const fmtHM = (ts?: string): string => {
    if (!ts) return '--:--';
    const m = ts.match(/(\d{2}):(\d{2})/);
    return m ? `${m[1]}:${m[2]}` : '--:--';
  };
  const timeStr = run.startTime || run.endTime ? `${fmtHM(run.startTime)} - ${fmtHM(run.endTime)}` : '';

  // 1. 顶部基础元数据（带年份施测时间）
  sheet1.getCell('C2').value = `${year}/${dateStr} ${timeStr}`; // C2: 施测时间
  sheet1.getCell('Q2').value = run.weather || '';              // Q2: 天气
  sheet1.getCell('C3').value = run.location || '';              // C3: 断面位置
  sheet1.getCell('N3').value = run.waterCondition || '';        // N3: 河段水情/冰情
  const instrument = run.instrumentSnapshot;
  const instrumentLabel = [instrument?.name, instrument?.model, instrument?.serialNumber].filter(Boolean).join(' / ');
  const formulaLabel = run.meterFormula ? `K=${run.meterFormula.k}  C=${run.meterFormula.c}` : '';
  sheet1.getCell('D4').value = [instrumentLabel, formulaLabel].filter(Boolean).join(' · '); // D4: 仪器及公式
  sheet1.getCell('D15').value = [
    run.stationCode ? `测站编码：${run.stationCode}` : '',
    run.riverName ? `河流：${run.riverName}` : '',
    run.operator ? `施测：${run.operator}` : '',
    run.recorder ? `记录：${run.recorder}` : '',
    run.reviewer ? `复核：${run.reviewer}` : '',
    run.notes ? `备注：${run.notes}` : '',
  ].filter(Boolean).join('；');

  // 计算表一特征值
  const vCount = run.verticals.filter(v => v.type === 'measure').length;
  const pCount = run.verticals.reduce((acc, v) => acc + (v.measurePoints?.length || 0), 0);
  const avgDepthVal = (run.totalArea && run.surfaceWidth && +run.surfaceWidth > 0)
    ? (+run.totalArea / +run.surfaceWidth).toFixed(2)
    : '';

  // 2. 特征值汇总 — 直通注入，完全对齐国标圣经精度
  sheet1.getCell('D6').value = `${vCount} / ${pCount}`;                // D6: 垂线数 / 测点数
  sheet1.getCell('J6').value = formatVelocity(run.maxVelocity);         // J6: 最大测点流速
  sheet1.getCell('D7').value = roundGB(run.waterLevel, 2);              // D7: 相应水位 (2位小数)
  sheet1.getCell('J7').value = formatWidth(run.surfaceWidth);           // J7: 水面宽 (>=5m小数不过一位 ➔ 33.8)
  sheet1.getCell('D8').value = formatDischarge(run.totalDischarge);     // D8: 断面流量
  sheet1.getCell('J8').value = roundGB(avgDepthVal, 2);                 // J8: 平均水深
  sheet1.getCell('D9').value = formatArea(run.totalArea);               // D9: 断面面积
  sheet1.getCell('J9').value = roundGB(run.maxDepth, 2);                // J9: 最大水深
  sheet1.getCell('D11').value = formatVelocity(run.meanVelocity);       // D11: 平均流速
}

// ═══════════════════════════════════════════════════════════════════
//  表二：主程序（省局级：双行物理格动态插行与合并重构引擎）
// ═══════════════════════════════════════════════════════════════════
function buildSheet2(workbook: ExcelJS.Workbook, run: Run): void {
  const sheet2 = workbook.worksheets[1] || workbook.getWorksheet(2);
  if (!sheet2) return;

  const DATA_START_ROW = 5; 
  let rowOffset = 0; // 累计动态双行插行偏移量
  const styleRowTemplate = sheet2.getRow(DATA_START_ROW);
  const { verticals } = run;

  for (let i = 0; i < verticals.length; i++) {
    const v = verticals[i];

    // 基于原生双行块（i * 2）与累计偏移计算起跑行
    const startRow = DATA_START_ROW + i * 2 + rowOffset;
    
    const rawPoints = v.measurePoints || [];
    // 强制排序，确保多点瀑布流在物理行中自上而下对齐
    const points = [...rawPoints].sort((a, b) => parseFloat(String(a.relativeDepth || 0)) - parseFloat(String(b.relativeDepth || 0)));
    const pointCount = points.length > 0 ? points.length : 1;

    // 【物理强制解绑测点列】：仅在多点法时，破坏模板默认的 2 行合并
    if (pointCount >= 2) {
      const pointColsToUnmerge = [11, 12, 18, 20]; 
      for (const col of pointColsToUnmerge) {
        const colL = colToLetter(col);
        try {
          sheet2.unMergeCells(`${colL}${startRow}:${colL}${startRow + 1}`);
          const masterCell = sheet2.getCell(`${colL}${startRow}`);
          const slaveCell = sheet2.getCell(`${colL}${startRow + 1}`);
          if (masterCell.style) slaveCell.style = JSON.parse(JSON.stringify(masterCell.style));
          slaveCell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
          slaveCell.alignment = { vertical: 'middle', horizontal: 'center' };
        } catch (error) {
          console.debug('[Excel] 测点列未处于合并状态', error);
        }
      }
    }

    // 1. 【核心：双行级动态插行】如果测点数超过 2 个，物理级向当前块尾部插入（PointCount - 2）对行（即双行）
    if (pointCount > 2) {
      const numToInsert = pointCount - 2;
      const insertIndex = startRow + 2; // 在原本的第 2 行（即 startRow + 1）下方开始插行

      // 强行插入空行
      sheet2.spliceRows(insertIndex, 0, ...new Array(numToInsert).fill([]));
      
      // 完美样式预克隆
      for (let r = 0; r < numToInsert; r++) {
        copyRowStyle(styleRowTemplate, sheet2.getRow(insertIndex + r));
      }

      // 精准平移下方所有历史合并单元格，绝不错位
      shiftMergesDown(sheet2, insertIndex, numToInsert);

      // 解除原本的 2-Row 静态合并格，并将其纵向平铺扩大到 [startRow, startRow + pointCount - 1]
      const colsToMerge = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 19, 25, 29]; // A, B, C, D, E, F, G, H, I(冰花厚), J, S, Y, AC
      for (const col of colsToMerge) {
        const colL = colToLetter(col);
        try {
          sheet2.unMergeCells(`${colL}${startRow}:${colL}${startRow + 1}`);
        } catch (error) {
          console.debug('[Excel] 动态行原合并区域不存在', error);
        }
        sheet2.mergeCells(`${colL}${startRow}:${colL}${startRow + pointCount - 1}`);
      }

      rowOffset += numToInsert;
    }

    // 2. 写入【间隙行】（若不是第一条垂线），其安全落点永远是当前垂线起跑行 startRow 的前一行（即前一垂线的最后一行）
    if (i > 0) {
      const prev = verticals[i - 1];
      const sectionRow = sheet2.getRow(startRow - 1);
      
      const d1 = parseFloat(v.startDistance), d2 = parseFloat(prev.startDistance);
      const interval = (!isNaN(d1) && !isNaN(d2)) ? Math.abs(d1 - d2) : 0;
      const area = parseFloat(v.partialArea || '0'), discharge = parseFloat(v.partialDischarge || '0');

      if (interval > 0) {
        sectionRow.getCell(21).value = roundGB(interval, 1); // U(21)
        if (area > 0) {
          sectionRow.getCell(22).value = roundGB(area / interval, 2); // V(22)
        }
      }
      if (area > 0) {
        sectionRow.getCell(23).value = formatArea(area); // W(23)
        sectionRow.getCell(24).value = formatArea(area); // X(24)
      }
      
      if (area > 0) {
        let rawAvgVel = 0;
        const prevVel = parseFloat(prev.correctedVelocity || '0');
        const currVel = parseFloat(v.correctedVelocity || '0');
        const prevIsBank = parseFloat(prev.waterDepth || '0') === 0 || prev.type === 'edge';
        const currIsBank = parseFloat(v.waterDepth || '0') === 0 || v.type === 'edge';
        
        const getKa = (vert: Vertical) => parseFloat(vert.type === 'edge' ? (vert.shoreCoefficient || '0.70') : (vert.deflectionCoefficient || '1.0'));

        if (prevIsBank) rawAvgVel = currVel * getKa(prev);
        else if (currIsBank) rawAvgVel = prevVel * getKa(v);
        else {
          if (prevVel === 0 && currVel !== 0) rawAvgVel = currVel;
          else if (currVel === 0 && prevVel !== 0) rawAvgVel = prevVel;
          else rawAvgVel = (prevVel + currVel) / 2;
        }
        sectionRow.getCell(26).value = formatVelocity(rawAvgVel); // Z(26)
      }

      if (discharge > 0) {
        sectionRow.getCell(27).value = formatDischarge(discharge); // AA(27)
        sectionRow.getCell(28).value = formatDischarge(discharge); // AB(28)
      }
    }

    // 3. 写入当前【垂线共性属性】（落入起跑行 startRow，即合并格的左上角）
    const vRow = sheet2.getRow(startRow);
    
    if (v.type === 'measure') {
      vRow.getCell(1).value = v.verticalNumber; // A(1)
      vRow.getCell(2).value = v.verticalNumber; // B(2)
    } else {
      vRow.getCell(1).value = v.name || ''; // A(1)
    }

    vRow.getCell(5).value = roundGB(v.startDistance, 1);     // E(5)
    vRow.getCell(6).value = roundGB(v.waterDepth, 2);        // F(6)
    vRow.getCell(7).value = roundGB(v.iceThickness, 2);      // G(7)
    vRow.getCell(8).value = roundGB(v.waterIceThickness, 2); // H(8)
    vRow.getCell(10).value = roundGB(v.effectiveDepth || v.waterDepth, 2); // J(10)

    vRow.getCell(19).value = v.type === 'edge' ? (v.shoreCoefficient || '0.70') : (v.deflectionCoefficient || '1.0'); // S(19)
      
    const meanVel = v.correctedVelocity || v.meanVelocity || '';
    const parsedVel = parseFloat(String(meanVel));
    if (!meanVel || isNaN(parsedVel) || parsedVel === 0) {
      vRow.getCell(25).value = ''; 
    } else {
      vRow.getCell(25).value = formatVelocity(meanVel); // Y(25): 垂线平均流速
    }

    // 4. 顺序平铺写入【测点特有流速数据】（落入 startRow + j 行，保证 K, L, R 独立格不合并）
    if (points.length > 0) {
      // 提取垂线流速系数 (岸边/有效偏角系数)
      const coeffStr = v.type === 'edge' ? (v.shoreCoefficient || '0.70') : (v.deflectionCoefficient || '1.0');
      const coeff = parseFloat(coeffStr);

      for (let j = 0; j < points.length; j++) {
        const mp = points[j];
        const pRow = sheet2.getRow(startRow + j);

        // 📏 物理高度锁定：多点法时，确保测点所在行的最小行高为 19 磅
        if (points.length >= 2) {
          pRow.height = Math.max(pRow.height || 0, 19);
        }

        pRow.getCell(11).value = roundGB(mp.relativeDepth, 1);
        pRow.getCell(12).value = roundGB(mp.absolutePosition || mp.absoluteDepth, 2);
        pRow.getCell(18).value = formatVelocity(mp.velocity);
        
        // T(20): 每个测点独立的改正后流速 = 测点流速 × 垂线系数
        const ptVel = parseFloat(String(mp.velocity || '0'));
        if (!isNaN(ptVel) && ptVel !== 0) {
          pRow.getCell(20).value = formatVelocity(ptVel * coeff);
        } else {
          pRow.getCell(20).value = '';
        }
      }
    }

  }
}

export async function buildHydroWorkbook(run: Run, templateLoader: () => Promise<ExcelJS.Workbook> = loadTemplate): Promise<ExcelJS.Workbook> {
  const workbook = await templateLoader();
  buildSheet1(workbook, run);
  buildSheet2(workbook, run);
  return workbook;
}

export async function downloadExcel(): Promise<void> {
  // 🚨 同样采用"直接从仓库提货"的机制，获取重算后的最新数据
  const run = useHydroStore.getState().getProcessedRun();
  const workbook = await buildHydroWorkbook(run);
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const location = run.location || '测站';
  const fileName = `${location}_${extractTimeDigits(run.timestamp).substring(0, 12)}_流量计算表.xlsx`;

  // 🔥 原生端：走 Filesystem + Share 引擎唤起安卓原生分享面板
  if (Capacitor.isNativePlatform()) {
    const reader = new FileReader();
    reader.onloadend = async () => {
      const base64Data = (reader.result as string).split(',')[1]; // 去除 data:...;base64, 前缀
      try {
        const result = await Filesystem.writeFile({
          path: fileName,
          data: base64Data,
          directory: Directory.Cache,
        });
        await Share.share({
          url: result.uri,
        });
      } catch (e) {
        console.error('[原生分享] 导出失败', e);
      }
    };
    reader.readAsDataURL(blob);
    return;
  }

  // Web 浏览器端：保留原有 <a> 标签下载逻辑
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a'); link.href = url; link.download = fileName;
  document.body.appendChild(link); link.click(); document.body.removeChild(link); URL.revokeObjectURL(url);
}

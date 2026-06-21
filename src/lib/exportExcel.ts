/**
 * 水文测验 Excel 报表导出器（模板注入版）
 *
 * 架构：
 *   从 public/template.xlsx 加载国标底稿模板（含所有合并单元格、竖排文字、打印边距），
 *   按绝对坐标将 store 数据精准填入对应单元格，最后导出 Blob 触发浏览器下载。
 *
 * 修改指引：
 *   - 表一坐标 → 修改 buildSheet1() 中的 getCell 行号/列号
 *   - 表二起始行 → 修改 buildSheet2() 中的 DATA_START_ROW
 *   - 表二列映射 → 修改 buildSheet2() 中 getCell 的列索引
 *   - 文件名 → 修改 downloadExcel() 中的 fileName
 *   - 行计数器 → 修改 buildSheet2() 中的 currentRow 初始值
 */
import ExcelJS from 'exceljs';
import type { Run } from '../types';

// ═══════════════════════════════════════════════════════════════════
//  模板加载
// ═══════════════════════════════════════════════════════════════════

/**
 * 从 public/ 目录异步加载国标底稿模板
 * 返回已实例化的 exceljs Workbook，包含所有预设样式与合并
 */
async function loadTemplate(): Promise<ExcelJS.Workbook> {
  const response = await fetch('/template.xlsx');
  if (!response.ok) {
    throw new Error(`模板加载失败: HTTP ${response.status}`);
  }
  const buffer = await response.arrayBuffer();
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  return workbook;
}

// ═══════════════════════════════════════════════════════════════════
//  工具函数
// ═══════════════════════════════════════════════════════════════════

/** 安全数值 → 字符串，null/undefined → '' */
function val(v: string | number | undefined | null): string {
  if (v === undefined || v === null) return '';
  return String(v);
}

/**
 * 从时间字符串中提取纯数字时间戳
 * 输入: "2026/06/17 08:37:59" 或 ISO 8601 格式
 * 输出: "20260617083759"
 */
function extractTimeDigits(timestamp: string): string {
  const localized = new Date(timestamp).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  // 滤除所有非数字字符，仅保留纯数字
  return localized.replace(/\D/g, '');
}

// ═══════════════════════════════════════════════════════════════════
//  表一：成果数据注入
// ═══════════════════════════════════════════════════════════════════
function buildSheet1(workbook: ExcelJS.Workbook, run: Run): void {
  const sheet1 = workbook.getWorksheet(1);
  if (!sheet1) {
    console.warn('模板中未找到第一个工作表，跳过表一注入');
    return;
  }

  // ── 基本测次信息 ──
  // 坐标说明：行=行号，列=列字母
  // 开发者请根据真实 Excel 模板修正以下占位坐标

  sheet1.getCell('A3').value = `施测号数: ${run.runNumber}`;

  // 去除时分秒，仅保留日期用于抬头
  const dateStr = new Date(run.timestamp).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit' });

  // 安全提取 HH:mm（兼容 ISO 8601 与 MM/DD HH:mm 双格式，防空格切割崩溃）
  const fmtHM = (ts?: string): string => {
    if (!ts) return '--:--';
    const m = ts.match(/(\d{2}):(\d{2})/);
    return m ? `${m[1]}:${m[2]}` : '--:--';
  };
  const timeStr = run.startTime || run.endTime
    ? `${fmtHM(run.startTime)} - ${fmtHM(run.endTime)}`
    : '';
  sheet1.getCell('B3').value = `施测时间: ${dateStr} ${timeStr}`;

  sheet1.getCell('C3').value = run.location || '';
  sheet1.getCell('D3').value = run.flowPeriod === 'open' ? '畅流期' : '冰期';

  // 测流历时：填入附注单元格（C4 或合适位置）
  if (run.duration) {
    sheet1.getCell('C4').value = `测流历时: ${run.duration}`;
  }

  // ── 流速仪公式 ──
  sheet1.getCell('A4').value = run.meterFormula
    ? `K=${run.meterFormula.k}  C=${run.meterFormula.c}`
    : '';

  // ── 水尺信息 ──
  // 坐标占位，请按实际模板行号修正
  sheet1.getCell('A6').value = '';  // 水尺名称
  sheet1.getCell('B6').value = '';  // 水尺编号
  sheet1.getCell('C6').value = '';  // 水尺读数(始)
  sheet1.getCell('D6').value = '';  // 水尺读数(中)
  sheet1.getCell('E6').value = '';  // 水尺读数(终)
  sheet1.getCell('F6').value = '';  // 相应水位

  // ── 特征值汇总 ──
  // 坐标占位，请按实际模板行号修正
  sheet1.getCell('A8').value = val(run.totalDischarge);   // 断面流量(m³/s)
  sheet1.getCell('B8').value = val(run.totalArea);        // 断面面积(m²)
  sheet1.getCell('C8').value = val(run.meanVelocity);     // 平均流速(m/s)
  sheet1.getCell('D8').value = val(run.surfaceWidth);     // 水面宽(m)
  sheet1.getCell('E8').value = val(run.maxDepth);         // 最大水深(m)
  sheet1.getCell('F8').value = '';                        // 平均水深(m)
  sheet1.getCell('G8').value = val(run.maxVelocity);      // 最大测点流速(m/s)
  sheet1.getCell('H8').value = '';                        // 死水面积(m²)

  // 岸边系数
  sheet1.getCell('A9').value = val(run.leftBankCoefficient);   // 左岸系数
  sheet1.getCell('B9').value = val(run.rightBankCoefficient);  // 右岸系数

  // 其他预留特征值
  sheet1.getCell('A10').value = '';  // 水面比降
  sheet1.getCell('B10').value = '';  // 水位涨率(m/h)
  sheet1.getCell('C10').value = '';  // 糙率
}

// ═══════════════════════════════════════════════════════════════════
//  表二：过程数据（垂线明细）注入
// ═══════════════════════════════════════════════════════════════════
function buildSheet2(workbook: ExcelJS.Workbook, run: Run): void {
  const sheet2 = workbook.getWorksheet(2);
  if (!sheet2) {
    console.warn('模板中未找到第二个工作表，跳过表二注入');
    return;
  }

  // ── 可配置常量 ──
  // 数据起始行：第一条垂线的行号（开发者按真实模板修正）
  const DATA_START_ROW = 6;

  // ── 说明：以下列编号均为 1-based 索引 ──
  //   A=1   垂线号数
  //   D=4   起点距
  //   E=5   测得水深
  //   F=6   悬索偏角
  //   G=7   悬索支架至水面高
  //   H=8   干湿绳改正数
  //   I=9   冰厚
  //   J=10  冰花厚
  //   K=11  有效水深（或应用水深）
  //   L=12  仪器位置-相对
  //   M=13  仪器位置-绝对
  //   N=14  测点流速
  //   O=15  流向偏角
  //   P=16  岸边系数
  //   Q=17  改正后流速
  //   R=18  测深垂线间距
  //   S=19  面积(测深)
  //   T=20  面积(测速)
  //   U=21  流量(测速)
  //   V=22  流量(取样)
  //   W=23  含沙量

  const { verticals } = run;

  // 🚨 架构红线：严禁使用 addRow / insertRow 等插入行 API
  // 必须使用原地坐标覆盖方式逐行赋值
  // 使用独立绝对行计数器 currentRow，每写入一行后自增
  let currentRow = DATA_START_ROW;

  for (const v of verticals) {
    const row = sheet2.getRow(currentRow);

    // ── 垂线级数据（每垂线固定列）──
    row.getCell(1).value = v.verticalNumber;                 // A: 垂线号数
    row.getCell(4).value = v.startDistance;                  // D: 起点距
    row.getCell(5).value = v.waterDepth;                     // E: 测得水深
    row.getCell(6).value = '';                               // F: 悬索偏角（暂无数据源）
    row.getCell(7).value = '';                               // G: 悬索支架至水面高（暂无）
    row.getCell(8).value = '';                               // H: 干湿绳改正数（暂无）
    row.getCell(9).value = v.iceThickness || '';            // I: 冰厚
    row.getCell(10).value = v.iceFlowerThickness || '';     // J: 冰花厚
    row.getCell(11).value = v.effectiveDepth || '';         // K: 有效水深

    // ── 仪器位置 ──
    row.getCell(12).value = '';                              // L: 仪器位置-相对
    row.getCell(13).value = '';                              // M: 仪器位置-绝对

    // ── 测点流速（垂线均值）──
    row.getCell(14).value = v.meanVelocity || '';           // N: 测点流速 / 垂线平均流速

    // ── 流向偏角 ──
    row.getCell(15).value = '';                              // O: 流向偏角（暂无数据源）

    // ── 岸边系数 ──
    row.getCell(16).value = v.type === 'edge'
      ? (v.shoreCoefficient || '0.70')
      : (v.deflectionCoefficient || '');                    // P: 岸边系数

    // ── 改正后流速 ──
    row.getCell(17).value = v.correctedVelocity || '';      // Q: 改正后流速

    // ── 测深垂线间距 ──
    // 注意：间距是基于总 verticals 数组的顺序而非当前写入行
    const vIndex = verticals.indexOf(v);
    if (vIndex > 0) {
      const prev = verticals[vIndex - 1];
      const d1 = parseFloat(v.startDistance);
      const d2 = parseFloat(prev.startDistance);
      if (!isNaN(d1) && !isNaN(d2)) {
        row.getCell(18).value = (d1 - d2).toFixed(2);       // R: 测深垂线间距
      } else {
        row.getCell(18).value = '';
      }
    } else {
      row.getCell(18).value = '';                            // 第一条垂线无间距
    }

    // ── 部分面积 ──
    row.getCell(19).value = v.partialArea || '';            // S: 面积(测深)
    row.getCell(20).value = v.partialArea || '';            // T: 面积(测速)

    // ── 部分流量 ──
    row.getCell(21).value = v.partialDischarge || '';       // U: 流量(测速)
    row.getCell(22).value = v.partialDischarge || '';       // V: 流量(取样)

    // ── 含沙量 ──
    row.getCell(23).value = v.meanSedimentConc || '';       // W: 含沙量

    // ══════════════════════════════════════════════════════
    //  测点明细注入（多点法时，每个测点占一行）
    // ══════════════════════════════════════════════════════
    currentRow++; // 垂线汇总行写入完成，指针自增

    if (v.type === 'measure' && v.measurePoints.length > 1) {
      for (const mp of v.measurePoints) {
        const pointRow = sheet2.getRow(currentRow);
        pointRow.getCell(12).value = mp.relativeDepth || '';       // L: 仪器位置-相对
        pointRow.getCell(13).value = mp.absolutePosition || '';    // M: 仪器位置-绝对
        pointRow.getCell(14).value = mp.velocity || '';            // N: 测点流速
        currentRow++; // 每个测点行写入后指针自增
      }
    }
  }
}

// ═══════════════════════════════════════════════════════════════════
//  下载闭环
// ═══════════════════════════════════════════════════════════════════

/**
 * 导出并触发浏览器下载
 * 文件名格式：[断面位置]_[提取的纯数字时间]_流量计算表.xlsx
 */
export async function downloadExcel(run: Run): Promise<void> {
  // 1. 加载模板
  const workbook = await loadTemplate();

  // 2. 注入数据
  buildSheet1(workbook, run);
  buildSheet2(workbook, run);

  // 3. 导出 Blob
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });

  // 4. 触发下载 — 文件名：[断面位置]_[纯数字时间]_流量计算表.xlsx
  const location = run.location || '测站';
  const timeDigits = extractTimeDigits(run.timestamp);
  const fileName = `${location}_${timeDigits}_流量计算表.xlsx`;

  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
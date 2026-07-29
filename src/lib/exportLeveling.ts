import ExcelJS from 'exceljs';
import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import type { LevelingRoute, SurveyDirection } from '../types/leveling';
import { parseStaffReadingMm } from './LevelingEngine';
import { Decimal, toFiniteDecimal } from './rounding';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const GRADE3_TEMPLATE = '/leveling_3.xlsx';
const GRADE4_TEMPLATE = '/leveling_4.xlsx';
const GRADE3_DATA_START = 10;
const GRADE3_ROWS_PER_STATION = 4;
const GRADE3_TEMPLATE_STATIONS = 1;
const GRADE4_DATA_START = 8;
const GRADE4_ROWS_PER_POINT = 2;
const GRADE4_TEMPLATE_POINTS = 14;

export type LevelingTemplateLoader = (templatePath: string) => Promise<ArrayBuffer>;

export interface WorkbookValidationResult {
  isValid: boolean;
  sheetName: string;
  mergeCount: number;
  errors: string[];
}

interface PointRecord {
  id: string;
  stationNumber: number;
  pointName: string;
  direction: SurveyDirection;
  distanceFromStartM: number;
  segmentLengthM: number | null;
  backBlack: number | null;
  backRed: number | null;
  foreBlack: number | null;
  foreRed: number | null;
  intermediateBlack: number | null;
  intermediateRed: number | null;
  blackDelta: number | null;
  redDelta: number | null;
  meanDelta: number | null;
  elevation: number | null;
  originalElevation: number | null;
  isComplete: boolean;
  isValid: boolean;
}

function templatePathFor(route: LevelingRoute): string {
  return route.grade === '3' ? GRADE3_TEMPLATE : GRADE4_TEMPLATE;
}

function expectedSheetName(route: LevelingRoute): string {
  return route.grade === '3' ? 'Sheet1' : '第1页';
}

async function fetchTemplate(path: string): Promise<ArrayBuffer> {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`水准模板加载失败：${path}（HTTP ${response.status}）`);
  return response.arrayBuffer();
}

function cloneStyle<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function copyRowStyle(source: ExcelJS.Row, target: ExcelJS.Row, maxColumn: number): void {
  target.height = source.height;
  target.hidden = source.hidden;
  target.outlineLevel = source.outlineLevel;
  for (let column = 1; column <= maxColumn; column += 1) {
    target.getCell(column).style = cloneStyle(source.getCell(column).style);
  }
}

interface MergeAddress {
  startColumn: string;
  startRow: number;
  endColumn: string;
  endRow: number;
}

function parseMerge(address: string): MergeAddress | null {
  const match = address.match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/);
  if (!match) return null;
  return {
    startColumn: match[1],
    startRow: Number(match[2]),
    endColumn: match[3],
    endRow: Number(match[4]),
  };
}

function mergeAddress(merge: MergeAddress): string {
  return `${merge.startColumn}${merge.startRow}:${merge.endColumn}${merge.endRow}`;
}

function insertRowsPreservingMerges(sheet: ExcelJS.Worksheet, insertAt: number, count: number): void {
  if (count <= 0) return;
  const affected = (sheet.model.merges ?? [])
    .map(parseMerge)
    .filter((merge): merge is MergeAddress => merge !== null && merge.endRow >= insertAt);
  for (const merge of affected) sheet.unMergeCells(mergeAddress(merge));
  sheet.spliceRows(insertAt, 0, ...Array.from({ length: count }, () => []));
  for (const merge of affected) {
    const shifted = {
      ...merge,
      startRow: merge.startRow >= insertAt ? merge.startRow + count : merge.startRow,
      endRow: merge.endRow + count,
    };
    sheet.mergeCells(mergeAddress(shifted));
  }
}

function clearRows(sheet: ExcelJS.Worksheet, startRow: number, endRow: number, maxColumn: number): void {
  for (let row = startRow; row <= endRow; row += 1) {
    for (let column = 1; column <= maxColumn; column += 1) sheet.getRow(row).getCell(column).value = null;
  }
}

function setValue(
  sheet: ExcelJS.Worksheet,
  address: string,
  value: string | number | null | undefined,
  numberFormat?: string,
): void {
  const cell = sheet.getCell(address);
  if (value === null || value === undefined || value === '') {
    cell.value = null;
    return;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      cell.value = null;
      return;
    }
    cell.value = value;
    if (numberFormat) cell.numFmt = numberFormat;
    return;
  }
  cell.value = value;
}

function setIdentifier(
  sheet: ExcelJS.Worksheet,
  address: string,
  value: string | number,
  wrapText = false,
): void {
  const cell = sheet.getCell(address);
  cell.style = cloneStyle(cell.style);
  cell.value = String(value);
  cell.numFmt = '@';
  if (wrapText) {
    cell.alignment = {
      ...cell.alignment,
      horizontal: 'center',
      vertical: 'middle',
      wrapText: true,
      shrinkToFit: true,
    };
  }
}

function enableShrinkToFit(sheet: ExcelJS.Worksheet, address: string): void {
  const cell = sheet.getCell(address);
  cell.style = cloneStyle(cell.style);
  cell.alignment = { ...cell.alignment, shrinkToFit: true };
}

function readingMeters(raw: string): number | null {
  const millimeters = parseStaffReadingMm(raw);
  return millimeters === null ? null : new Decimal(millimeters).div(1000).toNumber();
}

function positive(value: number | null): number | null {
  return value !== null && value > 0 ? value : null;
}

function negativeMagnitude(value: number | null): number | null {
  return value !== null && value < 0 ? Math.abs(value) : null;
}

function formatDateTime(value?: string): string {
  if (!value) return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return `${date.getFullYear()}年${String(date.getMonth() + 1).padStart(2, '0')}月${String(date.getDate()).padStart(2, '0')}日 ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function knownElevation(route: LevelingRoute, name: string): number | null {
  const point = route.knownPoints.find((candidate) => candidate.name.trim() === name.trim());
  return point?.elevation ?? null;
}

function buildPointRecords(route: LevelingRoute): PointRecord[] {
  const records: PointRecord[] = [];
  let cumulativeMeters = 0;
  let previousPointName = '';
  let previousElevation = route.calculation.startElevation;

  for (const station of route.stations) {
    const { readings, result } = station;
    const segmentLength = result.backDistance !== null && result.foreDistance !== null
      ? new Decimal(result.backDistance).plus(result.foreDistance).toNumber()
      : null;
    if (records.length === 0 || previousPointName !== readings.backPoint.trim()) {
      records.push({
        id: `back:${station.id}`,
        stationNumber: station.stationNumber,
        pointName: readings.backPoint,
        direction: station.direction,
        distanceFromStartM: cumulativeMeters,
        segmentLengthM: segmentLength,
        backBlack: readingMeters(readings.backBlack),
        backRed: readingMeters(readings.backRed),
        foreBlack: null,
        foreRed: null,
        intermediateBlack: null,
        intermediateRed: null,
        blackDelta: null,
        redDelta: null,
        meanDelta: null,
        elevation: previousElevation,
        originalElevation: knownElevation(route, readings.backPoint),
        isComplete: result.isComplete,
        isValid: result.isValid,
      });
    } else {
      const previous = records[records.length - 1];
      previous.backBlack = readingMeters(readings.backBlack);
      previous.backRed = readingMeters(readings.backRed);
    }

    readings.intermediates.forEach((intermediate) => {
      const intermediateResult = result.intermediateResults.find((candidate) => candidate.id === intermediate.id);
      records.push({
        id: `intermediate:${intermediate.id}`,
        stationNumber: station.stationNumber,
        pointName: intermediate.point,
        direction: station.direction,
        distanceFromStartM: cumulativeMeters,
        segmentLengthM: segmentLength,
        backBlack: null,
        backRed: null,
        foreBlack: null,
        foreRed: null,
        intermediateBlack: readingMeters(intermediate.black),
        intermediateRed: readingMeters(intermediate.red),
        blackDelta: null,
        redDelta: null,
        meanDelta: intermediateResult?.deltaHeight ?? null,
        elevation: intermediateResult?.elevation ?? null,
        originalElevation: knownElevation(route, intermediate.point),
        isComplete: intermediateResult?.isComplete ?? false,
        isValid: result.isValid,
      });
    });

    if (segmentLength !== null) cumulativeMeters = new Decimal(cumulativeMeters).plus(segmentLength).toNumber();
    records.push({
      id: `fore:${station.id}`,
      stationNumber: station.stationNumber,
      pointName: readings.forePoint,
      direction: station.direction,
      distanceFromStartM: cumulativeMeters,
      segmentLengthM: segmentLength,
      backBlack: null,
      backRed: null,
      foreBlack: readingMeters(readings.foreBlack),
      foreRed: readingMeters(readings.foreRed),
      intermediateBlack: null,
      intermediateRed: null,
      blackDelta: result.blackDelta,
      redDelta: result.redDelta,
      meanDelta: result.meanDeltaHeight,
      elevation: result.elevation,
      originalElevation: knownElevation(route, readings.forePoint),
      isComplete: result.isComplete,
      isValid: result.isValid,
    });
    previousPointName = readings.forePoint.trim();
    previousElevation = result.elevation;
  }
  return records;
}

function extendGrade3Template(sheet: ExcelJS.Worksheet, stationCount: number): number {
  const extraStations = Math.max(0, stationCount - GRADE3_TEMPLATE_STATIONS);
  const extraRows = extraStations * GRADE3_ROWS_PER_STATION;
  insertRowsPreservingMerges(sheet, 14, extraRows);
  for (let index = 0; index < extraRows; index += 1) {
    copyRowStyle(sheet.getRow(GRADE3_DATA_START + index % 4), sheet.getRow(14 + index), 13);
  }
  sheet.pageSetup.printArea = `A1:M${19 + extraRows}`;
  return extraRows;
}

const GRADE4_PAIR_MERGES: ReadonlyArray<readonly [string, string]> = [
  ['A', 'A'], ['B', 'B'], ['C', 'C'], ['D', 'G'], ['P', 'S'], ['T', 'T'], ['U', 'U'],
  ['V', 'Y'], ['Z', 'AA'], ['AB', 'AC'], ['AD', 'AE'], ['AF', 'AG'], ['AH', 'AI'],
];

function extendGrade4Template(sheet: ExcelJS.Worksheet, pointCount: number): number {
  const extraPoints = Math.max(0, pointCount - GRADE4_TEMPLATE_POINTS);
  const extraRows = extraPoints * GRADE4_ROWS_PER_POINT;
  if (extraRows > 0) {
    sheet.unMergeCells('AJ8:AN35');
    insertRowsPreservingMerges(sheet, 36, extraRows);
    for (let index = 0; index < extraRows; index += 1) {
      copyRowStyle(sheet.getRow(34 + index % 2), sheet.getRow(36 + index), 40);
    }
    for (let pointIndex = 0; pointIndex < extraPoints; pointIndex += 1) {
      const topRow = 36 + pointIndex * 2;
      const bottomRow = topRow + 1;
      for (const [startColumn, endColumn] of GRADE4_PAIR_MERGES) {
        sheet.mergeCells(`${startColumn}${topRow}:${endColumn}${bottomRow}`);
      }
      sheet.mergeCells(`J${topRow}:M${topRow}`);
      sheet.mergeCells(`J${bottomRow}:M${bottomRow}`);
    }
    sheet.mergeCells(`AJ8:AN${35 + extraRows}`);
  }
  sheet.pageSetup.printArea = `A1:AN${38 + extraRows}`;
  return extraRows;
}

function populateGrade3(sheet: ExcelJS.Worksheet, route: LevelingRoute): void {
  const extraRows = extendGrade3Template(sheet, route.stations.length);
  const summaryDataRow = 16 + extraRows;
  const signatureRow = 19 + extraRows;
  clearRows(sheet, GRADE3_DATA_START, GRADE3_DATA_START + Math.max(route.stations.length, 1) * 4 - 1, 13);

  setValue(sheet, 'A2', `站名：${route.location ?? ''}`);
  setValue(sheet, 'H2', `项目：${route.name}`);
  setValue(sheet, 'A3', `测自：${route.calculation.startPointName}`);
  setValue(sheet, 'E3', `测至：${route.calculation.endPointName}`);
  setValue(sheet, 'H3', '天气：');
  setValue(sheet, 'K3', '成像：');
  setValue(sheet, 'A4', '基面：');
  setValue(sheet, 'E4', `仪器：${route.instrument}`);
  setValue(sheet, 'H4', `测量时间：${formatDateTime(route.startTime ?? route.createdAt)}`);

  route.stations.forEach((station, index) => {
    const row = GRADE3_DATA_START + index * 4;
    const { readings, result } = station;
    setIdentifier(sheet, `A${row}`, station.stationNumber);
    setIdentifier(sheet, `B${row}`, readings.backPoint, true);
    setIdentifier(sheet, `B${row + 1}`, readings.forePoint, true);
    setValue(sheet, `D${row}`, readingMeters(readings.backUpper), '0.000');
    setValue(sheet, `D${row + 1}`, readingMeters(readings.backLower), '0.000');
    setValue(sheet, `F${row}`, readingMeters(readings.foreUpper), '0.000');
    setValue(sheet, `F${row + 1}`, readingMeters(readings.foreLower), '0.000');
    setValue(sheet, `C${row + 2}`, result.backDistance, '0.0');
    setValue(sheet, `E${row + 2}`, result.foreDistance, '0.0');
    setValue(sheet, `C${row + 3}`, result.distanceDiff, '0.0');
    setValue(sheet, `E${row + 3}`, result.accumulatedDistanceDiff, '0.0');
    setValue(sheet, `H${row}`, readingMeters(readings.backBlack), '0.000');
    setValue(sheet, `H${row + 1}`, readingMeters(readings.foreBlack), '0.000');
    setValue(sheet, `I${row + 2}`, readingMeters(readings.foreRed), '0.000');
    setValue(sheet, `I${row + 3}`, readingMeters(readings.backRed), '0.000');
    setValue(sheet, `J${row}`, result.backDiff, '0.0');
    setValue(sheet, `J${row + 1}`, result.foreDiff, '0.0');
    setValue(sheet, `K${row}`, result.meanDeltaHeight, '0.000');
    setValue(sheet, `L${row}`, result.elevation, '0.000');
    setValue(sheet, `M${row}`, result.isComplete ? result.isValid ? '合格' : '超限' : '未完整');
  });

  const forwardElevation = route.calculation.startElevation !== null && route.calculation.forwardDeltaHeightM !== null
    ? new Decimal(route.calculation.startElevation).plus(route.calculation.forwardDeltaHeightM).toNumber()
    : null;
  const returnElevation = route.calculation.startElevation !== null && route.calculation.returnDeltaHeightM !== null
    ? new Decimal(route.calculation.startElevation).minus(route.calculation.returnDeltaHeightM).toNumber()
    : null;
  setValue(sheet, `A${summaryDataRow}`, route.calculation.startPointName);
  setValue(sheet, `B${summaryDataRow}`, route.calculation.endPointName);
  setValue(sheet, `C${summaryDataRow}`, forwardElevation, '0.000');
  setValue(sheet, `D${summaryDataRow}`, returnElevation, '0.000');
  setValue(sheet, `E${summaryDataRow}`, route.calculation.adoptedElevation, '0.000');
  setValue(sheet, `F${summaryDataRow}`, route.calculation.closureErrorMm === null ? null : route.calculation.closureErrorMm / 1000, '0.000');
  setValue(sheet, `G${summaryDataRow}`, route.calculation.meanSightDistanceM === null ? null : route.calculation.meanSightDistanceM / 1000, '0.000');
  setValue(sheet, `H${summaryDataRow}`, route.calculation.allowableErrorMm === null ? null : route.calculation.allowableErrorMm / 1000, '0.000');
  setValue(sheet, `I${summaryDataRow}`, route.calculation.knownEndElevation, '0.000');
  setValue(sheet, `J${summaryDataRow}`, route.calculation.adoptedElevation, '0.000');
  setValue(sheet, `K${summaryDataRow}`, route.calculation.isWithinTolerance === null ? '待计算' : route.calculation.isWithinTolerance ? '符合当前限差参数' : '超限');
  setValue(sheet, `A${signatureRow}`, `测量：${route.observer ?? ''}`);
  setValue(sheet, `C${signatureRow}`, `记载：${route.recorder ?? ''}`);
  setValue(sheet, `E${signatureRow}`, '计算：应用自动计算');
  setValue(sheet, `G${signatureRow}`, '初校：');
  setValue(sheet, `J${signatureRow}`, '复校：');
}

function routeZeroElevation(route: LevelingRoute): number | null {
  const waterLevel = toFiniteDecimal(route.waterLevel);
  const edgeReading = toFiniteDecimal(route.waterEdgeReading);
  return waterLevel && edgeReading ? waterLevel.minus(edgeReading).toNumber() : null;
}

function routeTypeLabel(routeType: LevelingRoute['routeType']): string {
  if (routeType === 'attached') return '附合路线';
  if (routeType === 'closed') return '闭合路线';
  if (routeType === 'round-trip') return '往返路线';
  return '开放路线';
}

function populateGrade4(sheet: ExcelJS.Worksheet, route: LevelingRoute): void {
  const records = buildPointRecords(route);
  const extraRows = extendGrade4Template(sheet, records.length);
  const signatureRow = 37 + extraRows;
  const dataEnd = GRADE4_DATA_START + Math.max(GRADE4_TEMPLATE_POINTS, records.length) * 2 - 1;
  clearRows(sheet, GRADE4_DATA_START, dataEnd, 35);

  const gradeLabel = route.grade === '4' ? '四等' : '等外';
  setValue(sheet, 'A1', `${route.location ?? ''}${gradeLabel}水准测量记载表`);
  setValue(sheet, 'AL2', route.id.slice(0, 8));
  setValue(sheet, 'C3', route.name);
  setValue(sheet, 'N3', route.location ?? '');
  setValue(sheet, 'C4', route.staffNumber ?? '');
  setValue(sheet, 'I4', routeZeroElevation(route), '0.00');
  setValue(sheet, 'O4', toFiniteDecimal(route.waterEdgeReading)?.toNumber() ?? null, '0.000');
  setValue(sheet, 'T4', toFiniteDecimal(route.waterLevel)?.toNumber() ?? null, '0.000');

  const startDate = new Date(route.startTime ?? route.createdAt);
  if (Number.isFinite(startDate.getTime())) {
    setValue(sheet, 'V3', startDate.getFullYear(), '0');
    setValue(sheet, 'AB3', startDate.getMonth() + 1, '0');
    setValue(sheet, 'AD3', startDate.getDate(), '0');
    setValue(sheet, 'AF3', startDate.getHours(), '0');
    setValue(sheet, 'AH3', startDate.getMinutes(), '0');
  }
  const endDate = new Date(route.endTime ?? route.updatedAt);
  if (Number.isFinite(endDate.getTime())) {
    setValue(sheet, 'AK3', endDate.getHours(), '0');
    setValue(sheet, 'AM3', endDate.getMinutes(), '0');
  }

  records.forEach((record, index) => {
    const topRow = GRADE4_DATA_START + index * 2;
    const bottomRow = topRow + 1;
    setIdentifier(sheet, `A${topRow}`, record.stationNumber);
    setIdentifier(sheet, `B${topRow}`, record.pointName, true);
    setValue(sheet, `C${topRow}`, record.distanceFromStartM, '0.0');
    enableShrinkToFit(sheet, `C${topRow}`);
    setValue(sheet, `D${topRow}`, record.segmentLengthM, '0.0');
    setValue(sheet, `H${topRow}`, record.backBlack, '0.000');
    setValue(sheet, `H${bottomRow}`, record.backRed, '0.000');
    setValue(sheet, `I${topRow}`, record.foreBlack, '0.000');
    setValue(sheet, `I${bottomRow}`, record.foreRed, '0.000');
    setValue(sheet, `J${topRow}`, record.intermediateBlack, '0.000');
    setValue(sheet, `J${bottomRow}`, record.intermediateRed, '0.000');
    setValue(sheet, `N${topRow}`, positive(record.blackDelta), '0.000');
    setValue(sheet, `O${topRow}`, negativeMagnitude(record.blackDelta), '0.000');
    setValue(sheet, `N${bottomRow}`, positive(record.redDelta), '0.000');
    setValue(sheet, `O${bottomRow}`, negativeMagnitude(record.redDelta), '0.000');
    setValue(sheet, `P${topRow}`, positive(record.meanDelta), '0.000');
    setValue(sheet, `T${topRow}`, negativeMagnitude(record.meanDelta), '0.000');
    setValue(sheet, `U${topRow}`, record.elevation, '0.000');
  });

  const finalRecord = records[records.length - 1];
  if (finalRecord) {
    const finalRow = GRADE4_DATA_START + (records.length - 1) * 2;
    const returnElevation = route.calculation.startElevation !== null && route.calculation.returnDeltaHeightM !== null
      ? new Decimal(route.calculation.startElevation).minus(route.calculation.returnDeltaHeightM).toNumber()
      : null;
    setValue(sheet, `V${finalRow}`, returnElevation, '0.000');
    setValue(sheet, `Z${finalRow}`, route.calculation.closureErrorMm, '0.0');
    setValue(sheet, `AB${finalRow}`, route.calculation.allowableErrorMm, '0.0');
    setValue(sheet, `AD${finalRow}`, route.calculation.adoptedElevation, '0.000');
    setValue(sheet, `AF${finalRow}`, routeZeroElevation(route), '0.000');
    setValue(sheet, `AH${finalRow}`, routeZeroElevation(route), '0.00');
  }
  setValue(
    sheet,
    'AJ8',
    [
      `等级：${gradeLabel}`,
      `路线：${routeTypeLabel(route.routeType)}`,
      `测站：${route.stations.length}`,
      `结果：${route.calculation.isWithinTolerance === null ? '待完整数据' : route.calculation.isWithinTolerance ? '符合当前限差参数' : '超限'}`,
    ].join('\n'),
  );
  setValue(sheet, `A${signatureRow}`, `测量：${route.observer ?? ''}`);
  setValue(sheet, `H${signatureRow}`, `记录：${route.recorder ?? ''}`);
  setValue(sheet, `N${signatureRow}`, '计算：应用自动计算');
  setValue(sheet, `T${signatureRow}`, '校核：');
}

export async function buildLevelingWorkbook(
  route: LevelingRoute,
  loadTemplate: LevelingTemplateLoader = fetchTemplate,
): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  const templatePath = templatePathFor(route);
  const template = await loadTemplate(templatePath);
  await workbook.xlsx.load(template);
  const sheet = workbook.getWorksheet(expectedSheetName(route));
  if (!sheet) throw new Error(`模板缺少工作表：${expectedSheetName(route)}`);
  workbook.creator = '水文测验终端';
  workbook.modified = new Date();
  if (route.grade === '3') populateGrade3(sheet, route);
  else populateGrade4(sheet, route);
  return workbook;
}

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Date) return value.toISOString();
  if ('text' in value && typeof value.text === 'string') return value.text;
  if ('result' in value && (typeof value.result === 'string' || typeof value.result === 'number')) return String(value.result);
  return '';
}

export async function validateLevelingWorkbook(
  buffer: ArrayBuffer | Uint8Array,
  route: LevelingRoute,
): Promise<WorkbookValidationResult> {
  const workbook = new ExcelJS.Workbook();
  // ExcelJS 浏览器运行时接受 ArrayBuffer；复制 Uint8Array 可避免较新 Node 类型
  // 将 ArrayBufferView 错误收窄为 Node.js Buffer。
  const workbookBuffer = buffer instanceof ArrayBuffer ? buffer : Uint8Array.from(buffer).buffer;
  await workbook.xlsx.load(workbookBuffer);
  const sheetName = expectedSheetName(route);
  const sheet = workbook.getWorksheet(sheetName);
  const errors: string[] = [];
  if (!sheet) return { isValid: false, sheetName, mergeCount: 0, errors: [`缺少工作表 ${sheetName}`] };

  const merges = sheet.model.merges ?? [];
  const expectedRootMerge = route.grade === '3' ? 'A1:M1' : 'A1:AN1';
  if (!merges.includes(expectedRootMerge)) errors.push(`缺少关键合并区域 ${expectedRootMerge}`);
  if (route.grade === '4' && !merges.some((merge) => merge.startsWith('AJ8:AN'))) {
    errors.push('四等模板备注合并区域缺失');
  }
  if (route.name) {
    const nameCell = route.grade === '3' ? 'H2' : 'C3';
    if (!cellText(sheet.getCell(nameCell).value).includes(route.name)) errors.push(`测量对象未写入 ${nameCell}`);
  }
  if (route.stations.length > 0) {
    const stationCell = route.grade === '3' ? 'A10' : 'A8';
    if (cellText(sheet.getCell(stationCell).value) === '') errors.push(`首个测站未写入 ${stationCell}`);
  }

  sheet.eachRow({ includeEmpty: false }, (row) => {
    row.eachCell({ includeEmpty: false }, (cell) => {
      if (typeof cell.value === 'number' && !Number.isFinite(cell.value)) {
        errors.push(`${cell.address} 含非有限数`);
      }
      if (typeof cell.value === 'string' && /^(NaN|Infinity|-Infinity|undefined|null|\[object Object\])$/.test(cell.value.trim())) {
        errors.push(`${cell.address} 含非法文本 ${cell.value}`);
      }
    });
  });
  return { isValid: errors.length === 0, sheetName, mergeCount: merges.length, errors };
}

function sanitizeFilename(value: string): string {
  const invalid = '<>:"/\\|?*';
  const cleaned = Array.from(value, (character) => invalid.includes(character) || character.charCodeAt(0) < 32 ? '_' : character)
    .join('')
    .replace(/[. ]+$/g, '')
    .trim();
  return cleaned || '水准测量';
}

export function createLevelingExportFilename(route: LevelingRoute): string {
  const grade = route.grade === '3' ? '三等' : route.grade === '4' ? '四等' : '等外';
  const date = new Date(route.startTime ?? route.createdAt);
  const time = Number.isFinite(date.getTime())
    ? `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}_${String(date.getHours()).padStart(2, '0')}${String(date.getMinutes()).padStart(2, '0')}`
    : '未定时间';
  return `${sanitizeFilename([grade, route.location, route.name || '未命名', time].filter(Boolean).join('_'))}.xlsx`;
}

function blobBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('Excel Blob 读取失败'));
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const base64 = result.split(',')[1];
      if (!base64) reject(new Error('Excel Base64 转换失败'));
      else resolve(base64);
    };
    reader.readAsDataURL(blob);
  });
}

export async function exportLevelingExcel(route: LevelingRoute): Promise<void> {
  const workbook = await buildLevelingWorkbook(route);
  const output = await workbook.xlsx.writeBuffer();
  const bytes = new Uint8Array(output as ArrayBuffer);
  const validation = await validateLevelingWorkbook(bytes, route);
  if (!validation.isValid) throw new Error(`Excel 回读校验失败：${validation.errors.join('；')}`);
  const fileName = createLevelingExportFilename(route);
  const blob = new Blob([bytes], { type: XLSX_MIME });

  if (Capacitor.isNativePlatform()) {
    const result = await Filesystem.writeFile({
      path: fileName,
      data: await blobBase64(blob),
      directory: Directory.Cache,
    });
    await Share.share({ title: fileName, url: result.uri, dialogTitle: '分享水准测量成果' });
    return;
  }

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { calculateFlowDeviation } from '../src/lib/flowDeviation';
import { createMeasureVertical, createNewRun, processRun } from '../src/lib/HydroEngine';
import { durationLabel, legacyTimeToIso, markHydroRunTime } from '../src/lib/hydroTiming';
import { applyDeadZone, boundedBubblePosition, lowPassTilt, rotateForScreen } from '../src/lib/spiritLevel';
import { greatCircleDistanceMeters, isValidCoordinate } from '../src/lib/levelingVisuals';
import { formatFiniteAdaptive, roundBanker } from '../src/lib/rounding';
import { compareVersions, formatAssetSize, normalizeVersion, parseGitHubRelease } from '../src/lib/githubUpdate';
import { processStation } from '../src/lib/LevelingEngine';
import { calculateAllowableError, recalculateLevelingRoute } from '../src/lib/RouteClosureEngine';
import {
  createEmptyLevelingRoute,
  createEmptyLevelingStation,
  migrateLevelingPersistedState,
  useLevelingStore,
} from '../src/store/levelingStore';
import { migrateHydroPersistedState, useHydroStore } from '../src/store/hydroStore';
import { createAppDiagnostic, createFullBackup, restoreFullBackup, validateFullBackup } from '../src/lib/appBackup';
import { integrityHash } from '../src/lib/dataIntegrity';
import { createRuleProfileSnapshot, DEFAULT_LEVELING_RULE_PROFILE } from '../src/lib/levelingRules';
import { migrateGovernanceState, useGovernanceStore } from '../src/store/governanceStore';
import { runHydroBenchmark, ZHENG_JIA_TUN_FIXTURE } from '../src/lib/__benchmark';
import { buildHydroWorkbook } from '../src/lib/exportExcel';
import {
  buildLevelingWorkbook,
  createLevelingExportFilename,
  validateLevelingWorkbook,
} from '../src/lib/exportLeveling';
import type {
  LevelingGrade,
  LevelingRoute,
  LevelingStation,
  SurveyDirection,
} from '../src/types/leveling';
import { LEVELING_SCHEMA_VERSION } from '../src/types/leveling';

let assertionCount = 0;

function assert(condition: unknown, message: string): asserts condition {
  assertionCount += 1;
  if (!condition) throw new Error(`断言失败：${message}`);
}

function assertClose(actual: number | null, expected: number, tolerance: number, message: string): void {
  assert(actual !== null && Math.abs(actual - expected) <= tolerance, `${message}，实际 ${String(actual)}，期望 ${expected}`);
}

function testGitHubUpdate(): void {
  assert(normalizeVersion('v1.10.26') === '1.10.26', 'GitHub Tag 应标准化为语义版本');
  assert(compareVersions('1.10.26', '1.10.25') > 0, '新版本应高于旧版本');
  assert(compareVersions('1.10.25', '1.10.25') === 0, '相同版本应一致');
  assert(compareVersions('1.9.99', '1.10.0') < 0, '版本比较不得按字符串排序');
  assert(formatAssetSize(6 * 1024 * 1024) === '6.0 MB', 'APK 大小应格式化为 MB');

  const release = parseGitHubRelease({
    tag_name: 'v1.10.26',
    name: '水文测验终端 v1.10.26',
    body: '更新说明',
    published_at: '2026-07-29T00:00:00Z',
    html_url: 'https://github.com/TaissaFarmiga/SWCY/releases/tag/v1.10.26',
    assets: [{
      name: 'update.apk',
      state: 'uploaded',
      size: 6_000_000,
      browser_download_url: 'https://github.com/TaissaFarmiga/SWCY/releases/download/v1.10.26/update.apk',
      digest: `sha256:${'a'.repeat(64)}`,
    }],
  });
  assert(release.version === '1.10.26' && release.asset.size === 6_000_000, 'GitHub Release 应解析版本和 APK');
  assert(release.asset.sha256 === 'a'.repeat(64), 'GitHub Release 应解析 SHA-256');

  let rejectedUntrustedUrl = false;
  try {
    parseGitHubRelease({
      tag_name: 'v1.10.26',
      assets: [{
        name: 'update.apk', state: 'uploaded', size: 1,
        browser_download_url: 'https://example.com/update.apk',
        digest: `sha256:${'b'.repeat(64)}`,
      }],
    });
  } catch {
    rejectedUntrustedUrl = true;
  }
  assert(rejectedUntrustedUrl, '非 GitHub 更新地址必须拒绝');

  let rejectedLookalikePath = false;
  try {
    parseGitHubRelease({
      tag_name: 'v1.10.26',
      assets: [{
        name: 'update.apk', state: 'uploaded', size: 1,
        browser_download_url: 'https://github.com/TaissaFarmiga/SWCY/releases/download/v1.10.26/update.apk.backup',
        digest: `sha256:${'c'.repeat(64)}`,
      }],
    });
  } catch {
    rejectedLookalikePath = true;
  }
  assert(rejectedLookalikePath, 'GitHub Release 近似路径不得通过精确资产校验');
}

function expectValidFlow(measured: unknown, online: unknown) {
  const result = calculateFlowDeviation(measured, online);
  assert(result.kind === 'valid', `${String(measured)}/${String(online)} 应可计算`);
  return result;
}

function makeStation(
  stationNumber: number,
  backPoint: string,
  forePoint: string,
  direction: SurveyDirection = 'forward',
  delta: 'positive' | 'negative' = 'positive',
): LevelingStation {
  const station = createEmptyLevelingStation(stationNumber, direction);
  const positive = delta === 'positive';
  station.readings = {
    ...station.readings,
    backPoint,
    forePoint,
    backUpper: '1.500',
    backLower: '2.000',
    foreUpper: '1.600',
    foreLower: '2.100',
    backBlack: positive ? '1.500' : '1.200',
    backRed: positive ? '6.187' : '5.987',
    foreBlack: positive ? '1.200' : '1.500',
    foreRed: positive ? '5.987' : '6.187',
  };
  return station;
}

function buildRoute(
  grade: LevelingGrade,
  stations: LevelingStation[],
  endElevation: number,
  routeType: LevelingRoute['routeType'] = 'attached',
): LevelingRoute {
  const route = createEmptyLevelingRoute(grade);
  route.name = '中文/特殊:水准?测量*对象';
  route.location = '测试站（东）';
  route.routeType = routeType;
  route.stations = stations;
  route.knownPoints = [
    { id: 'known-start', name: stations[0]?.readings.backPoint ?? 'A', elevation: 100 },
    { id: 'known-end', name: stations[stations.length - 1]?.readings.forePoint ?? 'B', elevation: endElevation },
  ];
  return recalculateLevelingRoute(route);
}

async function templateLoader(templatePath: string): Promise<ArrayBuffer> {
  const filename = path.basename(templatePath);
  const bytes = await readFile(path.resolve('public', filename));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function workbookBytes(route: LevelingRoute): Promise<Uint8Array> {
  const workbook = await buildLevelingWorkbook(route, templateLoader);
  const output = await workbook.xlsx.writeBuffer();
  return new Uint8Array(output as ArrayBuffer);
}

function testFlowDeviation(): void {
  let result = expectValidFlow(10, 10);
  assert(result.delta.isZero() && result.status === '一致', '10/10 应一致');
  result = expectValidFlow(11, 10);
  assert(result.delta.equals(1) && result.signedRate?.equals(10) === true && result.status === '实测偏高', '11/10');
  result = expectValidFlow(9, 10);
  assert(result.delta.equals(-1) && result.signedRate?.equals(-10) === true && result.absoluteRate?.equals(10) === true, '9/10');
  result = expectValidFlow(0, 10);
  assert(result.signedRate?.equals(-100) === true && result.status === '实测偏低', '0/10');
  result = expectValidFlow(10, 0);
  assert(result.delta.equals(10) && result.signedRate === null && result.absoluteRate === null && result.rateMessage?.includes('无法计算') === true, '10/0');
  assert(calculateFlowDeviation('', 10).kind === 'invalid', '空值不能转 0');
  assert(calculateFlowDeviation('非数字', 10).kind === 'invalid', '非数字应拒绝');
  result = expectValidFlow('0.00000000000000000002', '0.00000000000000000001');
  assert(result.signedRate?.equals(100) === true, '极小小数应保持精度');
  assert(formatFiniteAdaptive(result.delta, 6) === '1.00000e-20', '极小非零差值不得显示成假 0');
  result = expectValidFlow('999999999999.123456789', '999999999999');
  assert(result.delta.equals('0.123456789'), '大流量多位小数应保持精度');
  assert(roundBanker('2.345', 2) === '2.34' && roundBanker('2.355', 2) === '2.36', '五成双舍入');
}

function testHydroEngineCompleteness(): void {
  const empty = processRun(createNewRun(1));
  assert(empty.totalArea === '' && empty.totalDischarge === '' && empty.meanVelocity === '', '空测流任务不得生成假 0 成果');
  assert(empty.surfaceWidth === '', '空水边起点距不得生成假水面宽');

  const run = createNewRun(2);
  const measure = createMeasureVertical(1, 'open');
  run.verticals[0].startDistance = '0';
  run.verticals[1].startDistance = '10';
  measure.startDistance = '5';
  run.verticals.splice(1, 0, measure);

  let result = processRun(run);
  assert(result.totalArea === '' && result.totalDischarge === '', '缺失水深和流速时不得生成成果');
  result.verticals[1].waterDepth = '2';
  result = processRun(result);
  assert(result.totalArea !== '' && result.totalDischarge === '', '几何完整但流速缺失时仅可生成面积');
  result.verticals[1].measurePoints[0].velocity = '1';
  result = processRun(result);
  assert(result.totalArea === '10' && result.totalDischarge === '7' && result.meanVelocity === '0.7', '完整单垂线断面成果');

  result.verticals[1].waterDepth = '';
  result = processRun(result);
  assert(result.totalArea === '' && result.maxDepth === '', '清空水深后必须清除旧成果');
  result.verticals[1].waterDepth = 'Infinity';
  result = processRun(result);
  assert(result.totalArea === '' && result.maxDepth === '', 'Infinity 水深不得参与计算');
}

function testHydroPersistenceAndTiming(): void {
  const base = createNewRun(1, 'open');
  const started = markHydroRunTime(base, 'start', new Date('2025-12-31T23:55:00+08:00'));
  const ended = markHydroRunTime(started, 'end', new Date('2026-01-01T00:10:00+08:00'));
  assert(ended.startAt === '2025-12-31T15:55:00.000Z', '测流开始时间应保存完整 ISO 时间戳');
  assert(ended.endAt === '2025-12-31T16:10:00.000Z' && ended.duration === '00小时15分', '跨年计时应为 15 分钟');
  assert(durationLabel('2026-07-29T00:00:00Z', '2026-07-29T01:02:59Z') === '01小时02分', '同日时长按完整时间戳计算');
  assert(durationLabel('2026-07-29T01:00:00Z', '2026-07-29T00:00:00Z') === '', '结束早于开始不得生成假时长');

  const legacyReference = new Date('2026-01-01T00:10:00+08:00');
  const legacyStart = legacyTimeToIso('12/31 23:55', legacyReference);
  assert(legacyStart === '2025-12-31T15:55:00.000Z', '旧跨年显示时间应推回上一年');

  const duplicate = { ...base, id: 'same-id', startTime: '12/31 23:55', endTime: '1/1 00:10', timestamp: '2026-01-01T00:10:00+08:00' };
  const migrated = migrateHydroPersistedState({
    currentRun: duplicate,
    runs: [duplicate, { ...duplicate }],
    templates: [
      null,
      {
        id: 'template-1',
        name: '旧断面',
        createdAt: 1,
        verticals: base.verticals,
      },
    ],
  });
  assert(migrated.currentRun.schemaVersion === 2 && migrated.currentRun.startAt === legacyStart, '旧测流数据应升级 Schema 并恢复完整开始时间');
  assert(migrated.currentRun.endAt === '2025-12-31T16:10:00.000Z' && migrated.currentRun.duration === '00小时15分', '旧跨年开始/结束显示字段应迁移为正确完整时长');
  assert(migrated.runs.length === 2 && migrated.runs[0].id !== migrated.runs[1].id, '重复历史 ID 应修复且不清空历史');
  assert(migrated.templates.length === 1 && migrated.templates[0].name === '旧断面', '合法旧模板应迁入统一持久化状态');
  assert(migrateHydroPersistedState({ currentRun: null, runs: [null, 'bad'], templates: 'bad' }).runs.length === 0, '非法旧测流节点应容错过滤');

  useHydroStore.setState({ currentRun: base, runs: [], templates: [] });
  const savedTemplate = useHydroStore.getState().saveTemplate();
  assert(useHydroStore.getState().templates[0].id === savedTemplate.id, '模板保存应进入统一 Zustand 状态');
  useHydroStore.getState().deleteTemplate(savedTemplate.id);
  assert(useHydroStore.getState().templates.length === 0, '模板删除应通过统一 Zustand 持久化链');
}

function testSpiritLevelMath(): void {
  const rotated = rotateForScreen(1, 2, 90);
  assert(rotated.x === -2 && rotated.y === 1, '横屏 90° 坐标映射');
  assert(applyDeadZone(0.04) === 0 && applyDeadZone(0.06) === 0.06, '气泡死区');
  const filtered = lowPassTilt({ x: 0, y: 10 }, { x: 10, y: 0 });
  assertClose(filtered.x, 1.8, 1e-12, '低通滤波 X');
  const bounded = boundedBubblePosition(100, 100);
  assert(Math.hypot(bounded.x, bounded.y) <= 92.0000001, '气泡位移必须限制在靶盘内');
}

function testLevelingEngine(): void {
  const empty = createEmptyLevelingStation(1, 'forward');
  const emptyResult = processStation(empty, '4', 0, 100);
  assert(!emptyResult.isComplete && emptyResult.meanDeltaHeight === null && emptyResult.elevation === null, '缺失读数不得变 0');
  empty.readings.backBlack = 'Infinity';
  assert(processStation(empty, 'out', 0, 100).blackDelta === null, 'Infinity 应拒绝');

  const positive = makeStation(1, 'A', 'P1');
  const positiveResult = processStation(positive, '4', 0, 100);
  assert(positiveResult.isComplete && positiveResult.isValid, '四等正高差单站应完整合格');
  assertClose(positiveResult.backDistance, 50, 1e-9, '后距');
  assertClose(positiveResult.foreDistance, 50, 1e-9, '前距');
  assertClose(positiveResult.meanDeltaHeight, 0.3, 1e-12, '高差中数');
  assertClose(positiveResult.elevation, 100.3, 1e-12, '高程递推');

  const negative = makeStation(2, 'P1', 'A', 'return', 'negative');
  const negativeResult = processStation(negative, '4', 0, 100.3);
  assertClose(negativeResult.meanDeltaHeight, -0.3, 1e-12, '负高差');
  assertClose(negativeResult.elevation, 100, 1e-12, '返测高程');

  const eightyMeterSight = makeStation(1, 'A', 'P1');
  eightyMeterSight.readings.backUpper = '1.000';
  eightyMeterSight.readings.backLower = '1.800';
  eightyMeterSight.readings.foreUpper = '1.000';
  eightyMeterSight.readings.foreLower = '1.800';
  const grade3Sight = processStation(eightyMeterSight, '3', 0, 100);
  const grade4Sight = processStation(eightyMeterSight, '4', 0, 100);
  assert(grade3Sight.isComplete && !grade3Sight.isValid, '80m 视距应超过三等 75m 当前参数');
  assert(grade4Sight.isComplete && grade4Sight.isValid, '80m 视距应符合四等 100m 当前参数');
}

function testRouteCalculations(): void {
  const attached = buildRoute('4', [makeStation(1, 'A', 'P1'), makeStation(2, 'P1', 'B')], 100.6);
  assertClose(attached.totalDeltaHeight, 0.6, 1e-12, '路线高差累计');
  assertClose(attached.totalDistance, 0.2, 1e-12, '路线长度');
  assertClose(attached.closureError, 0, 1e-8, '附合闭合差');
  assert(attached.calculation.isWithinTolerance === true && attached.calculation.profilePoints.length === 3, '附合路线通过且纵断面统一');

  const exactLimit = buildRoute('4', [makeStation(1, 'A', 'P1'), makeStation(2, 'P1', 'B')], 100.58);
  assertClose(exactLimit.closureError, 20, 1e-8, '闭合差等于限差');
  assert(exactLimit.calculation.isWithinTolerance === true, '等于限差应通过');
  const overLimit = buildRoute('4', [makeStation(1, 'A', 'P1'), makeStation(2, 'P1', 'B')], 100.579);
  assert(overLimit.calculation.isWithinTolerance === false, '略超限应失败');

  const roundTrip = buildRoute(
    '4',
    [makeStation(1, 'A', 'B', 'forward'), makeStation(2, 'B', 'A', 'return', 'negative')],
    100,
    'round-trip',
  );
  assertClose(roundTrip.calculation.roundTripDiscrepancyMm, 0, 1e-8, '往返高差不符值');
  assertClose(roundTrip.calculation.adoptedElevation, 100.3, 1e-12, '往返采用高程');

  const deletedFirst = recalculateLevelingRoute({ ...attached, stations: attached.stations.slice(1) });
  assert(deletedFirst.stations[0].stationNumber === 1 && deletedFirst.calculation.startPointName === 'P1', '删除第一站后应重排并重算');
  const modifiedPrevious = recalculateLevelingRoute({
    ...attached,
    stations: attached.stations.map((station, index) => index === 0
      ? { ...station, readings: { ...station.readings, foreBlack: '1.100', foreRed: '5.887' } }
      : station),
  });
  assert(modifiedPrevious.stations[1].result.elevation !== attached.stations[1].result.elevation, '修改前序站应重算后续高程');

  const discontinuous = recalculateLevelingRoute({
    ...attached,
    stations: attached.stations.map((station, index) => index === 1
      ? { ...station, readings: { ...station.readings, backPoint: '断链点' } }
      : station),
  });
  assert(discontinuous.stations[1].result.elevation === null, '删除中间站造成断链时不得继续递推高程');
  assert(discontinuous.totalDeltaHeight === null && discontinuous.calculation.computedEndElevation === null, '断链路线不得生成总高差和终点高程');
  assert(discontinuous.calculation.errorMessages.some((message) => message.includes('不连续')), '断链路线应明确提示点名不连续');
  assert(!discontinuous.calculation.isComplete, '断链路线不得标记为完整');

  const grade3AtLimit = buildRoute('3', [makeStation(1, 'A', 'P1'), makeStation(2, 'P1', 'B')], 100.588);
  assertClose(grade3AtLimit.calculation.allowableErrorMm, 12, 1e-12, '三等路线当前允许限差参数');
  assertClose(grade3AtLimit.closureError, 12, 1e-8, '三等闭合差等于允许值');
  assert(grade3AtLimit.calculation.isWithinTolerance === true, '三等闭合差等于允许值应通过');
  const grade3OverLimit = buildRoute('3', [makeStation(1, 'A', 'P1'), makeStation(2, 'P1', 'B')], 100.587);
  assert(grade3OverLimit.calculation.isWithinTolerance === false, '三等闭合差略超限应失败');
  assertClose(calculateAllowableError('4', 0.2, 2), 20, 1e-12, '四等路线当前允许限差参数');
}

function testLevelingVisualData(): void {
  const empty = recalculateLevelingRoute(createEmptyLevelingRoute('4'));
  assert(empty.calculation.profilePoints.length === 0 && empty.calculation.trajectoryPoints.length === 0, '空任务图形数据应为空');

  const single = buildRoute('4', [makeStation(1, 'A', 'B')], 100.3);
  assert(single.calculation.profilePoints.length === 2, '单站纵断面应含起终两点');
  assert(single.calculation.trajectoryPoints.length === 1 && single.calculation.trajectoryPoints[0].progress === 1, '单站轨迹应可独立显示');

  const zeroDistanceStation = makeStation(1, 'A', 'B');
  const repeatedDistance = buildRoute('out', [zeroDistanceStation], 100.3);
  assert(repeatedDistance.calculation.profilePoints.every((point) => point.distanceKm === 0), '缺路线距离时重复里程应保持有限 0 并按顺序绘制');

  const flatStation = makeStation(1, 'A', 'B');
  flatStation.readings.foreBlack = flatStation.readings.backBlack;
  flatStation.readings.foreRed = flatStation.readings.backRed;
  const flat = buildRoute('4', [flatStation], 100);
  assert(flat.calculation.profilePoints.every((point) => point.elevation === 100), '相同高程纵断面数据应保留水平线');

  const tinyDeltaStation = makeStation(1, '高程基点', '微小变化点');
  tinyDeltaStation.readings.backBlack = '1.501';
  tinyDeltaStation.readings.backRed = '6.188';
  tinyDeltaStation.readings.foreBlack = '1.500';
  tinyDeltaStation.readings.foreRed = '6.187';
  const highBase = createEmptyLevelingRoute('4');
  highBase.stations = [tinyDeltaStation];
  highBase.knownPoints = [
    { id: 'high-start', name: '高程基点', elevation: 10_000 },
    { id: 'high-end', name: '微小变化点', elevation: 10_000.001 },
  ];
  const highBaseResult = recalculateLevelingRoute(highBase);
  assertClose(highBaseResult.calculation.profilePoints[1].elevation, 10_000.001, 1e-12, '大高程基值小高差');

  const longStations = Array.from({ length: 100 }, (_, index) => makeStation(index + 1, `长路线点${index}`, `长路线点${index + 1}`));
  longStations.forEach((station, index) => {
    station.lat = 30 + index * 0.00001;
    station.lng = 120 + index * 0.00001;
  });
  const longRoute = buildRoute('4', longStations, 130);
  assert(longRoute.calculation.profilePoints.length === 101 && longRoute.calculation.trajectoryPoints.length === 100, '大量测站应生成完整图形数据');
  assert(longRoute.calculation.trajectoryPoints.every((point) => Number.isFinite(point.progress) && Number.isFinite(point.distanceKm)), '长路线轨迹数值必须有限');
  assert(longRoute.calculation.trajectoryPoints[99].progress === 1 && longRoute.calculation.trajectoryPoints[99].label === '长路线点100', '长路线末站顺序与标签');
  assert(longRoute.calculation.trajectoryPoints[0].lat === 30 && longRoute.calculation.trajectoryPoints[0].lng === 120, 'GPS 坐标应随统一轨迹结果传递');

  assert(isValidCoordinate(30, 120) && !isValidCoordinate(91, 120) && !isValidCoordinate(30, Number.NaN), 'GPS 坐标范围和有限性');
  const antipodalDistance = greatCircleDistanceMeters(0, 0, 0, 180);
  assert(antipodalDistance !== null && Number.isFinite(antipodalDistance) && antipodalDistance > 20_000_000, '反跖点距离不得产生 NaN');
  assert(greatCircleDistanceMeters('30', 120, 30, 120) === null, '非法 GPS 输入应拒绝');

  const repeatedNames = buildRoute('4', [
    makeStation(1, '同名点', '同名点'),
    makeStation(2, '同名点', '同名点'),
  ], 100.6, 'open');
  assert(repeatedNames.calculation.profilePoints.length === 3, '重复测点名称不得合并或丢失路线节点');
  assert(new Set(repeatedNames.calculation.profilePoints.map((point) => point.id)).size === 3, '重复名称图形节点 ID 必须稳定唯一');

  const longName = '超长中文测点名称'.repeat(20);
  const longNameRoute = buildRoute('4', [makeStation(1, longName, `${longName}终点`)], 100.3);
  assert(longNameRoute.calculation.profilePoints[0].name === longName, '超长中文点名应完整保存在统一成果数据');
  assert(longNameRoute.calculation.trajectoryPoints[0].label === `${longName}终点`, '超长中文轨迹标签数据不得截断');
}

function testLevelingStoreHistory(): void {
  const initial = buildRoute('3', [makeStation(1, 'A', 'B')], 100.3);
  useLevelingStore.setState({ currentRoute: initial, routes: [], isDirty: true });
  useLevelingStore.getState().commitRoute('new');

  let state = useLevelingStore.getState();
  assert(state.routes.length === 1, '暂存应新增一条历史');
  const savedId = state.routes[0].id;
  const originalForeBlack = state.routes[0].stations[0].readings.foreBlack;
  assert(state.routes[0] !== state.currentRoute && state.routes[0].stations[0] !== state.currentRoute.stations[0], '暂存与当前任务必须深拷贝隔离');

  useLevelingStore.getState().updateStationReading(state.currentRoute.stations[0].id, { foreBlack: '1.100', foreRed: '5.887' });
  state = useLevelingStore.getState();
  assert(state.routes[0].stations[0].readings.foreBlack === originalForeBlack, '编辑当前任务不得串改历史快照');

  useLevelingStore.getState().loadRoute(savedId);
  state = useLevelingStore.getState();
  assert(state.currentRoute.stations[0] !== state.routes[0].stations[0], '历史恢复必须深拷贝');
  useLevelingStore.getState().updateStationReading(state.currentRoute.stations[0].id, { foreBlack: '1.050', foreRed: '5.837' });
  useLevelingStore.getState().commitRoute('overwrite');
  state = useLevelingStore.getState();
  assert(state.routes.length === 1 && state.routes[0].stations[0].readings.foreBlack === '1.050', '覆盖保存应替换同一历史记录');

  useLevelingStore.getState().deleteRoute(savedId);
  assert(useLevelingStore.getState().routes.length === 0, '历史删除应仅删除目标记录');
  useLevelingStore.setState({ currentRoute: createEmptyLevelingRoute('4'), routes: [], isDirty: false });
}

function testMigration(): void {
  const migrated = migrateLevelingPersistedState({
    currentRoute: {
      id: 'legacy-route',
      grade: '4',
      stations: [{
        id: 'legacy-station',
        stationNumber: 99,
        readings: { ...createEmptyLevelingStation(1, 'forward').readings, backPoint: '返B', forePoint: '返A' },
        result: {},
        timestamp: 1,
      }],
      knownPoints: [{ id: 'empty', name: '', elevation: 0 }],
    },
    routes: [],
    isDirty: true,
  });
  assert(migrated.currentRoute.schemaVersion === LEVELING_SCHEMA_VERSION, `旧数据应迁移到版本 ${LEVELING_SCHEMA_VERSION}`);
  assert(migrated.currentRoute.stations[0].direction === 'return', '旧返字点名只在迁移时推断方向');
  assert(migrated.currentRoute.knownPoints[0].elevation === null, '旧空白占位 0 应恢复为空值');
  assert(migrated.currentRoute.stations[0].stationNumber === 1, '旧索引应重排');

  const malformed = migrateLevelingPersistedState({
    currentRoute: {
      id: 123,
      grade: 'unknown',
      routeType: 'bad',
      createdAt: 'not-a-date',
      stations: [
        null,
        {
          id: {},
          stationNumber: Number.NaN,
          lat: Number.POSITIVE_INFINITY,
          lng: 'not-a-coordinate',
          readings: {
            backPoint: 42,
            forePoint: ['bad'],
            backBlack: 'Infinity',
            intermediates: [null, { point: '旧间视', black: {}, red: [] }],
          },
          result: { elevation: Number.POSITIVE_INFINITY },
        },
      ],
      knownPoints: [null, { name: '坏高程', elevation: 'Infinity', lat: 91, lng: -181 }],
    },
    routes: [null, 'bad-route', { grade: '3', stations: 'bad-stations', knownPoints: 'bad-points' }],
    isDirty: 'true',
  });
  assert(malformed.currentRoute.grade === '4' && malformed.currentRoute.routeType === 'open', '非法旧枚举应安全回退');
  assert(malformed.currentRoute.stations.length === 2 && malformed.currentRoute.stations.every((station, index) => station.stationNumber === index + 1), '非法旧测站应归一化且重排');
  assert(malformed.currentRoute.stations.every((station) => station.lat === undefined && station.lng === undefined), '非法旧坐标不得进入路线');
  assert(malformed.currentRoute.knownPoints.every((point) => point.lat === undefined && point.lng === undefined), '越界旧已知点坐标不得进入路线');
  assert(malformed.currentRoute.knownPoints.every((point) => point.elevation === null || Number.isFinite(point.elevation)), '非法旧高程不得传播 NaN/Infinity');
  assert(malformed.routes.length === 1 && malformed.routes[0].grade === '3' && malformed.isDirty === false, '非法历史条目应丢弃，有效对象型历史应保留');
  assert(Number.isFinite(Date.parse(malformed.currentRoute.createdAt)), '非法旧日期应回退为有效 ISO 时间');
}

function testGovernanceSnapshotsAndAudit(): void {
  const customRule = JSON.parse(JSON.stringify(DEFAULT_LEVELING_RULE_PROFILE));
  customRule.id = 'unit-approved-rule';
  customRule.name = '单位确认规则';
  customRule.approved = true;
  customRule.source = '测试中的明确来源';
  const migrated = migrateGovernanceState({ ruleProfiles: [customRule, { id: 'bad-rule' }], instruments: [] });
  assert(migrated.ruleProfiles.some((rule) => rule.id === customRule.id && rule.approved), '自定义规则迁移不得被默认规则覆盖');
  assert(migrated.ruleProfiles.every((rule, index, all) => all.findIndex((candidate) => candidate.id === rule.id) === index), '规则 ID 不得重复');

  const snapshot = createRuleProfileSnapshot(customRule, '2026-07-29T00:00:00.000Z');
  customRule.tolerances['3'].maxSightDistance = 999;
  assert(snapshot.tolerances['3'].maxSightDistance !== 999 && snapshot.capturedAt === '2026-07-29T00:00:00.000Z', '规则快照必须深拷贝并固定捕获时间');

  useGovernanceStore.setState({ ...migrateGovernanceState({}), hydrated: true });
  const instrument = useGovernanceStore.getState().addInstrument({
    kind: 'current-meter', name: '测试流速仪', model: 'LS-Test', serialNumber: 'SN-1', certificateNumber: 'CERT-1',
    verificationDate: '1999-01-01', validUntil: '2000-01-01', status: 'valid', meterFormula: { k: 0.5, c: 0.01 }, notes: '',
  });
  useGovernanceStore.getState().setSelectedInstrument('flow', instrument.id);
  const instrumentSnapshot = useGovernanceStore.getState().captureInstrument(instrument.id);
  assert(instrumentSnapshot?.status === 'expired' && instrumentSnapshot.meterFormula?.k === 0.5, '仪器快照应自动识别过期并保留流速公式');
  useGovernanceStore.getState().updateInstrument(instrument.id, { name: '修改后名称', meterFormula: { k: 1, c: 1 } });
  assert(instrumentSnapshot?.name === '测试流速仪' && instrumentSnapshot.meterFormula?.k === 0.5, '仪器档案修改不得串改任务快照');

  const before = { nested: { value: 1 } };
  const after = { nested: { value: 2 } };
  const entry = useGovernanceStore.getState().recordAudit({ module: 'governance', recordId: 'audit-test', action: 'revise', before, after });
  const beforeHash = entry.beforeHash;
  before.nested.value = 99;
  after.nested.value = 100;
  assert(entry.beforeHash === beforeHash && entry.beforeHash === integrityHash({ nested: { value: 1 } }), '审计摘要不得受调用方后续突变影响');
  assert(!('before' in entry) && !('after' in entry), '审计记录不得保存整份测量数据');
}

function buildCompleteHydroRun() {
  const run = createNewRun(88, 'open');
  const measure = createMeasureVertical(1, 'open');
  run.location = '锁定测流成果';
  run.verticals[0].startDistance = '0';
  run.verticals[1].startDistance = '10';
  measure.startDistance = '5';
  measure.waterDepth = '2';
  measure.measurePoints[0].velocity = '1';
  run.verticals.splice(1, 0, measure);
  return processRun(run);
}

function testLockedResultsCreateRevisions(): void {
  const flow = buildCompleteHydroRun();
  useHydroStore.setState({ currentRun: flow, runs: [], templates: [], isDirty: true });
  assert(useHydroStore.getState().completeCurrentRun(), '完整测流任务应可完成');
  const completedFlow = useHydroStore.getState().currentRun;
  assert(completedFlow.recordStatus === 'completed' && useHydroStore.getState().runs.length === 1, '测流完成应自动保存锁定快照');
  useHydroStore.getState().updateRun({ notes: '修订备注' });
  let hydroState = useHydroStore.getState();
  assert(hydroState.currentRun.recordStatus === 'revision' && hydroState.currentRun.parentId === completedFlow.id && hydroState.currentRun.id !== completedFlow.id, '修改锁定测流成果应创建新修订和父记录关系');
  assert(hydroState.runs.length === 1 && hydroState.runs[0].notes !== '修订备注', '修订前原测流成果不得被串改');
  const revisionId = hydroState.currentRun.id;
  useHydroStore.getState().commitCurrentRun('overwrite');
  hydroState = useHydroStore.getState();
  assert(hydroState.runs.length === 2 && hydroState.runs.some((run) => run.id === completedFlow.id && run.recordStatus === 'completed') && hydroState.runs.some((run) => run.id === revisionId && run.parentId === completedFlow.id), '保存测流修订必须保留原成果和父子关系');

  const route = buildRoute('3', [makeStation(1, '锁定起点', '锁定终点')], 100.3);
  assert(route.calculation.isComplete, '水准修订测试路线应完整');
  useLevelingStore.setState({ currentRoute: route, routes: [], isDirty: true });
  useLevelingStore.getState().completeRoute();
  const completedRoute = useLevelingStore.getState().currentRoute;
  assert(completedRoute.completionStatus === 'completed' && useLevelingStore.getState().routes.length === 1, '水准完成应自动保存锁定快照');
  useLevelingStore.getState().updateRouteMeta({ notes: '水准修订备注' });
  let levelingState = useLevelingStore.getState();
  assert(levelingState.currentRoute.completionStatus === 'revision' && levelingState.currentRoute.parentId === completedRoute.id && levelingState.currentRoute.id !== completedRoute.id, '修改锁定水准成果应创建新修订');
  assert(levelingState.routes.length === 1 && levelingState.routes[0].notes !== '水准修订备注', '水准原成果不得被串改');
  const routeRevisionId = levelingState.currentRoute.id;
  useLevelingStore.getState().commitRoute('overwrite');
  levelingState = useLevelingStore.getState();
  assert(levelingState.routes.length === 2 && levelingState.routes.some((item) => item.id === completedRoute.id && item.completionStatus === 'completed') && levelingState.routes.some((item) => item.id === routeRevisionId && item.parentId === completedRoute.id), '保存水准修订必须保留原成果和父子关系');
}

async function testFullBackupAndDiagnostics(): Promise<void> {
  useHydroStore.setState((state) => ({ currentRun: { ...state.currentRun, notes: '不得出现在诊断中的测流秘密' } }));
  useLevelingStore.setState((state) => ({ currentRoute: { ...state.currentRoute, notes: '不得出现在诊断中的水准秘密' } }));
  const backup = createFullBackup('2026-07-29T12:34:56.000Z');
  const validated = validateFullBackup(backup);
  assert(validated.payload.hydro.templates.length === useHydroStore.getState().templates.length, '完整备份应包含断面模板');
  assert(validated.payload.governance.ruleProfiles.length === useGovernanceStore.getState().ruleProfiles.length, '完整备份应包含规则和治理数据');

  const tampered = JSON.parse(JSON.stringify(backup));
  tampered.payload.hydro.currentRun.location = '被篡改';
  let rejectedTampered = false;
  try { validateFullBackup(tampered); } catch { rejectedTampered = true; }
  assert(rejectedTampered, '完整备份内容被修改后必须拒绝');

  const originalFlowId = validated.payload.hydro.currentRun.id;
  const originalLevelingId = validated.payload.leveling.currentRoute.id;
  useHydroStore.setState((state) => ({ currentRun: { ...state.currentRun, id: 'temporary-flow-id' }, runs: [] }));
  useLevelingStore.setState((state) => ({ currentRoute: { ...state.currentRoute, id: 'temporary-leveling-id' }, routes: [] }));
  restoreFullBackup(validated);
  assert(useHydroStore.getState().currentRun.id === originalFlowId && useLevelingStore.getState().currentRoute.id === originalLevelingId, '完整备份恢复应同时恢复测流和水准工作区');

  const flowBeforeInvalidRestore = useHydroStore.getState().currentRun.id;
  try { restoreFullBackup(tampered); } catch { /* 预期拒绝 */ }
  assert(useHydroStore.getState().currentRun.id === flowBeforeInvalidRestore, '非法备份不得污染当前数据');

  const diagnostic = await createAppDiagnostic();
  const diagnosticText = JSON.stringify(diagnostic);
  assert(!diagnosticText.includes('不得出现在诊断') && !diagnosticText.includes('verticals') && !diagnosticText.includes('stations'), '诊断文件不得包含完整测量数据或备注');
  assert(diagnostic.appVersion.length > 0 && diagnostic.counts.flowRecords >= 0 && diagnostic.counts.levelingRecords >= 0, '诊断应包含版本、水合和记录数量');
}

function testConfiguredBusinessFixture(): void {
  const result = runHydroBenchmark(ZHENG_JIA_TUN_FIXTURE);
  assert(result.allPassed, '郑家屯真实档案 fixture 应通过配置化真值对标');
  assert(ZHENG_JIA_TUN_FIXTURE.source.includes('流量测验记载计算表'), 'fixture 必须记录真实来源，不得伪造新测站真值');
}

async function testExcel(): Promise<void> {
  const outputDirectory = path.resolve('_AI_Tools_', 'spreadsheet-inspection', 'exports');
  await mkdir(outputDirectory, { recursive: true });

  const empty3 = createEmptyLevelingRoute('3');
  const empty3Bytes = await workbookBytes(empty3);
  assert((await validateLevelingWorkbook(empty3Bytes, empty3)).isValid, '空三等任务模板应可打开');

  const threeStations = buildRoute('3', [
    makeStation(1, '三等起点', '三等中间点一'),
    makeStation(2, '三等中间点一', '三等中间点二'),
    makeStation(3, '三等中间点二', '三等终点'),
  ], 100.9);
  threeStations.taskNumber = 'TASK-3-001';
  threeStations.organization = '测试水文中心';
  threeStations.surveyor = '施测甲';
  threeStations.checker = '复核乙';
  threeStations.weather = '晴';
  threeStations.terrain = '平原';
  threeStations.backStaffNumber = '后尺01';
  threeStations.foreStaffNumber = '前尺02';
  threeStations.notes = '元数据回读';
  const grade3Bytes = await workbookBytes(threeStations);
  const grade3Validation = await validateLevelingWorkbook(grade3Bytes, threeStations);
  assert(grade3Validation.isValid && grade3Validation.sheetName === 'Sheet1', '三等必须使用三等模板并回读通过');
  const grade3Workbook = await buildLevelingWorkbook(threeStations, templateLoader);
  const grade3Sheet = grade3Workbook.getWorksheet('Sheet1');
  assert(grade3Sheet?.getCell('H2').text.includes(threeStations.name) === true, '三等模板应写入测量对象');
  assert(grade3Sheet?.getCell('A2').text.includes('TASK-3-001') === true && grade3Sheet.getCell('H3').text.includes('晴'), '三等模板应写入任务编号和天气元数据');
  assert(grade3Sheet?.getColumn('A').values.some((value) => String(value).includes('施测甲')) === true
    && grade3Sheet.getColumn('G').values.some((value) => String(value).includes('复核乙')), '三等模板应写入施测和复核人员');
  assert(grade3Sheet?.getCell('A10').text === '1' && grade3Sheet.getCell('B10').text === '三等起点', '三等模板首站映射');
  assert(grade3Sheet?.model.merges?.includes('A1:M1') === true, '三等模板标题合并区应保留');
  assert(grade3Sheet?.pageSetup.printArea === 'A1:M27', '三等多站扩容后打印区应同步延长');
  assert(grade3Sheet?.getRow(14).height === grade3Sheet?.getRow(10).height, '三等扩容行高应复制模板数据行');
  await writeFile(path.join(outputDirectory, 'leveling_3-validation.xlsx'), grade3Bytes);

  const longStations = Array.from({ length: 15 }, (_, index) => makeStation(index + 1, `四等点${index}`, `四等点${index + 1}`));
  const longGrade4 = buildRoute('4', longStations, 104.5);
  longGrade4.taskNumber = 'TASK-4-001';
  longGrade4.organization = '测试水文中心';
  longGrade4.surveyor = '施测丙';
  longGrade4.checker = '复核丁';
  longGrade4.weather = '多云';
  longGrade4.terrain = '丘陵';
  longGrade4.notes = '四等元数据回读';
  const grade4Bytes = await workbookBytes(longGrade4);
  const grade4Validation = await validateLevelingWorkbook(grade4Bytes, longGrade4);
  assert(grade4Validation.isValid && grade4Validation.sheetName === '第1页', '四等必须使用四等模板并扩容回读通过');
  const grade4Workbook = await buildLevelingWorkbook(longGrade4, templateLoader);
  const grade4Sheet = grade4Workbook.getWorksheet('第1页');
  assert(grade4Sheet?.getCell('C3').text === longGrade4.name, '四等模板应写入测量对象');
  assert(grade4Sheet?.getCell('A8').text === '1' && grade4Sheet.getCell('B8').text === '四等点0', '四等模板首个测点映射');
  assert(grade4Sheet?.getCell('AJ8').text.includes('路线：附合路线') === true, '四等模板路线类型应使用中文业务文案');
  assert(grade4Sheet?.getCell('AL2').text === 'TASK-4-001' && grade4Sheet.getCell('AJ8').text.includes('测试水文中心'), '四等模板应写入任务编号和单位元数据');
  assert(grade4Sheet?.model.merges?.includes('A1:AN1') === true && grade4Sheet.model.merges.includes('AJ8:AN39'), '四等扩容合并区应保留并延长');
  assert(grade4Sheet?.pageSetup.printArea === 'A1:AN42', '四等长路线扩容后打印区应同步延长');
  await writeFile(path.join(outputDirectory, 'leveling_4-validation.xlsx'), grade4Bytes);

  const filename = createLevelingExportFilename(longGrade4);
  assert(filename.startsWith('四等_') && !/[<>:"/\\|?*]/.test(filename), '文件名应含等级并清理非法字符');

  const hydroRun = buildCompleteHydroRun();
  hydroRun.stationCode = 'ZQ-001';
  hydroRun.riverName = '测试河';
  hydroRun.operator = '测流甲';
  hydroRun.recorder = '记录乙';
  hydroRun.reviewer = '复核丙';
  hydroRun.weather = '小雨';
  hydroRun.waterCondition = '平水';
  hydroRun.notes = '测流元数据回读';
  hydroRun.instrumentSnapshot = {
    id: 'meter-fixture', kind: 'current-meter', name: 'LS45', model: 'LS45-A', serialNumber: 'SN-45',
    certificateNumber: 'CERT-45', status: 'valid', notes: '', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', capturedAt: '2026-07-29T00:00:00.000Z', meterFormula: { k: 0.428, c: 0.0057 },
  };
  const hydroWorkbook = await buildHydroWorkbook(hydroRun, async () => {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(path.resolve('public', 'template.xlsx'));
    return workbook;
  });
  const hydroSheet = hydroWorkbook.getWorksheet('2.0成果数据');
  assert(hydroSheet?.getCell('Q2').text === '小雨' && hydroSheet.getCell('N3').text === '平水', '测流模板应写入天气和水情');
  assert(hydroSheet?.getCell('D4').text.includes('LS45') === true && hydroSheet.getCell('D15').text.includes('ZQ-001'), '测流模板应写入仪器快照和测站元数据');
}

testFlowDeviation();
testGitHubUpdate();
testHydroEngineCompleteness();
testHydroPersistenceAndTiming();
testSpiritLevelMath();
testLevelingEngine();
testRouteCalculations();
testLevelingVisualData();
testLevelingStoreHistory();
testMigration();
testGovernanceSnapshotsAndAudit();
testLockedResultsCreateRevisions();
await testFullBackupAndDiagnostics();
testConfiguredBusinessFixture();
await testExcel();

console.log(JSON.stringify({ total: assertionCount, passed: assertionCount, failed: [] }));

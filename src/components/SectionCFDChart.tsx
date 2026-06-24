/**
 * SectionCFDChart.tsx — 河流断面 ADCP 级全断面流速等值色斑图 v6.1
 *
 * 架构：
 *   1. 高精度 IDW (p=2, GRID_SCALE=2) 静态流速色斑 Heatmap
 *   2. 河道轮廓 clip 裁切，深邃水体渐变背景
 *   3. 冰期冰盖遮罩
 *   4. 垂线全局常驻渲染 (type === 'measure', 半透明白色虚线)
 *   5. 测点实心白圈全局常驻锚定
 *   6. 十字准星探针 HUD — 全域交叉虚线 + 暗色半透明圆角浮窗
 *   7. 零 requestAnimationFrame，纯静态渲染
 *   8. 【v6.1】纯图表组件：外层 Bottom Sheet 提供高度，
 *      本组件通过 ResizeObserver 自适应父容器高度，
 *      断面 Y 轴像素跨度随容器高度物理拉伸。
 */
import { useRef, useEffect, useLayoutEffect, useState, useCallback, useMemo } from 'react';
import { useHydroStore } from '../store/hydroStore';
import type { Vertical } from '../types';

/* ──────────── 常量 ──────────── */
const GRID_SCALE = 4;
const MIN_VERTICALS = 3;
const CHART_PADDING = { top: 32, right: 30, bottom: 36, left: 50 };

/* ──────────── 类型 ──────────── */
interface DataPoint {
  x: number; y: number; v: number;
}

interface GridMeta {
  data: Float32Array;
  cols: number; rows: number;
  xMin: number; xMax: number;
  yMin: number; yMax: number;
  cellW: number; cellH: number;
}

interface ChannelBounds {
  xMin: number; xMax: number;
  maxDepth: number;
  profile: { x: number; depth: number }[];
  iceProfile: { x: number; iceBottom: number; iceFlower: number }[];
  hasIce: boolean;
}

interface IceMeta {
  waterIceThickness: number;
  iceFlowerThickness: number;
}

/** v7.0 磁吸吸附测点数据结构 — 供底部面板下沉覆盖使用 */
export interface SnappedPoint {
  /** dataPoints 中的索引 */
  index: number;
  /** 起点距 (m) */
  distance: number;
  /** 水深 (m) */
  depth: number;
  /** 流速 (m/s) */
  velocity: number;
}

interface SectionCFDChartProps {
  onSnapChange?: (point: SnappedPoint | null) => void;
}

/* ──────────── 科学水文色带映射（余弦平滑插值） ──────────── */
function velocityToScientific(v: number, vMax: number): [number, number, number, number] {
  const t = Math.max(0, Math.min(1, vMax > 0.01 ? v / vMax : 0));
  const stops = [
    [12, 35, 100],
    [30, 110, 210],
    [20, 200, 180],
    [180, 230, 50],
    [230, 50, 20]
  ];
  const i = t * (stops.length - 1);
  const idx = Math.floor(i);
  if (idx >= stops.length - 1) return [stops[4][0], stops[4][1], stops[4][2], 0.85];
  const f = i - idx;
  const fSmooth = (1 - Math.cos(f * Math.PI)) / 2;
  const c1 = stops[idx], c2 = stops[idx + 1];
  return [
    Math.round(c1[0] + (c2[0] - c1[0]) * fSmooth),
    Math.round(c1[1] + (c2[1] - c1[1]) * fSmooth),
    Math.round(c1[2] + (c2[2] - c1[2]) * fSmooth),
    0.85
  ];
}

/* ──────────── 数据提取 ──────────── */
function extractDataPoints(verticals: Vertical[]): DataPoint[] {
  const points: DataPoint[] = [];
  const measureVerticals = verticals.filter((v) => v.type === 'measure');

  for (const v of measureVerticals) {
    const sx = parseFloat(v.startDistance);
    const wd = parseFloat(v.waterDepth);
    if (isNaN(sx) || isNaN(wd) || wd <= 0) continue;

    for (const mp of v.measurePoints) {
      const vel = parseFloat(mp.velocity);
      if (isNaN(vel)) continue;

      let absDepth: number;
      if (mp.absoluteDepth !== undefined && mp.absoluteDepth !== '') {
        absDepth = parseFloat(mp.absoluteDepth);
      } else {
        absDepth = wd * parseFloat(mp.relativeDepth);
      }
      if (isNaN(absDepth)) continue;

      points.push({ x: sx, y: absDepth, v: vel });
    }

    const hasBottom = points.some(
      (p) => Math.abs(p.x - sx) < 0.01 && Math.abs(p.y - wd) < 0.01,
    );
    if (!hasBottom) points.push({ x: sx, y: wd, v: 0 });
  }

  return points;
}

function getIceMeta(vertical: Vertical): IceMeta {
  const wi = parseFloat(vertical.waterIceThickness || '0') || 0;
  const fl = parseFloat(vertical.iceFlowerThickness || '0') || 0;
  return { waterIceThickness: wi, iceFlowerThickness: fl };
}

function getChannelBounds(verticals: Vertical[], flowPeriod: string): ChannelBounds | null {
  const all = [...verticals];
  const xVals = all.map((v) => parseFloat(v.startDistance)).filter((n) => !isNaN(n));
  if (xVals.length < 2) return null;

  const xMin = Math.min(...xVals);
  const xMax = Math.max(...xVals);

  const measureVerticals = verticals.filter((v) => v.type === 'measure');
  const depths = measureVerticals
    .map((v) => parseFloat(v.waterDepth))
    .filter((n) => !isNaN(n) && n > 0);
  const maxDepth = depths.length > 0 ? Math.max(...depths) : 1;

  const hasIce = flowPeriod === 'ice' || String(flowPeriod).includes('冰');

  const profile = verticals
    .filter((v) => !isNaN(parseFloat(v.startDistance)))
    .map((v) => {
      const sd = parseFloat(v.startDistance);
      const wd = v.type === 'measure' ? parseFloat(v.waterDepth) || 0 : 0;
      return { x: sd, depth: wd };
    })
    .sort((a, b) => a.x - b.x);

  // 提取原始冰层数据
  const rawIceProfile = verticals
    .filter((v) => !isNaN(parseFloat(v.startDistance)))
    .map((v) => {
      const sd = parseFloat(v.startDistance);
      let iceBottom = 0;
      let iceFlower = 0;
      if (hasIce && v.type === 'measure') {
        const meta = getIceMeta(v);
        iceBottom = meta.waterIceThickness + meta.iceFlowerThickness;
        iceFlower = Math.max(0, meta.iceFlowerThickness);
      }
      return { x: sd, iceBottom, iceFlower };
    })
    .sort((a, b) => a.x - b.x);

  // --- 全局冰层水平延伸算法 ---
  const validIces = rawIceProfile.filter(p => p.iceBottom > 0);
  const iceProfile = rawIceProfile.map(p => {
    let ib = p.iceBottom;
    let fl = p.iceFlower;
    // 如果岸边无冰厚，向最近测点借用，确保数学模型上的冰层也是延伸的
    if (ib === 0 && validIces.length > 0) {
      const nearest = validIces.reduce((prev, curr) => Math.abs(curr.x - p.x) < Math.abs(prev.x - p.x) ? curr : prev);
      ib = nearest.iceBottom;
      fl = nearest.iceFlower;
    }
    return { x: p.x, iceBottom: ib, iceFlower: fl };
  });

  return { xMin, xMax, maxDepth, profile, iceProfile, hasIce };
}

function getBedDepthAtX(dataX: number, bounds: ChannelBounds): number {
  const { profile, maxDepth } = bounds;
  if (dataX <= profile[0].x) return profile[0].depth;
  if (dataX >= profile[profile.length - 1].x) return profile[profile.length - 1].depth;
  for (let i = 0; i < profile.length - 1; i++) {
    const a = profile[i], bP = profile[i + 1];
    if (dataX >= Math.min(a.x, bP.x) && dataX <= Math.max(a.x, bP.x)) {
      const t = bP.x !== a.x ? (dataX - a.x) / (bP.x - a.x) : 0;
      return a.depth + (bP.depth - a.depth) * t;
    }
  }
  return maxDepth;
}

function getIceBottomAtX(dataX: number, bounds: ChannelBounds): number {
  const { iceProfile } = bounds;
  if (!iceProfile || iceProfile.length < 2) return 0;
  if (dataX <= iceProfile[0].x) return iceProfile[0].iceBottom;
  if (dataX >= iceProfile[iceProfile.length - 1].x) return iceProfile[iceProfile.length - 1].iceBottom;
  for (let i = 0; i < iceProfile.length - 1; i++) {
    const a = iceProfile[i], bP = iceProfile[i + 1];
    if (dataX >= Math.min(a.x, bP.x) && dataX <= Math.max(a.x, bP.x)) {
      const t = bP.x !== a.x ? (dataX - a.x) / (bP.x - a.x) : 0;
      return a.iceBottom + (bP.iceBottom - a.iceBottom) * t;
    }
  }
  return 0;
}

interface FlowProfile {
  x: number; depth: number;
  pts: { y: number; v: number }[];
}

function getProfileVelocity(prof: FlowProfile, y: number): number {
  if (prof.depth <= 0 || prof.pts.length === 0) return 0;
  if (y >= prof.depth) return 0;
  if (y <= prof.pts[0].y) return prof.pts[0].v;
  for (let i = 0; i < prof.pts.length - 1; i++) {
    const p1 = prof.pts[i], p2 = prof.pts[i + 1];
    if (y >= p1.y && y <= p2.y) {
      const t = (y - p1.y) / (p2.y - p1.y);
      return p1.v + t * (p2.v - p1.v);
    }
  }
  const lastP = prof.pts[prof.pts.length - 1];
  const t = (y - lastP.y) / (prof.depth - lastP.y);
  return lastP.v * (1 - t);
}

function bilinearSample(grid: GridMeta, px: number, py: number): number {
  const col = (px - grid.xMin) / grid.cellW;
  const row = (py - grid.yMin) / grid.cellH;
  const c0 = Math.max(0, Math.min(grid.cols - 1, Math.floor(col)));
  const r0 = Math.max(0, Math.min(grid.rows - 1, Math.floor(row)));
  const c1 = Math.min(grid.cols - 1, c0 + 1);
  const r1 = Math.min(grid.rows - 1, r0 + 1);
  const fc = col - c0, fr = row - r0;
  const v00 = grid.data[r0 * grid.cols + c0];
  const v10 = grid.data[r0 * grid.cols + c1];
  const v01 = grid.data[r1 * grid.cols + c0];
  const v11 = grid.data[r1 * grid.cols + c1];
  const top = v00 + (v10 - v00) * fc;
  const bot = v01 + (v11 - v01) * fc;
  return top + (bot - top) * fr;
}

/* ════════════════════════════════════════
   主组件 — 纯图表引擎（无外壳，无拖拽）
   ════════════════════════════════════════ */
export default function SectionCFDChart({ onSnapChange }: SectionCFDChartProps) {
  const verticals = useHydroStore((s) => s.currentRun.verticals);
  const flowPeriod = useHydroStore((s) => s.currentRun.flowPeriod);

  const containerRef = useRef<HTMLDivElement>(null);
  const mainCanvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const gridRef = useRef<GridMeta | null>(null);
  const vMaxRef = useRef(0);
  const offscreenCanvasRef = useRef<HTMLCanvasElement | null>(null);

  /* ════════════════════════════════════════
      v7.0 物理触控磁吸状态机
      ════════════════════════════════════════ */
  const [snappedPoint, setSnappedPoint] = useState<SnappedPoint | null>(null);

  /* ── 动画隔离：延迟渲染引擎，防止 Canvas 计算阻塞 UI 动画 ── */
  const [isEngineReady, setIsEngineReady] = useState(false);
  /* ── v6.4 发令枪：离屏网格就绪后强制触发主画布重绘，解决首屏竞态白屏 ── */
  const [gridVersion, setGridVersion] = useState(0);
  useEffect(() => {
    // 等待外层 Bottom Sheet 300ms 物理动画结束后，再放行渲染
    const timer = setTimeout(() => setIsEngineReady(true), 350);
    return () => clearTimeout(timer);
  }, []);

  const isTouchingRef = useRef(false);
  const snappedIndexRef = useRef<number | null>(null);
  /* 触控安全半径 (px) — 移动端手指覆盖半径 */
  const SNAP_RADIUS_PX = 30;

  /* ── 容器自适应宽度 ── */
  const [containerWidth, setContainerWidth] = useState(
    Math.min(window.innerWidth - 16, 900),
  );

  /* ── ResizeObserver 驱动图表高度 ── */
  const [chartHeight, setChartHeight] = useState(420);

  const cw = containerWidth;
  /* v6.2 底层数学防线：防止容器高度被压缩至趋近于 0 时产生 NaN/Infinity 白屏 */
  const ch = Math.max(10, chartHeight);

  const dataPoints = useMemo(() => extractDataPoints(verticals), [verticals]);
  const channelBounds = useMemo(() => getChannelBounds(verticals, flowPeriod), [verticals, flowPeriod]);
  const measureCount = useMemo(() => verticals.filter((v) => v.type === 'measure').length, [verticals]);

  const dataSig = useMemo(() => {
    return JSON.stringify(dataPoints.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(3)},${p.v.toFixed(3)}`));
  }, [dataPoints]);

  /* ── 窗口宽度自适应 ── */
  useEffect(() => {
    const updateWidth = () => {
      setContainerWidth(Math.min(window.innerWidth - 16, 900));
    };
    window.addEventListener('resize', updateWidth);
    return () => window.removeEventListener('resize', updateWidth);
  }, []);

  /* ── ResizeObserver：监听父容器高度变化，钳制到安全范围 ── */
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const h = entry.contentRect.height;
        if (h > 0) {
          // 确保图表高度至少容纳 padding (68px) + 最小像素绘图区
          setChartHeight(Math.max(80, h));
        }
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /* ── 坐标映射（v6.1：真实 1:1 比例，拉伸由容器高度物理驱动） ── */
  const toCanvasY = useCallback((dataY: number) => {
    if (!channelBounds) return CHART_PADDING.top;
    const effD = channelBounds.maxDepth || 1;
    const safeH = Math.max(10, ch);
    const plotH = Math.max(1, safeH - CHART_PADDING.top - CHART_PADDING.bottom);
    return CHART_PADDING.top + (dataY / effD) * plotH;
  }, [channelBounds, ch]);

  const toDataX = useCallback((cx: number) => {
    if (!channelBounds) return 0;
    const range = channelBounds.xMax - channelBounds.xMin || 1;
    return channelBounds.xMin + ((cx - CHART_PADDING.left) / (cw - CHART_PADDING.left - CHART_PADDING.right)) * range;
  }, [channelBounds, cw]);

  const toDataY = useCallback((cy: number) => {
    if (!channelBounds) return 0;
    const effD = channelBounds.maxDepth || 1;
    const safeH = Math.max(10, ch);
    const plotH = Math.max(1, safeH - CHART_PADDING.top - CHART_PADDING.bottom);
    return ((cy - CHART_PADDING.top) / plotH) * effD;
  }, [channelBounds, ch]);

  /* ════════════════════════════════════════
     离屏 Canvas 热力网格缓存
     性能极客优化：锁定 Y 轴虚拟分辨率，彻底剥离与物理高度 ch 的计算依赖！
     ════════════════════════════════════════ */
  useEffect(() => {
    if (!isEngineReady) return; // 动画隔离：等待底部抽屉展开动画完成

    if (!channelBounds || dataPoints.length < 3 || measureCount < MIN_VERTICALS) {
      gridRef.current = null;
      vMaxRef.current = 0;
      return;
    }

    const { xMin, xMax, maxDepth } = channelBounds;
    const effD = maxDepth;

    const plotW = Math.max(1, cw - CHART_PADDING.left - CHART_PADDING.right);
    const VIRTUAL_PLOT_H = 300; // 锁定热力图虚拟 Y 分辨率，拖拽时不再重算网格！
    const gridCols = Math.max(1, Math.ceil(plotW / GRID_SCALE));
    const gridRows = Math.max(1, Math.ceil(VIRTUAL_PLOT_H / GRID_SCALE));

    let offscreen = offscreenCanvasRef.current;
    if (!offscreen || offscreen.width !== gridCols || offscreen.height !== gridRows) {
      offscreen = document.createElement('canvas');
      offscreen.width = gridCols;
      offscreen.height = gridRows;
      offscreenCanvasRef.current = offscreen;
    }
    const octx = offscreen.getContext('2d');
    if (!octx) return;

    let globalVMax = 0;
    for (const p of dataPoints) { if (p.v > globalVMax) globalVMax = p.v; }
    if (globalVMax < 0.01) globalVMax = 0.01;
    vMaxRef.current = globalVMax;

    const imgData = octx.createImageData(gridCols, gridRows);
    const pixels = imgData.data;

    const cellW = (xMax - xMin) / gridCols;
    const cellH = effD / gridRows;
    const velGrid = new Float32Array(gridCols * gridRows);

    const flowProfiles: FlowProfile[] = channelBounds.profile.map(p => {
      const vMatch = verticals.find(v => Math.abs(parseFloat(v.startDistance || '-1') - p.x) < 0.01);
      if (!vMatch || vMatch.type !== 'measure') return { x: p.x, depth: p.depth, pts: [] };
      const wd = parseFloat(vMatch.waterDepth) || 0;
      const pts = vMatch.measurePoints
        .map(mp => ({
          y: mp.absoluteDepth !== undefined && mp.absoluteDepth !== '' ? parseFloat(mp.absoluteDepth) : wd * parseFloat(mp.relativeDepth),
          v: parseFloat(mp.velocity)
        }))
        .filter(pt => !isNaN(pt.y) && !isNaN(pt.v))
        .sort((a, b) => a.y - b.y);
      return { x: p.x, depth: wd, pts };
    });

    for (let gy = 0; gy < gridRows; gy++) {
      const dataY = (gy + 0.5) * cellH;
      for (let gx = 0; gx < gridCols; gx++) {
        const dataX = xMin + (gx + 0.5) * cellW;
        const idx = gy * gridCols + gx;

        const bedY = getBedDepthAtX(dataX, channelBounds);
        if (dataY > bedY + cellH * 0.5) { velGrid[idx] = 0; continue; }
        const iceBtm = channelBounds.hasIce ? getIceBottomAtX(dataX, channelBounds) : 0;
        if (dataY < iceBtm - cellH * 0.5) { velGrid[idx] = 0; continue; }

        let pL = flowProfiles[0], pR = flowProfiles[flowProfiles.length - 1];
        for (let i = 0; i < flowProfiles.length - 1; i++) {
          if (dataX >= flowProfiles[i].x && dataX <= flowProfiles[i + 1].x) {
            pL = flowProfiles[i]; pR = flowProfiles[i + 1]; break;
          }
        }

        const tX = pR.x !== pL.x ? (dataX - pL.x) / (pR.x - pL.x) : 0;
        const localBed = pL.depth + tX * (pR.depth - pL.depth);
        if (localBed <= 0 || dataY >= localBed) { velGrid[idx] = 0; continue; }

        const vL = pL.pts.length > 0 ? getProfileVelocity(pL, dataY) : 0;
        const vR = pR.pts.length > 0 ? getProfileVelocity(pR, dataY) : 0;
        const vel = vL + tX * (vR - vL);
        velGrid[idx] = vel;

        const pixelIdx = idx * 4;
        if (vel > 1e-9) {
          const [r, g, b, a] = velocityToScientific(vel, globalVMax);
          pixels[pixelIdx] = r;
          pixels[pixelIdx + 1] = g;
          pixels[pixelIdx + 2] = b;
          pixels[pixelIdx + 3] = Math.round(a * 255);
        } else {
          pixels[pixelIdx] = 0;
          pixels[pixelIdx + 1] = 0;
          pixels[pixelIdx + 2] = 0;
          pixels[pixelIdx + 3] = 0;
        }
      }
    }

    octx.putImageData(imgData, 0, 0);

    gridRef.current = {
      data: velGrid, cols: gridCols, rows: gridRows,
      xMin, xMax, yMin: 0, yMax: effD, cellW, cellH,
    };
    // 触发主画布重绘的发令枪
    setGridVersion(v => v + 1);
  }, [dataSig, cw, channelBounds, dataPoints, measureCount, verticals, isEngineReady]);

  /* ════════════════════════════════════════
     主画布光速盖章
     v6.3 极客重构：必须使用 useLayoutEffect 同步拦截重绘，消灭 Canvas 缩放闪烁！
     ════════════════════════════════════════ */
  useLayoutEffect(() => {
    if (!isEngineReady) return; // 动画隔离：等待底部抽屉展开动画完成

    const canvas = mainCanvasRef.current;
    if (!canvas || !channelBounds || dataPoints.length < 3 || measureCount < MIN_VERTICALS || ch < 80) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { xMin, xMax, maxDepth, profile, iceProfile, hasIce } = channelBounds;
    const effD = maxDepth;
    const xRange = xMax - xMin || 1;
    const plotW = Math.max(1, cw - CHART_PADDING.left - CHART_PADDING.right);
    const plotH = Math.max(1, ch - CHART_PADDING.top - CHART_PADDING.bottom);

    ctx.clearRect(0, 0, cw, ch);

    const profilePx = profile.map((vp) => ({
      px: CHART_PADDING.left + ((vp.x - xMin) / xRange) * plotW,
      py: CHART_PADDING.top + ((vp.depth || 0) / effD) * plotH,
    }));
    const surfaceY = CHART_PADDING.top;
    const bedMaxY = CHART_PADDING.top + plotH;

    // 第 1 层：河道 clip + 深邃水体背景
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(profilePx[0].px, surfaceY);
    for (let i = 0; i < profilePx.length; i++) ctx.lineTo(profilePx[i].px, profilePx[i].py);
    ctx.lineTo(profilePx[profilePx.length - 1].px, surfaceY);
    ctx.closePath();
    ctx.clip();

    const waterGrad = ctx.createLinearGradient(0, surfaceY, 0, bedMaxY);
    waterGrad.addColorStop(0, 'rgba(18, 42, 78, 0.92)');
    waterGrad.addColorStop(0.3, 'rgba(10, 28, 56, 0.94)');
    waterGrad.addColorStop(0.7, 'rgba(4, 14, 32, 0.97)');
    waterGrad.addColorStop(1, 'rgba(1, 4, 14, 0.99)');
    ctx.fillStyle = waterGrad;
    ctx.fillRect(0, surfaceY, cw, bedMaxY);

    // 第 2 层：微缩 ImageData → GPU 双线性硬件拉伸
    if (offscreenCanvasRef.current && gridRef.current) {
      ctx.imageSmoothingEnabled = true;
      const { cols, rows } = gridRef.current;
      ctx.drawImage(
        offscreenCanvasRef.current,
        0, 0, cols, rows,
        CHART_PADDING.left, CHART_PADDING.top, plotW, plotH,
      );
    }

    // 河床底部微弱辉光
    const bedGlow = ctx.createLinearGradient(0, bedMaxY - 40, 0, bedMaxY);
    bedGlow.addColorStop(0, 'rgba(20, 60, 140, 0)');
    bedGlow.addColorStop(1, 'rgba(20, 60, 140, 0.15)');
    ctx.fillStyle = bedGlow;
    ctx.fillRect(0, bedMaxY - 40, cw, 40);

    // 第 3 层：垂线全局常驻
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.lineWidth = 1.5;
    ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
    ctx.shadowBlur = 3;
    ctx.setLineDash([5, 4]);
    for (const v of verticals) {
      if (v.type !== 'measure') continue;
      const sx = parseFloat(v.startDistance);
      const wd = parseFloat(v.waterDepth);
      if (isNaN(sx) || isNaN(wd) || wd <= 0) continue;
      const vx = CHART_PADDING.left + ((sx - xMin) / xRange) * plotW;
      const vyTop = surfaceY;
      const vyBottom = CHART_PADDING.top + (wd / effD) * plotH;
      ctx.beginPath();
      ctx.moveTo(vx, vyTop);
      ctx.lineTo(vx, vyBottom);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.shadowBlur = 0;

    // 第 4 层：测点实心白圈 + v7.0 磁吸放大特效
    const snappedIdx = snappedIndexRef.current;
    for (let i = 0; i < dataPoints.length; i++) {
      const dp = dataPoints[i];
      const cx = CHART_PADDING.left + ((dp.x - xMin) / xRange) * plotW;
      const cy = CHART_PADDING.top + (dp.y / effD) * plotH;
      const isSnapped = i === snappedIdx;

      if (isSnapped) {
        // ── v7.0 动态扩散光圈 (rgba(59, 130, 246, 0.4)) ──
        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, 14, 0, Math.PI * 2);
        const haloGrad = ctx.createRadialGradient(cx, cy, 5, cx, cy, 14);
        haloGrad.addColorStop(0, 'rgba(59, 130, 246, 0.7)');
        haloGrad.addColorStop(0.5, 'rgba(59, 130, 246, 0.3)');
        haloGrad.addColorStop(1, 'rgba(59, 130, 246, 0)');
        ctx.fillStyle = haloGrad;
        ctx.fill();
        ctx.restore();

        // ── v7.0 2.5x 放大蓝色测点 (默认半径 2.2 → 放大 5.5px) ──
        ctx.fillStyle = 'rgba(59, 130, 246, 0.95)';
        ctx.beginPath();
        ctx.arc(cx, cy, 5.5, 0, Math.PI * 2);
        ctx.fill();
        // 外圈发光描边
        ctx.strokeStyle = 'rgba(147, 197, 253, 0.9)';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // 内圈白色高光
        ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
        ctx.beginPath();
        ctx.arc(cx - 1, cy - 1, 2, 0, Math.PI * 2);
        ctx.fill();
      } else {
        // 默认测点渲染
        ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
        ctx.beginPath();
        ctx.arc(cx, cy, 2.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.5)';
        ctx.lineWidth = 0.5;
        ctx.stroke();
      }
    }

    // 第 5 层：河道轮廓线
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.28)';
    ctx.lineWidth = 1.2;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(profilePx[0].px, surfaceY);
    for (const vp of profilePx) ctx.lineTo(vp.px, vp.py);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(100, 180, 240, 0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(profilePx[0].px, surfaceY);
    ctx.lineTo(profilePx[profilePx.length - 1].px, surfaceY);
    ctx.stroke();

    // 第 6 层：冰盖遮罩 (Foggy White Liquid Glass)
    if (hasIce && iceProfile.length >= 2) {
      // 底层 iceProfile 已自带完美延伸数据，直接映射像素
      const icePx = iceProfile.map((vp) => ({
        px: CHART_PADDING.left + ((vp.x - xMin) / xRange) * plotW,
        py: CHART_PADDING.top + (vp.iceBottom / effD) * plotH,
      }));

      // 模拟真实厚冰层的光学反射与吸收
      const iceGrad = ctx.createLinearGradient(0, surfaceY, 0, surfaceY + plotH * 0.25);
      iceGrad.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
      iceGrad.addColorStop(0.3, 'rgba(230, 245, 255, 0.85)');
      iceGrad.addColorStop(1, 'rgba(140, 190, 225, 0.7)');

      ctx.fillStyle = iceGrad;
      ctx.beginPath();
      ctx.moveTo(icePx[0].px, surfaceY);
      for (let i = 0; i < icePx.length; i++) ctx.lineTo(icePx[i].px, icePx[i].py);
      ctx.lineTo(icePx[icePx.length - 1].px, surfaceY);
      ctx.closePath();
      ctx.fill();

      // 冰层高光边界线
      ctx.strokeStyle = 'rgba(220, 240, 255, 0.9)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(icePx[0].px, icePx[0].py);
      for (let i = 1; i < icePx.length; i++) ctx.lineTo(icePx[i].px, icePx[i].py);
      ctx.stroke();

      // 冰花羽化 (直接使用底层 iceFlower 数据)
      const flPx = iceProfile.map((vp) => ({
        px: CHART_PADDING.left + ((vp.x - xMin) / xRange) * plotW,
        py: CHART_PADDING.top + (vp.iceFlower / effD) * plotH,
      }));
      
      const flGrad = ctx.createLinearGradient(0, surfaceY, 0, surfaceY + plotH * 0.3);
      flGrad.addColorStop(0, 'rgba(255, 255, 255, 0.3)');
      flGrad.addColorStop(1, 'rgba(255, 255, 255, 0.0)');
      
      ctx.fillStyle = flGrad;
      ctx.beginPath();
      ctx.moveTo(flPx[0].px, surfaceY);
      for (let i = 0; i < flPx.length; i++) ctx.lineTo(flPx[i].px, flPx[i].py);
      ctx.lineTo(flPx[flPx.length - 1].px, surfaceY);
      ctx.closePath();
      ctx.fill();
    }

    ctx.restore();

    // 第 7 层：坐标轴
    ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
    ctx.font = '10px monospace';
    const xSteps = 5;
    for (let i = 0; i <= xSteps; i++) {
      const dataXVal = xMin + (i / xSteps) * xRange;
      const ctxX = CHART_PADDING.left + (i / xSteps) * plotW;
      ctx.fillText(dataXVal.toFixed(1), ctxX - 12, ch - 6);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(ctxX, ch - CHART_PADDING.bottom);
      ctx.lineTo(ctxX, ch - CHART_PADDING.bottom + 4);
      ctx.stroke();
    }
    ctx.save();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.font = '10px monospace';
    ctx.textAlign = 'right';
    ctx.fillText('起点距(m)', cw - 5, ch - CHART_PADDING.bottom - 10);
    ctx.restore();

    const ySteps = 4;
    for (let i = 0; i <= ySteps; i++) {
      const dataYVal = (i / ySteps) * effD;
      const ctxY = CHART_PADDING.top + (i / ySteps) * plotH;
      ctx.fillText(dataYVal.toFixed(1), 4, ctxY + 4);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
      ctx.lineWidth = 0.5;
      ctx.setLineDash([2, 4]);
      ctx.beginPath();
      ctx.moveTo(CHART_PADDING.left, ctxY);
      ctx.lineTo(cw - CHART_PADDING.right, ctxY);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.save();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.font = '10px monospace';
    ctx.textAlign = 'left';
    ctx.fillText('深度(m)', CHART_PADDING.left + 5, CHART_PADDING.top - 8);
    ctx.restore();

  }, [dataSig, measureCount, channelBounds, dataPoints, cw, ch, verticals, snappedPoint, isEngineReady, gridVersion]);

  /* ════════════════════════════════════════
     十字准星探针 — 叠层 Canvas HUD
     ════════════════════════════════════════ */
  const drawCrosshair = useCallback((canvasX: number, canvasY: number) => {
    const overlay = overlayCanvasRef.current;
    if (!overlay || !channelBounds || !gridRef.current) return;
    const ctx = overlay.getContext('2d');
    if (!ctx) return;

    if (overlay.width !== cw || overlay.height !== ch) {
      overlay.width = cw;
      overlay.height = ch;
    }

    ctx.clearRect(0, 0, cw, ch);

    const grid = gridRef.current;
    const dataX = toDataX(canvasX);
    const dataY = toDataY(canvasY);

    const bedY = getBedDepthAtX(dataX, channelBounds);
    const iceBtm = channelBounds.hasIce ? getIceBottomAtX(dataX, channelBounds) : 0;
    const clampedY = Math.max(iceBtm, Math.min(dataY, bedY));
    const clampedCY = toCanvasY(clampedY);

    const sampledV = bilinearSample(grid, dataX, clampedY);

    ctx.strokeStyle = 'rgba(0, 255, 200, 0.55)';
    ctx.lineWidth = 1;
    ctx.setLineDash([6, 4]);

    ctx.beginPath();
    ctx.moveTo(canvasX, CHART_PADDING.top);
    ctx.lineTo(canvasX, ch - CHART_PADDING.bottom);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(CHART_PADDING.left, clampedCY);
    ctx.lineTo(cw - CHART_PADDING.right, clampedCY);
    ctx.stroke();

    ctx.setLineDash([]);

    ctx.strokeStyle = 'rgba(0, 255, 200, 0.7)';
    ctx.lineWidth = 1.5;
    ctx.shadowColor = 'rgba(0, 255, 200, 0.6)';
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.arc(canvasX, clampedCY, 5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.shadowBlur = 0;

    const lines = [
      `距起点: ${dataX.toFixed(1)}m`,
      `水深: ${clampedY.toFixed(2)}m`,
      `流速: ${sampledV.toFixed(3)}m/s`,
    ];
    ctx.font = '11px monospace';
    const textWidths = lines.map((l) => ctx.measureText(l).width);
    const maxTW = Math.max(...textWidths);
    const lineH = 16;
    const padX = 10;
    const padY = 6;
    const boxW = maxTW + padX * 2;
    const boxH = lines.length * lineH + padY * 2;

    let boxX = canvasX + 16;
    let boxY = clampedCY - boxH - 12;
    if (boxX + boxW > cw - 4) boxX = canvasX - boxW - 16;
    if (boxY < 4) boxY = clampedCY + 12;
    if (boxX < 4) boxX = 4;

    ctx.fillStyle = 'rgba(8, 14, 30, 0.88)';
    ctx.strokeStyle = 'rgba(0, 255, 200, 0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (ctx.roundRect) {
      ctx.roundRect(boxX, boxY, boxW, boxH, 6);
    } else {
      const r = 6;
      ctx.moveTo(boxX + r, boxY);
      ctx.lineTo(boxX + boxW - r, boxY);
      ctx.arcTo(boxX + boxW, boxY, boxX + boxW, boxY + r, r);
      ctx.lineTo(boxX + boxW, boxY + boxH - r);
      ctx.arcTo(boxX + boxW, boxY + boxH, boxX + boxW - r, boxY + boxH, r);
      ctx.lineTo(boxX + r, boxY + boxH);
      ctx.arcTo(boxX, boxY + boxH, boxX, boxY + boxH - r, r);
      ctx.lineTo(boxX, boxY + r);
      ctx.arcTo(boxX, boxY, boxX + r, boxY, r);
      ctx.closePath();
    }
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    for (let i = 0; i < lines.length; i++) {
      ctx.fillText(lines[i], boxX + padX, boxY + padY + lineH * (i + 1) - 2);
    }
  }, [cw, ch, channelBounds, toCanvasY, toDataX, toDataY]);

  /* ════════════════════════════════════════
     v7.0 核心磁吸算法
     基于当前数学触点坐标，动态遍历 dataPoints，
     寻找 Euclidean 距离在 SNAP_RADIUS_PX 范围内的最近测点。
     ════════════════════════════════════════ */
  const trySnap = useCallback(
    (canvasX: number, canvasY: number) => {
      const pts = dataPoints;
      const n = pts.length;
      if (n === 0 || !channelBounds) return -1;

      let bestIdx = -1;
      let bestDistSq = Infinity;

      const { xMin, xMax, maxDepth } = channelBounds;
      const xRange = xMax - xMin || 1;
      const effD = maxDepth;
      const safeH = Math.max(10, ch);
      const plotW = Math.max(1, cw - CHART_PADDING.left - CHART_PADDING.right);
      const plotH = Math.max(1, safeH - CHART_PADDING.top - CHART_PADDING.bottom);

      for (let i = 0; i < n; i++) {
        const dp = pts[i];
        const cx = CHART_PADDING.left + ((dp.x - xMin) / xRange) * plotW;
        const cy = CHART_PADDING.top + (dp.y / effD) * plotH;
        const dx = canvasX - cx;
        const dy = canvasY - cy;
        const distSq = dx * dx + dy * dy;
        if (distSq < bestDistSq) {
          bestDistSq = distSq;
          bestIdx = i;
        }
      }

      if (bestIdx === -1) return -1;
      const dist = Math.sqrt(bestDistSq);
      return dist <= SNAP_RADIUS_PX ? bestIdx : -1;
    },
    [dataPoints, channelBounds, cw, ch],
  );

  /* ════════════════════════════════════════
     v7.0 触控事件处理 — Touch 磁吸吸附
     ════════════════════════════════════════ */
  const handleTouchStart = useCallback(
    (e: React.TouchEvent<HTMLCanvasElement>) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.touches.length === 0) return;
      isTouchingRef.current = true;
      const touch = e.touches[0];
      const rect = e.currentTarget.getBoundingClientRect();
      const px = touch.clientX - rect.left;
      const py = touch.clientY - rect.top;
      const idx = trySnap(px, py);
      if (idx >= 0) {
        const dp = dataPoints[idx];
        snappedIndexRef.current = idx;
        const sp: SnappedPoint = {
          index: idx,
          distance: dp.x,
          depth: dp.y,
          velocity: dp.v,
        };
        setSnappedPoint(sp);
        onSnapChange?.(sp);
      } else {
        snappedIndexRef.current = null;
        setSnappedPoint(null);
        onSnapChange?.(null);
      }
      drawCrosshair(px, py);
    },
    [trySnap, dataPoints, drawCrosshair, onSnapChange],
  );

  const handleTouchMove = useCallback(
    (e: React.TouchEvent<HTMLCanvasElement>) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.touches.length === 0) return;
      if (!isTouchingRef.current) return;
      const touch = e.touches[0];
      const rect = e.currentTarget.getBoundingClientRect();
      const px = touch.clientX - rect.left;
      const py = touch.clientY - rect.top;
      const idx = trySnap(px, py);
      if (idx >= 0) {
        const dp = dataPoints[idx];
        snappedIndexRef.current = idx;
        const sp: SnappedPoint = {
          index: idx,
          distance: dp.x,
          depth: dp.y,
          velocity: dp.v,
        };
        setSnappedPoint(sp);
        onSnapChange?.(sp);
      } else {
        snappedIndexRef.current = null;
        setSnappedPoint(null);
        onSnapChange?.(null);
      }
      drawCrosshair(px, py);
    },
    [trySnap, dataPoints, drawCrosshair, onSnapChange],
  );

  const handleTouchEnd = useCallback(
    (e: React.TouchEvent<HTMLCanvasElement>) => {
      e.preventDefault();
      e.stopPropagation();
      isTouchingRef.current = false;
      // 手指抬起时不清除吸附 — 保留最后吸附状态，让用户能阅读底部面板
      // 只在真正离开绘图区且无触摸时清除
    },
    [],
  );

  /* ── 保留鼠标指针探针：仅 Desktop 端十字准星 HUD，不触发磁吸 ── */
  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      // 如果是触控事件（pointerType === 'touch'），由 touch 处理器接管
      if (e.pointerType === 'touch') return;
      if (!channelBounds || measureCount < MIN_VERTICALS) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      drawCrosshair(px, py);
    },
    [channelBounds, measureCount, drawCrosshair],
  );

  const handlePointerLeave = useCallback(() => {
    const overlay = overlayCanvasRef.current;
    if (!overlay) return;
    const ctx = overlay.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, overlay.width, overlay.height);
    // 鼠标离开时清除磁吸
    if (!isTouchingRef.current) {
      snappedIndexRef.current = null;
      setSnappedPoint(null);
      onSnapChange?.(null);
    }
  }, [onSnapChange]);

  /* ════════════════════════════════════════
     3 垂线门槛 — 静态占位
     ════════════════════════════════════════ */
  if (measureCount < MIN_VERTICALS || !channelBounds) {
    return (
      <div className="relative z-0 w-full h-full min-h-[320px] flex items-center justify-center bg-black/80 rounded-xl overflow-hidden select-none">
        <canvas
          ref={(el) => {
            if (!el) return;
            const rect = el.getBoundingClientRect();
            const w = rect.width || 400;
            const h = rect.height || 320;
            if (el.width === w && el.height === h && (el as HTMLCanvasElement & { _drawn?: boolean })._drawn) return;
            el.width = w;
            el.height = h;
            const ctx = el.getContext('2d');
            if (!ctx) return;
            ctx.clearRect(0, 0, w, h);
            ctx.strokeStyle = 'rgba(0, 255, 180, 0.04)';
            ctx.lineWidth = 0.5;
            const gs = 30;
            for (let x = 0; x < w; x += gs) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
            for (let y = 0; y < h; y += gs) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
            const scanY = h * 0.45;
            ctx.strokeStyle = 'rgba(0, 255, 180, 0.25)';
            ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(0, scanY); ctx.lineTo(w, scanY); ctx.stroke();
            ctx.fillStyle = 'rgba(0, 255, 180, 0.4)';
            ctx.shadowColor = 'rgba(0, 255, 180, 0.6)';
            ctx.shadowBlur = 10;
            ctx.beginPath(); ctx.arc(w * 0.3, scanY, 3, 0, Math.PI * 2); ctx.fill();
            ctx.shadowBlur = 0;
            (el as HTMLCanvasElement & { _drawn?: boolean })._drawn = true;
          }}
          className="absolute inset-0 w-full h-full"
        />
        <div className="relative z-10 text-center">
          <div className="text-5xl mb-4">🔬</div>
          <p className="text-cyan-400/80 text-sm font-mono tracking-wider mb-1">断面测点不足</p>
          <p className="text-slate-500 text-xs font-mono">
            请至少施测 <span className="text-cyan-400 font-bold">{MIN_VERTICALS}</span> 条垂线以解锁断面垂线分布图
          </p>
          <p className="text-slate-600 text-[10px] mt-2 font-mono">当前测速垂线: {measureCount} / {MIN_VERTICALS}</p>
        </div>
      </div>
    );
  }

  /* ════════════════════════════════════════
     主渲染 — 纯图表（无外壳，容器自适应）
     ════════════════════════════════════════ */
  return (
    <div ref={containerRef} className="w-full h-full relative">
      {/* 专业流速图例条 */}
      <div className="absolute top-1 right-1 z-10 flex items-center gap-2 bg-black/40 px-2 py-1.5 rounded-md backdrop-blur-md border border-white/10 shadow-lg scale-90 origin-top-right">
        <span className="text-white/60 text-[9px] font-mono leading-none">0.0</span>
        <div className="h-2 w-20 rounded-full" style={{ background: 'linear-gradient(to right, rgb(48,18,59), rgb(70,134,250), rgb(26,228,182), rgb(164,252,60), rgb(251,162,56), rgb(122,4,3))' }} />
        <span className="text-white/60 text-[9px] font-mono leading-none">Vmax</span>
        {channelBounds?.hasIce && (
          <span className="text-cyan-300/80 text-[9px] font-mono ml-0.5 bg-cyan-900/50 px-1 py-0.5 rounded leading-none">冰</span>
        )}
      </div>

      {/* 延迟渲染 Loading 态 */}
      {!isEngineReady && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-[#0a0f1e]/50 backdrop-blur-sm">
          <div className="w-8 h-8 border-2 border-cyan-500/30 border-t-cyan-400 rounded-full animate-spin mb-3" />
          <span className="text-[10px] text-cyan-400/60 font-mono tracking-widest animate-pulse">引擎启动中...</span>
        </div>
      )}

      {/* 主 Canvas — 静态 Heatmap + v7.0 Touch 磁吸吸附 */}
      <canvas
        ref={mainCanvasRef}
        width={cw}
        height={ch}
        className="absolute cursor-crosshair touch-none"
        style={{ width: cw, height: ch, top: 0, left: 0, zIndex: 1, touchAction: 'none' }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onPointerMove={handlePointerMove}
        onPointerLeave={handlePointerLeave}
      />

      {/* 叠加 Canvas — 十字准星 HUD */}
      <canvas
        ref={overlayCanvasRef}
        width={cw}
        height={ch}
        className="absolute pointer-events-none"
        style={{ width: cw, height: ch, top: 0, left: 0, zIndex: 2 }}
      />
    </div>
  );
}
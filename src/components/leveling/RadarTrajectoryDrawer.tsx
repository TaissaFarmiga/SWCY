import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { MapPin, Radar, Route, X } from 'lucide-react';
import { useLevelingStore } from '../../store/levelingStore';
import { greatCircleDistanceMeters, hasValidCoordinates } from '../../lib/levelingVisuals';

interface GeoNode {
  id: string;
  lat: number;
  lng: number;
  label: string;
  elevation: number | null;
  kind: 'known' | 'station';
  isValid: boolean;
  x: number;
  y: number;
}

interface GeoEdge {
  id: string;
  source: GeoNode;
  target: GeoNode;
  distanceM: number;
}

function shortLabel(value: string): string {
  return value.length > 12 ? `${value.slice(0, 12)}…` : value;
}

export function RadarTrajectoryDrawer({ onClose }: { onClose: () => void }) {
  const route = useLevelingStore((state) => state.currentRoute);
  const trajectory = route.calculation.trajectoryPoints;

  const geoData = useMemo(() => {
    const stationInputs = trajectory.filter(hasValidCoordinates);
    if (stationInputs.length < 2) return null;
    const raw = [
      ...route.knownPoints
        .filter(hasValidCoordinates)
        .map((point) => ({
          id: point.id,
          lat: point.lat,
          lng: point.lng,
          label: point.name || '已知点',
          elevation: point.elevation,
          kind: 'known' as const,
          isValid: true,
        })),
      ...stationInputs.map((point) => ({
        id: point.id,
        lat: point.lat as number,
        lng: point.lng as number,
        label: point.label,
        elevation: point.elevation,
        kind: 'station' as const,
        isValid: point.isValid,
      })),
    ];
    const minLat = Math.min(...raw.map((point) => point.lat));
    const maxLat = Math.max(...raw.map((point) => point.lat));
    const minLng = Math.min(...raw.map((point) => point.lng));
    const maxLng = Math.max(...raw.map((point) => point.lng));
    const middleLatitude = (minLat + maxLat) / 2;
    const latitudeToMeters = Math.PI / 180 * 6_371_000;
    const longitudeToMeters = latitudeToMeters * Math.cos(middleLatitude * Math.PI / 180);
    const nodes: GeoNode[] = raw.map((point) => ({
      ...point,
      x: (point.lng - minLng) * longitudeToMeters,
      y: (maxLat - point.lat) * latitudeToMeters,
    }));
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const edges: GeoEdge[] = [];
    for (let index = 1; index < stationInputs.length; index += 1) {
      const source = byId.get(stationInputs[index - 1].id);
      const target = byId.get(stationInputs[index].id);
      if (!source || !target) continue;
      const distanceM = greatCircleDistanceMeters(source.lat, source.lng, target.lat, target.lng);
      if (distanceM === null) continue;
      edges.push({
        id: `${source.id}:${target.id}`,
        source,
        target,
        distanceM,
      });
    }
    const width = Math.max((maxLng - minLng) * longitudeToMeters, 0);
    const height = Math.max((maxLat - minLat) * latitudeToMeters, 0);
    const scale = Math.max(width, height, 20);
    const padding = scale * 0.3;
    return {
      nodes,
      edges,
      scale,
      viewBox: `${-padding} ${-padding} ${width + padding * 2} ${height + padding * 2}`,
      nodeRadius: scale * 0.018,
      strokeWidth: scale * 0.006,
      fontSize: scale * 0.04,
    };
  }, [route.knownPoints, trajectory]);

  return (
    <>
      <motion.button type="button" aria-label="点击遮罩关闭雷达轨迹" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} className="fixed inset-0 z-40 bg-slate-950/35 backdrop-blur-sm" />
      <motion.section
        role="dialog"
        aria-modal="true"
        aria-label="水准雷达轨迹"
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 28, stiffness: 260 }}
        className="fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[86dvh] min-h-[55dvh] w-full max-w-2xl flex-col overflow-hidden rounded-t-[28px] border border-white/80 bg-[#f7f9fc]/95 shadow-2xl backdrop-blur-2xl dark:border-gray-700 dark:bg-gray-950/95"
      >
        <header className="flex shrink-0 items-center justify-between border-b border-slate-200/70 px-4 pb-3 pt-4 dark:border-gray-800">
          <div>
            <p className="text-[10px] font-bold tracking-[0.18em] text-violet-500">{geoData ? 'WGS-84 本地投影' : '测站顺序与质量状态'}</p>
            <h2 className="flex items-center gap-2 text-lg font-black text-slate-800 dark:text-slate-100"><Radar className="h-5 w-5" />雷达轨迹</h2>
          </div>
          <button type="button" aria-label="关闭雷达轨迹" onClick={onClose} className="flex min-h-11 min-w-11 items-center justify-center rounded-2xl bg-white/80 text-slate-500 shadow-sm dark:bg-gray-800 dark:text-slate-300"><X className="h-5 w-5" /></button>
        </header>

        <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto overflow-x-hidden p-2 pb-[max(1rem,env(safe-area-inset-bottom))] min-[360px]:p-4">
          {trajectory.length === 0 ? (
            <div className="flex min-h-64 flex-col items-center justify-center px-5 text-center text-slate-400">
              <MapPin className="mb-3 h-12 w-12 opacity-50" />
              <p className="text-sm font-bold">暂无测站轨迹</p>
              <p className="mt-1 text-[11px]">添加测站后显示真实测站顺序；GPS 模式至少需要两个带坐标测站。</p>
            </div>
          ) : geoData ? (
            <svg className="block h-auto max-h-[64dvh] w-full rounded-3xl border border-white/80 bg-white/75 shadow-glass dark:border-gray-700 dark:bg-gray-900/70" viewBox={geoData.viewBox} preserveAspectRatio="xMidYMid meet" role="img" aria-label="GPS 测站真实轨迹">
              {geoData.edges.map((edge) => {
                const middleX = (edge.source.x + edge.target.x) / 2;
                const middleY = (edge.source.y + edge.target.y) / 2;
                return (
                  <g key={edge.id}>
                    <line x1={edge.source.x} y1={edge.source.y} x2={edge.target.x} y2={edge.target.y} stroke="#6366f1" strokeWidth={geoData.strokeWidth} strokeDasharray={`${geoData.strokeWidth * 3} ${geoData.strokeWidth * 2}`} />
                    <text x={middleX} y={middleY - geoData.fontSize * 0.35} textAnchor="middle" fill="#6366f1" fontSize={geoData.fontSize * 0.7}>{edge.distanceM.toFixed(1)}m</text>
                  </g>
                );
              })}
              {geoData.nodes.map((node) => (
                <g key={node.id}>
                  <circle cx={node.x} cy={node.y} r={node.kind === 'known' ? geoData.nodeRadius * 1.35 : geoData.nodeRadius} fill={node.kind === 'known' ? '#ef4444' : node.isValid ? '#10b981' : '#f59e0b'} stroke="white" strokeWidth={geoData.strokeWidth * 0.6} />
                  <text x={node.x} y={node.y - geoData.fontSize * 1.25} textAnchor="middle" fill="#334155" fontSize={geoData.fontSize} fontWeight="700">{shortLabel(node.label)}</text>
                  <text x={node.x} y={node.y + geoData.fontSize * 1.45} textAnchor="middle" fill="#64748b" fontSize={geoData.fontSize * 0.72} fontFamily="monospace">H {node.elevation === null ? '--' : node.elevation.toFixed(3)}</text>
                </g>
              ))}
            </svg>
          ) : (
            <SequenceTrajectory />
          )}
        </div>

        <footer className="shrink-0 border-t border-slate-200/70 bg-white/50 px-4 py-2 text-[10px] leading-5 text-slate-500 dark:border-gray-800 dark:bg-gray-900/50 dark:text-slate-400">
          {geoData
            ? `真实 GPS 轨迹；自适应范围约 ${Math.round(geoData.scale)} m。红色为已知点，绿色为合格测站，琥珀色为未完整或超限测站。`
            : '未伪造地理位置。当前为测站序列模式，横轴只表达观测进度与累计里程，不代表平面方位。'}
        </footer>
      </motion.section>
    </>
  );
}

function SequenceTrajectory() {
  const points = useLevelingStore((state) => state.currentRoute.calculation.trajectoryPoints);
  const width = 640;
  const height = 300;
  const left = 54;
  const right = 34;
  const usable = width - left - right;
  const x = (progress: number) => left + progress * usable;
  const labelEvery = Math.max(1, Math.ceil(points.length / 8));
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="block h-auto w-full rounded-3xl border border-white/80 bg-white/75 shadow-glass dark:border-gray-700 dark:bg-gray-900/70" role="img" aria-label="测站顺序与质量轨迹">
      <line x1={left} y1="150" x2={width - right} y2="150" stroke="#cbd5e1" strokeWidth="3" />
      {points.map((point, index) => {
        const pointX = x(point.progress);
        const pointY = point.direction === 'return' ? 184 : 116;
        const color = !point.isComplete ? '#f59e0b' : point.isValid ? '#10b981' : '#ef4444';
        const previous = index > 0 ? points[index - 1] : null;
        const showLabel = index === 0 || index === points.length - 1 || index % labelEvery === 0;
        return (
          <g key={point.id}>
            {previous && <line x1={x(previous.progress)} y1={previous.direction === 'return' ? 184 : 116} x2={pointX} y2={pointY} stroke="#6366f1" strokeWidth="2" />}
            <line x1={pointX} y1="150" x2={pointX} y2={pointY} stroke="#94a3b8" strokeDasharray="3 3" />
            <circle cx={pointX} cy={pointY} r="8" fill={color} stroke="white" strokeWidth="3" />
            {showLabel && (
              <>
                <text x={pointX} y={point.direction === 'return' ? 214 : 88} textAnchor="middle" fill="#475569" fontSize="12" fontWeight="700">{shortLabel(point.label)}</text>
                <text x={pointX} y={point.direction === 'return' ? 230 : 72} textAnchor="middle" fill="#94a3b8" fontSize="9" fontFamily="monospace">{point.distanceKm.toFixed(3)}km</text>
              </>
            )}
          </g>
        );
      })}
      <Route x="18" y="18" width="18" height="18" color="#6366f1" />
      <text x="42" y="31" fill="#64748b" fontSize="12">测站序列模式</text>
      <text x={left} y="270" fill="#64748b" fontSize="10">往测在上，返测在下；颜色表示完整性和限差状态</text>
    </svg>
  );
}

export function isValidCoordinate(lat: unknown, lng: unknown): boolean {
  return typeof lat === 'number'
    && typeof lng === 'number'
    && Number.isFinite(lat)
    && Number.isFinite(lng)
    && lat >= -90
    && lat <= 90
    && lng >= -180
    && lng <= 180;
}

export function hasValidCoordinates<T extends { lat?: unknown; lng?: unknown }>(
  value: T,
): value is T & { lat: number; lng: number } {
  return isValidCoordinate(value.lat, value.lng);
}

/** WGS-84 坐标的球面近似距离；非法坐标返回 null，不向 SVG 传播 NaN。 */
export function greatCircleDistanceMeters(
  lat1: unknown,
  lng1: unknown,
  lat2: unknown,
  lng2: unknown,
): number | null {
  if (!isValidCoordinate(lat1, lng1) || !isValidCoordinate(lat2, lng2)) return null;
  if (typeof lat1 !== 'number' || typeof lng1 !== 'number' || typeof lat2 !== 'number' || typeof lng2 !== 'number') return null;
  const radius = 6_371_000;
  const latitudeDelta = (lat2 - lat1) * Math.PI / 180;
  const longitudeDelta = (lng2 - lng1) * Math.PI / 180;
  const rawHaversine = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(longitudeDelta / 2) ** 2;
  const haversine = Math.min(1, Math.max(0, rawHaversine));
  const distance = radius * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
  return Number.isFinite(distance) ? distance : null;
}

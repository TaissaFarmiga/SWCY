const FILTER_ALPHA = 0.18;
const DEAD_ZONE_DEGREES = 0.05;
const BUBBLE_MAX_RADIUS = 92;
const BUBBLE_PIXELS_PER_DEGREE = 9;

export interface TiltVector {
  x: number;
  y: number;
}

export function rotateForScreen(x: number, y: number, angle: number): { x: number; y: number } {
  const normalized = ((Math.round(angle / 90) * 90) % 360 + 360) % 360;
  if (normalized === 90) return { x: -y, y: x };
  if (normalized === 180) return { x: -x, y: -y };
  if (normalized === 270) return { x: y, y: -x };
  return { x, y };
}

export function applyDeadZone(value: number, deadZone = DEAD_ZONE_DEGREES): number {
  return Math.abs(value) < deadZone ? 0 : value;
}

export function boundedBubblePosition(x: number, y: number): { x: number; y: number } {
  let targetX = x * BUBBLE_PIXELS_PER_DEGREE;
  let targetY = y * BUBBLE_PIXELS_PER_DEGREE;
  const distance = Math.hypot(targetX, targetY);
  if (distance > BUBBLE_MAX_RADIUS) {
    targetX = targetX / distance * BUBBLE_MAX_RADIUS;
    targetY = targetY / distance * BUBBLE_MAX_RADIUS;
  }
  return { x: targetX, y: targetY };
}

export function snapTiltWithinTolerance(tilt: TiltVector, toleranceDegrees: number): TiltVector {
  if (!Number.isFinite(toleranceDegrees) || toleranceDegrees < 0) return tilt;
  return Math.hypot(tilt.x, tilt.y) <= toleranceDegrees ? { x: 0, y: 0 } : tilt;
}

export function lowPassTilt(
  previous: TiltVector | null,
  next: TiltVector,
  alpha = FILTER_ALPHA,
): TiltVector {
  if (!previous) return next;
  const clampedAlpha = Math.min(1, Math.max(0, alpha));
  return {
    x: previous.x + clampedAlpha * (next.x - previous.x),
    y: previous.y + clampedAlpha * (next.y - previous.y),
  };
}

export function medianTilt(samples: TiltVector[]): TiltVector | null {
  if (samples.length === 0) return null;
  const median = (values: number[]) => {
    const ordered = [...values].sort((left, right) => left - right);
    const middle = Math.floor(ordered.length / 2);
    return ordered.length % 2 === 0
      ? (ordered[middle - 1] + ordered[middle]) / 2
      : ordered[middle];
  };
  return { x: median(samples.map((sample) => sample.x)), y: median(samples.map((sample) => sample.y)) };
}

export function nextCenteredState(
  deviation: number | null,
  wasCentered: boolean,
  enterLimitDegrees: number,
  exitLimitDegrees: number,
): boolean {
  if (deviation === null || !Number.isFinite(deviation)) return false;
  return wasCentered ? deviation <= exitLimitDegrees : deviation <= enterLimitDegrees;
}

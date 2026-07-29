const FILTER_ALPHA = 0.18;
const DEAD_ZONE_DEGREES = 0.05;
const BUBBLE_MAX_RADIUS = 92;
const BUBBLE_PIXELS_PER_DEGREE = 9;

export function rotateForScreen(x: number, y: number, angle: number): { x: number; y: number } {
  const normalized = ((Math.round(angle / 90) * 90) % 360 + 360) % 360;
  if (normalized === 90) return { x: -y, y: x };
  if (normalized === 180) return { x: -x, y: -y };
  if (normalized === 270) return { x: y, y: -x };
  return { x, y };
}

export function applyDeadZone(value: number): number {
  return Math.abs(value) < DEAD_ZONE_DEGREES ? 0 : value;
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

export function lowPassTilt(
  previous: { x: number; y: number } | null,
  next: { x: number; y: number },
  alpha = FILTER_ALPHA,
): { x: number; y: number } {
  if (!previous) return next;
  return {
    x: previous.x + alpha * (next.x - previous.x),
    y: previous.y + alpha * (next.y - previous.y),
  };
}

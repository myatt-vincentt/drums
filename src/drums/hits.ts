// Stick hits, worked out on the screen.
//
// Every head (and cymbal) is drawn on screen as an ellipse, its "zone". A
// stick tip that moves down fast into a zone hits that piece. The hit fires
// at the START of the stroke: as soon as the tip is moving down fast and its
// path (from the last reading, a little way ahead along its motion) enters a
// zone. That hides the camera and tracking delay, so the sound lands about
// when the stick would meet the head. How fast the stroke is sets how loud
// it plays. A stick plays once per stroke and is ready again when it lifts.
//
// Units: screen heights, x right, y up, origin at the screen centre. Speeds
// are in palm lengths per second, so a hand far from the camera (small on
// screen) plays the same as one close up.
import type { PieceId } from "./pieces";

/** A head on screen: an ellipse with semi-axes `a` (along `angle`) and `b`. */
export type Zone = {
  id: PieceId;
  x: number;
  y: number;
  a: number;
  b: number;
  angle: number;
};

export const STROKE = {
  /** Downward speed (palms/s) that starts a stroke. */
  startSpeed: 4,
  /** Downward speed that plays at full loudness. */
  loudSpeed: 14,
  /** How far ahead along the motion (s) the path looks for a head. */
  lead: 0.07,
  /** Upward speed (palms/s) that re-arms the stick after a hit. */
  rearmSpeed: 1.2,
  /** Or: a lift of this many palms above the lowest point since the hit. */
  rearmRise: 0.35,
  /** Shortest time between two hits of one stick (s). */
  minGap: 0.08,
  /** A move of more palms than this in one reading is a tracking jump. */
  maxJump: 2.5,
  /** Readings further apart than this (s) don't make a speed. */
  maxDt: 0.15,
  /** The softest stroke's loudness (0..1). */
  softest: 0.15,
};

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** How far a point is from a zone's centre, in zone radii (1 = on the rim). */
export const zoneDistance = (z: Zone, px: number, py: number) => {
  const dx = px - z.x;
  const dy = py - z.y;
  const c = Math.cos(z.angle);
  const s = Math.sin(z.angle);
  const u = dx * c + dy * s;
  const v = -dx * s + dy * c;
  return Math.hypot(u / Math.max(1e-6, z.a), v / Math.max(1e-6, z.b));
};

/** The zone a point is in (the one it is deepest in), or null. */
export const zoneAt = (
  zones: readonly Zone[],
  px: number,
  py: number,
  limit = 1,
): Zone | null => {
  let best: Zone | null = null;
  let bestD = limit;
  for (let i = 0; i < zones.length; i += 1) {
    const d = zoneDistance(zones[i], px, py);
    if (d <= bestD) {
      bestD = d;
      best = zones[i];
    }
  }
  return best;
};

/**
 * The ellipse through a ring of points around a centre (a head's rim seen on
 * screen): its axes from the points' spread. `pts` is x, y pairs, evenly
 * spaced round the rim.
 */
export const ellipseFromRim = (
  id: PieceId,
  cx: number,
  cy: number,
  pts: ArrayLike<number>,
): Zone => {
  const n = Math.floor(pts.length / 2);
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (let i = 0; i < n; i += 1) {
    const dx = pts[i * 2] - cx;
    const dy = pts[i * 2 + 1] - cy;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }
  sxx /= Math.max(1, n);
  syy /= Math.max(1, n);
  sxy /= Math.max(1, n);
  // Eigenvalues of the spread; points round an ellipse spread a² / 2.
  const tr = sxx + syy;
  const det = sxx * syy - sxy * sxy;
  const disc = Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
  const l1 = tr / 2 + disc;
  const l2 = Math.max(0, tr / 2 - disc);
  const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  return {
    id,
    x: cx,
    y: cy,
    a: Math.sqrt(2 * l1),
    b: Math.sqrt(2 * l2),
    angle,
  };
};

/**
 * The first zone met along a path of points (x, y pairs): each segment is
 * walked in small steps, so a fast tip that jumps over the edge between two
 * readings still counts.
 */
export const firstZoneOnPath = (
  zones: readonly Zone[],
  path: readonly number[],
  steps = 4,
): Zone | null => {
  const n = Math.floor(path.length / 2);
  if (n === 0) return null;
  const first = zoneAt(zones, path[0], path[1]);
  if (first) return first;
  for (let i = 1; i < n; i += 1) {
    const x0 = path[(i - 1) * 2];
    const y0 = path[(i - 1) * 2 + 1];
    const x1 = path[i * 2];
    const y1 = path[i * 2 + 1];
    for (let k = 1; k <= steps; k += 1) {
      const t = k / steps;
      const z = zoneAt(zones, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t);
      if (z) return z;
    }
  }
  return null;
};

/** One reading of a stick: its tip, and the hand's palm length (screen heights). */
export type StickSample = { t: number; x: number; y: number; palm: number };

export type StrokeHit = {
  piece: PieceId;
  /** Loudness 0..1. */
  velocity: number;
  /** The stroke's downward speed (palms/s). */
  speed: number;
  t: number;
};

/** Loudness (0..1) of a stroke from its downward speed (palms/s). */
export const strokeVelocity = (speed: number) => {
  const k = clamp01(
    (speed - STROKE.startSpeed) / (STROKE.loudSpeed - STROKE.startSpeed),
  );
  return STROKE.softest + (1 - STROKE.softest) * k ** 0.85;
};

/** Watches one stick's readings and calls out its hits. */
export class StrokeDetector {
  /** Ready for a hit (it has lifted since the last one). */
  armed = true;

  /** The tip's current speed in any direction (palms/s). */
  speed = 0;

  private prev: StickSample | null = null;

  private prevDown = 0;

  private low = Infinity;

  private lastHit = -Infinity;

  /** Forget the stick (it left the camera). */
  reset() {
    this.prev = null;
    this.prevDown = 0;
    this.speed = 0;
    this.armed = true;
    this.low = Infinity;
  }

  /** A fresh reading; returns the hit it makes, if any. */
  push(s: StickSample, zones: readonly Zone[]): StrokeHit | null {
    const p = this.prev;
    if (p && s.t <= p.t) return null;
    this.prev = s;
    if (!p) return null;
    const dt = s.t - p.t;
    const palm = Math.max(1e-3, s.palm);
    const dx = (s.x - p.x) / palm;
    const dy = (s.y - p.y) / palm;
    if (dt > STROKE.maxDt || Math.hypot(dx, dy) > STROKE.maxJump) {
      this.prevDown = 0;
      this.speed = 0;
      return null;
    }
    const vx = dx / dt;
    const vy = dy / dt;
    this.speed = Math.hypot(vx, vy);
    const down = -vy;
    const before = this.prevDown;
    this.prevDown = down;

    if (!this.armed) {
      this.low = Math.min(this.low, s.y);
      const lifted =
        vy > STROKE.rearmSpeed || (s.y - this.low) / palm > STROKE.rearmRise;
      if (lifted && s.t - this.lastHit >= STROKE.minGap) this.armed = true;
      return null;
    }

    // A stroke: moving down fast, and already moving down a reading ago
    // (or very fast now), so one noisy reading doesn't play.
    const stroke =
      down > STROKE.startSpeed &&
      (before > STROKE.startSpeed * 0.35 || down > STROKE.startSpeed * 1.6);
    if (!stroke || s.t - this.lastHit < STROKE.minGap) return null;

    const ahead = STROKE.lead * palm;
    const zone = firstZoneOnPath(zones, [
      p.x,
      p.y,
      s.x,
      s.y,
      s.x + vx * ahead,
      s.y + vy * ahead,
    ]);
    if (!zone) return null;
    this.armed = false;
    this.low = s.y;
    this.lastHit = s.t;
    return {
      piece: zone.id,
      velocity: strokeVelocity(down),
      speed: down,
      t: s.t,
    };
  }
}

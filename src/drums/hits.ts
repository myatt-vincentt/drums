// Stick strokes, from your hand's motion on the camera picture.
//
// A stroke is a quick move of the hand down. It plays at its START: as soon
// as the hand is clearly moving down fast, after coming down a little way.
// That hides the camera and tracking delay, so the sound lands about when
// the stick would meet the head. How fast the stroke is sets how loud it
// plays. A hand plays once per stroke and is ready again once it lifts (or
// rests a moment). Slow drifts, small wobbles and the jumps of a lost hand
// never play.
//
// Units: the reach box (aim.ts): x across and y DOWN, 1 = the box's height
// (strokeUnit), so a small reach plays the same as a big one; a box not yet
// grown (someone barely moving) counts as a usual reach, so small gestures
// never play.
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

export const STROKE = {
  /** Downward speed (box heights/s) that starts a stroke… */
  startSpeed: 1.4,
  /** …after the hand has come down at least this far from its recent top. */
  minTravel: 0.1,
  /** …moving more down than sideways (down ÷ sideways at least this). */
  downRatio: 0.4,
  /** The top fades this fast (box heights/s), so a slow drift never adds up. */
  topFade: 0.5,
  /** Downward speed that plays at full loudness. */
  loudSpeed: 5,
  /** A lift this far above the lowest point re-arms the hand… */
  rearmRise: 0.06,
  /** …or no longer coming down (slower than `restSpeed`) for this long (s)… */
  rearmRest: 0.15,
  restSpeed: 0.3,
  /** …or coming back after this long out of sight (s)… */
  lostRearm: 0.25,
  /** …or this long (s) after the hit, once it is no longer coming down fast. */
  rearmAfter: 0.3,
  /** Shortest time between two hits of one hand (s). */
  minGap: 0.12,
  /** A move further than this (box heights) in one reading, and faster than
   * `maxSpeed` (box heights/s), is a tracking jump. */
  maxJump: 0.35,
  maxSpeed: 9,
  /** Speeds are measured over at least this long (s). */
  window: 0.06,
  /** Readings further apart than this (s) don't make a speed. */
  maxDt: 0.15,
  /** The softest stroke's loudness (0..1). */
  softest: 0.15,
};

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** The usual reach's height on the picture (the least unit of a stroke). */
export const MIN_UNIT = 0.65;

/** The unit of hand moves for a reach box this tall (picture heights). */
export const strokeUnit = (boxHeight: number) => Math.max(MIN_UNIT, boxHeight);

/** One reading of a hand: where it is in the reach box (y down). */
export type HandSample = { t: number; x: number; y: number };

export type StrokeHit = {
  /** Loudness 0..1. */
  velocity: number;
  /** The stroke's downward speed (box heights/s). */
  speed: number;
  /** Its sideways speed (box heights/s). */
  side: number;
  t: number;
};

/** Loudness (0..1) of a stroke from its downward speed. */
export const strokeVelocity = (speed: number) => {
  const k = clamp01(
    (speed - STROKE.startSpeed) / (STROKE.loudSpeed - STROKE.startSpeed),
  );
  return STROKE.softest + (1 - STROKE.softest) * k ** 0.85;
};

/** Watches one hand's readings and calls out its strokes. */
export class StrokeDetector {
  /** Ready for a hit (it has lifted since the last one). */
  armed = true;

  /** The hand's current speed in any direction (box heights/s). */
  speed = 0;

  /** Its downward speed (box heights/s). */
  down = 0;

  /** The last few readings (speeds are measured over `STROKE.window`). */
  private past: HandSample[] = [];

  private low = -Infinity;

  private top = Infinity;

  private restFor = 0;

  private lastHit = -Infinity;

  /** Forget the hand (it left the camera). */
  reset() {
    this.past.length = 0;
    this.speed = 0;
    this.down = 0;
    this.armed = true;
    this.low = -Infinity;
    this.top = Infinity;
    this.restFor = 0;
  }

  /** A fresh reading; returns the stroke it starts, if any. */
  push(s: HandSample): StrokeHit | null {
    const { past } = this;
    const p = past[past.length - 1];
    if (p && s.t <= p.t) return null;
    if (
      p &&
      (s.t - p.t > STROKE.maxDt ||
        Math.hypot(s.x - p.x, s.y - p.y) >
          Math.max(STROKE.maxJump, STROKE.maxSpeed * (s.t - p.t)))
    ) {
      // A gap or a jump: start again from here (after a long gap, ready).
      past.length = 0;
      this.top = s.y;
      if (s.t - p.t >= STROKE.lostRearm) this.armed = true;
      else this.low = Math.max(this.low, s.y);
    }
    past.push(s);
    while (past.length > 8) past.shift();
    if (past.length === 1) {
      this.top = s.y;
      this.speed = 0;
      this.down = 0;
      return null;
    }
    // Speeds over a short window, so a repeated (or skipped) camera frame
    // never makes a spike or a dip.
    let ref = past[past.length - 2];
    for (let i = past.length - 2; i >= 0; i -= 1) {
      ref = past[i];
      if (s.t - past[i].t >= STROKE.window) break;
    }
    const dt = s.t - ref.t;
    const vx = (s.x - ref.x) / dt;
    const down = (s.y - ref.y) / dt;
    const step = s.t - p.t;
    this.speed = Math.hypot(s.x - p.x, s.y - p.y) / step;
    this.down = down;

    if (!this.armed) {
      // Ready again after a real lift, or once it stops coming down.
      this.low = Math.max(this.low, s.y);
      this.restFor = down < STROKE.restSpeed ? this.restFor + step : 0;
      const lifted = this.low - s.y > STROKE.rearmRise;
      const over =
        s.t - this.lastHit >= STROKE.rearmAfter &&
        down < STROKE.startSpeed * 0.5;
      if (
        (lifted || over || this.restFor >= STROKE.rearmRest) &&
        s.t - this.lastHit >= STROKE.minGap
      ) {
        this.armed = true;
        this.top = s.y;
      }
      return null;
    }

    // The hand's recent top (fading down, so a slow drift never counts).
    this.top = Math.min(s.y, this.top + STROKE.topFade * step);
    const stroke =
      down > STROKE.startSpeed &&
      down >= STROKE.downRatio * Math.abs(vx) &&
      s.y - this.top >= STROKE.minTravel;
    if (!stroke || s.t - this.lastHit < STROKE.minGap) return null;
    this.armed = false;
    this.low = s.y;
    this.restFor = 0;
    this.lastHit = s.t;
    return { velocity: strokeVelocity(down), speed: down, side: vx, t: s.t };
  }
}

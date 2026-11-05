// Stick strokes, from your hand's motion on the camera picture.
//
// A stroke is a quick move of the hand down that stops: it plays where it
// lands (the stick meets the head there), as soon as the hand slows at the
// bottom. How fast it came down sets how loud it plays. A hand plays once
// per stroke and is ready again once it lifts (or rests a moment). Slow
// drifts, small wobbles and the jumps of a lost hand never play.
//
// Fast hands blur, and the tracker often loses a hand for a few frames in
// the middle of a stroke. A hand that was coming down fast (or that comes
// back clearly lower) within a moment landed: it plays where it comes back.
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
  /** A stroke comes down at least this fast (box heights/s)… */
  startSpeed: 1.4,
  /** …at least this far from its recent top… */
  minTravel: 0.1,
  /** …and lands once it slows to this share of its fastest. */
  landShare: 0.35,
  /** A hand lost on its way down (or out of sight and back clearly lower,
   * coming down at least `startSpeed` on average) within this long (s) landed. */
  blurGap: 0.35,
  /** (Across a gap the speed is an average: this share of `startSpeed` will do.) */
  blurSlack: 0.8,
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
  /** The stroke's fastest downward speed (box heights/s). */
  speed: number;
  /** Its sideways speed then (box heights/s). */
  side: number;
  t: number;
  /** Where it landed (its lowest reading's x, y)… */
  x: number;
  y: number;
  /** …and where it began (its highest). */
  from: { x: number; y: number };
};

/** Loudness (0..1) of a stroke from its downward speed. */
export const strokeVelocity = (speed: number) => {
  const k = clamp01(
    (speed - STROKE.startSpeed) / (STROKE.loudSpeed - STROKE.startSpeed),
  );
  return STROKE.softest + (1 - STROKE.softest) * k ** 0.85;
};

/** Watches one hand's readings and calls out its strokes as they land. */
export class StrokeDetector {
  /** Ready for a hit (it has lifted since the last one). */
  armed = true;

  /** The hand's current speed in any direction (box heights/s). */
  speed = 0;

  /** Its downward speed (box heights/s). */
  down = 0;

  /** This reading began a stroke (it has come down fast far enough): a
   * cymbal plays here, on the way down; a drum waits for it to land. */
  started = false;

  /** The highest reading before the stroke under way (its x, y). */
  from = { x: 0, y: 0 };

  /** The last few readings (speeds are measured over `STROKE.window`). */
  private past: HandSample[] = [];

  private low = -Infinity;

  private top = Infinity;

  /** The fastest downward speed of the move down under way (0: none). */
  private peak = 0;

  private peakSide = 0;

  private begun = false;

  /** It has lifted since its last hit. */
  private lifted = false;

  /** The lowest reading of the stroke under way (where it lands). */
  private lowest: HandSample | null = null;

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
    this.peak = 0;
    this.begun = false;
    this.started = false;
    this.restFor = 0;
  }

  /** Not ready until the hand lifts or rests (it just played some other way). */
  disarm(s: HandSample) {
    this.armed = false;
    this.lifted = false;
    this.lowest = null;
    this.begun = false;
    this.low = s.y;
    this.restFor = 0;
    this.peak = 0;
    this.lastHit = s.t;
  }

  private hit(s: HandSample, speed: number, side: number): StrokeHit {
    const at = this.lowest && this.lowest.y > s.y ? this.lowest : s;
    const from = { ...this.from };
    this.disarm(s);
    return {
      velocity: strokeVelocity(speed),
      speed,
      side,
      t: s.t,
      x: at.x,
      y: at.y,
      from,
    };
  }

  /** A fresh reading; returns the stroke that lands with it, if any. */
  push(s: HandSample): StrokeHit | null {
    const { past } = this;
    const p = past[past.length - 1];
    this.started = false;
    if (p && s.t <= p.t) return null;
    const gap = p ? s.t - p.t : 0;
    if (
      p &&
      (gap > STROKE.maxDt ||
        Math.hypot(s.x - p.x, s.y - p.y) >
          Math.max(STROKE.maxJump, STROKE.maxSpeed * gap))
    ) {
      // A gap (or a jump): a hand lost on its way down, or back clearly
      // lower, landed; otherwise start again from here.
      const fell = s.y - p.y;
      const top = Math.min(this.top, p.y);
      let out: StrokeHit | null = null;
      if (
        this.armed &&
        gap > STROKE.maxDt &&
        gap <= STROKE.blurGap &&
        s.t - this.lastHit >= STROKE.minGap &&
        s.y - top >= STROKE.minTravel &&
        ((this.peak >= STROKE.startSpeed && fell > -0.02) ||
          (fell >= STROKE.minTravel &&
            fell / gap >= STROKE.startSpeed * STROKE.blurSlack))
      )
        out = this.hit(s, Math.max(this.peak, fell / gap), this.peakSide);
      past.length = 0;
      past.push(s);
      this.top = s.y;
      this.from = { x: s.x, y: s.y };
      this.speed = 0;
      this.down = 0;
      this.peak = 0;
      this.begun = false;
      if (out) return out;
      if (gap >= STROKE.lostRearm) this.armed = true;
      else this.low = Math.max(this.low, s.y);
      return null;
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
      if (this.low - s.y > STROKE.rearmRise) this.lifted = true;
      const { lifted } = this;
      const over =
        s.t - this.lastHit >= STROKE.rearmAfter &&
        down < STROKE.startSpeed * 0.5;
      if (
        (lifted || over || this.restFor >= STROKE.rearmRest) &&
        s.t - this.lastHit >= STROKE.minGap
      ) {
        this.armed = true;
        this.top = s.y;
        this.peak = 0;
      }
      return null;
    }

    // The hand's recent top (fading down, so a slow drift never counts).
    // While it comes down fast the top holds: the stroke's travel counts
    // from where it began.
    if (this.peak === 0) {
      // The top fades only while the hand is about still: a stroke that
      // starts slowly keeps its whole travel.
      const fade =
        down > STROKE.restSpeed ? this.top : this.top + STROKE.topFade * step;
      if (s.y <= fade) this.from = { x: s.x, y: s.y };
      this.top = Math.min(s.y, fade);
    } else if (s.y < this.top) {
      this.top = s.y;
      this.from = { x: s.x, y: s.y };
    }
    const fast =
      down > STROKE.startSpeed && down >= STROKE.downRatio * Math.abs(vx);
    if (fast && down > this.peak) {
      if (this.peak === 0) this.lowest = null;
      this.peak = down;
      this.peakSide = vx;
    }
    if (this.peak > 0 && (!this.lowest || s.y > this.lowest.y)) this.lowest = s;
    if (this.peak === 0) return null;
    if (!this.begun && s.y - this.top >= STROKE.minTravel && fast) {
      this.begun = true;
      this.started = true;
    }
    // Coming down: it lands once it slows (or turns back up).
    if (down > this.peak * STROKE.landShare) return null;
    const { peak } = this;
    this.peak = 0;
    this.begun = false;
    if (s.y - this.top < STROKE.minTravel || s.t - this.lastHit < STROKE.minGap)
      return null;
    return this.hit(s, peak, this.peakSide);
  }
}

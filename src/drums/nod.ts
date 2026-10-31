// The kick drum, played by a nod: a quick downward dip of the head.
//
// It fires early in the dip, once the head is moving down fast and has
// dropped a little from where it just was, then waits for the head to come
// back up before the next one. Turning the head side to side (a shake)
// doesn't count. A faster nod plays a louder kick.

export const NOD = {
  /** The head must drop this far (radians, ~5°) from its recent top… */
  drop: 0.09,
  /** …moving down at least this fast (rad/s). */
  speed: 1.1,
  /** This fast (rad/s) is a full-loudness kick. */
  loudSpeed: 3,
  /** The "recent top" is the highest pitch in this window (s). */
  window: 0.4,
  /** The head must come back up this far (rad) to nod again. */
  rearm: 0.035,
  /** Shortest time between two nods (s). */
  minGap: 0.18,
  /** Pitch must move this many times faster than yaw (no shakes). */
  yawRatio: 1.2,
  /** Readings further apart than this (s) don't make a speed. */
  maxDt: 0.2,
};

export type Nod = { t: number; velocity: number };

export class NodDetector {
  armed = true;

  private history: { t: number; pitch: number }[] = [];

  private prev: { t: number; pitch: number; yaw: number } | null = null;

  private low = Infinity;

  private lastNod = -Infinity;

  reset() {
    this.history = [];
    this.prev = null;
    this.armed = true;
    this.low = Infinity;
  }

  /** A fresh head reading: pitch (+ up) and yaw, radians. */
  push(t: number, pitch: number, yaw: number): Nod | null {
    const p = this.prev;
    if (p && t <= p.t) return null;
    this.prev = { t, pitch, yaw };
    const top = this.history.reduce((m, h) => Math.max(m, h.pitch), -Infinity);
    this.history.push({ t, pitch });
    while (this.history.length && t - this.history[0].t > NOD.window)
      this.history.shift();
    if (!p) return null;
    const dt = t - p.t;
    if (dt > NOD.maxDt) {
      this.history = [{ t, pitch }];
      return null;
    }
    const vPitch = (pitch - p.pitch) / dt;
    const vYaw = (yaw - p.yaw) / dt;

    if (!this.armed) {
      this.low = Math.min(this.low, pitch);
      if (pitch - this.low >= NOD.rearm && t - this.lastNod >= NOD.minGap)
        this.armed = true;
      return null;
    }

    const down = -vPitch;
    if (
      down < NOD.speed ||
      top - pitch < NOD.drop ||
      down < NOD.yawRatio * Math.abs(vYaw) ||
      t - this.lastNod < NOD.minGap
    )
      return null;
    this.armed = false;
    this.low = pitch;
    this.lastNod = t;
    const k = Math.min(1, (down - NOD.speed) / (NOD.loudSpeed - NOD.speed));
    return { t, velocity: 0.35 + 0.65 * k };
  }
}

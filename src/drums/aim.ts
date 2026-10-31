// Where a ghost stick aims, and how far it is struck down.
//
// Your hand on the camera picture points at the kit as seen from the
// drummer's seat: left–right goes across the kit, up–down goes from the near
// drums (low on screen) to the far ones and the cymbals (high on screen).
// The aim follows your hand, except while it strikes: a quick move down
// holds the aim where the stroke began and swings the stick down instead,
// so a stroke whacks the drum you were over rather than sliding to the one
// nearer you. A slow move down (or resting low for a moment) moves the aim.
//
// A gentle aim assist pulls the aim towards the middle of the nearest head,
// so hits near an edge still land.
import { Ray, Vector3 } from "three";

import type { PieceId } from "./pieces";

export const AIM = {
  /** Heads count out to this many radii (with the assist pulling in). */
  reach: 1.6,
  /** Pull towards the middle: none inside this many radii… */
  pullFrom: 0.5,
  /** …rising to this share at the reach. */
  pull: 0.55,
  /** With no head near, the aim rests on this height (m). */
  restHeight: 0.78,
};

export const HOLD = {
  /** Following the hand (1/s). */
  follow: 18,
  /** Following sideways while a stroke holds the aim (1/s). */
  sideways: 4,
  /** Below the held aim by more than this share of a palm counts as striking. */
  below: 0.15,
  /** Slower than this (palms/s) while low… */
  slow: 1.5,
  /** …for this long (s) moves the aim down after all. */
  release: 0.3,
  /** A full stroke: the hand this many palms below the held aim. */
  strokePalms: 1,
  /** The deepest stroke (1 = the tip on the head). */
  maxStroke: 1.15,
};

export type AimHead = {
  id: PieceId;
  center: Vector3;
  normal: Vector3;
  radius: number;
};

export type Aim = {
  /** The aimed piece, or null (between pieces, in the air). */
  piece: PieceId | null;
  /** Where on it (on the head's plane, after the assist). */
  point: Vector3;
  /** The head's normal there (straight up in the air). */
  normal: Vector3;
  /** How far out from the head's middle, in radii, before the assist. */
  reach: number;
};

const hitPoint = new Vector3();
const toCenter = new Vector3();
const UP = new Vector3(0, 1, 0);

/* eslint-disable no-param-reassign */
/** The aim along a ray from the seat, among the heads a stick can play. */
export const aimAlong = (
  ray: Ray,
  heads: readonly AimHead[],
  out: Aim,
): Aim => {
  let best: AimHead | null = null;
  let bestQ = Infinity;
  heads.forEach((h) => {
    const denom = h.normal.dot(ray.direction);
    if (Math.abs(denom) < 1e-4) return;
    const t = toCenter.copy(h.center).sub(ray.origin).dot(h.normal) / denom;
    if (t <= 0) return;
    ray.at(t, hitPoint);
    const q = hitPoint.distanceTo(h.center) / h.radius;
    if (q < bestQ) {
      bestQ = q;
      best = h;
    }
  });
  const h = best as AimHead | null;
  if (h && bestQ <= AIM.reach) {
    const denom = h.normal.dot(ray.direction);
    const t = toCenter.copy(h.center).sub(ray.origin).dot(h.normal) / denom;
    ray.at(t, out.point);
    const k =
      AIM.pull *
      Math.min(
        1,
        Math.max(0, (bestQ - AIM.pullFrom) / (AIM.reach - AIM.pullFrom)),
      );
    out.point.lerp(h.center, k);
    out.normal.copy(h.normal);
    out.piece = h.id;
    out.reach = bestQ;
    return out;
  }
  // In the air: rest on a level a little above the drums.
  const dy = ray.direction.y;
  const t = Math.abs(dy) > 1e-4 ? (AIM.restHeight - ray.origin.y) / dy : 1;
  ray.at(Math.max(0.2, Math.min(3, t)), out.point);
  out.normal.copy(UP);
  out.piece = null;
  out.reach = Infinity;
  return out;
};
/* eslint-enable no-param-reassign */

/** The aim on screen (NDC of the seat's view) and how far the stick is struck. */
export class AimHold {
  x = 0;

  y = 0;

  ready = false;

  /** 0 (resting above the head) … 1 (tip on the head) and a little past. */
  stroke = 0;

  private lowFor = 0;

  reset() {
    this.ready = false;
    this.stroke = 0;
    this.lowFor = 0;
  }

  /**
   * The hand's point (NDC), its speed (palms/s) and its palm length (NDC
   * units), `dt` seconds after the last reading.
   */
  update(dt: number, px: number, py: number, speed: number, palm: number) {
    if (!this.ready) {
      this.x = px;
      this.y = py;
      this.ready = true;
      this.stroke = 0;
      return;
    }
    const p = Math.max(1e-3, palm);
    const low = py < this.y - HOLD.below * p;
    if (low) {
      this.lowFor = speed < HOLD.slow ? this.lowFor + dt : 0;
    } else this.lowFor = 0;
    const holding = low && this.lowFor < HOLD.release;
    const kx = 1 - Math.exp(-(holding ? HOLD.sideways : HOLD.follow) * dt);
    this.x += (px - this.x) * kx;
    if (!holding) this.y += (py - this.y) * (1 - Math.exp(-HOLD.follow * dt));
    this.stroke = Math.min(
      HOLD.maxStroke,
      Math.max(0, (this.y - py) / (HOLD.strokePalms * p)),
    );
  }
}

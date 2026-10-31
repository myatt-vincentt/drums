// The hi-hat's foot, played by holding still.
//
// The hats start open. Rest a stick fairly still over the hi-hat for a
// quarter of a second and the top cymbal drops (closed), with the foot's
// "chick". Hits while it is closed play the closed sound. Lift that stick
// clearly away (well to the side, high above, or down onto another drum),
// or lose it from the camera, and the hats open again. A held mouse button
// or finger on the hi-hat works the same way.
import { zoneDistance, type Zone } from "./hits";

export const HIHAT = {
  /** Slower than this (palms/s) counts as still. */
  still: 2.2,
  /** How long a stick rests over the hats before they close (s). */
  holdS: 0.25,
  /** "Over the hi-hat": within this many zone radii. */
  near: 1.3,
  /** Clearly away: this many hat radii to the side… */
  awaySide: 1.5,
  /** …or above the hat… */
  awayUp: 2.6,
  /** …or below it. */
  awayDown: 1.6,
  /** Away for this long (s) before the hats open. */
  awayS: 0.12,
  /** The closing stick lost from the camera this long (s) opens them. */
  lostS: 0.4,
};

/** One stick (or the pointer) this frame. */
export type HatInput = {
  id: string;
  present: boolean;
  x: number;
  y: number;
  /** palms/s */
  speed: number;
};

export type HatEvent = "close" | "open";

export class HiHatControl {
  closed = false;

  /** The stick that closed it. */
  by: string | null = null;

  private stillSince = new Map<string, number>();

  private awaySince: number | null = null;

  private lostSince: number | null = null;

  update(
    t: number,
    inputs: readonly HatInput[],
    zone: Zone | null,
  ): HatEvent | null {
    if (!zone) return null;
    if (!this.closed) {
      let event: HatEvent | null = null;
      inputs.forEach((s) => {
        const over =
          s.present &&
          s.speed < HIHAT.still &&
          zoneDistance(zone, s.x, s.y) <= HIHAT.near;
        if (!over) {
          this.stillSince.delete(s.id);
          return;
        }
        const since = this.stillSince.get(s.id) ?? t;
        this.stillSince.set(s.id, since);
        if (!event && t - since >= HIHAT.holdS) {
          this.closed = true;
          this.by = s.id;
          this.awaySince = null;
          this.lostSince = null;
          event = "close";
        }
      });
      return event;
    }

    const s = inputs.find((i) => i.id === this.by);
    if (!s || !s.present) {
      this.awaySince = null;
      this.lostSince = this.lostSince ?? t;
      return t - this.lostSince >= HIHAT.lostS ? this.open() : null;
    }
    this.lostSince = null;
    const r = Math.max(zone.a, zone.b);
    const dy = s.y - zone.y;
    const away =
      Math.abs(s.x - zone.x) > HIHAT.awaySide * r ||
      dy > HIHAT.awayUp * r ||
      -dy > HIHAT.awayDown * r;
    if (!away) {
      this.awaySince = null;
      return null;
    }
    this.awaySince = this.awaySince ?? t;
    return t - this.awaySince >= HIHAT.awayS ? this.open() : null;
  }

  /** Open at once (the pointer let go). */
  release(id: string): HatEvent | null {
    this.stillSince.delete(id);
    return this.closed && this.by === id ? this.open() : null;
  }

  private open(): HatEvent {
    this.closed = false;
    if (this.by) this.stillSince.delete(this.by);
    this.by = null;
    this.awaySince = null;
    this.lostSince = null;
    return "open";
  }
}

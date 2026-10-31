// The studio's LED strips flash in colour when you play: each piece has its
// own colour, a hit lights it at once (as loud as the hit) and it eases away
// over about half a second. Hits close together mix their colours, and while
// you keep playing the colours slowly sway a little either side (each piece
// keeps its own colour) so it never sits still.
// After a song the strips sweep through the rainbow. Plain code (no scene).
import { Color } from "three";

import type { PieceId } from "./pieces";

/** Each piece's colour, as a hue (0..1). */
export const LED_HUE: Record<PieceId, number> = {
  kick: 0.955, // deep magenta red
  snare: 0.9, // hot pink
  tom1: 0.77, // violet
  tom2: 0.62, // blue
  hihat: 0.49, // teal
  crash: 0.075, // amber
};

/** A flash fades with this time constant (s): about 5% is left after 0.5 s. */
export const LED_DECAY = 0.17;
/** While you play the colours sway this far either side (hue turns)… */
export const LED_SWAY = 0.06;
/** …once every this long (s of playing). */
export const LED_SWAY_PERIOD = 40;
/** The rainbow after a song lasts this long (s). */
export const LED_RAINBOW = 1.8;
/** No channel holds more than this (many hits at once stay a colour). */
const CAP = 1.5;

const ease = (t: number) => 1 - (1 - Math.min(1, Math.max(0, t))) ** 3;

export class LedFlash {
  /** The flash's light (linear RGB; 0 when dark). */
  readonly color = new Color(0, 0, 0);

  /** How lit the strips are by the flash, 0..1. */
  amount = 0;

  /** The colours' sway now (hue turns, ± LED_SWAY). */
  drift = 0;

  private phase = 0;

  private sweepAt = -1e9;

  private readonly c = new Color();

  /** A hit on `piece`, `velocity` 0..1. */
  hit(piece: PieceId, velocity: number) {
    const v = Math.min(1, Math.max(0.15, velocity)) ** 0.8;
    this.c.setHSL((LED_HUE[piece] + this.drift + 1) % 1, 1, 0.5);
    this.color.r = Math.min(CAP, this.color.r + this.c.r * v);
    this.color.g = Math.min(CAP, this.color.g + this.c.g * v);
    this.color.b = Math.min(CAP, this.color.b + this.c.b * v);
    this.amount = Math.min(
      1,
      Math.max(this.color.r, this.color.g, this.color.b),
    );
  }

  /** A song ended at `at` (s): the rainbow. */
  celebrate(at: number) {
    this.sweepAt = at;
  }

  /** Moves the flash on by `dt` (s); `now` is the clock (s). */
  update(dt: number, now: number) {
    this.color.multiplyScalar(Math.exp(-dt / LED_DECAY));
    if (Math.max(this.color.r, this.color.g, this.color.b) > 0.05) {
      this.phase += (dt * 2 * Math.PI) / LED_SWAY_PERIOD;
      this.drift = LED_SWAY * Math.sin(this.phase);
    }
    const e = now - this.sweepAt;
    if (e >= 0 && e < LED_RAINBOW) {
      const hold = LED_RAINBOW * 0.7;
      const level = e < hold ? 1 : 1 - ease((e - hold) / (LED_RAINBOW - hold));
      this.c.setHSL((e / LED_RAINBOW + this.drift + 1) % 1, 1, 0.5);
      this.color.r = Math.max(this.color.r, this.c.r * level);
      this.color.g = Math.max(this.color.g, this.c.g * level);
      this.color.b = Math.max(this.color.b, this.c.b * level);
    }
    this.amount = Math.min(
      1,
      Math.max(this.color.r, this.color.g, this.color.b),
    );
  }
}

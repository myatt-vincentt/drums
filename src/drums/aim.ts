// Where each hand aims: a piece of the kit, picked from where the hand is on
// the camera picture.
//
// The picture is split into big regions laid out like the kit in front of
// you: the cymbals up high (the hi-hat on the left, the crash on the right)
// and the drums below (the snare on the left, the tom in the middle, the
// floor tom on the right). The regions cover your own reach: a box learnt
// from where your hands go, so a small or a big reach plays the whole kit.
//
// The aimed piece changes only once the hand is clearly over the next
// region (not when it wavers on a border), and a quick move down (a stroke)
// never changes it: a stroke plays the piece it started over.
//
// Units: the picture as you see it (mirrored on a webcam), u right and v
// down, 0..1.
import type { PieceId } from "./pieces";
import { inBox, type Box } from "./reach";

export { inBox, REACH, ReachBox, type Box } from "./reach";

export type StickPiece = Exclude<PieceId, "kick">;

export const LAYOUT = {
  /** The cymbals take the box above this share of its height… */
  row: 0.5,
  /** …split across here (hi-hat left, crash right). */
  cymbals: 0.5,
  /** The drums below: the snare, the tom and the floor tom, split here
   * (the snare, the most played, a little wider). */
  drums: [0.38, 0.62] as const,
  /** A hand changes piece only this far (share of the box) past a border. */
  margin: 0.07,
};

export const AIM_HOLD = {
  /** Moving down faster than this (box heights/s): a stroke, the aim holds… */
  speed: 0.9,
  /** …for at most this long (s), or until the hand is back up. */
  most: 0.4,
  /** How fast the aim follows the hand (1/s). */
  follow: 25,
};

/** Each piece's region of the box: x0, x1, y0, y1 (0..1, y down). */
export const REGIONS: Record<
  StickPiece,
  readonly [number, number, number, number]
> = {
  hihat: [0, LAYOUT.cymbals, 0, LAYOUT.row],
  crash: [LAYOUT.cymbals, 1, 0, LAYOUT.row],
  snare: [0, LAYOUT.drums[0], LAYOUT.row, 1],
  tom1: [LAYOUT.drums[0], LAYOUT.drums[1], LAYOUT.row, 1],
  tom2: [LAYOUT.drums[1], 1, LAYOUT.row, 1],
};

export const STICK_ORDER: StickPiece[] = [
  "hihat",
  "crash",
  "snare",
  "tom1",
  "tom2",
];

/** The piece whose region holds a point of the box. */
export const regionAt = (x: number, y: number): StickPiece => {
  if (y < LAYOUT.row) return x < LAYOUT.cymbals ? "hihat" : "crash";
  if (x < LAYOUT.drums[0]) return "snare";
  return x < LAYOUT.drums[1] ? "tom1" : "tom2";
};

/** Still over `current` (its region widened by the margin on its inner borders)? */
export const stillOver = (current: StickPiece, x: number, y: number) => {
  const [x0, x1, y0, y1] = REGIONS[current];
  const m = LAYOUT.margin;
  return x >= x0 - m && x <= x1 + m && y >= y0 - m && y <= y1 + m;
};

/** The aimed piece, with hysteresis: it changes only clearly past a border. */
export const nextAim = (
  current: StickPiece | null,
  x: number,
  y: number,
): StickPiece =>
  current && stillOver(current, x, y) ? current : regionAt(x, y);

/**
 * One hand's aim. It follows the hand (eased), except while the hand moves
 * down fast (a stroke): then it holds where the stroke began, until the hand
 * lifts again or rests a moment.
 */
export class HandAim {
  /** The aim's place on the picture. */
  u = 0.5;

  v = 0.5;

  /** Its place in the box (0..1). */
  x = 0.5;

  y = 0.5;

  piece: StickPiece | null = null;

  /** The aim is held by a stroke. */
  held = false;

  private ready = false;

  private prevV = 0;

  private heldFor = 0;

  reset() {
    this.ready = false;
    this.held = false;
    this.piece = null;
    this.heldFor = 0;
  }

  /** A reading of the hand (picture u, v) `dt` s after the last, in the box `b`. */
  update(dt: number, u: number, v: number, b: Box) {
    const h = Math.max(1e-6, b.v1 - b.v0);
    if (!this.ready) {
      this.ready = true;
      this.u = u;
      this.v = v;
      this.prevV = v;
      this.held = false;
    } else {
      const down = (v - this.prevV) / h / Math.max(1e-3, dt);
      this.prevV = v;
      if (this.held) {
        this.heldFor += dt;
        // Back up to where it began, or the stroke is over: follow again.
        if (
          v <= this.v ||
          (this.heldFor >= AIM_HOLD.most && down < AIM_HOLD.speed)
        )
          this.held = false;
      } else if (down > AIM_HOLD.speed) {
        this.held = true;
        this.heldFor = 0;
      }
      if (!this.held) {
        const k = 1 - Math.exp(-AIM_HOLD.follow * Math.min(0.2, dt));
        this.u += (u - this.u) * k;
        this.v += (v - this.v) * k;
      }
    }
    const p = inBox(b, this.u, this.v);
    this.x = p.x;
    this.y = p.y;
    this.piece = nextAim(this.piece, p.x, p.y);
    return this.piece;
  }
}

// Where each hand's stick is over the kit.
//
// Your hand on the camera picture is the stick on the kit as you see it
// from the drummer's seat: move your hand right and the stick moves right,
// move it up the picture and the stick moves out to the far pieces (the
// hi-hat, the rack tom and the crash), down and it comes back to the snare
// and the floor tom. It follows your hand all the time; nothing snaps.
//
// A picture is flat, so a hand up high could be lifted for a stroke or
// reaching for a far piece. Each hand keeps its playing level: where it
// lands. Lifting above it lifts the stick; staying up there a moment moves
// the stick out over the far pieces; a stroke lands where your hand stops
// (hits.ts), and that sets the level again.
//
// The kit is laid over your own reach: a box learnt from where your hands
// play (reach.ts), so a small or a big reach plays the whole kit.
//
// Units: the picture as you see it (mirrored on a webcam), u right and v
// down, 0..1. The kit: x across (0 the hi-hat, 1 the floor tom) and y
// towards you (0 the crash, 1 the snare and the floor tom), as on screen
// from the seat.
import type { PieceId } from "./pieces";
import { inBox, type Box } from "./reach";

export { inBox, REACH, ReachBox, type Box } from "./reach";

export type StickPiece = Exclude<PieceId, "kick">;

/** A piece's place on the kit as seen from the seat, and its size (kit units). */
export type Spot = { id: StickPiece; x: number; y: number; r: number };

/** The kit from the drummer's seat (from the seat view; the far row a
 * little higher and the snare, the most played, a little bigger). */
export const SPOTS: readonly Spot[] = [
  { id: "hihat", x: 0, y: 0.12, r: 0.17 },
  { id: "tom1", x: 0.5, y: 0.3, r: 0.16 },
  { id: "crash", x: 0.91, y: 0, r: 0.17 },
  { id: "snare", x: 0.15, y: 0.99, r: 0.22 },
  { id: "tom2", x: 1, y: 1, r: 0.18 },
];

export const AIM = {
  /** The other hand's pieces count this much further away. */
  away: 1.7,
  /** The shown piece changes once another is this much nearer (radii). */
  margin: 0.35,
  /** The playing level follows a hand held higher this fast (1/s) (a
   * lower hand sets it at once). */
  rise: 2.2,
  /** How far past the reach the stick may go (kit units). */
  over: 0.12,
  /** A stroke that begins up above the drums (higher than this, kit y)
   * and out to a side (within this of it, kit x) meets that side's cymbal
   * on its way down: cymbals sit above the drums. */
  cymbalHigh: 0.06,
  cymbalSide: 0.3,
  /** Or out past the kit's side (this far, kit x) and fairly high (above
   * this, kit y): reaching out wide for it. */
  cymbalWide: -0.05,
  cymbalWideHigh: 0.2,
  /** …if the hand was up there at least this long (s), not just passing. */
  cymbalDwell: 0.08,
  /** A hand last seen this near the picture's top (share of its height)… */
  topEdge: 0.1,
  /** …and back within this long (s) played the cymbal up there. */
  topBack: 2.5,
};

/** Each hand's own pieces, as a drummer plays them. */
export const HOME: Record<"left" | "right", readonly StickPiece[]> = {
  left: ["hihat", "snare"],
  right: ["tom1", "tom2", "crash"],
};

/** How far a point is from a spot for a hand: the other hand's pieces count further. */
const handDistance = (s: Spot, x: number, y: number, hand?: "left" | "right") =>
  (Math.hypot(x - s.x, y - s.y) / s.r) *
  (hand && !HOME[hand].includes(s.id) ? AIM.away : 1);

export const STICK_ORDER: StickPiece[] = SPOTS.map((s) => s.id);

/** How far a point is from a spot, in its radii (1 = on the rim). */
export const spotDistance = (s: Spot, x: number, y: number) =>
  Math.hypot(x - s.x, y - s.y) / s.r;

/**
 * The piece nearest a point of the kit (in radii, so big pieces reach
 * further), for a hand if given (the other hand's pieces count further).
 */
export const pieceAt = (
  x: number,
  y: number,
  hand?: "left" | "right",
): StickPiece => {
  let best = SPOTS[0];
  let bestD = Infinity;
  SPOTS.forEach((s) => {
    const d = handDistance(s, x, y, hand);
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  });
  return best.id;
};

/** The cymbal a hand reaches out of the top of the picture for. */
export const topCymbal = (u: number, b: Box): StickPiece =>
  u < (b.u0 + b.u1) / 2 ? "hihat" : "crash";

/**
 * One hand's stick. `x`, `y`: its place on the kit; `lift`: how far the
 * hand is above its playing level (box heights); `piece`: the piece it is
 * over (changes only clearly past the middle between two).
 */
export class HandAim {
  constructor(readonly hand?: "left" | "right") {}

  x = 0.5;

  y = 0.7;

  lift = 0;

  /** The playing level (picture v). */
  base = 0.5;

  piece: StickPiece | null = null;

  private ready = false;

  reset() {
    this.ready = false;
    this.piece = null;
    this.lift = 0;
  }

  /** A reading of the hand (picture u, v) `dt` s after the last, in the box `b`. */
  update(dt: number, u: number, v: number, b: Box) {
    if (!this.ready) {
      this.ready = true;
      this.base = v;
    } else if (v >= this.base) this.base = v;
    else this.base += (v - this.base) * (1 - Math.exp(-AIM.rise * dt));
    this.place(u, b);
    const h = Math.max(1e-6, b.v1 - b.v0);
    this.lift = Math.max(0, (this.base - v) / h);
    return this.piece;
  }

  /** A stroke landed here: the playing level is where the hand stopped. */
  land(u: number, v: number, b: Box) {
    this.ready = true;
    this.base = v;
    this.lift = 0;
    this.place(u, b);
  }

  private place(u: number, b: Box) {
    const p = inBox(b, u, this.base, AIM.over);
    this.x = p.x;
    this.y = p.y;
    const next = pieceAt(p.x, p.y, this.hand);
    if (!this.piece) this.piece = next;
    else if (next !== this.piece) {
      const cur = SPOTS.find((s) => s.id === this.piece)!;
      const nx = SPOTS.find((s) => s.id === next)!;
      if (
        handDistance(nx, p.x, p.y, this.hand) + AIM.margin <
        handDistance(cur, p.x, p.y, this.hand)
      )
        this.piece = next;
    }
  }
}

/**
 * The cymbal a stroke meets on its way down when it begins at kit (x, y):
 * reaching up above the drums, out on the hi-hat's side or the crash's.
 */
export const cymbalAt = (x: number, y: number): StickPiece | null => {
  const wide = (out: number) => out > AIM.cymbalWide && y < AIM.cymbalWideHigh;
  if (x < AIM.cymbalSide && (y < AIM.cymbalHigh || wide(-x))) return "hihat";
  if (x > 1 - AIM.cymbalSide && (y < AIM.cymbalHigh || wide(x - 1)))
    return "crash";
  return null;
};

/** The piece a stroke that stopped at picture (u, v) plays, in the box `b`, for `hand`. */
export const landedOn = (
  u: number,
  v: number,
  b: Box,
  hand?: "left" | "right",
) => {
  const p = inBox(b, u, v, AIM.over);
  return { piece: pieceAt(p.x, p.y, hand), x: p.x, y: p.y };
};

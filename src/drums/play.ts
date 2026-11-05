// Your two hands playing the kit: hand readings in, hits out.
//
// Each reading goes to its hand (pair.ts), grows your reach (reach.ts),
// moves the hand's stick (aim.ts) and is watched for strokes (hits.ts):
//
//   - a stroke that begins with the stick over a cymbal plays the cymbal on
//     its way down (cymbals sit above the drums);
//   - any other stroke plays the piece where it lands;
//   - a hand that goes out of the top of the picture (reaching up for a
//     cymbal) and comes back played that cymbal: the hi-hat on the left,
//     the crash on the right.
//
// Readings come from the hand tracker (`update`, both hands at once) or,
// while the tracker has lost a hand, from following it on the picture
// (`followed`, one hand, follow.ts).
//
// Pure (no three.js, no clock): times are the readings' own (s).
import {
  AIM,
  cymbalAt,
  HandAim,
  inBox,
  landedOn,
  SPOTS,
  topCymbal,
  type StickPiece,
} from "./aim";
import {
  StrokeDetector,
  strokeUnit,
  strokeVelocity,
  type StrokeHit,
} from "./hits";
import { HandPairer, type Side } from "./pair";
import { ReachBox, type Box } from "./reach";

export const PLAY = {
  /** A hand not seen for this long (s) is gone. */
  lostS: 0.6,
  /** A hand lost on its way up out of the picture: where it would be this
   * long (s) later, at its last speed. */
  ahead: 0.2,
  /** Out of sight at least this long (s) before a cymbal counts. */
  topAway: 0.1,
  /** Readings further apart than this (s) make no speed. */
  maxDt: 0.15,
  /** After a cymbal (on the way down, or back from the top), the rest of
   * the hand's way down plays nothing for this long (s). */
  afterCymbal: 0.5,
};

/** One reading of a hand: its palm (u, v) and topmost point (picture, v down). */
export type Reading = { u: number; v: number; top?: number; size?: number };

export type PlayHit = {
  side: Side;
  piece: StickPiece;
  velocity: number;
  t: number;
  /** Where on the kit (aim.ts units). */
  x: number;
  y: number;
  /** Where the hand was on the picture. */
  u: number;
  v: number;
  /** How it played: landed, on a cymbal on the way down, or back from the top. */
  how: "land" | "cymbal" | "top";
};

export type HandPlay = {
  aim: HandAim;
  detector: StrokeDetector;
  /** The last reading's time (s), -1 before any. */
  t: number;
  u: number;
  v: number;
  /** Its topmost point's v. */
  top: number;
  /** Its upward speed (picture heights/s), for leaving through the top. */
  up: number;
  tracked: boolean;
  /** It left through the top: when, and for which cymbal. */
  outTop: { t: number; piece: StickPiece } | null;
  /** When it last played a cymbal. */
  cymbalAt: number;
  /** Up high on a cymbal's side: which, since and until when (s). */
  high: { piece: StickPiece; since: number; last: number } | null;
};

const newHand = (side: Side): HandPlay => ({
  aim: new HandAim(side),
  detector: new StrokeDetector(),
  t: -1,
  u: 0.5,
  v: 0.5,
  top: 0.5,
  up: 0,
  tracked: false,
  outTop: null,
  cymbalAt: -1e9,
  high: null,
});

/** Going out of the top: on its way up and near (or past) the top edge. */
const leaving = (h: HandPlay, t: number) =>
  h.tracked &&
  t - h.t >= PLAY.topAway &&
  h.top - h.up * PLAY.ahead < AIM.topEdge;

const spot = (id: StickPiece) => SPOTS.find((s) => s.id === id)!;

export class Players {
  readonly hands: Record<Side, HandPlay> = {
    left: newHand("left"),
    right: newHand("right"),
  };

  readonly reach = new ReachBox();

  readonly box: Box = this.reach.box();

  private pairer = new HandPairer();

  private lastT = -1;

  reset() {
    this.hands.left = newHand("left");
    this.hands.right = newHand("right");
    this.reach.reset();
    this.reach.box(this.box);
    this.pairer.reset();
    this.lastT = -1;
  }

  /** Time passes (s): hands out of sight a moment on their way up went out
   * of the top; hands not seen lately are gone. */
  tick(t: number) {
    (["left", "right"] as const).forEach((side) => {
      const h = this.hands[side];
      if (!h.outTop && leaving(h, t))
        h.outTop = { t: h.t, piece: topCymbal(h.u, this.box) };
      if (!h.tracked || t - h.t <= PLAY.lostS) return;
      h.tracked = false;
      h.detector.reset();
      h.aim.reset();
      this.reach.lose(side);
    });
  }

  /**
   * The tracker's readings at time `t` (at most two): returns, per hand,
   * the index of its reading (or -1), and the hits that land.
   */
  update(t: number, readings: readonly Reading[]) {
    const slot = this.pair(t, readings);
    const hits: PlayHit[] = [];
    (["left", "right"] as const).forEach((side) => {
      if (slot[side] >= 0) this.take(side, t, readings[slot[side]], hits);
    });
    return { slot, hits };
  }

  /** Which hand each of the tracker's readings at time `t` is (index or -1). */
  pair(t: number, readings: readonly Reading[]) {
    const slot = this.pairer.update(t, readings);
    this.reach.relax(this.lastT > 0 ? t - this.lastT : 0);
    this.lastT = Math.max(this.lastT, t);
    return slot;
  }

  /** A reading of one hand at time `t` (followed on the picture, or the tracker's). */
  read(t: number, side: Side, r: Reading) {
    const hits: PlayHit[] = [];
    if (t <= this.hands[side].t) return hits;
    this.pairer.note(side, r.u, r.v, t);
    this.take(side, t, r, hits);
    return hits;
  }

  private take(side: Side, t: number, r: Reading, hits: PlayHit[]) {
    const h = this.hands[side];
    const gap = h.t >= 0 ? t - h.t : Infinity;
    const dt = Math.min(0.2, gap === Infinity ? 1 / 30 : gap);
    // Back from out of the top: the cymbal up there.
    const out =
      h.outTop ??
      (leaving(h, t) ? { t: h.t, piece: topCymbal(h.u, this.box) } : null);
    h.outTop = null;
    const fromTop =
      out && t - out.t <= AIM.topBack && t - out.t >= PLAY.topAway
        ? out.piece
        : null;
    h.up = gap <= PLAY.maxDt && dt > 0 ? (h.v - r.v) / dt : 0;
    h.t = t;
    h.u = r.u;
    h.v = r.v;
    h.top = Math.min(r.top ?? r.v, r.v);
    h.tracked = true;
    this.reach.see(side, r.u, Math.max(r.v, h.aim.base), dt);
    this.reach.box(this.box);
    const b = this.box;
    const unit = strokeUnit(b.v1 - b.v0);
    // In box heights, from the picture's corner: the box grows as it learns,
    // and a still hand must never seem to move.
    const sample = { t, x: r.u / unit, y: r.v / unit };
    const play = (piece: StickPiece, velocity: number, how: PlayHit["how"]) => {
      const s = spot(piece);
      const p = how === "land" ? inBox(b, r.u, r.v, AIM.over) : s;
      hits.push({
        side,
        piece,
        velocity,
        t,
        x: p.x,
        y: p.y,
        u: r.u,
        v: r.v,
        how,
      });
    };
    // Up high on a cymbal's side (the hand itself, not its playing level).
    const raw = inBox(b, r.u, r.v, AIM.over);
    const upHigh = cymbalAt(raw.x, raw.y);
    if (upHigh) {
      if (h.high?.piece === upHigh && t - h.high.last < 0.15) h.high.last = t;
      // Back in sight up there after a while out of it: it was up there.
      else
        h.high = {
          piece: upHigh,
          since: gap >= 0.15 && gap < 1 ? t - gap : t,
          last: t,
        };
    }
    if (t - h.cymbalAt < PLAY.afterCymbal) {
      // Still on its way down from a cymbal (or back from the top after one).
      h.detector.push(sample);
      h.aim.update(dt, r.u, r.v, b);
      return;
    }
    if (fromTop) {
      h.detector.push(sample);
      h.detector.disarm(sample);
      h.aim.update(dt, r.u, r.v, b);
      h.cymbalAt = t;
      play(fromTop, 0.8, "top");
      return;
    }
    const hit: StrokeHit | null = h.detector.push(sample);
    if (hit) {
      const l = landedOn(r.u, r.v, b, side);
      h.aim.land(r.u, r.v, b);
      play(l.piece, hit.velocity, "land");
      return;
    }
    if (h.detector.started) {
      // Began over a cymbal: it meets the cymbal on the way down.
      const f = h.detector.from;
      const at = inBox(b, f.x * unit, f.y * unit, AIM.over);
      const c = cymbalAt(at.x, at.y);
      const held = h.high;
      if (
        c &&
        held?.piece === c &&
        held.last - held.since >= AIM.cymbalDwell &&
        t - held.last < 0.35
      ) {
        h.detector.disarm(sample);
        h.aim.update(dt, r.u, r.v, b);
        h.cymbalAt = t;
        play(c, strokeVelocity(h.detector.down), "cymbal");
        return;
      }
    }
    h.aim.update(dt, r.u, r.v, b);
  }
}

export type { Side };

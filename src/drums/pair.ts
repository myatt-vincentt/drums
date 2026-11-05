// Which hand is which. The tracker's own left / right label can swap from one
// reading to the next (it guesses from the hand's shape), so each hand here
// keeps its place by where it was: a new reading goes to the hand that was
// nearest. The first time, and after a hand is lost, the hand on the left of
// the picture is "left". A hand that crosses over (to play the hi-hat with
// the right hand) stays itself.
export type Side = "left" | "right";

export const PAIR = {
  /** A hand not seen for this long (s) is gone… */
  lostS: 0.6,
  /** …but a hand coming back within this long (s) near where it was is itself again. */
  backS: 3,
  /** A lone reading further than this (picture widths) from a hand is a new hand. */
  near: 0.3,
  /** Two readings nearer than this (or than this share of the hand's
   * size) are one hand found twice: one is dropped. */
  same: 0.12,
  sameSize: 0.6,
  /** A hand moves at most this far (picture widths) in a moment, plus this
   * far a second. */
  nearBase: 0.08,
  nearSpeed: 2.5,
  /** A lone reading this far (picture widths) past the other hand is that hand. */
  order: 0.05,
};

type Slot = { u: number; v: number; t: number };

export class HandPairer {
  private slots: Record<Side, Slot | null> = { left: null, right: null };

  reset() {
    this.slots = { left: null, right: null };
  }

  private live(s: Side, t: number) {
    const x = this.slots[s];
    return !!x && t - x.t <= PAIR.lostS;
  }

  /**
   * The readings at time `t` (picture u, v; at most two): returns, per side,
   * the index of its reading, or -1.
   */
  update(t: number, all: readonly { u: number; v: number; size?: number }[]) {
    const out: Record<Side, number> = { left: -1, right: -1 };
    // One hand found twice: keep the reading nearer a known hand.
    let readings = all.slice(0, 2);
    let drop = -1;
    if (
      readings.length === 2 &&
      Math.hypot(readings[0].u - readings[1].u, readings[0].v - readings[1].v) <
        Math.max(
          PAIR.same,
          PAIR.sameSize *
            Math.min(readings[0].size ?? 0, readings[1].size ?? 0),
        )
    ) {
      const near = (r: { u: number; v: number }) =>
        Math.min(
          ...(["left", "right"] as const).map((s) =>
            this.live(s, t)
              ? Math.hypot(this.slots[s]!.u - r.u, this.slots[s]!.v - r.v)
              : Infinity,
          ),
        );
      drop = near(readings[0]) <= near(readings[1]) ? 1 : 0;
      readings = [readings[1 - drop]];
    }
    const d = (s: Side, i: number) =>
      Math.hypot(
        this.slots[s]!.u - readings[i].u,
        this.slots[s]!.v - readings[i].v,
      );
    const liveL = this.live("left", t);
    const liveR = this.live("right", t);
    if (readings.length >= 2) {
      if (liveL && liveR) {
        const keep = d("left", 0) + d("right", 1);
        const swap = d("left", 1) + d("right", 0);
        out.left = keep <= swap ? 0 : 1;
      } else if (liveL || liveR) {
        // One hand known: it takes the nearer reading.
        const s: Side = liveL ? "left" : "right";
        const i = d(s, 0) <= d(s, 1) ? 0 : 1;
        out.left = s === "left" ? i : 1 - i;
      } else out.left = readings[0].u <= readings[1].u ? 0 : 1;
      out.right = 1 - out.left;
    } else if (readings.length === 1) {
      let s: Side;
      if (liveL && liveR) {
        s = d("left", 0) <= d("right", 0) ? "left" : "right";
        // Hands seldom cross: a lone reading well past the other hand is it.
        const r = readings[0];
        if (s === "left" && r.u > this.slots.right!.u + PAIR.order) s = "right";
        else if (s === "right" && r.u < this.slots.left!.u - PAIR.order)
          s = "left";
      } else if (liveL || liveR) {
        // The hand still in view, if the reading is near enough (as far as
        // a hand moves in the time since) and on its side.
        const known: Side = liveL ? "left" : "right";
        const other: Side = liveL ? "right" : "left";
        const k = this.slots[known]!;
        const r = readings[0];
        const reach = Math.min(
          PAIR.near,
          PAIR.nearBase + PAIR.nearSpeed * (t - k.t),
        );
        const past =
          known === "left" ? r.u > k.u + PAIR.order : r.u < k.u - PAIR.order;
        s =
          d(known, 0) <= reach && !(past && d(known, 0) > PAIR.nearBase)
            ? known
            : other;
      } else s = this.comeBack(t, readings[0]);
      out[s] = 0;
    }
    (["left", "right"] as const).forEach((s) => {
      const i = out[s];
      if (i >= 0) this.slots[s] = { u: readings[i].u, v: readings[i].v, t };
      else if (this.slots[s] && t - this.slots[s]!.t > PAIR.backS)
        this.slots[s] = null;
    });
    // Back to the indexes of all the readings.
    if (drop === 0)
      (["left", "right"] as const).forEach((s) => {
        if (out[s] === 0) out[s] = 1;
      });
    return out;
  }

  /** Hand `s` was found at (u, v) some other way (followed on the picture). */
  note(s: Side, u: number, v: number, t: number) {
    this.slots[s] = { u, v, t };
  }

  /** A hand appears with no hand in view: the one that was there lately, or by side. */
  private comeBack(t: number, r: { u: number; v: number }): Side {
    let best: Side | null = null;
    let bestD = PAIR.near;
    (["left", "right"] as const).forEach((s) => {
      const x = this.slots[s];
      if (!x || t - x.t > PAIR.backS) return;
      const dd = Math.hypot(x.u - r.u, x.v - r.v);
      if (dd < bestD) {
        bestD = dd;
        best = s;
      }
    });
    return best ?? (r.u < 0.5 ? "left" : "right");
  }
}

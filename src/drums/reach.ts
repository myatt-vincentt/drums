// Your reach on the camera picture: a box learnt from where your hands go.
// The kit's regions (aim.ts) are laid over it, so a small or a big reach
// plays the whole kit. It grows to the hands' eased places (a stray reading
// never stretches it), keeps clear of the picture's edges (a hand cut off by
// an edge reads short), and edges the hands stop reaching creep back in,
// slowly.
//
// Units: the picture as you see it, u right and v down, 0..1.

export type Box = { u0: number; u1: number; v0: number; v1: number };

export const REACH = {
  /** The box before any hand has been seen. */
  start: { u0: 0.2, u1: 0.8, v0: 0.3, v1: 0.75 } as Box,
  /** It is never smaller than this (share of the picture). */
  minW: 0.45,
  minH: 0.35,
  /** It never reaches nearer the picture's edge than this (a hand cut off by the edge reads short). */
  edge: 0.08,
  /** It learns from the hand's eased place (1/s), so one stray reading never stretches it. */
  ease: 12,
  /** Edges the hands no longer reach creep back in this fast (share of the picture per s). */
  relax: 0.001,
};

const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));

/** The learnt reach of the hands on the picture. */
export class ReachBox implements Box {
  u0 = REACH.start.u0;

  u1 = REACH.start.u1;

  v0 = REACH.start.v0;

  v1 = REACH.start.v1;

  private eased = new Map<string, { u: number; v: number }>();

  reset() {
    Object.assign(this, REACH.start);
    this.eased.clear();
  }

  /** Forget one hand's eased place (it left the picture). */
  lose(id: string) {
    this.eased.delete(id);
  }

  /** A hand's reading (`dt` s after its last one). */
  see(id: string, u: number, v: number, dt: number) {
    let e = this.eased.get(id);
    if (!e) {
      e = { u, v };
      this.eased.set(id, e);
      return;
    }
    const k = 1 - Math.exp(-REACH.ease * Math.min(0.2, dt));
    e.u += (u - e.u) * k;
    e.v += (v - e.v) * k;
    const lo = REACH.edge;
    const hi = 1 - REACH.edge;
    this.u0 = Math.max(lo, Math.min(this.u0, e.u));
    this.u1 = Math.min(hi, Math.max(this.u1, e.u));
    this.v0 = Math.max(lo, Math.min(this.v0, e.v));
    this.v1 = Math.min(hi, Math.max(this.v1, e.v));
  }

  /** Time passes: edges no hand has reached lately creep back in. */
  relax(dt: number) {
    const d = REACH.relax * Math.min(0.2, dt);
    const shrink = (a: "u0" | "v0", b: "u1" | "v1", min: number) => {
      const room = this.box()[b] - this.box()[a] - min;
      if (room <= 0) return;
      const s = Math.min(d, room / 2);
      this[a] += s;
      this[b] -= s;
    };
    shrink("u0", "u1", REACH.minW);
    shrink("v0", "v1", REACH.minH);
  }

  /** The box, at least its smallest size (grown around its middle). */
  box(out: Box = { u0: 0, u1: 0, v0: 0, v1: 0 }): Box {
    const grow = (a: number, b: number, min: number) => {
      const w = b - a;
      if (w >= min) return [a, b];
      const m = clamp((a + b) / 2, min / 2, 1 - min / 2);
      return [m - min / 2, m + min / 2];
    };
    const [u0, u1] = grow(this.u0, this.u1, REACH.minW);
    const [v0, v1] = grow(this.v0, this.v1, REACH.minH);
    /* eslint-disable no-param-reassign */
    out.u0 = u0;
    out.u1 = u1;
    out.v0 = v0;
    out.v1 = v1;
    /* eslint-enable no-param-reassign */
    return out;
  }
}

/** A point of the picture → the box (0..1 across and down, clamped). */
export const inBox = (b: Box, u: number, v: number) => ({
  x: clamp((u - b.u0) / Math.max(1e-6, b.u1 - b.u0), 0, 1),
  y: clamp((v - b.v0) / Math.max(1e-6, b.v1 - b.v0), 0, 1),
});

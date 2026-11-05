// Follows each hand on the camera picture, every camera frame.
//
// The hand tracker reads fewer frames than the camera shows, a frame or two
// late, and loses fists often: seen from the back, dark against a bright
// room, or blurred mid-stroke. So each hand is followed on a small grey copy
// of the camera picture: a little picture of the hand (taken where the
// tracker saw it) is found again in each new frame, near where it was. The
// tracker's readings keep it right: each one says where the hand really was
// when that frame was taken, and the follower moves by however far it had
// drifted from there.
//
// Pure: frames in (grey, 0..255), places out. Units: the picture as the
// tracker reads it, u right and v down, 0..1.

export const FOLLOW = {
  /** The grey picture's width (px); its height keeps the camera's shape. */
  width: 160,
  /** The hand's little picture (px, square)… */
  size: 16,
  /** …looked for this far around where it was (px). */
  reach: 20,
  /** A match at least this good (normalised correlation, −1..1)… */
  minScore: 0.55,
  /** …for at most this long (s) after the tracker last saw the hand. */
  most: 1.2,
  /** A tracker reading corrects the place followed at most this long (s)
   * before or after its own time. */
  match: 0.07,
  /** Each match blends this much of itself into the hand's picture. */
  learn: 0.15,
  /** Lost: looked for over the whole picture (its picture as the tracker
   * last saw it, still) for this long (s), matching at least this well. */
  refindFor: 4,
  refindScore: 0.8,
  /** Never this near (px) another hand: two fists look alike. */
  apart: 14,
  /** The tracker's place is a frame or two late: a hand moving faster than
   * this (picture heights/s) keeps its old picture. */
  stillSpeed: 1,
};

type Held = {
  /** The middle of the hand's picture (px). */
  x: number;
  y: number;
  /** From there to the palm (picture units) and to its topmost point. */
  palmU: number;
  palmV: number;
  topV: number;
  tpl: Float32Array | null;
  /** Its picture as the tracker last saw it still (never blended). */
  anchor: Float32Array | null;
  /** The tracker's last reading (s). */
  seen: number;
  /** Its last place and time (s) (the tracker's or followed). */
  t: number;
  /** Where it was followed lately (px, s). */
  past: { t: number; x: number; y: number }[];
};

/** A followed hand: its palm, topmost point and size, like a tracker reading. */
export type Followed = { u: number; v: number; top: number };

export class HandFollower {
  w = 0;

  h = 0;

  private grey: Float32Array | null = null;

  private sum: Float64Array | null = null;

  private sq: Float64Array | null = null;

  private held = new Map<string, Held>();

  reset() {
    this.held.clear();
  }

  forget(id: string) {
    this.held.delete(id);
  }

  /** Hand `id` is being followed. */
  has(id: string) {
    return !!this.held.get(id)?.tpl;
  }

  /** A new camera frame (grey 0..255, w × h). */
  frame(grey: Float32Array, w: number, h: number) {
    this.grey = grey;
    if (w !== this.w || h !== this.h || !this.sum) {
      this.w = w;
      this.h = h;
      this.sum = new Float64Array((w + 1) * (h + 1));
      this.sq = new Float64Array((w + 1) * (h + 1));
    }
    // Running sums, for each patch's mean and spread at once.
    const { sum, sq } = this;
    const W = w + 1;
    for (let y = 0; y < h; y += 1) {
      let rs = 0;
      let rq = 0;
      for (let x = 0; x < w; x += 1) {
        const g = grey[y * w + x];
        rs += g;
        rq += g * g;
        sum[(y + 1) * W + x + 1] = sum[y * W + x + 1] + rs;
        sq![(y + 1) * W + x + 1] = sq![y * W + x + 1] + rq;
      }
    }
  }

  private patch(cx: number, cy: number, out?: Float32Array) {
    const { grey, w, h } = this;
    const S = FOLLOW.size;
    const x0 = Math.round(cx - S / 2);
    const y0 = Math.round(cy - S / 2);
    if (!grey || x0 < 0 || y0 < 0 || x0 + S > w || y0 + S > h) return null;
    const p = out ?? new Float32Array(S * S);
    for (let y = 0; y < S; y += 1)
      for (let x = 0; x < S; x += 1) p[y * S + x] = grey[(y0 + y) * w + x0 + x];
    return p;
  }

  /**
   * The tracker saw hand `id` at time `t`: the middle of all its points
   * (cu, cv), its palm (pu, pv) and topmost point, moving `speed` (picture
   * heights/s).
   */
  seen(
    id: string,
    t: number,
    c: { u: number; v: number },
    palm: { u: number; v: number },
    top: number,
    speed: number,
  ) {
    let k = this.held.get(id);
    if (!k) {
      k = {
        anchor: null,
        x: 0,
        y: 0,
        palmU: 0,
        palmV: 0,
        topV: 0,
        tpl: null,
        seen: t,
        t,
        past: [],
      };
      this.held.set(id, k);
    }
    const cx = c.u * this.w;
    const cy = c.v * this.h;
    // Where it was followed when the tracker's frame was taken: the
    // follower has drifted by the difference since.
    let ref: Held["past"][number] | null = null;
    k.past.forEach((p) => {
      if (
        Math.abs(p.t - t) <= FOLLOW.match &&
        (!ref || Math.abs(p.t - t) < Math.abs(ref.t - t))
      )
        ref = p;
    });
    const r = ref as Held["past"][number] | null;
    if (r && k.tpl && t - k.seen < FOLLOW.most) {
      const dx = cx - r.x;
      const dy = cy - r.y;
      k.x += dx;
      k.y += dy;
      k.past.forEach((p) => {
        /* eslint-disable no-param-reassign */
        p.x += dx;
        p.y += dy;
        /* eslint-enable no-param-reassign */
      });
    } else {
      k.x = cx;
      k.y = cy;
      k.past.length = 0;
    }
    k.palmU = palm.u - c.u;
    k.palmV = palm.v - c.v;
    k.topV = top - c.v;
    k.seen = t;
    k.t = Math.max(k.t, t);
    if (!k.tpl || speed < FOLLOW.stillSpeed) {
      const p = this.patch(k.x, k.y, k.tpl ?? undefined);
      if (p) {
        k.tpl = p;
        if (speed < FOLLOW.stillSpeed) k.anchor = Float32Array.from(p);
      }
    }
  }

  /** How well the patch at (x0, y0) matches `tpl` (mean `tm`, spread `tn`). */
  private score(
    tpl: Float32Array,
    tm: number,
    tn: number,
    x0: number,
    y0: number,
  ) {
    const grey = this.grey!;
    const sum = this.sum!;
    const sq = this.sq!;
    const { w } = this;
    const S = FOLLOW.size;
    const n = S * S;
    const W = w + 1;
    const a = y0 * W + x0;
    const b = y0 * W + x0 + S;
    const c = (y0 + S) * W + x0;
    const d = (y0 + S) * W + x0 + S;
    const ps = sum[d] - sum[b] - sum[c] + sum[a];
    const pq = sq[d] - sq[b] - sq[c] + sq[a];
    const pv = pq - (ps * ps) / n;
    if (pv <= 1e-3) return -2;
    let cross = 0;
    for (let y = 0; y < S; y += 1) {
      const row = (y0 + y) * w + x0;
      const trow = y * S;
      for (let x = 0; x < S; x += 1) cross += grey[row + x] * tpl[trow + x];
    }
    // Σ(p − p̄)(t − t̄) = Σ p·t − p̄ Σ t, and Σ t = n·t̄.
    return (cross - ps * tm) / (Math.sqrt(pv) * tn);
  }

  /** The mean and spread of a hand's picture. */
  private static stats(tpl: Float32Array) {
    const n = tpl.length;
    let tm = 0;
    for (let i = 0; i < n; i += 1) tm += tpl[i];
    tm /= n;
    let tn = 0;
    for (let i = 0; i < n; i += 1) tn += (tpl[i] - tm) ** 2;
    return { tm, tn: Math.sqrt(tn) + 1e-6 };
  }

  /**
   * The best match of `tpl` with its middle within `R` px of (cx, cy) (all
   * of the picture if R is Infinity), every `step` px, clear of `others`.
   */
  private search(
    tpl: Float32Array,
    cx0: number,
    cy0: number,
    R: number,
    step: number,
    others: Held[],
    ok: (cx: number) => boolean = () => true,
  ) {
    const { w, h } = this;
    const S = FOLLOW.size;
    const { tm, tn } = HandFollower.stats(tpl);
    const x0a = Math.max(S / 2, Math.round(cx0 - R));
    const x0b = Math.min(w - S / 2, Math.round(cx0 + R));
    const y0a = Math.max(S / 2, Math.round(cy0 - R));
    const y0b = Math.min(h - S / 2, Math.round(cy0 + R));
    let best = -2;
    let bx = cx0;
    let by = cy0;
    for (let cy = y0a; cy <= y0b; cy += step)
      for (let cx = x0a; cx <= x0b; cx += step) {
        const clear =
          ok(cx) &&
          !others.some((o) => Math.hypot(o.x - cx, o.y - cy) < FOLLOW.apart);
        const sc = clear
          ? this.score(
              tpl,
              tm,
              tn,
              Math.round(cx - S / 2),
              Math.round(cy - S / 2),
            )
          : -2;
        if (sc > best) {
          best = sc;
          bx = cx;
          by = cy;
        }
      }
    return { best, bx, by };
  }

  /** Hand `id` in the current frame (time `t`), if it can still be followed. */
  follow(id: string, t: number): Followed | null {
    const k = this.held.get(id);
    const { grey, sum, sq } = this;
    if (!k || !k.tpl || !grey || !sum || !sq) return null;
    const away = t - k.seen;
    if (away > FOLLOW.most + FOLLOW.refindFor) return null;
    const others: Held[] = [];
    this.held.forEach((o, oid) => {
      if (oid !== id && t - o.t < 0.25) others.push(o);
    });
    let found =
      away <= FOLLOW.most
        ? this.search(k.tpl, k.x, k.y, FOLLOW.reach, 1, others)
        : { best: -2, bx: k.x, by: k.y };
    if (found.best < FOLLOW.minScore) {
      // Lost: look for it all over the picture, as the tracker last saw it.
      if (!k.anchor) return null;
      // Two fists look alike: a hand found again is on its own side of the
      // other hand (hands seldom cross), well clear of it.
      const ownSide = (cx: number) =>
        others.every((o) =>
          id === "left"
            ? cx < o.x - FOLLOW.apart * 2
            : cx > o.x + FOLLOW.apart * 2,
        );
      const wide = this.search(
        k.anchor,
        k.x,
        k.y,
        Infinity,
        2,
        others,
        ownSide,
      );
      if (wide.best < FOLLOW.refindScore) return null;
      found = this.search(k.anchor, wide.bx, wide.by, 2, 1, others, ownSide);
      k.tpl.set(k.anchor);
      k.past.length = 0;
    }
    const { bx, by } = found;
    k.x = bx;
    k.y = by;
    k.t = t;
    k.past.push({ t, x: bx, y: by });
    while (k.past.length && t - k.past[0].t > 0.3) k.past.shift();
    const p = this.patch(bx, by);
    const { tpl } = k;
    if (p)
      for (let i = 0; i < tpl.length; i += 1)
        tpl[i] += (p[i] - tpl[i]) * FOLLOW.learn;
    const cu = bx / this.w;
    const cv = by / this.h;
    return { u: cu + k.palmU, v: cv + k.palmV, top: cv + k.topV };
  }
}

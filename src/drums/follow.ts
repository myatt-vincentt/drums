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
      if (p) k.tpl = p;
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

  /** Hand `id` in the current frame (time `t`), if it can still be followed. */
  follow(id: string, t: number): Followed | null {
    const k = this.held.get(id);
    const { grey, sum, sq, w, h } = this;
    if (!k || !k.tpl || !grey || !sum || !sq) return null;
    if (t - k.seen > FOLLOW.most) return null;
    const S = FOLLOW.size;
    const n = S * S;
    const { tpl } = k;
    let tm = 0;
    for (let i = 0; i < n; i += 1) tm += tpl[i];
    tm /= n;
    let tn = 0;
    for (let i = 0; i < n; i += 1) tn += (tpl[i] - tm) ** 2;
    tn = Math.sqrt(tn) + 1e-6;
    const R = FOLLOW.reach;
    const others: Held[] = [];
    this.held.forEach((o, oid) => {
      if (oid !== id && t - o.t < 0.25) others.push(o);
    });
    let best = -2;
    let bx = k.x;
    let by = k.y;
    const near = (cx: number, cy: number) =>
      others.some((o) => Math.hypot(o.x - cx, o.y - cy) < FOLLOW.apart);
    for (let dy = -R; dy <= R; dy += 1) {
      const y0 = Math.round(k.y - S / 2 + dy);
      for (let dx = -R; dx <= R; dx += 1) {
        const x0 = Math.round(k.x - S / 2 + dx);
        const cx = k.x + dx;
        const cy = k.y + dy;
        const s =
          y0 >= 0 && y0 + S <= h && x0 >= 0 && x0 + S <= w && !near(cx, cy)
            ? this.score(tpl, tm, tn, x0, y0)
            : -2;
        if (s > best) {
          best = s;
          bx = cx;
          by = cy;
        }
      }
    }
    if (best < FOLLOW.minScore) return null;
    k.x = bx;
    k.y = by;
    k.t = t;
    k.past.push({ t, x: bx, y: by });
    while (k.past.length && t - k.past[0].t > 0.3) k.past.shift();
    const p = this.patch(bx, by);
    if (p)
      for (let i = 0; i < n; i += 1) tpl[i] += (p[i] - tpl[i]) * FOLLOW.learn;
    const cu = bx / w;
    const cv = by / h;
    return { u: cu + k.palmU, v: cv + k.palmV, top: cv + k.topV };
  }
}

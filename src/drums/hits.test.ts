import { describe, expect, it } from "vitest";

import {
  ellipseFromRim,
  firstZoneOnPath,
  STROKE,
  StrokeDetector,
  strokeVelocity,
  zoneAt,
  zoneDistance,
  type Zone,
} from "./hits";

const snare: Zone = { id: "snare", x: 0, y: 0, a: 0.1, b: 0.05, angle: 0 };
const tom: Zone = { id: "tom1", x: 0, y: 0.2, a: 0.08, b: 0.04, angle: 0 };
const ZONES = [snare, tom];
const PALM = 0.1;
const FPS = 30;

/** Readings of a tip moving from (x, y0) at `speed` palms/s (+ up). */
const run = (
  det: StrokeDetector,
  zones: Zone[],
  from: { t: number; x: number; y: number },
  speed: number,
  frames: number,
) => {
  const hits = [];
  let { t, y } = from;
  for (let i = 0; i < frames; i += 1) {
    const hit = det.push({ t, x: from.x, y, palm: PALM }, zones);
    if (hit) hits.push(hit);
    t += 1 / FPS;
    y += (speed * PALM) / FPS;
  }
  return { hits, t, y };
};

describe("zones", () => {
  it("measures distance in zone radii", () => {
    expect(zoneDistance(snare, 0.1, 0)).toBeCloseTo(1);
    expect(zoneDistance(snare, 0, 0.05)).toBeCloseTo(1);
    expect(zoneDistance(snare, 0, 0)).toBe(0);
    const turned = { ...snare, angle: Math.PI / 2 };
    expect(zoneDistance(turned, 0, 0.1)).toBeCloseTo(1);
  });

  it("picks the zone the point is deepest in", () => {
    const big: Zone = { id: "tom2", x: 0.3, y: 0, a: 0.3, b: 0.3, angle: 0 };
    // Inside both: nearer the snare's centre (in its radii) than the tom's.
    expect(zoneAt([big, snare], 0.02, 0)?.id).toBe("snare");
    expect(zoneAt([big, snare], 0.09, 0)?.id).toBe("tom2");
    expect(zoneAt([snare], 0.5, 0)).toBeNull();
  });

  it("fits the ellipse of a rim", () => {
    const pts: number[] = [];
    for (let i = 0; i < 16; i += 1) {
      const a = (i / 16) * Math.PI * 2;
      // a = 0.2 along 30°, b = 0.05
      const u = Math.cos(a) * 0.2;
      const v = Math.sin(a) * 0.05;
      const c = Math.cos(Math.PI / 6);
      const s = Math.sin(Math.PI / 6);
      pts.push(1 + u * c - v * s, 2 + u * s + v * c);
    }
    const z = ellipseFromRim("snare", 1, 2, pts);
    expect(z.a).toBeCloseTo(0.2, 5);
    expect(z.b).toBeCloseTo(0.05, 5);
    expect(z.angle).toBeCloseTo(Math.PI / 6, 5);
  });

  it("finds the first zone along a path, even between readings", () => {
    expect(firstZoneOnPath(ZONES, [0, 0.4, 0, 0.1, 0, -0.1])?.id).toBe("tom1");
    expect(firstZoneOnPath(ZONES, [0, 0.12, 0, -0.1])?.id).toBe("snare");
    expect(firstZoneOnPath(ZONES, [0.5, 0.4, 0.5, -0.4])).toBeNull();
  });
});

describe("strokes", () => {
  it("plays once on a fast downward stroke into a head, before reaching it", () => {
    const det = new StrokeDetector();
    // From above the snare (clear of the tom beside it), down at 10 palms/s.
    const { hits } = run(det, [snare], { t: 0, x: 0, y: 0.12 }, -10, 6);
    expect(hits).toHaveLength(1);
    expect(hits[0].piece).toBe("snare");
    // It fires while the tip is still above the head (y > 0.05 at that time).
    expect(hits[0].t).toBeLessThan(0.15);
  });

  it("ignores slow moves and a single noisy reading", () => {
    const det = new StrokeDetector();
    expect(run(det, ZONES, { t: 0, x: 0, y: 0.1 }, -2, 10).hits).toHaveLength(
      0,
    );
    const d2 = new StrokeDetector();
    d2.push({ t: 0, x: 0, y: 0.03, palm: PALM }, ZONES);
    d2.push({ t: 1 / 30, x: 0, y: 0.03, palm: PALM }, ZONES);
    // One reading 0.5 palms lower (15 palms/s) then still: no stroke before it.
    expect(
      d2.push(
        { t: 2 / 30, x: 0, y: 0.03 - 0.5 * PALM * 0.4, palm: PALM },
        ZONES,
      ),
    ).toBeNull();
  });

  it("ignores small quick gestures and jitter (no real stroke)", () => {
    // A quick dip of half a palm (a thumbs-up pump), many times.
    const det = new StrokeDetector();
    let hits = 0;
    let t = 0;
    for (let k = 0; k < 10; k += 1) {
      [0, -0.25, -0.5, -0.25, 0].forEach((dy) => {
        if (det.push({ t, x: 0, y: 0.03 + dy * PALM, palm: PALM }, ZONES))
          hits += 1;
        t += 1 / FPS;
      });
    }
    expect(hits).toBe(0);
    // Jitter: ±0.2 palm, every reading.
    const d2 = new StrokeDetector();
    let jit = 0;
    for (let i = 0; i < 60; i += 1)
      if (
        d2.push(
          { t: i / FPS, x: 0, y: (i % 2 ? 0.2 : -0.2) * PALM, palm: PALM },
          ZONES,
        )
      )
        jit += 1;
    expect(jit).toBe(0);
  });

  it("ignores tracking jumps", () => {
    const det = new StrokeDetector();
    det.push({ t: 0, x: 0, y: 0.5, palm: PALM }, ZONES);
    expect(det.push({ t: 1 / 30, x: 0, y: 0, palm: PALM }, ZONES)).toBeNull();
  });

  it("needs a lift before the next hit, then plays again", () => {
    const det = new StrokeDetector();
    const first = run(det, [snare], { t: 0, x: 0, y: 0.12 }, -10, 8);
    expect(first.hits).toHaveLength(1);
    // Keep pushing down (past the head): still one hit.
    const more = run(det, [snare], { t: first.t, x: 0, y: first.y }, -10, 4);
    expect(more.hits).toHaveLength(0);
    // Lift, then strike again.
    const up = run(det, [snare], { t: more.t, x: 0, y: more.y }, 8, 18);
    expect(det.armed).toBe(true);
    const again = run(det, [snare], { t: up.t, x: 0, y: up.y }, -10, 8);
    expect(again.hits).toHaveLength(1);
  });

  it("is louder for faster strokes", () => {
    expect(strokeVelocity(STROKE.startSpeed)).toBeCloseTo(STROKE.softest);
    expect(strokeVelocity(STROKE.loudSpeed)).toBeCloseTo(1);
    expect(strokeVelocity(30)).toBe(1);
    const soft = run(
      new StrokeDetector(),
      [snare],
      { t: 0, x: 0, y: 0.12 },
      -7,
      8,
    );
    const hard = run(
      new StrokeDetector(),
      [snare],
      { t: 0, x: 0, y: 0.25 },
      -14,
      8,
    );
    expect(soft.hits[0].velocity).toBeLessThan(hard.hits[0].velocity);
  });

  it("lets two sticks hit the same drum", () => {
    const a = new StrokeDetector();
    const b = new StrokeDetector();
    const ha = run(a, [snare], { t: 0, x: -0.05, y: 0.12 }, -10, 6).hits;
    const hb = run(b, [snare], { t: 0, x: 0.05, y: 0.12 }, -10, 6).hits;
    expect(ha.map((h) => h.piece)).toEqual(["snare"]);
    expect(hb.map((h) => h.piece)).toEqual(["snare"]);
  });

  it("plays the drum the stroke reaches first", () => {
    const det = new StrokeDetector();
    // Down through the tom (above) towards the snare: the tom plays.
    const { hits } = run(det, ZONES, { t: 0, x: 0, y: 0.32 }, -12, 10);
    expect(hits.map((h) => h.piece)).toEqual(["tom1"]);
  });
});

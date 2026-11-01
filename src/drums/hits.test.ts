import { describe, expect, it } from "vitest";

import {
  STROKE,
  StrokeDetector,
  strokeVelocity,
  zoneDistance,
  type Zone,
} from "./hits";

const FPS = 30;

/** Readings of a hand moving down (+) or up (−) at `speed` box heights/s. */
const run = (
  det: StrokeDetector,
  from: { t: number; x?: number; y: number },
  speed: number,
  frames: number,
  fps = FPS,
) => {
  const hits = [];
  let { t, y } = from;
  for (let i = 0; i < frames; i += 1) {
    const hit = det.push({ t, x: from.x ?? 0, y });
    if (hit) hits.push(hit);
    t += 1 / fps;
    y += speed / fps;
  }
  return { hits, t, y };
};

describe("zones", () => {
  it("measures distance in zone radii", () => {
    const z: Zone = { id: "hihat", x: 0, y: 0, a: 0.1, b: 0.05, angle: 0 };
    expect(zoneDistance(z, 0.1, 0)).toBeCloseTo(1);
    expect(zoneDistance(z, 0, 0.05)).toBeCloseTo(1);
    expect(zoneDistance({ ...z, angle: Math.PI / 2 }, 0, 0.1)).toBeCloseTo(1);
  });
});

describe("strokes", () => {
  it("plays once, early in a quick move down", () => {
    const det = new StrokeDetector();
    run(det, { t: 0, y: 0.3 }, 0, 5);
    const { hits } = run(det, { t: 5 / FPS, y: 0.3 }, 3, 8);
    expect(hits).toHaveLength(1);
    // Within the first few readings of the stroke.
    expect(hits[0].t - 5 / FPS).toBeLessThan(0.15);
  });

  it("also plays at a low reading rate (15 a second)", () => {
    const det = new StrokeDetector();
    run(det, { t: 0, y: 0.3 }, 0, 4, 15);
    expect(run(det, { t: 4 / 15, y: 0.3 }, 3, 5, 15).hits).toHaveLength(1);
  });

  it("ignores slow drifts, jitter and small dips", () => {
    expect(
      run(new StrokeDetector(), { t: 0, y: 0.2 }, 0.8, 40).hits,
    ).toHaveLength(0);
    const jitter = new StrokeDetector();
    let n = 0;
    for (let i = 0; i < 90; i += 1)
      if (jitter.push({ t: i / FPS, x: 0, y: 0.5 + (i % 2 ? 0.02 : -0.02) }))
        n += 1;
    expect(n).toBe(0);
    // A quick dip of 0.06 box heights, many times.
    const dips = new StrokeDetector();
    n = 0;
    let t = 0;
    for (let k = 0; k < 10; k += 1)
      [0, 0.03, 0.06, 0.03, 0].forEach((dy) => {
        if (dips.push({ t, x: 0, y: 0.5 + dy })) n += 1;
        t += 1 / FPS;
      });
    expect(n).toBe(0);
  });

  it("ignores tracking jumps", () => {
    const det = new StrokeDetector();
    det.push({ t: 0, x: 0, y: 0.1 });
    det.push({ t: 1 / FPS, x: 0, y: 0.1 });
    expect(det.push({ t: 2 / FPS, x: 0, y: 0.7 })).toBeNull();
    expect(det.push({ t: 3 / FPS, x: 0, y: 0.72 })).toBeNull();
  });

  it("plays once per stroke, again after a lift", () => {
    const det = new StrokeDetector();
    run(det, { t: 0, y: 0.2 }, 0, 4);
    const first = run(det, { t: 4 / FPS, y: 0.2 }, 3, 6);
    expect(first.hits).toHaveLength(1);
    // Still coming down: no second hit.
    const more = run(det, { t: first.t, y: first.y }, 3, 3);
    expect(more.hits).toHaveLength(0);
    // Back up, then down again.
    const up = run(det, { t: more.t, y: more.y }, -3, 6);
    expect(det.armed).toBe(true);
    expect(run(det, { t: up.t, y: up.y }, 3, 6).hits).toHaveLength(1);
  });

  it("is ready again after the hand rests low a moment", () => {
    const det = new StrokeDetector();
    run(det, { t: 0, y: 0.2 }, 0, 4);
    const first = run(det, { t: 4 / FPS, y: 0.2 }, 3, 6);
    run(det, { t: first.t, y: first.y }, 0, 12);
    expect(det.armed).toBe(true);
  });

  it("is louder for faster strokes", () => {
    expect(strokeVelocity(STROKE.startSpeed)).toBeCloseTo(STROKE.softest);
    expect(strokeVelocity(STROKE.loudSpeed)).toBeCloseTo(1);
    const soft = new StrokeDetector();
    run(soft, { t: 0, y: 0.2 }, 0, 4);
    const hard = new StrokeDetector();
    run(hard, { t: 0, y: 0.2 }, 0, 4);
    const s = run(soft, { t: 4 / FPS, y: 0.2 }, 2, 8).hits[0];
    const h = run(hard, { t: 4 / FPS, y: 0.2 }, 6, 8).hits[0];
    expect(s.velocity).toBeLessThan(h.velocity);
  });
});

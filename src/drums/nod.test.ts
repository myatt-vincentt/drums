import { describe, expect, it } from "vitest";

import { NOD, NodDetector } from "./nod";

const FPS = 30;

/** Feeds a pitch / yaw curve (functions of time) for `seconds`. */
const feed = (
  det: NodDetector,
  seconds: number,
  pitch: (t: number) => number,
  yaw: (t: number) => number = () => 0,
  from = 0,
) => {
  const nods = [];
  for (let i = 0; i < seconds * FPS; i += 1) {
    const t = from + i / FPS;
    const n = det.push(t, pitch(t), yaw(t));
    if (n) nods.push(n);
  }
  return nods;
};

/** A nod every `period` s: a quick dip of `depth` rad lasting `dip` s. */
const nodding = (period: number, depth: number, dip: number) => (t: number) => {
  const p = t % period;
  if (p > dip) return 0;
  return -depth * Math.sin((p / dip) * Math.PI);
};

describe("nod", () => {
  it("plays one kick per nod, early in the dip", () => {
    const det = new NodDetector();
    const nods = feed(det, 3, nodding(0.6, 0.25, 0.3));
    expect(nods).toHaveLength(5);
    // The first fires within the first third of the dip.
    expect(nods[0].t).toBeLessThan(0.1);
  });

  it("ignores holding still, slow drifts and small jitter", () => {
    expect(feed(new NodDetector(), 2, () => 0.05)).toHaveLength(0);
    expect(feed(new NodDetector(), 3, (t) => -0.3 * (t / 3))).toHaveLength(0);
    expect(
      feed(new NodDetector(), 3, (t) => 0.01 * Math.sin(t * 40)),
    ).toHaveLength(0);
  });

  it("ignores a head shake", () => {
    // Yaw swings ±0.4 rad at 2.5 Hz, pitch wobbles a little with it.
    const yaw = (t: number) => 0.4 * Math.sin(t * Math.PI * 5);
    const pitch = (t: number) => 0.06 * Math.abs(Math.sin(t * Math.PI * 5));
    expect(feed(new NodDetector(), 3, pitch, yaw)).toHaveLength(0);
  });

  it("plays louder for a faster nod", () => {
    const soft = feed(new NodDetector(), 1, nodding(1, 0.28, 0.35));
    const hard = feed(new NodDetector(), 1, nodding(1, 0.4, 0.2));
    expect(soft).toHaveLength(1);
    expect(hard).toHaveLength(1);
    expect(hard[0].velocity).toBeGreaterThan(soft[0].velocity);
    expect(hard[0].velocity).toBeLessThanOrEqual(1);
  });

  it("needs the head back up before the next nod", () => {
    const det = new NodDetector();
    // Down in two quick steps without coming up: one kick.
    const pitch = (t: number) =>
      t < 0.2 ? 0 : -Math.min(0.5, (t - 0.2) * 2.5);
    expect(feed(det, 1, pitch)).toHaveLength(1);
    expect(det.armed).toBe(false);
    feed(det, 0.3, () => -0.5 + NOD.rearm * 2, undefined, 1);
    expect(det.armed).toBe(true);
  });
});

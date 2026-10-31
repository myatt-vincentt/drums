import { describe, expect, it } from "vitest";

import { LED_RAINBOW, LED_SWAY, LedFlash } from "./led";

const run = (f: LedFlash, seconds: number, from = 0) => {
  const dt = 1 / 60;
  let t = from;
  for (let i = 0; i < Math.round(seconds / dt); i += 1) {
    t += dt;
    f.update(dt, t);
  }
  return t;
};

describe("LED flash", () => {
  it("is dark until something is hit", () => {
    const f = new LedFlash();
    run(f, 1);
    expect(f.amount).toBe(0);
  });

  it("lights at once, as loud as the hit, and eases away in about half a second", () => {
    const loud = new LedFlash();
    loud.hit("snare", 1);
    expect(loud.amount).toBeCloseTo(1, 5);
    const soft = new LedFlash();
    soft.hit("snare", 0.3);
    expect(soft.amount).toBeLessThan(0.5);
    run(loud, 0.25);
    const mid = loud.amount;
    expect(mid).toBeGreaterThan(0.15);
    expect(mid).toBeLessThan(0.5);
    run(loud, 0.3);
    expect(loud.amount).toBeLessThan(0.06);
  });

  it("gives each piece its own colour", () => {
    const red = new LedFlash();
    red.hit("kick", 1);
    expect(red.color.r).toBeGreaterThan(red.color.g * 4);
    const teal = new LedFlash();
    teal.hit("hihat", 1);
    expect(teal.color.g).toBeGreaterThan(teal.color.r * 4);
    const gold = new LedFlash();
    gold.hit("crash", 1);
    expect(gold.color.r).toBeGreaterThan(gold.color.b * 4);
  });

  it("mixes hits that overlap, and many hits stay a colour", () => {
    const f = new LedFlash();
    f.hit("kick", 1);
    f.hit("tom2", 1);
    expect(f.color.r).toBeGreaterThan(0.5);
    expect(f.color.b).toBeGreaterThan(0.5);
    for (let i = 0; i < 20; i += 1) f.hit("snare", 1);
    expect(Math.max(f.color.r, f.color.g, f.color.b)).toBeLessThanOrEqual(1.5);
  });

  it("sways its colours a little, only while lit", () => {
    const f = new LedFlash();
    run(f, 2);
    expect(f.drift).toBe(0);
    let t = 0;
    let most = 0;
    for (let i = 0; i < 400; i += 1) {
      f.hit("snare", 1);
      t = run(f, 0.25, t);
      most = Math.max(most, Math.abs(f.drift));
    }
    expect(most).toBeGreaterThan(0.04);
    expect(most).toBeLessThanOrEqual(LED_SWAY + 1e-9);
  });

  it("sweeps the rainbow after a song, then goes dark", () => {
    const f = new LedFlash();
    f.celebrate(0);
    const hues = new Set<number>();
    const dt = 1 / 60;
    for (let t = dt; t < LED_RAINBOW; t += dt) {
      f.update(dt, t);
      if (t < LED_RAINBOW * 0.6) {
        expect(f.amount).toBeGreaterThan(0.9);
        const { r, g, b } = f.color;
        hues.add(r >= g && r >= b ? 0 : g >= b ? 1 : 2);
      }
    }
    expect(hues.size).toBe(3);
    run(f, 1, LED_RAINBOW);
    expect(f.amount).toBeLessThan(0.01);
  });
});

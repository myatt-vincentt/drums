import { describe, expect, it } from "vitest";

import {
  DIP,
  dip,
  pulse,
  WHACK,
  whack,
  WHACK_LENGTH,
  wobble,
  wobbleLength,
} from "./fx";

const sample = (f: (t: number) => number, until: number) =>
  Array.from({ length: 400 }, (_, i) => f((i / 399) * until));

describe("hit motion", () => {
  it("dips fast and comes back without passing its rest", () => {
    expect(dip(0)).toBe(0);
    expect(dip(DIP.down)).toBeCloseTo(1);
    expect(dip(DIP.down + DIP.back)).toBeCloseTo(0);
    sample(dip, 0.5).forEach((v) => {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    });
  });

  it("whacks onto the head, rebounds a little higher for harder hits, then rests", () => {
    expect(whack(0, 0.5)).toBe(1);
    const lowSoft = Math.min(...sample((t) => whack(t, 0.1), WHACK_LENGTH));
    const lowHard = Math.min(...sample((t) => whack(t, 1), WHACK_LENGTH));
    expect(lowSoft).toBeLessThan(0);
    expect(lowHard).toBeLessThan(lowSoft);
    expect(whack(WHACK_LENGTH + 0.01, 1)).toBe(0);
    // Never past the head.
    sample((t) => whack(t, 1), WHACK_LENGTH).forEach((v) =>
      expect(v).toBeLessThanOrEqual(1),
    );
    expect(whack(WHACK.hold + WHACK.up, 1)).toBeCloseTo(-0.35);
  });

  it("wobbles and dies away", () => {
    const tau = 0.4;
    expect(wobble(0, tau, 2)).toBe(0);
    expect(Math.abs(wobble(wobbleLength(tau), tau, 2))).toBeLessThanOrEqual(
      0.0101,
    );
    expect(
      Math.max(...sample((t) => wobble(t, tau, 2), 2)),
    ).toBeLessThanOrEqual(1);
  });

  it("pulses up and down within its length", () => {
    expect(pulse(0, 0.1)).toBe(0);
    expect(pulse(0.03, 0.1)).toBeCloseTo(1);
    expect(pulse(0.1, 0.1)).toBeCloseTo(0);
    expect(pulse(0.2, 0.1)).toBe(0);
  });
});

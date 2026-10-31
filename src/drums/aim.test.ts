import { Ray, Vector3 } from "three";
import { describe, expect, it } from "vitest";

import { AIM, aimAlong, AimHold, HOLD, type Aim, type AimHead } from "./aim";

const UP = new Vector3(0, 1, 0);
const heads: AimHead[] = [
  {
    id: "snare",
    center: new Vector3(0.3, 0.66, -0.3),
    normal: UP,
    radius: 0.16,
  },
  {
    id: "tom2",
    center: new Vector3(-0.45, 0.63, -0.25),
    normal: UP,
    radius: 0.18,
  },
];
const newAim = (): Aim => ({
  piece: null,
  point: new Vector3(),
  normal: new Vector3(),
  reach: 0,
});
/** A ray straight down onto (x, z). */
const down = (x: number, z: number) =>
  new Ray(new Vector3(x, 2, z), new Vector3(0, -1, 0));

describe("aim", () => {
  it("aims at the head under the ray", () => {
    const a = aimAlong(down(0.3, -0.3), heads, newAim());
    expect(a.piece).toBe("snare");
    expect(a.point.y).toBeCloseTo(0.66);
    expect(a.reach).toBeCloseTo(0);
  });

  it("pulls a near miss in towards the head's middle", () => {
    // 1.3 radii out from the snare's middle.
    const a = aimAlong(down(0.3 + 0.16 * 1.3, -0.3), heads, newAim());
    expect(a.piece).toBe("snare");
    const out = Math.hypot(a.point.x - 0.3, a.point.z + 0.3) / 0.16;
    expect(out).toBeLessThan(1);
    expect(out).toBeGreaterThan(0.5);
  });

  it("aims in the air past the reach", () => {
    const a = aimAlong(
      down(0.3 + 0.16 * (AIM.reach + 0.2), -0.3),
      heads,
      newAim(),
    );
    expect(a.piece).toBeNull();
    expect(a.point.y).toBeCloseTo(AIM.restHeight);
  });

  it("picks the nearer head (in radii) where two are in reach", () => {
    expect(aimAlong(down(-0.2, -0.27), heads, newAim()).piece).toBe("tom2");
    expect(aimAlong(down(0.05, -0.29), heads, newAim()).piece).toBe("snare");
  });
});

describe("aim hold", () => {
  const PALM = 0.2;
  const step = (h: AimHold, y: number, speed: number, n = 1, x = 0) => {
    for (let i = 0; i < n; i += 1) h.update(1 / 30, x, y, speed, PALM);
  };

  it("follows a hand that moves slowly", () => {
    const h = new AimHold();
    step(h, 0, 0);
    step(h, 0.3, 1, 30);
    expect(h.y).toBeCloseTo(0.3, 2);
    expect(h.stroke).toBe(0);
  });

  it("holds the aim through a fast stroke and swings the stick down", () => {
    const h = new AimHold();
    step(h, 0.3, 0, 10);
    // Down one palm in 4 readings, fast.
    for (let i = 1; i <= 4; i += 1) step(h, 0.3 - (PALM * i) / 4, 8);
    expect(h.y).toBeCloseTo(0.3, 5);
    expect(h.stroke).toBeCloseTo(1, 5);
    // Back up: the stick lifts and the aim stays.
    step(h, 0.3, 8, 4);
    expect(h.stroke).toBe(0);
    expect(h.y).toBeCloseTo(0.3, 3);
  });

  it("moves the aim down after resting low for a moment", () => {
    const h = new AimHold();
    step(h, 0.3, 0, 10);
    step(h, 0.3 - PALM, 9);
    step(h, 0.3 - PALM, 0.2, Math.ceil(HOLD.release * 30) + 30);
    expect(h.y).toBeCloseTo(0.3 - PALM, 2);
    expect(h.stroke).toBeLessThan(0.05);
  });
});

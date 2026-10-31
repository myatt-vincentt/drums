import { Vector3 } from "three";
import { describe, expect, it } from "vitest";

import { fitFov, phoneness, pieceShift, vfovFromH, viewPose } from "./layout";

describe("layout", () => {
  it("blends laptop to phone by the screen's shape", () => {
    expect(phoneness(16 / 9)).toBe(0);
    expect(phoneness(9 / 19.5)).toBe(1);
    const v = new Vector3();
    expect(pieceShift("hihat", 16 / 9, v).length()).toBeCloseTo(0);
    expect(pieceShift("hihat", 0.46, v).toArray()).toEqual([-0.1, 0, -0.08]);
    expect(pieceShift("kick", 0.46, v).length()).toBeCloseTo(0);
  });

  it("uses the seat cameras at the two ends", () => {
    const pose = { pos: new Vector3(), target: new Vector3(), fov: 0 };
    viewPose("drummer", 16 / 9, pose);
    expect(pose.pos.toArray()).toEqual([0, 1.47, -1.3]);
    expect(pose.fov).toBeCloseTo(54);
    viewPose("drummer", 0.46, pose);
    expect(pose.target.toArray()).toEqual([0, 1.12, 0.42]);
    expect(pose.fov).toBeCloseTo(vfovFromH(62, 0.46));
  });

  it("widens the view just enough to keep every point on screen", () => {
    const inside = [new Vector3(0, 0, -5)];
    expect(fitFov(50, 1, inside)).toBe(50);
    // A point 45° up must sit inside the top margin.
    const high = [new Vector3(0, 1, -1)];
    const fov = fitFov(50, 1, high);
    expect(Math.tan(((fov / 2) * Math.PI) / 180) * 0.94).toBeCloseTo(1, 5);
    // Sideways is measured against the width.
    const wide = fitFov(30, 2, [new Vector3(2, 0, -1)]);
    expect(Math.tan(((wide / 2) * Math.PI) / 180) * 2 * 0.94).toBeCloseTo(2, 5);
  });
});

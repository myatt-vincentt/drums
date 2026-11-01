import { describe, expect, it } from "vitest";

import { HandPairer } from "./pair";

describe("which hand is which", () => {
  it("starts by side, then keeps each hand by where it was", () => {
    const p = new HandPairer();
    // Readings may come in either order.
    expect(
      p.update(0, [
        { u: 0.8, v: 0.5 },
        { u: 0.2, v: 0.5 },
      ]),
    ).toEqual({ left: 1, right: 0 });
    // The right hand crosses over to the left of the picture, step by step.
    let r = { left: -1, right: -1 };
    for (let k = 1; k <= 10; k += 1)
      r = p.update(k / 30, [
        { u: 0.2, v: 0.6 },
        { u: 0.8 - k * 0.07, v: 0.3 },
      ]);
    expect(r).toEqual({ left: 0, right: 1 });
  });

  it("drops one hand found twice", () => {
    const p = new HandPairer();
    p.update(0, [{ u: 0.3, v: 0.5 }]);
    const r = p.update(1 / 30, [
      { u: 0.31, v: 0.52 },
      { u: 0.36, v: 0.45 },
    ]);
    expect(r.left).toBe(0);
    expect(r.right).toBe(-1);
  });

  it("knows a hand coming back where it was", () => {
    const p = new HandPairer();
    p.update(0, [
      { u: 0.4, v: 0.5 },
      { u: 0.8, v: 0.5 },
    ]);
    // The left hand drifts right of the middle, is lost, and comes back.
    p.update(1, [
      { u: 0.55, v: 0.5 },
      { u: 0.85, v: 0.5 },
    ]);
    expect(p.update(2, [{ u: 0.56, v: 0.5 }])).toEqual({ left: 0, right: -1 });
  });
});

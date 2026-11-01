import { describe, expect, it } from "vitest";

import {
  HandAim,
  LAYOUT,
  nextAim,
  ReachBox,
  REACH,
  regionAt,
  type Box,
} from "./aim";

const BOX: Box = { u0: 0, u1: 1, v0: 0, v1: 1 };

describe("regions", () => {
  it("lays the kit out like you see it", () => {
    expect(regionAt(0.2, 0.2)).toBe("hihat");
    expect(regionAt(0.8, 0.2)).toBe("crash");
    expect(regionAt(0.1, 0.8)).toBe("snare");
    expect(regionAt(0.5, 0.8)).toBe("tom1");
    expect(regionAt(0.9, 0.8)).toBe("tom2");
  });

  it("changes piece only clearly past a border", () => {
    const m = LAYOUT.margin;
    // On the snare, wavering just past the line to the tom: still the snare.
    expect(nextAim("snare", LAYOUT.drums[0] + m * 0.5, 0.8)).toBe("snare");
    expect(nextAim("snare", LAYOUT.drums[0] + m * 1.5, 0.8)).toBe("tom1");
    // Up from the snare a little: still the snare; well up: the hi-hat.
    expect(nextAim("snare", 0.2, LAYOUT.row - m * 0.5)).toBe("snare");
    expect(nextAim("snare", 0.2, LAYOUT.row - m * 1.5)).toBe("hihat");
    expect(nextAim(null, 0.2, 0.2)).toBe("hihat");
  });
});

describe("reach", () => {
  it("grows to where the hands go, never smaller than its least size", () => {
    const r = new ReachBox();
    for (let i = 0; i < 60; i += 1) r.see("left", 0.05, 0.05, 1 / 30);
    const b = r.box();
    expect(b.u0).toBeCloseTo(REACH.edge, 2);
    expect(b.v0).toBeCloseTo(REACH.edge, 2);
    expect(b.u1).toBeCloseTo(REACH.start.u1);
    const tiny = new ReachBox();
    tiny.u0 = 0.45;
    tiny.u1 = 0.5;
    const t = tiny.box();
    expect(t.u1 - t.u0).toBeCloseTo(REACH.minW);
  });

  it("is not stretched by one stray reading", () => {
    const r = new ReachBox();
    r.see("left", 0.5, 0.5, 1 / 30);
    r.see("left", 0.02, 0.5, 1 / 30);
    r.see("left", 0.5, 0.5, 1 / 30);
    expect(r.box().u0).toBeGreaterThan(0.15);
  });
});

describe("hand aim", () => {
  it("follows the hand and names the piece under it", () => {
    const a = new HandAim();
    for (let i = 0; i < 10; i += 1) a.update(1 / 30, 0.85, 0.2, BOX);
    expect(a.piece).toBe("crash");
    // A slow move down (not a stroke) takes the aim with it.
    for (let i = 1; i <= 40; i += 1)
      a.update(1 / 30, 0.85, 0.2 + i * 0.0175, BOX);
    expect(a.piece).toBe("tom2");
  });

  it("follows again after a quick move down that stays down", () => {
    const a = new HandAim();
    for (let i = 0; i < 10; i += 1) a.update(1 / 30, 0.85, 0.2, BOX);
    for (let i = 0; i < 20; i += 1) a.update(1 / 30, 0.85, 0.85, BOX);
    expect(a.piece).toBe("tom2");
  });

  it("holds through a quick stroke down from a cymbal", () => {
    const a = new HandAim();
    for (let i = 0; i < 10; i += 1) a.update(1 / 30, 0.2, 0.35, BOX);
    expect(a.piece).toBe("hihat");
    // Down fast, well into the snare's region, and back up.
    [0.45, 0.6, 0.72, 0.75, 0.6, 0.45, 0.35].forEach((v) => {
      a.update(1 / 30, 0.2, v, BOX);
      expect(a.piece).toBe("hihat");
    });
  });
});

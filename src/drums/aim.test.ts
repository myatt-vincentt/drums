import { describe, expect, it } from "vitest";

import {
  AIM,
  cymbalAt,
  HandAim,
  landedOn,
  pieceAt,
  ReachBox,
  REACH,
  type Box,
} from "./aim";

const BOX: Box = { u0: 0, u1: 1, v0: 0, v1: 1 };

describe("the kit from the seat", () => {
  it("lays the pieces out as you see them", () => {
    expect(pieceAt(0.1, 0.15)).toBe("hihat");
    expect(pieceAt(0.5, 0.15)).toBe("tom1");
    expect(pieceAt(0.9, 0.05)).toBe("crash");
    expect(pieceAt(0.15, 0.95)).toBe("snare");
    expect(pieceAt(0.95, 0.95)).toBe("tom2");
  });

  it("plays a stroke where it lands", () => {
    expect(landedOn(0.15, 0.95, BOX).piece).toBe("snare");
    expect(landedOn(0.95, 0.95, BOX).piece).toBe("tom2");
  });

  it("meets a cymbal only from up high on its side", () => {
    expect(cymbalAt(0.1, 0)).toBe("hihat");
    expect(cymbalAt(0.9, 0)).toBe("crash");
    expect(cymbalAt(0.5, 0)).toBeNull();
    expect(cymbalAt(0.1, AIM.cymbalHigh + 0.1)).toBeNull();
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
  it("follows the hand across the kit", () => {
    const a = new HandAim();
    a.update(1 / 30, 0.15, 0.95, BOX);
    expect(a.piece).toBe("snare");
    for (let i = 0; i < 30; i += 1)
      a.update(1 / 30, 0.15 + i * 0.03, 0.95, BOX);
    expect(a.piece).toBe("tom2");
    expect(a.x).toBeGreaterThan(0.9);
  });

  it("lifts the stick when the hand lifts, and moves out when it stays up", () => {
    const a = new HandAim();
    a.update(1 / 30, 0.15, 0.95, BOX);
    a.update(1 / 30, 0.15, 0.6, BOX);
    expect(a.lift).toBeGreaterThan(0.25);
    expect(a.piece).toBe("snare");
    for (let i = 0; i < 60; i += 1) a.update(1 / 30, 0.0, 0.3, BOX);
    expect(a.lift).toBeLessThan(0.05);
    expect(a.piece).toBe("hihat");
  });

  it("sets its level where a stroke lands", () => {
    const a = new HandAim();
    a.update(1 / 30, 0.95, 0.4, BOX);
    a.land(0.95, 0.95, BOX);
    expect(a.lift).toBe(0);
    expect(a.piece).toBe("tom2");
  });
});

import { describe, expect, it } from "vitest";

import { HIHAT, HiHatControl, type HatInput } from "./hihat";
import type { Zone } from "./hits";

const hat: Zone = { id: "hihat", x: -0.3, y: 0, a: 0.08, b: 0.03, angle: 0 };
const stick = (over: Partial<HatInput> = {}): HatInput => ({
  id: "left",
  present: true,
  x: hat.x,
  y: hat.y + 0.01,
  speed: 0.5,
  ...over,
});

/** Runs a control for `seconds` at 30 readings a second. */
const hold = (
  c: HiHatControl,
  from: number,
  seconds: number,
  inputs: HatInput[],
) => {
  const events = [];
  let t = from;
  for (; t < from + seconds; t += 1 / 30) {
    const e = c.update(t, inputs, hat);
    if (e) events.push(e);
  }
  return { events, t };
};

describe("hi-hat", () => {
  it("starts open and closes after a still rest over it", () => {
    const c = new HiHatControl();
    expect(c.closed).toBe(false);
    const short = hold(c, 0, HIHAT.holdS - 0.06, [stick()]);
    expect(short.events).toEqual([]);
    const rest = hold(c, short.t, 0.2, [stick()]);
    expect(rest.events).toEqual(["close"]);
    expect(c.closed).toBe(true);
    expect(c.by).toBe("left");
  });

  it("doesn't close for a moving stick or one beside the hats", () => {
    const c = new HiHatControl();
    expect(hold(c, 0, 1, [stick({ speed: 6 })]).events).toEqual([]);
    expect(hold(c, 1, 1, [stick({ x: hat.x + 0.3 })]).events).toEqual([]);
  });

  it("stays closed through small lifts and opens when lifted clearly away", () => {
    const c = new HiHatControl();
    const { t } = hold(c, 0, 0.5, [stick()]);
    expect(c.closed).toBe(true);
    // A stroke's lift (about one hat radius) keeps it closed.
    const lift = hold(c, t, 0.5, [stick({ y: hat.y + hat.a, speed: 8 })]);
    expect(lift.events).toEqual([]);
    // Well above: it opens.
    const away = hold(c, lift.t, 0.5, [stick({ y: hat.y + hat.a * 3.5 })]);
    expect(away.events).toEqual(["open"]);
    expect(c.closed).toBe(false);
  });

  it("opens when the closing stick is lost, not for the other stick", () => {
    const c = new HiHatControl();
    const other: HatInput = { ...stick(), id: "right", x: 0.4, speed: 9 };
    const { t } = hold(c, 0, 0.5, [stick(), other]);
    expect(c.closed).toBe(true);
    const busy = hold(c, t, 0.3, [stick(), { ...other, x: 0.6 }]);
    expect(busy.events).toEqual([]);
    const lost = hold(c, busy.t, HIHAT.lostS + 0.1, [
      stick({ present: false }),
      other,
    ]);
    expect(lost.events).toEqual(["open"]);
  });

  it("opens at once when a held pointer lets go", () => {
    const c = new HiHatControl();
    hold(c, 0, 0.5, [stick({ id: "pointer", speed: 0 })]);
    expect(c.by).toBe("pointer");
    expect(c.release("left")).toBeNull();
    expect(c.release("pointer")).toBe("open");
    expect(c.closed).toBe(false);
  });
});

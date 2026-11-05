import { describe, expect, it } from "vitest";

import { Players, type PlayHit } from "./play";

const FPS = 30;

/** Both hands, held, then one hand strokes from `from` down to `to` (picture v) at `u`. */
const strokeAt = (
  side: "left" | "right",
  u: number,
  from: number,
  to: number,
) => {
  const p = new Players();
  const other = side === "left" ? 0.8 : 0.2;
  const hits: PlayHit[] = [];
  let t = 0;
  const read = (v: number) => {
    const me = { u, v };
    const them = { u: other, v: 0.7 };
    hits.push(...p.update(t, side === "left" ? [me, them] : [them, me]).hits);
    t += 1 / FPS;
  };
  for (let i = 0; i < 20; i += 1) read(from);
  for (let v = from; v < to; v += 0.08) read(v);
  for (let i = 0; i < 6; i += 1) read(to);
  return hits;
};

describe("players", () => {
  it("plays a drum where a stroke lands", () => {
    const hits = strokeAt("left", 0.3, 0.45, 0.75);
    expect(hits).toHaveLength(1);
    expect(hits[0].side).toBe("left");
    expect(hits[0].how).toBe("land");
  });

  it("plays the crash for a stroke from up high on the right", () => {
    const hits = strokeAt("right", 0.78, 0.12, 0.6);
    expect(hits).toHaveLength(1);
    expect(hits[0].piece).toBe("crash");
    expect(hits[0].how).toBe("cymbal");
  });

  it("plays the hi-hat for a left hand back from out of the top", () => {
    const p = new Players();
    let t = 0;
    const hits: PlayHit[] = [];
    // The left hand rises fast and leaves through the top…
    for (let v = 0.6; v > 0.1; v -= 0.1, t += 1 / FPS)
      hits.push(
        ...p.update(t, [
          { u: 0.3, v },
          { u: 0.75, v: 0.7 },
        ]).hits,
      );
    for (let i = 0; i < 8; i += 1, t += 1 / FPS)
      hits.push(...p.update(t, [{ u: 0.75, v: 0.7 }]).hits);
    // …and comes back.
    hits.push(
      ...p.update(t, [
        { u: 0.3, v: 0.15 },
        { u: 0.75, v: 0.7 },
      ]).hits,
    );
    expect(hits.map((h) => [h.side, h.piece, h.how])).toEqual([
      ["left", "hihat", "top"],
    ]);
  });
});

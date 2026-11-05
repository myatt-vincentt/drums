import { describe, expect, it } from "vitest";

import {
  STROKE,
  StrokeDetector,
  strokeVelocity,
  zoneDistance,
  type Zone,
} from "./hits";

const FPS = 30;

/** Readings of a hand moving down (+) or up (−) at `speed` box heights/s. */
const run = (
  det: StrokeDetector,
  from: { t: number; x?: number; y: number },
  speed: number,
  frames: number,
  fps = FPS,
) => {
  const hits = [];
  let { t, y } = from;
  for (let i = 0; i < frames; i += 1) {
    const hit = det.push({ t, x: from.x ?? 0, y });
    if (hit) hits.push(hit);
    t += 1 / fps;
    y += speed / fps;
  }
  return { hits, t, y };
};

describe("zones", () => {
  it("measures distance in zone radii", () => {
    const z: Zone = { id: "hihat", x: 0, y: 0, a: 0.1, b: 0.05, angle: 0 };
    expect(zoneDistance(z, 0.1, 0)).toBeCloseTo(1);
    expect(zoneDistance(z, 0, 0.05)).toBeCloseTo(1);
    expect(zoneDistance({ ...z, angle: Math.PI / 2 }, 0, 0.1)).toBeCloseTo(1);
  });
});

/** Down at `speed` for `frames`, then still for a few frames: the stroke lands. */
const stroke = (
  det: StrokeDetector,
  from: { t: number; y: number },
  speed: number,
  frames: number,
) => {
  const down = run(det, from, speed, frames);
  const still = run(det, { t: down.t, y: down.y }, 0, 4);
  return { hits: [...down.hits, ...still.hits], t: still.t, y: still.y };
};

describe("strokes", () => {
  it("plays once, where a quick move down lands", () => {
    const det = new StrokeDetector();
    run(det, { t: 0, y: 0.2 }, 0, 4);
    const s = stroke(det, { t: 4 / FPS, y: 0.2 }, 3, 6);
    expect(s.hits).toHaveLength(1);
    expect(s.hits[0].y).toBeGreaterThan(0.45);
  });

  it("ignores slow drifts and small wobbles", () => {
    const det = new StrokeDetector();
    expect(stroke(det, { t: 0, y: 0.2 }, 0.5, 30).hits).toHaveLength(0);
    expect(stroke(det, { t: 2, y: 0.5 }, 3, 1).hits).toHaveLength(0);
  });

  it("plays again only after the hand lifts or rests", () => {
    const det = new StrokeDetector();
    run(det, { t: 0, y: 0.2 }, 0, 4);
    const first = stroke(det, { t: 4 / FPS, y: 0.2 }, 3, 6);
    expect(first.hits).toHaveLength(1);
    const up = run(det, { t: first.t, y: first.y }, -3, 6);
    const second = stroke(det, { t: up.t, y: up.y }, 3, 6);
    expect(second.hits).toHaveLength(1);
  });

  it("lands a stroke the tracker lost on its way down", () => {
    const det = new StrokeDetector();
    run(det, { t: 0, y: 0.2 }, 0, 4);
    const d = run(det, { t: 4 / FPS, y: 0.2 }, 3, 3);
    // Lost for 0.2 s, back lower.
    const hit = det.push({ t: d.t + 0.2, x: 0, y: d.y + 0.25 });
    expect(hit).not.toBeNull();
  });

  it("calls out where a stroke begins", () => {
    const det = new StrokeDetector();
    run(det, { t: 0, y: 0.2 }, 0, 4);
    let began = 0;
    let t = 4 / FPS;
    for (let y = 0.2; y < 0.6; y += 0.1, t += 1 / FPS) {
      det.push({ t, x: 0, y });
      if (det.started) began += 1;
    }
    expect(began).toBe(1);
    expect(det.from.y).toBeCloseTo(0.2, 1);
  });

  it("is louder for faster strokes", () => {
    const soft = new StrokeDetector();
    const hard = new StrokeDetector();
    run(soft, { t: 0, y: 0.2 }, 0, 4);
    run(hard, { t: 0, y: 0.2 }, 0, 4);
    const s = stroke(soft, { t: 4 / FPS, y: 0.2 }, 2, 6).hits[0];
    const h = stroke(hard, { t: 4 / FPS, y: 0.2 }, 6, 3).hits[0];
    expect(s.velocity).toBeLessThan(h.velocity);
    expect(strokeVelocity(STROKE.loudSpeed)).toBeCloseTo(1);
  });
});

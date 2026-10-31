import { describe, expect, it } from "vitest";

import { CHARTS, chartById, secondsPerBeat } from "./songs";
import { COUNT_IN_BARS, judge, Session, starsFor, WINDOW } from "./session";

const PIECES = ["kick", "snare", "tom1", "tom2", "hihat", "crash"];

describe("charts", () => {
  it("are all well formed", () => {
    expect(CHARTS.map((c) => c.id)).toEqual([
      "birthday",
      "rock",
      "disco",
      "fill",
      "ballad",
    ]);
    CHARTS.forEach((c) => {
      const end = c.bars * c.beatsPerBar;
      c.notes.forEach((n, i) => {
        expect(PIECES).toContain(n.piece);
        expect(n.beat).toBeGreaterThanOrEqual(0);
        expect(n.beat).toBeLessThan(end);
        if (i > 0) expect(n.beat).toBeGreaterThan(c.notes[i - 1].beat);
      });
      [...c.melody, ...c.bass].forEach((tone) => {
        expect(tone.beat).toBeGreaterThanOrEqual(-c.beatsPerBar);
        expect(tone.beat + tone.length).toBeLessThanOrEqual(end + 0.001);
      });
      expect(c.bass.length).toBeGreaterThan(0);
      // Every song ends on the crash.
      expect(c.notes[c.notes.length - 1].piece).toBe("crash");
    });
  });

  it("plays Happy Birthday in 3/4: kick on 1, hi-hat and snare on 2 and 3", () => {
    const hb = chartById("birthday")!;
    expect(hb.beatsPerBar).toBe(3);
    expect(hb.melody[0].beat).toBeLessThan(0); // the pickup
    hb.notes.slice(0, -1).forEach((n) => {
      const inBar = n.beat % 3;
      expect(n.piece).toBe(
        inBar === 0 ? "kick" : inBar === 1 ? "hihat" : "snare",
      );
    });
  });

  it("keeps each beat's character", () => {
    const at = (id: string, bar: number) =>
      chartById(id)!
        .notes.filter((n) => Math.floor(n.beat / 4) === bar)
        .map((n) => [n.beat % 4, n.piece]);
    // Rock: kick on 1 and 3, snare on 2 and 4, hi-hat on the eighths between.
    expect(at("rock", 0)).toEqual([
      [0, "kick"],
      [0.5, "hihat"],
      [1, "snare"],
      [1.5, "hihat"],
      [2, "kick"],
      [2.5, "hihat"],
      [3, "snare"],
      [3.5, "hihat"],
    ]);
    // The fill: snare → rack tom → floor tom → crash after a groove bar.
    expect(at("fill", 1).map(([, p]) => p)).toEqual([
      "snare",
      "snare",
      "tom1",
      "tom1",
      "tom2",
      "tom2",
      "crash",
    ]);
    // The ballad: big snare on 3.
    expect(at("ballad", 0)).toEqual([
      [0, "kick"],
      [1, "hihat"],
      [2, "snare"],
      [3, "hihat"],
    ]);
    // Disco: the hi-hat on every offbeat.
    expect(
      at("disco", 0)
        .filter(([b]) => (b as number) % 1 === 0.5)
        .every(([, p]) => p === "hihat"),
    ).toBe(true);
  });
});

describe("timing judge", () => {
  it("judges by how close the hit lands", () => {
    expect(judge(0)).toBe("perfect");
    expect(judge(-WINDOW.perfect)).toBe("perfect");
    expect(judge(WINDOW.perfect + 0.01)).toBe("good");
    expect(judge(-WINDOW.good)).toBe("good");
    expect(judge(WINDOW.good + 0.01)).toBe("miss");
  });

  it("gives 1–3 stars", () => {
    expect(starsFor(["perfect", "perfect", "good"])).toBe(3);
    expect(starsFor(["perfect", "good", "miss"])).toBe(2);
    expect(starsFor(["miss", "miss", "good"])).toBe(1);
  });
});

describe("session", () => {
  const rock = chartById("rock")!;
  const spb = secondsPerBeat(rock);
  const countIn = COUNT_IN_BARS * rock.beatsPerBar * spb;

  it("Play: judges hits on time, early and late, and misses the rest", () => {
    const s = new Session(rock, "play", 1, 0);
    const t = (i: number) => countIn + rock.notes[i].beat * spb;
    expect(s.hit("kick", t(0) + 0.02)).toBe("perfect");
    expect(s.hit("hihat", t(1) - 0.1)).toBe("good");
    expect(s.hit("tom2", t(2))).toBeNull(); // the wrong piece plays nothing
    s.update(t(3) + 1);
    expect(s.results.slice(0, 4)).toEqual(["perfect", "good", "miss", "miss"]);
    expect(s.events.slice(0, 4).map((e) => e.result)).toEqual([
      "perfect",
      "good",
      "miss",
      "miss",
    ]);
  });

  it("Play: runs slower on the slow speed", () => {
    const s = new Session(rock, "play", 0.75, 0);
    expect(s.secondsPerBeat).toBeCloseTo(spb / 0.75);
  });

  it("Play: ends with stars", () => {
    const s = new Session(rock, "play", 1, 0);
    rock.notes.forEach((n) => s.hit(n.piece, countIn + n.beat * spb));
    s.update(countIn + (rock.bars * 4 + 1) * spb);
    expect(s.done).toBe(true);
    expect(s.stars).toBe(3);
  });

  it("Learn: waits at each note until the right piece is hit", () => {
    const s = new Session(rock, "learn", 1, 0);
    s.update(100);
    expect(s.waiting).toBe(true);
    expect(s.beat).toBe(rock.notes[0].beat);
    expect(s.hit("snare", 100)).toBeNull();
    expect(s.hit("kick", 100.1)).toBe("good");
    expect(s.next).toBe(1);
    // It moves on to the next note, and waits again.
    s.update(200);
    expect(s.beat).toBe(rock.notes[1].beat);
    rock.notes.slice(1).forEach((n, i) => {
      s.update(300 + i);
      s.hit(n.piece, 300 + i);
    });
    s.update(1000);
    expect(s.done).toBe(true);
  });

  it("pauses where it is and goes on after a count-in", () => {
    const s = new Session(rock, "play", 1, 0);
    s.update(countIn + 1 * spb);
    const at = s.beat;
    s.pause(countIn + 1 * spb);
    s.update(countIn + 50);
    expect(s.beat).toBeCloseTo(at);
    expect(s.results.filter((r) => r === "miss").length).toBeLessThan(4);
    const bar = rock.beatsPerBar * spb;
    s.resume(100, bar);
    s.update(100 + bar / 2);
    expect(s.beat).toBeCloseTo(at);
    expect(s.timeOf(at + 1, 100 + bar / 2)).toBeCloseTo(100 + bar + spb);
    s.update(100 + bar + spb);
    expect(s.beat).toBeCloseTo(at + 1);
  });
});

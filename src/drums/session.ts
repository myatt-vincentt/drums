// A song being learnt or played (pure: times in seconds on the audio clock).
//
// Learn: the song moves at its tempo up to the next note to play and waits
// there until the right piece is hit; nothing can be failed. Play: the song
// runs at its tempo (or slower) and every note is judged by how close the
// hit lands: perfect, good, or missed.
import { secondsPerBeat, type Chart } from "./songs";
import type { PieceId } from "./pieces";

export type Mode = "learn" | "play";
export type Judgement = "perfect" | "good" | "miss";

/** Timing windows (s either side of the note). */
export const WINDOW = { perfect: 0.07, good: 0.16 };

/** How a hit `offset` seconds off the note is judged. */
export const judge = (offset: number): Judgement => {
  const d = Math.abs(offset);
  if (d <= WINDOW.perfect) return "perfect";
  if (d <= WINDOW.good) return "good";
  return "miss";
};

/** Stars for a finished song (1–3), from how well its notes were played. */
const POINTS: Record<Judgement, number> = { perfect: 1, good: 0.6, miss: 0 };

export const starsFor = (results: readonly (Judgement | null)[]) => {
  const n = results.length || 1;
  const score = results.reduce((sum, r) => sum + (r ? POINTS[r] : 0), 0) / n;
  if (score >= 0.8) return 3;
  if (score >= 0.5) return 2;
  return 1;
};

export type JudgeEvent = {
  index: number;
  piece: PieceId;
  result: Judgement;
  at: number;
};

/** In Learn, a hit this early (beats) on the right piece still counts. */
const LEARN_EARLY = 0.6;
/** The count-in before the first downbeat (bars). */
export const COUNT_IN_BARS = 1;

export class Session {
  readonly chart: Chart;

  readonly mode: Mode;

  readonly speed: number;

  /** Each note's result (Learn: "good" once played). */
  readonly results: (Judgement | null)[];

  /** The next note to play (Learn) / the earliest not yet judged (Play). */
  next = 0;

  /** The song's position (beats from the first downbeat). */
  beat: number;

  done = false;

  /** Judgements not yet shown (the caller drains them). */
  events: JudgeEvent[] = [];

  private last: number;

  private readonly spb: number;

  constructor(chart: Chart, mode: Mode, speed: number, now: number) {
    this.chart = chart;
    this.mode = mode;
    this.speed = mode === "learn" ? 1 : speed;
    this.spb = secondsPerBeat(chart, this.speed);
    this.results = chart.notes.map(() => null);
    this.beat = -COUNT_IN_BARS * chart.beatsPerBar;
    this.last = now;
  }

  /** Seconds per beat. */
  get secondsPerBeat() {
    return this.spb;
  }

  /** Where the song may run to now (Learn waits at the next note). */
  get limit() {
    if (this.mode === "play" || this.next >= this.chart.notes.length)
      return Infinity;
    return this.chart.notes[this.next].beat;
  }

  /** Learn: the song is waiting at a note. */
  get waiting() {
    return (
      this.mode === "learn" && !this.done && this.beat >= this.limit - 1e-6
    );
  }

  /** The audio time of a beat (from the song's position now). */
  timeOf(beat: number, now: number) {
    return now + (beat - this.beat) * this.spb;
  }

  /** Moves the song on to `now`. */
  update(now: number) {
    const dt = Math.max(0, now - this.last);
    this.last = now;
    if (this.done) return;
    this.beat = Math.min(this.limit, this.beat + dt / this.spb);
    const { notes } = this.chart;
    if (this.mode === "play") {
      // Notes whose window has passed are missed.
      while (this.next < notes.length) {
        const late = (this.beat - notes[this.next].beat) * this.spb;
        if (this.results[this.next] === null && late <= WINDOW.good) break;
        if (this.results[this.next] === null) {
          this.results[this.next] = "miss";
          this.events.push({
            index: this.next,
            piece: notes[this.next].piece,
            result: "miss",
            at: now,
          });
        }
        this.next += 1;
      }
    }
    const end = this.chart.bars * this.chart.beatsPerBar;
    if (
      this.next >= notes.length &&
      this.beat >= Math.min(end, notes[notes.length - 1].beat + 1)
    )
      this.done = true;
  }

  /** A piece was hit at `now`; returns its judgement (or null if it played nothing). */
  hit(piece: PieceId, now: number): Judgement | null {
    this.update(now);
    if (this.done) return null;
    const { notes } = this.chart;
    if (this.mode === "learn") {
      const note = notes[this.next];
      if (!note || note.piece !== piece || note.beat - this.beat > LEARN_EARLY)
        return null;
      this.results[this.next] = "good";
      this.events.push({ index: this.next, piece, result: "good", at: now });
      this.beat = Math.max(this.beat, note.beat);
      this.next += 1;
      return "good";
    }
    // Play: the nearest note of that piece still to judge, within the window.
    let best = -1;
    let bestOff = Infinity;
    for (let i = this.next; i < notes.length; i += 1) {
      const off = (this.beat - notes[i].beat) * this.spb;
      if (off < -WINDOW.good) break;
      if (
        notes[i].piece === piece &&
        this.results[i] === null &&
        Math.abs(off) < Math.abs(bestOff)
      ) {
        best = i;
        bestOff = off;
      }
    }
    if (best < 0) return null;
    const result = judge(bestOff);
    if (result === "miss") return null;
    this.results[best] = result;
    this.events.push({ index: best, piece, result, at: now });
    return result;
  }

  get stars() {
    return starsFor(this.results);
  }
}

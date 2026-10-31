// The songs and beats to learn (pure data): what the player plays (one
// piece at a time) and the synth backing (melody and bass) that goes with it.
// Times are in beats from the first downbeat; the backing may start before
// it (a pickup), during the one-bar count-in.
import type { PieceId } from "./pieces";

export type Note = { beat: number; piece: PieceId };
/** A synth note: start (beats), MIDI pitch, length (beats), loudness 0..1. */
export type Tone = {
  beat: number;
  midi: number;
  length: number;
  velocity: number;
};

export type Chart = {
  id: string;
  /** A short caption for the song card. */
  title: string;
  bpm: number;
  beatsPerBar: number;
  /** Bars the song lasts (after the count-in). */
  bars: number;
  notes: Note[];
  melody: Tone[];
  bass: Tone[];
};

const n = (beat: number, piece: PieceId): Note => ({ beat, piece });
const t = (
  beat: number,
  midi: number,
  length: number,
  velocity = 0.8,
): Tone => ({
  beat,
  midi,
  length,
  velocity,
});

/** A bar pattern repeated `times`, starting at bar `from`. */
const repeat = (
  pattern: [number, PieceId][],
  beatsPerBar: number,
  from: number,
  times: number,
) =>
  Array.from({ length: times }, (_, k) =>
    pattern.map(([b, p]) => n((from + k) * beatsPerBar + b, p)),
  ).flat();

/** A bass line from one root per bar (MIDI), on the given beats of the bar. */
const bassLine = (
  roots: number[],
  beatsPerBar: number,
  hits: [number, number, number][], // beat in bar, interval above root, length
) =>
  roots.flatMap((root, bar) =>
    hits.map(([b, interval, length]) =>
      t(bar * beatsPerBar + b, root + interval, length, 0.85),
    ),
  );

// ---------------------------------------------------------------- Happy Birthday
// Traditional (public domain), in C, 3/4. The melody starts on a pickup.
const G4 = 67;
const A4 = 69;
const B4 = 71;
const C5 = 72;
const D5 = 74;
const E5 = 76;
const F5 = 77;
const G5 = 79;

const HB_MELODY: Tone[] = [
  // "Hap-py" (pickup)
  t(-1, G4, 0.7),
  t(-0.25, G4, 0.25),
  t(0, A4, 1),
  t(1, G4, 1),
  t(2, C5, 1),
  t(3, B4, 2),
  t(5, G4, 0.7),
  t(5.75, G4, 0.25),
  t(6, A4, 1),
  t(7, G4, 1),
  t(8, D5, 1),
  t(9, C5, 2),
  t(11, G4, 0.7),
  t(11.75, G4, 0.25),
  t(12, G5, 1),
  t(13, E5, 1),
  t(14, C5, 1),
  t(15, B4, 1),
  t(16, A4, 1),
  t(17, F5, 0.7),
  t(17.75, F5, 0.25),
  t(18, E5, 1),
  t(19, C5, 1),
  t(20, D5, 1),
  t(21, C5, 3),
];

const happyBirthday: Chart = {
  id: "birthday",
  title: "Happy Birthday",
  bpm: 100,
  beatsPerBar: 3,
  bars: 8,
  notes: [
    // Kick on 1, hi-hat on 2, snare on 3; a crash to finish.
    ...repeat(
      [
        [0, "kick"],
        [1, "hihat"],
        [2, "snare"],
      ],
      3,
      0,
      7,
    ),
    n(21, "crash"),
  ],
  melody: HB_MELODY,
  bass: [
    ...bassLine([48, 43, 43, 48, 48, 41, 43], 3, [
      [0, 0, 1.5],
      [2, 7, 0.9],
    ]),
    t(21, 36, 3, 0.9),
  ],
};

// ---------------------------------------------------------------- the beats
// Where two parts land together, the player plays the one that leads.
const ROCK: [number, PieceId][] = [
  [0, "kick"],
  [0.5, "hihat"],
  [1, "snare"],
  [1.5, "hihat"],
  [2, "kick"],
  [2.5, "hihat"],
  [3, "snare"],
  [3.5, "hihat"],
];

const rock: Chart = {
  id: "rock",
  title: "Rock",
  bpm: 96,
  beatsPerBar: 4,
  bars: 8,
  notes: [
    ...repeat(ROCK, 4, 0, 7),
    n(28, "kick"),
    n(29, "snare"),
    n(30, "kick"),
    n(31, "crash"),
  ],
  melody: [],
  bass: [
    ...bassLine([40, 40, 45, 43, 40, 40, 45, 43], 4, [
      [0, 0, 0.45],
      [0.5, 0, 0.45],
      [1.5, 0, 0.45],
      [2, 0, 0.45],
      [2.5, 12, 0.4],
      [3.5, 7, 0.45],
    ]),
  ],
};

const disco: Chart = {
  id: "disco",
  title: "Disco",
  bpm: 116,
  beatsPerBar: 4,
  bars: 8,
  notes: [
    // Four on the floor, the open hi-hat on the offbeats, snare on 2 and 4.
    ...repeat(
      [
        [0, "kick"],
        [0.5, "hihat"],
        [1, "snare"],
        [1.5, "hihat"],
        [2, "kick"],
        [2.5, "hihat"],
        [3, "snare"],
        [3.5, "hihat"],
      ],
      4,
      0,
      7,
    ),
    n(28, "kick"),
    n(29, "kick"),
    n(30, "kick"),
    n(31, "crash"),
  ],
  melody: [],
  // Octave bass on the eighths.
  bass: bassLine([45, 45, 50, 52, 45, 45, 50, 52], 4, [
    [0, 0, 0.4],
    [0.5, 12, 0.35],
    [1, 0, 0.4],
    [1.5, 12, 0.35],
    [2, 0, 0.4],
    [2.5, 12, 0.35],
    [3, 0, 0.4],
    [3.5, 12, 0.35],
  ]),
};

/** A groove bar, then the fill: snare → rack tom → floor tom → crash. */
const FILL: [number, PieceId][] = [
  [0, "snare"],
  [0.5, "snare"],
  [1, "tom1"],
  [1.5, "tom1"],
  [2, "tom2"],
  [2.5, "tom2"],
  [3, "crash"],
];

const fill: Chart = {
  id: "fill",
  title: "First fill",
  bpm: 88,
  beatsPerBar: 4,
  bars: 8,
  notes: [0, 2, 4, 6].flatMap((bar) => [
    ...repeat(ROCK, 4, bar, 1),
    ...repeat(FILL, 4, bar + 1, 1),
  ]),
  melody: [],
  bass: bassLine([43, 43, 48, 48, 43, 43, 50, 50], 4, [
    [0, 0, 0.9],
    [1.5, 0, 0.4],
    [2, 7, 0.9],
    [3, 10, 0.9],
  ]),
};

const ballad: Chart = {
  id: "ballad",
  title: "Ballad",
  bpm: 72,
  beatsPerBar: 4,
  bars: 8,
  notes: [
    // Half-time: the kick on 1, a big snare on 3, the hi-hat between.
    ...repeat(
      [
        [0, "kick"],
        [1, "hihat"],
        [2, "snare"],
        [3, "hihat"],
      ],
      4,
      0,
      7,
    ),
    n(28, "kick"),
    n(30, "crash"),
  ],
  melody: [],
  bass: bassLine([45, 41, 48, 43, 45, 41, 48, 43], 4, [
    [0, 0, 1.8],
    [2, 7, 0.9],
    [3, 12, 0.9],
  ]),
};

export const CHARTS: Chart[] = [happyBirthday, rock, disco, fill, ballad];

export const chartById = (id: string) =>
  CHARTS.find((c) => c.id === id) ?? null;

/** Seconds per beat at a speed (1 = the song's tempo). */
export const secondsPerBeat = (chart: Chart, speed = 1) =>
  60 / (chart.bpm * speed);

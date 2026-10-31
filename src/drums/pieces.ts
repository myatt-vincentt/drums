// The kit's six pieces: their node names in the model, the size of the head
// (or cymbal) you can hit, and the sounds they play.

export type PieceId = "kick" | "snare" | "tom1" | "tom2" | "hihat" | "crash";

/** Every sound in the kit (the hi-hat has four: three hits and the foot). */
export type SoundId =
  | "kick"
  | "snare"
  | "tom1"
  | "tom2"
  | "crash"
  | "hihatClosed"
  | "hihatSemi"
  | "hihatOpen"
  | "hihatPedal";

export type Piece = {
  id: PieceId;
  /** The piece's group in the model. */
  node: string;
  /** The empty at the head's centre; its +Y is the head's normal. */
  hitCenter: string;
  /** Radius of the playable head or cymbal (model metres). */
  radius: number;
  /** Cymbals are hit at the bell, so the whole cymbal counts. */
  cymbal: boolean;
};

export const PIECES: Piece[] = [
  {
    id: "kick",
    node: "Kick",
    hitCenter: "Kick_HitCenter",
    radius: 0.284,
    cymbal: false,
  },
  {
    id: "snare",
    node: "Snare",
    hitCenter: "Snare_HitCenter",
    radius: 0.157,
    cymbal: false,
  },
  {
    id: "tom1",
    node: "Tom1",
    hitCenter: "Tom1_HitCenter",
    radius: 0.135,
    cymbal: false,
  },
  {
    id: "tom2",
    node: "Tom2",
    hitCenter: "Tom2_HitCenter",
    radius: 0.181,
    cymbal: false,
  },
  {
    id: "hihat",
    node: "HiHat",
    hitCenter: "HiHat_HitCenter",
    radius: 0.178,
    cymbal: true,
  },
  {
    id: "crash",
    node: "Crash",
    hitCenter: "Crash_HitCenter",
    radius: 0.204,
    cymbal: true,
  },
];

/** The pieces a stick can hit (the kick is played by the foot). */
export const STICK_PIECES: PieceId[] = [
  "snare",
  "tom1",
  "tom2",
  "hihat",
  "crash",
];

/**
 * Model parts that are stands and hardware, not something to hit: a tap on
 * them counts as a tap off the drums (the kick).
 */
export const isHardware = (name: string) =>
  /_(Stand|Legs|Mount|Pedal)$/.test(name) || name === "Hardware";

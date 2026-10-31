// What the kit, the sticks, the taps and the nod share, read and written in
// the frame loop (never React state).
import type { Object3D } from "three";

import { sound } from "./audio";
import { HiHatControl, type HatEvent, type HatInput } from "./hihat";
import type { Zone } from "./hits";
import type { PieceId, SoundId } from "./pieces";

/** A light hit on the open hi-hat (below this loudness) plays half-open. */
const SEMI_BELOW = 0.3;

export type HitSource = "left" | "right" | "pointer" | "nod";

export const drums = {
  /** Each head on screen (screen heights, y up, centre origin), every frame. */
  zones: [] as Zone[],
  /** The stick-playable ones (no kick). */
  stickZones: [] as Zone[],
  /** The kit's model in the scene (for taps). */
  root: null as Object3D | null,
  /** Screen width ÷ height. */
  aspect: 1,
  /** Kit scale: world units per model metre. */
  scale: 1,
  hihat: new HiHatControl(),
  /** A mouse button or finger held down on the kit (it can close the hi-hat). */
  pointer: { id: "pointer", present: false, x: 0, y: 0, speed: 0 } as HatInput,
  /** performance.now() of each piece's last hit (for its animation). */
  hitAt: {
    kick: -1e9,
    snare: -1e9,
    tom1: -1e9,
    tom2: -1e9,
    hihat: -1e9,
    crash: -1e9,
  } as Record<PieceId, number>,
  /** Recent hits (read by the development debug object). */
  log: [] as Array<{
    t: number;
    piece: PieceId;
    sound: SoundId;
    velocity: number;
    by: HitSource;
  }>,
};

/** A piece is hit: pick its sound, play it and start its animation. */
export const strike = (piece: PieceId, velocity: number, by: HitSource) => {
  let id: SoundId;
  if (piece === "hihat") {
    if (drums.hihat.closed) id = "hihatClosed";
    else id = velocity < SEMI_BELOW ? "hihatSemi" : "hihatOpen";
  } else id = piece;
  if (id === "hihatClosed") sound.choke();
  sound.play(id, velocity);
  drums.hitAt[piece] = performance.now();
  drums.log.push({
    t: Math.round(performance.now()),
    piece,
    sound: id,
    velocity: Number(velocity.toFixed(2)),
    by,
  });
  if (drums.log.length > 60) drums.log.shift();
};

/** The hi-hat opened or closed: the foot's sound and the top cymbal. */
export const hatChanged = (e: HatEvent | null) => {
  if (e === "close") {
    sound.choke();
    sound.play("hihatPedal", 0.8);
  }
};

/** The zone of one piece, if it is on screen. */
export const zoneOf = (piece: PieceId) =>
  drums.zones.find((z) => z.id === piece) ?? null;

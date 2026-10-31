// What the kit, the ghost hands, the taps, the nod and the page UI share.
// Per-frame values are read and written in the frame loop (never React
// state); the few the page UI shows bump a version it subscribes to.
import { useSyncExternalStore } from "react";
import { Vector3, type Object3D, type PerspectiveCamera } from "three";

import { sound } from "./audio";
import { HiHatControl, type HatEvent, type HatInput } from "./hihat";
import { VIEWS, type View } from "./layout";
import type { Session } from "./session";
import type { PieceId, SoundId } from "./pieces";

/** A light hit on the open hi-hat (below this loudness) plays half-open. */
const SEMI_BELOW = 0.3;

export type HitSource = "left" | "right" | "pointer" | "nod";

/** A head (or cymbal) in the scene, this frame. */
export type Head = {
  id: PieceId;
  center: Vector3;
  /** The head's normal (up out of the head). */
  normal: Vector3;
  radius: number;
};

/** A hit, for the animations: where (the contact point, if known) and how hard. */
export type HitEvent = {
  seq: number;
  piece: PieceId;
  velocity: number;
  point: Vector3 | null;
  /** performance.now() / 1000 */
  at: number;
};

/**
 * Hand tracking starts on (taps, clicks and keys play too); the hands button
 * turns it off. The choice lasts for the visit; `?hands=off` starts with it off.
 */
const HANDS_KEY = "drums.hands";
const handsAtStart = () => {
  try {
    const q = new URLSearchParams(window.location.search).get("hands");
    if (q === "on" || q === "off") return q === "on";
    return window.sessionStorage.getItem(HANDS_KEY) !== "off";
  } catch {
    return true;
  }
};

const listeners = new Set<() => void>();
let version = 0;

export const drums = {
  /** Every head in the scene this frame (world metres). */
  heads: [] as Head[],
  /** The kit's model in the scene (for taps). */
  root: null as Object3D | null,
  /** The drummer's-seat camera for this screen (aiming always uses it). */
  seat: null as PerspectiveCamera | null,
  /** Screen width ÷ height. */
  aspect: 1,
  hihat: new HiHatControl(),
  /** A mouse button or finger held down on the hi-hat (it closes it). */
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
  /** The latest hits (the animations read the ones newer than they've seen). */
  events: [] as HitEvent[],
  seq: 0,
  /** Recent hits (read by the development debug object). */
  log: [] as Array<{
    t: number;
    piece: PieceId;
    sound: SoundId;
    velocity: number;
    by: HitSource;
  }>,

  // What the page UI shows.
  view: "drummer" as View,
  night: false,
  /** The corner camera is tucked away. */
  camHidden: false,
  /** Learn mode: the song card is open, Play runs slower, the song now. */
  songCard: false,
  slow: false,
  session: null as Session | null,
  /** The last song's end (for the stars and the celebration). */
  finish: null as {
    stars: number;
    at: number;
    id: string;
    mode: "learn" | "play";
    results: readonly (string | null)[];
    offsets: readonly (number | null)[];
  } | null,
  /** A song listening to the hits (set while one runs). */
  songHit: null as ((piece: PieceId, tracked: boolean) => void) | null,
  /** The studio, the kit and the hands have loaded. */
  loaded: false,
  /** Start was tapped on the home page (the camera and hand tracking run). */
  started: false,
  /** The home page has gone (the kit is in front of you). */
  entered: false,
  /** The "how to play" steps card is open. */
  howTo: false,
  /** It opened right after Start: it closes by itself (performance.now() ms). */
  howToUntil: null as number | null,
  /** After the first card: the dock's one pulse (performance.now() ms)… */
  dockPulseAt: null as number | null,
  /** …and the glow on the snare, until the first hit. */
  invite: false,
  /** Your hands (and nods) play the kit. */
  handsOn: handsAtStart(),
  changed() {
    version += 1;
    listeners.forEach((l) => l());
  },
};

export const nextView = () => {
  drums.view = VIEWS[(VIEWS.indexOf(drums.view) + 1) % VIEWS.length];
  drums.changed();
};

export const setNight = (on: boolean) => {
  drums.night = on;
  drums.changed();
};

/** The "how to play" steps show by themselves the first time hands go on. */
const HOWTO_KEY = "drums.howto";

export const toggleHands = () => {
  drums.handsOn = !drums.handsOn;
  if (drums.handsOn) {
    try {
      if (window.sessionStorage.getItem(HOWTO_KEY) !== "seen") {
        drums.howTo = true;
        window.sessionStorage.setItem(HOWTO_KEY, "seen");
      }
    } catch {
      drums.howTo = true;
    }
  }
  try {
    window.sessionStorage.setItem(HANDS_KEY, drums.handsOn ? "on" : "off");
  } catch {
    // private mode: it lasts until a reload
  }
  drums.changed();
};

/** Start on the home page: the sound, the camera and hand tracking. */
export const start = () => {
  if (drums.started) return;
  sound.unlock();
  drums.started = true;
  drums.changed();
};

/** The home page has faded: the steps card shows for a few seconds. */
export const INTRO_CARD_MS = 5000;
export const enter = () => {
  if (drums.entered) return;
  drums.entered = true;
  drums.howTo = true;
  drums.howToUntil = performance.now() + INTRO_CARD_MS;
  try {
    window.sessionStorage.setItem(HOWTO_KEY, "seen");
  } catch {
    // private mode
  }
  drums.changed();
};

/**
 * The steps card closes. After the first one the dock pulses once and the
 * snare glows until the first hit (not when a hit closed it: you've begun).
 */
export const closeHowTo = (byHit = false) => {
  if (!drums.howTo) return;
  const first = drums.howToUntil !== null;
  drums.howTo = false;
  drums.howToUntil = null;
  if (first) {
    drums.dockPulseAt = performance.now();
    drums.invite = !byHit;
  }
  drums.changed();
};

export const toggleCam = () => {
  drums.camHidden = !drums.camHidden;
  drums.changed();
};

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

/** Re-renders the caller when the page UI's state changes. */
export const useDrumsVersion = () =>
  useSyncExternalStore(subscribe, () => version);

/** A piece is hit: pick its sound, play it and start its animation. */
export const strike = (
  piece: PieceId,
  velocity: number,
  by: HitSource,
  point: Vector3 | null = null,
) => {
  let id: SoundId;
  if (piece === "hihat") {
    if (drums.hihat.closed) id = "hihatClosed";
    else id = velocity < SEMI_BELOW ? "hihatSemi" : "hihatOpen";
  } else id = piece;
  if (id === "hihatClosed") sound.choke();
  sound.play(id, velocity);
  drums.hitAt[piece] = performance.now();
  drums.seq += 1;
  drums.events.push({
    seq: drums.seq,
    piece,
    velocity,
    point: point ? point.clone() : null,
    at: performance.now() / 1000,
  });
  if (drums.events.length > 16) drums.events.shift();
  drums.log.push({
    t: Math.round(performance.now()),
    piece,
    sound: id,
    velocity: Number(velocity.toFixed(2)),
    by,
  });
  if (drums.log.length > 60) drums.log.shift();
  drums.songHit?.(piece, by === "left" || by === "right");
  // The first real stroke closes the how-to card; any first hit ends the
  // snare's invitation.
  if (drums.howTo && (by === "left" || by === "right")) closeHowTo(true);
  if (drums.invite) {
    drums.invite = false;
    drums.changed();
  }
};

/** The hi-hat opened or closed: the foot's sound (the top cymbal follows). */
export const hatChanged = (e: HatEvent | null) => {
  if (e === "close") {
    sound.choke();
    sound.play("hihatPedal", 0.8);
  }
};

/** The hits since `seq` (oldest first). */
export const hitsSince = (seq: number) =>
  drums.events.filter((e) => e.seq > seq);

export const headOf = (piece: PieceId) =>
  drums.heads.find((h) => h.id === piece) ?? null;

// Drums: a full 3D drum kit in a recording studio, seen from the drummer's
// seat, with two ghost hands holding drumsticks that follow your hands. Play
// it: strike down over a drum or cymbal, nod for the kick, rest a stick on
// the hi-hat to close it. A mouse or a finger plays it too. Free play, no
// score. Your camera sits small in the corner.
//
//   CameraRig.tsx     the views (drummer, front, top), fitted to the screen
//   Studio.tsx        the room and its light, day and night
//   Kit.tsx           the kit: its layout and heads; kitMotion.ts: how it moves when hit
//   Sparks.tsx        the flash where a stick lands hard
//   SongPlayer.tsx    Learn mode: songs and beats to play along (songs.ts,
//                     session.ts, synth.ts)
//   GhostHands.tsx    the ghost hands and sticks, and their hits
//   aim.ts            where a stick aims, and its stroke (pure)
//   hits.ts           what counts as a hit (pure)
//   hihat.ts          closing the hi-hat by holding still (pure)
//   NodKick.tsx       the kick from a nod of the head (nod.ts)
//   PointerInput.tsx  taps and clicks
//   CameraFrame.tsx   your camera in the corner
//   Hud.tsx           the bottom dock, song card, stars and how to play
//   audio.ts          the recorded kit, played with Web Audio
//   Sound.tsx         the wordless "tap for sound" speaker
import { Suspense } from "react";

import { CameraFrame } from "./CameraFrame";
import { CameraRig } from "./CameraRig";
import { GhostHands } from "./GhostHands";
import { Hud } from "./Hud";
import { Kit } from "./Kit";
import { NodKick } from "./NodKick";
import { PointerInput } from "./PointerInput";
import { SongPlayer } from "./SongPlayer";
import { Sound } from "./Sound";
import { Sparks } from "./Sparks";
import { drums, useDrumsVersion } from "./state";
import { Studio } from "./Studio";

/** The nod kick only listens while hand tracking is on. */
const NodWhenOn = () => {
  useDrumsVersion();
  return drums.handsOn ? <NodKick /> : null;
};

export const DrumsScene = () => (
  <>
    <CameraRig />
    <Suspense fallback={null}>
      <Studio />
      <Kit />
      <GhostHands />
      <Sparks />
      <SongPlayer />
    </Suspense>
    <CameraFrame />
    <NodWhenOn />
    <PointerInput />
    <Hud />
    <Sound />
  </>
);

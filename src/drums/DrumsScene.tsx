// Drums: a full 3D drum kit sits in front of you at the bottom of the
// screen and a drumstick appears in each hand. Play it: strike down at a
// drum or cymbal, nod for the kick, rest a stick on the hi-hat to close it.
// A mouse or a finger plays it too. Free play, no score.
//
//   Kit.tsx           the kit: placed, lit, beater and hi-hat moves, heads on screen
//   Sticks.tsx        a stick in each tracked hand, and their hits
//   hits.ts           what counts as a hit (pure)
//   hihat.ts          closing the hi-hat by holding still (pure)
//   NodKick.tsx       the kick from a nod of the head (nod.ts)
//   PointerInput.tsx  taps and clicks
//   audio.ts          the recorded kit, played with Web Audio
//   Sound.tsx         the wordless "tap for sound" speaker
import { Suspense } from "react";

import { Kit } from "./Kit";
import { NodKick } from "./NodKick";
import { PointerInput } from "./PointerInput";
import { Sound } from "./Sound";
import { Sticks } from "./Sticks";

export const DrumsScene = () => (
  <>
    <Suspense fallback={null}>
      <Kit />
      <Sticks />
    </Suspense>
    <NodKick />
    <PointerInput />
    <Sound />
  </>
);

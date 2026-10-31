// Development only: window.__drums, a look inside the kit for testing
// without a camera — the heads on screen, the hit log, the sound meter, the
// head reading, and pretend hands:
//
//   __drums.fakeHand("right", x, y, palm)  hold a pretend hand (tracker units)
//   __drums.fakeHand("right", null)        take it away
//   __drums.real()                         back to the tracked hands
//   __drums.strike("snare", 0.8)           play a piece
import { useEffect } from "react";

import { meter } from "./audio";
import { head } from "./NodKick";
import { drums, strike } from "./state";
import { devHands, readings, tips } from "./Sticks";

type Side = "left" | "right";

const DevDebug = () => {
  useEffect(() => {
    const api = {
      drums,
      meter,
      head,
      tips,
      readings,
      strike,
      fakeHand(side: Side, x: number | null, y = 0, palm = 0.12) {
        devHands[side] =
          x === null ? null : { x, y, palm, stamp: performance.now() };
      },
      real() {
        delete devHands.left;
        delete devHands.right;
      },
    };
    (window as unknown as { __drums?: typeof api }).__drums = api;
    return () => {
      delete (window as unknown as { __drums?: typeof api }).__drums;
    };
  }, []);
  return null;
};

export default DevDebug;

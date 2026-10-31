// Development only: window.__drums, a look inside for testing without a
// camera — the heads, the hit log, the sound meter, the head reading, the
// ghosts, and pretend hands:
//
//   __drums.fakeHand("right", x, y, palm)  hold a pretend hand (tracker units)
//   __drums.fakeHand("right", null)        take it away
//   __drums.real()                         back to the tracked hands
//   __drums.strike("snare", 0.8)           play a piece
//   __drums.view("front"), __drums.night(true)
import { useEffect } from "react";
import { Vector3 } from "three";

import { meter } from "./audio";
import { cameraOverride } from "./CameraRig";
import { devHands, devRest, devStroke, ghosts, swingAt } from "./GhostHands";
import type { View } from "./layout";
import type { PieceId } from "./pieces";
import { head } from "./NodKick";
import { drums, setNight, strike } from "./state";

type Side = "left" | "right";

const DevDebug = () => {
  useEffect(() => {
    const api = {
      drums,
      meter,
      head,
      ghosts,
      strike,
      view(v: View) {
        drums.view = v;
        drums.changed();
      },
      night: (on: boolean) => setNight(on),
      /** A fixed camera (null: back to the views). */
      look(pos: number[] | null, target: number[] = [0, 0.8, 0], fov = 40) {
        cameraOverride.pose = pos
          ? { pos: new Vector3(...pos), target: new Vector3(...target), fov }
          : null;
      },
      fakeHand(side: Side, x: number | null, y = 0, palm = 0.1) {
        devHands[side] =
          x === null ? null : { x, y, palm, stamp: performance.now() };
      },
      /** Untracked ghosts rest over these pieces, struck this far (0..1). */
      rest(left: PieceId, right: PieceId, stroke = 0) {
        devRest.left = left;
        devRest.right = right;
        devStroke.left = stroke;
        devStroke.right = stroke;
      },
      /** A tap on a piece at a point (as a click): the sound, the swing. */
      tap(piece: PieceId, point: Vector3, velocity = 0.8) {
        strike(piece, velocity, "pointer", point);
        if (piece !== "kick") swingAt(piece, point, velocity);
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

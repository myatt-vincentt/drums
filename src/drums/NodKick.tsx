// The kick drum from a nod of the head (see nod.ts for what counts).
import { useEffect, useRef } from "react";
import { useFaceInfo } from "@vincentt-xr/sdk/tracking";

import { NodDetector } from "./nod";
import { drums, strike } from "./state";

/** Head readings per second: a nod is quick. */
const FACE_FPS = 30;

/** Development only: the latest head reading (for the debug object). */
export const head = { pitch: 0, yaw: 0, nods: 0 };

export const NodKick = () => {
  const face = useFaceInfo({ numFaces: 1, targetFps: FACE_FPS });
  const detector = useRef(new NodDetector());

  useEffect(() => {
    if (!face) {
      detector.current.reset();
      return;
    }
    const { x: pitch, y: yaw } = face.pose.rotation;
    head.pitch = pitch;
    head.yaw = yaw;
    const nod = detector.current.push(performance.now() / 1000, pitch, yaw);
    if (nod && drums.root) {
      head.nods += 1;
      strike("kick", nod.velocity, "nod");
    }
  }, [face]);

  return null;
};

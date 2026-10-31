// The three views, switched with the view chip:
//   drummer  from the drummer's seat, looking down at the kit (the default)
//   front    from the room, facing the kit and the ghost hands
//   top      from above
// Each view blends between its laptop and phone framing by the screen's
// shape, and widens just enough to keep every head and cymbal on screen.
// Switching glides the camera to the new view (strict ease-out).
//
// Aiming always uses the drummer's-seat view (drums.seat), whatever the
// screen shows, so your hands play the same in every view.
import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { PerspectiveCamera, Vector3 } from "three";

import { pulse } from "./fx";
import { fitFov, viewPose, type CameraPose, type View } from "./layout";
import { drums } from "./state";

const GLIDE = 0.9;
/** The kick's thump: from this loudness, how far (m) and how long (s). */
const THUMP = { from: 0.6, depth: 0.006, length: 0.08 };
/** Edges kept clear around the kit in each view (NDC). */
const MARGIN = { side: 0.94, top: 0.9, bottom: 0.94 };

const ease = (t: number) => 1 - (1 - Math.min(1, Math.max(0, t))) ** 3;

const newPose = (): CameraPose => ({
  pos: new Vector3(),
  target: new Vector3(),
  fov: 50,
});

/** Development only: a fixed camera instead of the views (null = the views). */
export const cameraOverride: { pose: CameraPose | null } = { pose: null };

/**
 * The Front view also keeps the wall behind the kit in the shot: the ON AIR
 * sign, the neon under it and the two plants either side.
 */
const FRONT_WALL = [
  [-0.3, 2.64, -2.34],
  [0.3, 2.64, -2.34],
  [-0.7, 1.88, -2.34],
  [0.7, 1.88, -2.34],
  [-1.95, 1.15, -1.9],
  [-1.95, 0.05, -1.5],
  [1.85, 1.78, -1.9],
  [1.85, 0.05, -1.6],
  // …and the whole kit, down to its feet.
  [-0.85, 0, 0.35],
  [0.85, 0, 0.35],
  [0, 0, 0.5],
].map(([x, y, z]) => new Vector3(x, y, z));

const probe = new PerspectiveCamera();
const pts = Array.from({ length: 50 }, () => new Vector3());
const local: Vector3[] = [];

/** A view's pose for this screen, widened to fit the kit. */
const fittedPose = (view: View, aspect: number, out: CameraPose) => {
  viewPose(view, aspect, out);
  probe.position.copy(out.pos);
  probe.lookAt(out.target);
  probe.updateMatrixWorld(true);
  let n = 0;
  drums.heads.forEach((h) => {
    if (n + 5 > pts.length) return;
    const r = h.id === "kick" ? 0 : h.radius;
    pts[n].copy(h.center);
    pts[n + 1].set(h.center.x + r, h.center.y, h.center.z);
    pts[n + 2].set(h.center.x - r, h.center.y, h.center.z);
    pts[n + 3].set(h.center.x, h.center.y, h.center.z + r);
    pts[n + 4].set(h.center.x, h.center.y, h.center.z - r);
    n += 5;
  });
  if (view === "front")
    FRONT_WALL.forEach((p) => {
      pts[n].copy(p);
      n += 1;
    });
  local.length = n;
  for (let i = 0; i < n; i += 1)
    local[i] = pts[i].applyMatrix4(probe.matrixWorldInverse);
  // eslint-disable-next-line no-param-reassign
  out.fov = fitFov(out.fov, aspect, local, MARGIN);
  return out;
};

export const CameraRig = () => {
  const from = useMemo(newPose, []);
  const live = useMemo(newPose, []);
  const cur = useMemo(newPose, []);
  const seatPose = useMemo(newPose, []);
  const seat = useMemo(() => new PerspectiveCamera(), []);
  const sw = useRef({ view: drums.view, at: -10, started: false });

  useFrame(({ camera, size }) => {
    const cam = camera as PerspectiveCamera;
    const aspect = size.width / Math.max(1, size.height);
    const s = sw.current;
    const now = performance.now() / 1000;
    if (s.view !== drums.view) {
      from.pos.copy(cur.pos);
      from.target.copy(cur.target);
      from.fov = cur.fov;
      s.view = drums.view;
      s.at = now;
    }
    fittedPose(drums.view, aspect, live);
    if (!s.started) {
      cur.pos.copy(live.pos);
      cur.target.copy(live.target);
      cur.fov = live.fov;
      s.started = true;
    }
    const k = ease((now - s.at) / GLIDE);
    cur.pos.copy(from.pos).lerp(live.pos, k);
    cur.target.copy(from.target).lerp(live.target, k);
    cur.fov = from.fov + (live.fov - from.fov) * k;
    if (k >= 1) {
      from.pos.copy(live.pos);
      from.target.copy(live.target);
      from.fov = live.fov;
    }
    const shown = cameraOverride.pose ?? cur;
    cam.position.copy(shown.pos);
    // A hard kick gives the view a tiny thump (a pixel or two, briefly).
    for (let i = drums.events.length - 1; i >= 0; i -= 1) {
      const e = drums.events[i];
      if (e.piece === "kick") {
        if (e.velocity > THUMP.from)
          cam.position.y -=
            THUMP.depth * e.velocity * pulse(now - e.at, THUMP.length);
        break;
      }
    }
    cam.lookAt(shown.target);
    if (
      Math.abs(cam.fov - shown.fov) > 0.01 ||
      cam.near !== 0.05 ||
      Math.abs(cam.aspect - aspect) > 1e-4
    ) {
      cam.fov = shown.fov;
      cam.near = 0.05;
      cam.far = 60;
      cam.aspect = aspect;
      cam.updateProjectionMatrix();
    }

    // The seat's view, for aiming.
    fittedPose("drummer", aspect, seatPose);
    seat.position.copy(seatPose.pos);
    seat.lookAt(seatPose.target);
    seat.fov = seatPose.fov;
    seat.aspect = aspect;
    seat.near = 0.05;
    seat.far = 60;
    seat.updateProjectionMatrix();
    seat.updateMatrixWorld(true);
    drums.seat = seat;
  }, -1);
  return null;
};

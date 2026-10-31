// The screen layout: where the camera looks from in each view, how the kit
// is set out for the screen's shape, and where the corner camera sits.
//
// Coordinates are the kit's own (metres, y up): the drummer sits at −z
// facing +z, so from the seat the hi-hat (+x) is on the screen's left, the
// same side as your left hand in the mirrored selfie picture.
import { Vector3 } from "three";

import type { PieceId } from "./pieces";

export type View = "drummer" | "front" | "top";
export const VIEWS: View[] = ["drummer", "front", "top"];

/** Screen shape → 0 (laptop, wide) … 1 (phone, tall). */
export const phoneness = (aspect: number) =>
  Math.min(1, Math.max(0, (1.5 - aspect) / (1.5 - 0.56)));

/**
 * On a tall screen the outer pieces move in towards the middle (and a little
 * back, so nothing collides): metres at full phone shape.
 */
const PHONE_SHIFT: Partial<Record<PieceId, [number, number, number]>> = {
  hihat: [-0.1, 0, -0.08],
  crash: [0.1, 0, 0],
  snare: [-0.06, 0, -0.05],
  tom2: [0.06, 0, -0.05],
};

/** How far a piece moves for this screen shape (m). */
export const pieceShift = (id: PieceId, aspect: number, out: Vector3) => {
  const s = PHONE_SHIFT[id];
  const k = phoneness(aspect);
  return s ? out.set(s[0] * k, s[1] * k, s[2] * k) : out.set(0, 0, 0);
};

export type CameraPose = {
  pos: Vector3;
  target: Vector3;
  /** Vertical field of view (degrees). */
  fov: number;
};

const deg = (r: number) => (r * 180) / Math.PI;
const rad = (d: number) => (d * Math.PI) / 180;
/** The vertical field of view that gives this horizontal one. */
export const vfovFromH = (hfov: number, aspect: number) =>
  deg(2 * Math.atan(Math.tan(rad(hfov) / 2) / Math.max(0.1, aspect)));

// The seat's view: the studio renders' framing, with a longer lens from a
// little further back (the near drums are not stretched).
const DRUMMER = {
  laptop: { pos: [0, 1.47, -1.3], target: [0, 0.66, 0.7], vfov: 54 },
  phone: { pos: [0, 1.55, -1.3], target: [0, 1.12, 0.42], hfov: 62 },
};
const FRONT = {
  laptop: { pos: [0, 1.3, 2.35], target: [0, 0.85, -0.6], vfov: 54 },
  phone: { pos: [0, 1.35, 2.35], target: [0, 1.0, -0.6], hfov: 46 },
};
const TOP = {
  laptop: { pos: [0, 2.75, -0.45], target: [0, 0.6, 0.0], vfov: 46 },
  phone: { pos: [0, 2.9, -0.4], target: [0, 0.6, 0.0], hfov: 60 },
};

const VIEW_POSES = { drummer: DRUMMER, front: FRONT, top: TOP };

/* eslint-disable no-param-reassign */
/** A view's camera for this screen shape (before the fit). */
export const viewPose = (view: View, aspect: number, out: CameraPose) => {
  const v = VIEW_POSES[view];
  const k = phoneness(aspect);
  const [lx, ly, lz] = v.laptop.pos;
  const [px, py, pz] = v.phone.pos;
  out.pos.set(lx + (px - lx) * k, ly + (py - ly) * k, lz + (pz - lz) * k);
  const [ltx, lty, ltz] = v.laptop.target;
  const [ptx, pty, ptz] = v.phone.target;
  out.target.set(
    ltx + (ptx - ltx) * k,
    lty + (pty - lty) * k,
    ltz + (ptz - ltz) * k,
  );
  const phoneV = vfovFromH(v.phone.hfov, aspect);
  out.fov = v.laptop.vfov + (phoneV - v.laptop.vfov) * k;
  return out;
};
/* eslint-enable no-param-reassign */

/**
 * The narrowest vertical field of view (degrees, at least `fov`) that keeps
 * every point on screen, within `margin` of the edges (NDC). `points` are in
 * the camera's own space (looking down −z).
 */
export const fitFov = (
  fov: number,
  aspect: number,
  points: readonly Vector3[],
  margin = { side: 0.94, top: 0.94, bottom: 0.94 },
) => {
  let tanHalf = Math.tan(rad(fov) / 2);
  points.forEach((p) => {
    const depth = -p.z;
    if (depth <= 0.05) return;
    const up = p.y / depth;
    const ty = up >= 0 ? up / margin.top : -up / margin.bottom;
    const tx = Math.abs(p.x / depth) / (margin.side * aspect);
    tanHalf = Math.max(tanHalf, ty, tx);
  });
  return Math.min(110, deg(2 * Math.atan(tanHalf)));
};

// ---------------------------------------------------------------- corner camera

/** The page gutter (CSS px). */
export const GUTTER = 16;
/** The corner camera's corner radius (CSS px). */
export const FRAME_RADIUS = 16;

/** Where the corner camera sits (CSS px): top right. */
export const frameRect = (width: number, height: number) => {
  // Portrait-ish on a phone, landscape-ish on a laptop, never extreme.
  const aspect = Math.min(1.33, Math.max(0.75, width / Math.max(1, height)));
  const h = Math.min(220, Math.max(110, height * 0.24));
  const w = Math.round(h * aspect);
  return {
    left: width - GUTTER - w,
    top: GUTTER,
    width: w,
    height: Math.round(h),
  };
};

/**
 * For drei's `<Html fullscreen>`: pin the page UI to the screen. By default
 * it follows the scene's origin, which moves on screen with the camera.
 */
export const pinToScreen = (
  _el: unknown,
  _camera: unknown,
  size: { width: number; height: number },
) => [size.width / 2, size.height / 2];

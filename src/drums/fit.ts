// Sizing the kit to the screen: as wide as the screen allows (all six pieces
// in view, with a margin at the sides), never taller than about half the
// screen, sitting on the bottom edge.
import {
  Euler,
  Matrix4,
  Quaternion,
  Vector3,
  type PerspectiveCamera,
} from "three";

/** The kit's extent in model metres (the stands' feet left out). */
const EXTENT = { x: 0.82, low: 0.12, high: 1.21, back: -0.5, front: 0.32 };
/** Margin at each side, as a share of the screen width. */
const SIDE = 0.03;
/** The kit's most height, as a share of the screen height. */
const MAX_HEIGHT = 0.55;
/** Space below the kit, as a share of the screen height. */
const BOTTOM = 0.01;

const corners = [-1, 1].flatMap((sx) =>
  [EXTENT.low, EXTENT.high].flatMap((y) =>
    [EXTENT.back, EXTENT.front].map((z) => new Vector3(sx * EXTENT.x, y, z)),
  ),
);

const m = new Matrix4();
const q = new Quaternion();
const e = new Euler();
const s3 = new Vector3();
const p3 = new Vector3();
const v = new Vector3();

/** The kit's corners on screen (NDC) at this scale and height. */
const bounds = (
  camera: PerspectiveCamera,
  tilt: number,
  scale: number,
  y: number,
) => {
  q.setFromEuler(e.set(tilt, 0, 0));
  m.compose(p3.set(0, y, 0), q, s3.setScalar(scale));
  const b = {
    minX: Infinity,
    maxX: -Infinity,
    minY: Infinity,
    maxY: -Infinity,
  };
  corners.forEach((c) => {
    v.copy(c).applyMatrix4(m).project(camera);
    b.minX = Math.min(b.minX, v.x);
    b.maxX = Math.max(b.maxX, v.x);
    b.minY = Math.min(b.minY, v.y);
    b.maxY = Math.max(b.maxY, v.y);
  });
  return b;
};

/**
 * The kit's scale and height (world units) on screen, tipped towards the
 * camera by `tilt` (radians).
 */
export const fitKit = (camera: PerspectiveCamera, tilt: number) => {
  camera.updateMatrixWorld();
  const halfWorld =
    Math.tan(((camera.fov / 2) * Math.PI) / 180) * camera.position.z;
  const side = 1 - 2 * SIDE;
  const bottom = -1 + 2 * BOTTOM;
  let scale = 1;
  let y = -halfWorld * 0.6;
  for (let i = 0; i < 12; i += 1) {
    const a = bounds(camera, tilt, scale, y);
    scale *= Math.min(
      (2 * side) / (a.maxX - a.minX),
      (2 * MAX_HEIGHT) / (a.maxY - a.minY),
    );
    // Sit the bottom on the screen's bottom edge.
    const b = bounds(camera, tilt, scale, y);
    y += (bottom - b.minY) * halfWorld;
  }
  return { scale, y };
};

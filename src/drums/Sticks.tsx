// A drumstick in each hand, and the hits they play.
//
// The stick sits in your fist (the knuckles and the base of the thumb) and
// points forward and down from it, angled a little in towards the kit's
// middle like a real drummer's. Turning your hand sideways turns the stick
// with it. The grip is filtered lightly so the stick is steady without
// lagging behind your hand.
//
// Hits are read from the raw readings (not the filtered ones) for the
// shortest delay: see hits.ts. Holding a stick still over the hi-hat closes
// it: see hihat.ts.
import { useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import { XRModel, trackerToWorld } from "@vincentt-xr/sdk";
import { HandTracker } from "@vincentt-xr/sdk/tracking";
import {
  useXRModelNode,
  type XRModelNodeHandTracking,
} from "@vincentt-xr/sdk/low-level";
import {
  type PerspectiveCamera,
  Quaternion,
  Vector3,
  type Group,
  type Mesh,
  type Object3D,
} from "three";

import { OneEuro } from "./filter";
import { StrokeDetector } from "./hits";
import { dressMaterial, studioEnvironment } from "./look";
import { drums, hatChanged, strike } from "./state";
import type { HatInput } from "./hihat";

export const STICK_URL = "/models/drumstick.glb";
useGLTF.preload(STICK_URL);

/** Hand readings per second: strokes are quick, so more than usual. */
const HAND_FPS = 30;
/** The stick's tip along its length (model metres from the grip). */
const TIP = 0.2701;
/** The stick's length (model metres). */
const LENGTH = 0.405;
/**
 * A stick is about this many palm lengths long in your hand, kept between
 * these sizes relative to the kit (a hand very close to the camera or very
 * far away still gets a stick that fits the drums).
 */
const STICK_PALMS = 3.2;
const STICK_RANGE = [0.9, 2.2];
/** The stick's lean: in towards the kit's middle, down, and towards you. */
const LEAN = { inward: 0.3, turn: 0.6, down: 0.8, toward: 0.55 };
/** Filter: steady when still, no lag when moving (One Euro). */
const GRIP_FILTER = { minCutoff: 2.2, beta: 6 };
const TURN_FILTER = { minCutoff: 1.5, beta: 2 };
/** The smallest hand size used for speeds (screen heights). */
const MIN_PALM = 0.045;
/** Fade the stick in and out (1/s). */
const SHOW_RATE = 14;

type Side = "left" | "right";
const SIDES: Side[] = ["left", "right"];
/** The fist: thumb base and the four knuckles (hand joint indices). */
const FIST = [2, 5, 9, 13, 17];

/**
 * Development only: readings to use instead of the tracker's
 * (window.__drums.fakeHand): the grip in tracker units (x right, y up,
 * −1..1), the palm length in screen heights and the reading's time (ms).
 */
export const devHands: Partial<
  Record<Side, { x: number; y: number; palm: number; stamp: number } | null>
> = {};

/** Recent readings (read by the development debug object). */
export const readings: Array<{
  side: Side;
  t: number;
  gx: number;
  gy: number;
  palm: number;
  tx: number;
  ty: number;
  speed: number;
}> = [];

/** Each stick's tip on screen this frame (screen heights), for the hi-hat. */
export const tips: Record<Side, HatInput> = {
  left: { id: "left", present: false, x: 0, y: 0, speed: 0 },
  right: { id: "right", present: false, x: 0, y: 0, speed: 0 },
};

type StickState = {
  detector: StrokeDetector;
  stamp: number;
  x: OneEuro;
  y: OneEuro;
  turn: OneEuro;
  shown: number;
  lastSeen: number;
  /** The stick's scale (follows the hand's size, slowly). */
  size: number;
  /** The hand's size (screen heights), steadied: it reads noisily. */
  palm: number;
};

const grip3 = new Vector3();
const dir3 = new Vector3();
const tip3 = new Vector3();
const up3 = new Vector3(0, 1, 0);
const q = new Quaternion();
const point = { x: 0, y: 0, z: 0 };

/** The stick's direction in the scene for a grip at tracker x and a hand turn. */
const stickDirection = (gx: number, turn: number, out: Vector3) => {
  // In towards the middle: full at the screen's sides, none in the centre.
  const inward = Math.max(-1, Math.min(1, -gx * 3));
  return out
    .set(LEAN.inward * inward + LEAN.turn * turn, -LEAN.down, LEAN.toward)
    .normalize();
};

const prepareStick = (
  scene: Object3D,
  envMap: ReturnType<typeof studioEnvironment>,
) => {
  const root = scene.clone(true);
  root.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    // Always drawn over the kit, like the hands holding them.
    mesh.renderOrder = 20;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    mats.forEach((m) => {
      dressMaterial(m, envMap);
      m.depthTest = false; // eslint-disable-line no-param-reassign
    });
  });
  return root;
};

export const Sticks = () => {
  const node = useXRModelNode<XRModelNodeHandTracking>(XRModel.HAND_TRACKER);
  const { scene } = useGLTF(STICK_URL);
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  const models = useMemo(() => {
    const env = studioEnvironment(gl);
    return { left: prepareStick(scene, env), right: prepareStick(scene, env) };
  }, [scene, gl]);
  const groups = useRef<Record<Side, Group | null>>({
    left: null,
    right: null,
  });
  const state = useRef<Record<Side, StickState>>({
    left: {
      detector: new StrokeDetector(),
      stamp: -1,
      x: new OneEuro(GRIP_FILTER),
      y: new OneEuro(GRIP_FILTER),
      turn: new OneEuro(TURN_FILTER),
      shown: 0,
      lastSeen: -1e9,
      size: 0,
      palm: 0,
    },
    right: {
      detector: new StrokeDetector(),
      stamp: -1,
      x: new OneEuro(GRIP_FILTER),
      y: new OneEuro(GRIP_FILTER),
      turn: new OneEuro(TURN_FILTER),
      shown: 0,
      lastSeen: -1e9,
      size: 0,
      palm: 0,
    },
  });

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.1);
    const { aspect, scale } = drums;
    const cam = camera as PerspectiveCamera;
    // World units per screen height on the stick's plane.
    const worldPerScreen =
      2 * Math.tan(((cam.fov / 2) * Math.PI) / 180) * cam.position.z;

    // Now and then both hands are found on the same real hand: keep the
    // surer one so a hand never holds two sticks.
    const both = {
      left: node?.poses?.left ?? null,
      right: node?.poses?.right ?? null,
    };
    if (both.left && both.right) {
      const a = both.left.image[9];
      const b = both.right.image[9];
      const span = Math.hypot(
        both.left.image[0].x - a.x,
        (both.left.image[0].y - a.y) / aspect,
      );
      if (Math.hypot(a.x - b.x, (a.y - b.y) / aspect) < span * 0.6) {
        if (both.left.score < both.right.score) both.left = null;
        else both.right = null;
      }
    }

    SIDES.forEach((side) => {
      const st = state.current[side];
      const g = groups.current[side];
      const tip = tips[side];
      const fake = devHands[side];
      const pose = both[side];

      // This frame's reading: grip (tracker units), palm length, hand turn.
      let reading: {
        gx: number;
        gy: number;
        palm: number;
        turn: number;
        stamp: number;
      } | null = null;
      if (fake !== undefined) {
        if (fake)
          reading = {
            gx: fake.x,
            gy: fake.y,
            palm: fake.palm,
            turn: 0,
            stamp: fake.stamp,
          };
      } else if (pose && !pose.held) {
        const img = pose.image;
        let gx = 0;
        let gy = 0;
        FIST.forEach((i) => {
          gx += img[i].x;
          gy += img[i].y;
        });
        gx /= FIST.length;
        gy /= FIST.length;
        // The hand's size: wrist to knuckles, or across the knuckles when
        // the hand is seen end-on.
        const d = (a: number, b: number) =>
          Math.hypot(
            (img[a].x - img[b].x) * 0.5 * aspect,
            (img[a].y - img[b].y) * 0.5,
          );
        const palm = Math.max(d(0, 9), d(5, 17) * 1.15);
        // The hand's sideways turn: wrist to knuckles, in 3D.
        const w = pose.world;
        const fx = (w[5].x + w[9].x) / 2 - w[0].x;
        const fy = (w[5].y + w[9].y) / 2 - w[0].y;
        const fz = (w[5].z + w[9].z) / 2 - w[0].z;
        const len = Math.hypot(fx, fy, fz) || 1;
        const turn = Math.max(-0.8, Math.min(0.8, fx / len));
        reading = { gx, gy, palm, turn, stamp: pose.timestampMs };
      }

      const nowMs = performance.now();
      if (!reading) {
        if (nowMs - st.lastSeen > 250) {
          st.detector.reset();
          st.x.reset();
          st.y.reset();
          st.turn.reset();
          st.palm = 0;
        }
        tip.present = false;
        st.shown = Math.max(0, st.shown - dt * SHOW_RATE);
      } else {
        st.lastSeen = nowMs;
        st.shown = Math.min(1, st.shown + dt * SHOW_RATE);
        const fresh = reading.stamp !== st.stamp;
        // The stick's size from the hand's, eased (hands look jumpy in size).
        const want = Math.min(
          scale * STICK_RANGE[1],
          Math.max(
            scale * STICK_RANGE[0],
            (STICK_PALMS * (st.palm || reading.palm) * worldPerScreen) / LENGTH,
          ),
        );
        st.size = st.size
          ? st.size + (want - st.size) * (1 - Math.exp(-3 * dt))
          : want;
        if (fresh) {
          // A hand's size changes slowly; one reading can be far off.
          const p = Math.max(MIN_PALM, reading.palm);
          st.palm = st.palm
            ? st.palm + (p - st.palm) * (p > st.palm ? 0.35 : 0.12)
            : p;
          st.stamp = reading.stamp;
          const t = reading.stamp / 1000;
          const turn = st.turn.filter(reading.turn, t);
          st.x.filter(reading.gx, t);
          st.y.filter(reading.gy, t);
          // The raw tip on screen, for the hit.
          point.x = reading.gx;
          point.y = reading.gy;
          trackerToWorld(point, camera, grip3, 0);
          stickDirection(reading.gx, turn, dir3);
          tip3
            .copy(grip3)
            .addScaledVector(dir3, TIP * st.size)
            .project(camera);
          const tx = tip3.x * 0.5 * aspect;
          const ty = tip3.y * 0.5;
          const hit = st.detector.push(
            { t, x: tx, y: ty, palm: st.palm },
            drums.stickZones,
          );
          if (hit) strike(hit.piece, hit.velocity, side);
          readings.push({
            side,
            t: Math.round(reading.stamp),
            gx: +reading.gx.toFixed(3),
            gy: +reading.gy.toFixed(3),
            palm: +reading.palm.toFixed(3),
            tx: +tx.toFixed(3),
            ty: +ty.toFixed(3),
            speed: +st.detector.speed.toFixed(1),
          });
          if (readings.length > 400) readings.shift();
          tip.present = true;
          tip.x = tx;
          tip.y = ty;
          tip.speed = st.detector.speed;
        }
      }

      // The stick on screen (filtered grip).
      if (!g) return;
      g.visible = st.shown > 0.01 && st.x.ready;
      if (!g.visible) return;
      point.x = st.x.value;
      point.y = st.y.value;
      trackerToWorld(point, camera, grip3, 0);
      stickDirection(st.x.value, st.turn.value, dir3);
      g.position.copy(grip3);
      g.quaternion.copy(q.setFromUnitVectors(up3, dir3));
      g.scale.setScalar(st.size * (0.6 + 0.4 * st.shown));
    });

    // The hi-hat: sticks resting on it (and a held pointer) close it.
    hatChanged(
      drums.hihat.update(
        performance.now() / 1000,
        [tips.left, tips.right, drums.pointer],
        drums.zones.find((z) => z.id === "hihat") ?? null,
      ),
    );
  });

  return (
    <>
      <HandTracker targetFps={HAND_FPS} />
      {SIDES.map((side) => (
        <group
          key={side}
          ref={(g) => {
            groups.current[side] = g;
          }}
          visible={false}
        >
          <primitive object={models[side]} />
        </group>
      ))}
    </>
  );
};

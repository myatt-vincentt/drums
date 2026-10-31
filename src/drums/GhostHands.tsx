// Your hands, as two ghost hands holding drumsticks over the kit.
//
// Each tracked hand steers its ghost (your left hand the ghost on the
// hi-hat side): where your hand is on the camera picture is where the stick
// aims on the kit as seen from the seat (see aim.ts), and a quick move down
// swings the stick down onto the head it was over. The stick pivots in the
// ghost's grip, so a stroke visibly whacks the head; at the hit it touches
// the head even if the camera is a moment behind.
//
// Hits: a fast downward stroke plays the aimed piece at the start of the
// stroke, louder for faster strokes, once per stroke (hits.ts). A stick
// resting still on the hi-hat closes it (hihat.ts).
//
// With no hand in view the ghosts rest over the hi-hat and the snare, and a
// tap on a piece swings the nearer one onto it (PointerInput.tsx).
import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import { HandTracker } from "@vincentt-xr/sdk/tracking";
import { XRModel } from "@vincentt-xr/sdk";
import {
  useXRModelNode,
  type XRModelNodeHandTracking,
} from "@vincentt-xr/sdk/low-level";
import {
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Ray,
  Vector3,
  type Object3D,
} from "three";
// eslint-disable-next-line import/extensions
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";

import { aimAlong, AimHold, type Aim } from "./aim";
import { ghostMaterial, placeGhost, readGhost, type Ghost } from "./ghost";
import type { HatInput } from "./hihat";
import { whack, WHACK_LENGTH } from "./fx";
import { StrokeDetector } from "./hits";
import { dressModel } from "./look";
import { MODELS } from "./models";
import { STICK_PIECES, type PieceId } from "./pieces";
import { drums, hatChanged, headOf, strike } from "./state";

useGLTF.preload(MODELS.ghostLeft);
useGLTF.preload(MODELS.ghostRight);

/** Hand readings per second: strokes are quick, so more than usual. */
const HAND_FPS = 30;
/** The tip hovers this far above the head between strokes (m). */
const HOVER = 0.16;
/** Over a cymbal the tip hovers lower, so the hand stays near it. */
const HOVER_CYMBAL = 0.07;
/** The stick's slope at rest, tip lower than the hand (radians). */
const REST_SLOPE = 0.55;
/**
 * Where each hand comes from: out to the side and behind, so the sticks
 * angle in towards the kit like a drummer's and show their length from the
 * seat.
 */
const ANCHOR = {
  left: new Vector3(0.32, 1.1, -0.7),
  right: new Vector3(-0.32, 1.1, -0.7),
};
/** How far the sticks angle in across the kit (share of forward). */
const INWARD = 0.5;
/** The hands never drop below this (m): above the drums, in view from the seat. */
const GRIP_MIN_Y = 0.92;
/**
 * The hand keeps clear of every piece: never within this distance of a
 * head's or cymbal's rim sideways (m)…
 */
const CLEAR_SIDE = 0.07;
/** …unless it is at least this high above it (m). Stands sit under them. */
const CLEAR_UP = 0.13;
/** Cymbals are played near the edge on your side (share of the radius). */
const CYMBAL_EDGE = 0.5;
/** With no head aimed at, the aim stays over the kit (m, around its middle). */
const AIR = { x: 0.7, zNear: -0.45, zFar: 0.15 };
/** Where each ghost rests with no hand in view. */
const REST: Record<Side, PieceId> = { left: "snare", right: "tom2" };
/**
 * The part of the camera picture your hands play in (tracker units, x right,
 * y up), stretched over the kit as seen from the seat.
 */
const HAND_BOX = { x0: -0.75, x1: 0.75, y0: -0.75, y1: 0.25 };
/** The kit's playing area is widened by this share on each side. */
const KIT_PAD = 0.18;
/** A tap's swing down to the head (s); then the whack and rebound (fx.ts). */
const SWING_DOWN = 0.05;
/** The wrist's part in a stroke: from this tilt (rad), full over this, at most this much. */
const WRIST = { from: 0.08, full: 0.5, most: 0.6 };
/** The smallest hand size used for speeds (screen heights). */
const MIN_PALM = 0.045;
/** Follow rate of the drawn aim point (1/s). */
const DRAW_FOLLOW = 22;

type Side = "left" | "right";
const SIDES: Side[] = ["left", "right"];

type GhostState = {
  ghost: Ghost | null;
  detector: StrokeDetector;
  hold: AimHold;
  aim: Aim;
  /** The drawn aim point and normal (eased). */
  point: Vector3;
  normal: Vector3;
  stamp: number;
  lastSeen: number;
  tracked: boolean;
  palm: number;
  /** A tap's swing at a piece. */
  swing: {
    piece: PieceId;
    point: Vector3;
    at: number;
    velocity: number;
  } | null;
  /** performance.now() of the last hit (the whack). */
  hitAt: number;
  hitV: number;
  hat: HatInput;
  /** The wrist's tilt (knuckles up, radians) and its slow average. */
  tilt: number;
  tiltBase: number;
  /** The hand on the camera picture (0..1, v down), and how shown (0..1). */
  u: number;
  v: number;
  shown: number;
};

/** Development only: where each ghost rests instead (a piece), and a stroke. */
export const devRest: Partial<Record<Side, PieceId>> = {};
export const devStroke: Partial<Record<Side, number>> = {};

/** Development only: pretend hands (tracker units, palm in screen heights). */
export const devHands: Partial<
  Record<Side, { x: number; y: number; palm: number; stamp: number } | null>
> = {};

const newState = (side: Side): GhostState => ({
  ghost: null,
  detector: new StrokeDetector(),
  hold: new AimHold(),
  aim: {
    piece: null,
    point: new Vector3(),
    normal: new Vector3(0, 1, 0),
    reach: 0,
  },
  point: new Vector3(),
  normal: new Vector3(0, 1, 0),
  stamp: -1,
  lastSeen: -1e9,
  tracked: false,
  palm: 0,
  swing: null,
  hitAt: -1e9,
  hitV: 0,
  hat: { id: side, present: false, x: 0, y: 0, speed: 0 },
  tilt: 0,
  tiltBase: Number.NaN,
  u: 0.5,
  v: 0.5,
  shown: 0,
});

export const ghosts: Record<Side, GhostState> = {
  left: newState("left"),
  right: newState("right"),
};

/** A tap on a piece: the nearer ghost swings onto it. */
export const swingAt = (piece: PieceId, point: Vector3, velocity = 0.7) => {
  const now = performance.now();
  const dist = (s: Side) => ghosts[s].point.distanceTo(point);
  let side: Side = dist("left") <= dist("right") ? "left" : "right";
  const other: Side = side === "left" ? "right" : "left";
  // Quick taps alternate hands, like a roll.
  const busy = ghosts[side].swing && now - ghosts[side].swing!.at < 120;
  if (busy) side = other;
  ghosts[side].swing = { piece, point: point.clone(), at: now, velocity };
};

const ease = (t: number) => 1 - (1 - Math.min(1, Math.max(0, t))) ** 3;

const ray = new Ray();
const stickHeads: typeof drums.heads = [];
const tmp = new Vector3();
const flat = new Vector3();
const dir = new Vector3();
const grip = new Vector3();
const back = new Vector3();
const proj = new Vector3();
const aimTarget = new Vector3();
const hitPoint = new Vector3();
const tipNow = new Vector3();
/** The stick's trail: copies, their colour and opacities, and the tip speeds (m/s) it shows from and is full at. */
const TRAIL = {
  copies: 3,
  color: "#f3dcb8",
  opacity: [0.32, 0.18, 0.08],
  from: 1.6,
  full: 3,
};

/** The kit's playing area on the seat's view (NDC box of the stick pieces). */
const kitBox = { x0: -0.6, x1: 0.6, y0: -0.8, y1: 0.1 };
const updateKitBox = () => {
  const { seat } = drums;
  if (!seat) return;
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  drums.heads.forEach((h) => {
    if (!STICK_PIECES.includes(h.id)) return;
    proj.copy(h.center).project(seat);
    x0 = Math.min(x0, proj.x);
    x1 = Math.max(x1, proj.x);
    y0 = Math.min(y0, proj.y);
    y1 = Math.max(y1, proj.y);
  });
  if (!Number.isFinite(x0)) return;
  const px = (x1 - x0) * KIT_PAD;
  const py = (y1 - y0) * KIT_PAD;
  Object.assign(kitBox, { x0: x0 - px, x1: x1 + px, y0: y0 - py, y1: y1 + py });
};

/** Tracker point → the seat view (NDC), and its scale (NDC per tracker unit). */
const toSeat = (gx: number, gy: number) => {
  const sx = (kitBox.x1 - kitBox.x0) / (HAND_BOX.x1 - HAND_BOX.x0);
  const sy = (kitBox.y1 - kitBox.y0) / (HAND_BOX.y1 - HAND_BOX.y0);
  return {
    x: kitBox.x0 + (gx - HAND_BOX.x0) * sx,
    y: kitBox.y0 + (gy - HAND_BOX.y0) * sy,
    sy,
  };
};

/** The aim through a point of the seat's view. */
/* eslint-disable no-param-reassign */
const aimFrom = (x: number, y: number, out: Aim) => {
  const { seat } = drums;
  if (!seat) return out;
  ray.origin.setFromMatrixPosition(seat.matrixWorld);
  ray.direction.set(x, y, 0.5).unproject(seat).sub(ray.origin).normalize();
  stickHeads.length = 0;
  drums.heads.forEach((h) => {
    if (STICK_PIECES.includes(h.id)) stickHeads.push(h);
  });
  aimAlong(ray, stickHeads, out);
  // In the air: stay over the kit.
  if (!out.piece) {
    out.point.x = Math.max(-AIR.x, Math.min(AIR.x, out.point.x));
    out.point.z = Math.max(AIR.zNear, Math.min(AIR.zFar, out.point.z));
  }
  return out;
};
/* eslint-enable no-param-reassign */

const probe = new Vector3();
const tipAt = new Vector3();

/** How far a point must rise to clear every piece (m). */
const liftToClear = (p: Vector3) => {
  let lift = 0;
  drums.heads.forEach((h) => {
    if (h.id === "kick") return;
    const side = Math.hypot(p.x - h.center.x, p.z - h.center.z);
    if (side > h.radius + CLEAR_SIDE) return;
    lift = Math.max(lift, h.center.y + CLEAR_UP - p.y);
  });
  return lift;
};

/**
 * Poses a ghost: the stick's tip over the aim point (hovering, or down on
 * the head through a stroke), the hand behind and above, clear of the kit.
 * The stick pivots in the hand, so strokes never move the hand into a drum.
 */
const poseStick = (st: GhostState, side: Side, stroke: number) => {
  const g = st.ghost;
  if (!g) return;
  const L = g.tipLength;
  // The tip at rest, hovering over the aim point.
  const cymbal =
    st.aim.piece === "hihat" ||
    st.aim.piece === "crash" ||
    st.swing?.piece === "hihat" ||
    st.swing?.piece === "crash";
  const hover = cymbal ? HOVER_CYMBAL : HOVER;
  const rest = tmp.copy(st.point).addScaledVector(st.normal, hover);
  flat.copy(rest).sub(ANCHOR[side]);
  flat.y = 0;
  if (flat.lengthSq() < 1e-6) flat.set(0, 0, 1);
  flat.normalize();
  // Angled in across the kit (the hands sit out to the sides), so the
  // sticks cross the view and show their length from the seat.
  // Less so out on the hand's own side (the hi-hat, the crash), so those
  // hands stay in view.
  const own = Math.max(0, (side === "left" ? rest.x : -rest.x) - 0.05);
  const inward = INWARD * Math.max(0.15, 1 - own / 0.4);
  flat.x += side === "left" ? -inward : inward;
  flat.normalize();
  // The grip: a stick's length back from the resting tip, at least the
  // resting slope above it and never low; raised further where it would
  // touch a piece (the grip, the fist behind it and the wrist).
  let gripY = Math.max(rest.y + L * Math.sin(REST_SLOPE), GRIP_MIN_Y);
  for (let i = 0; i < 3; i += 1) {
    const drop = Math.min(L * 0.97, gripY - rest.y);
    const reach = Math.sqrt(L * L - drop * drop);
    grip.copy(rest).addScaledVector(flat, -reach);
    grip.y = gripY;
    dir.copy(rest).sub(grip).normalize();
    let lift = 0;
    [0, 0.05, 0.1].forEach((back0) => {
      probe.copy(grip).addScaledVector(dir, -back0);
      lift = Math.max(lift, liftToClear(probe));
    });
    if (lift <= 0.001) break;
    gripY += lift;
  }
  // The stroke: the hand comes down a little (never into a piece)…
  const handDrop =
    Math.max(0, grip.y - (st.point.y + 0.8 * L)) * Math.min(1, stroke);
  if (handDrop > 0) {
    grip.y -= handDrop;
    let clear = 0;
    [0, 0.05, 0.1].forEach((back0) => {
      probe.copy(grip).addScaledVector(dir, -back0);
      clear = Math.max(clear, liftToClear(probe));
    });
    grip.y += clear;
  }
  // …and the stick swings down onto the aim point: it points at where the
  // tip must be, and the hand slides along it so the tip lands right there.
  tipAt
    .copy(st.point)
    .addScaledVector(
      st.normal,
      hover * (1 - Math.min(1, stroke)) - 0.004 * Math.max(0, stroke - 1),
    );
  dir.copy(tipAt).sub(grip).normalize();
  grip.copy(tipAt).addScaledVector(dir, -L);
  // Palms down, the backs of the hands turned a little outwards.
  back.set(side === "left" ? 0.45 : -0.45, 1, 0).normalize();
  placeGhost(g, grip, dir, back);
};

/** Where on a piece the stick aims: cymbals near the edge on your side. */
const playPoint = (
  piece: PieceId | null,
  side: Side,
  point: Vector3,
  out: Vector3,
) => {
  out.copy(point);
  if (piece !== "hihat" && piece !== "crash") return out;
  const h = headOf(piece);
  if (!h) return out;
  flat.copy(ANCHOR[side]).sub(h.center);
  flat.y = 0;
  flat.normalize();
  return out.copy(h.center).addScaledVector(flat, h.radius * CYMBAL_EDGE);
};

export const GhostHands = () => {
  const node = useXRModelNode<XRModelNodeHandTracking>(XRModel.HAND_TRACKER);
  const leftGltf = useGLTF(MODELS.ghostLeft);
  const rightGltf = useGLTF(MODELS.ghostRight);
  const models = useMemo(() => {
    const look = ghostMaterial();
    // Skinned (posed in the model), so cloned with their skeletons.
    const make = (scene: Object3D) => {
      const root = cloneSkinned(scene);
      dressModel(root, false);
      return readGhost(root, look);
    };
    const out = { left: make(leftGltf.scene), right: make(rightGltf.scene) };
    ghosts.left.ghost = out.left;
    ghosts.right.ghost = out.right;
    return out;
  }, [leftGltf, rightGltf]);
  const started = useRef(false);
  // The stick's motion trail: faint copies at its last few places, shown
  // only while it moves fast (a stroke).
  const trails = useMemo(() => {
    const make = (g: Ghost) => {
      const stick = g.root.getObjectByName("Drumstick") as Mesh | undefined;
      const tip = g.root.getObjectByName("Drumstick_Tip");
      const copies = Array.from({ length: TRAIL.copies }, () => {
        const m = new Mesh(
          stick?.geometry,
          new MeshBasicMaterial({
            color: TRAIL.color,
            transparent: true,
            opacity: 0,
            depthWrite: false,
          }),
        );
        m.matrixAutoUpdate = false;
        m.frustumCulled = false;
        m.visible = false;
        return m;
      });
      return {
        stick,
        tip,
        copies,
        past: Array.from({ length: TRAIL.copies + 1 }, () => new Matrix4()),
        lastTip: new Vector3(),
        speed: 0,
        filled: 0,
      };
    };
    return { left: make(models.left), right: make(models.right) };
  }, [models]);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.1);
    if (!drums.seat || drums.heads.length === 0) return;
    updateKitBox();
    const nowMs = performance.now();
    const { aspect } = drums;

    SIDES.forEach((side) => {
      const st = ghosts[side];
      const fake = devHands[side];
      const pose = node?.poses?.[side] ?? null;
      let reading: {
        gx: number;
        gy: number;
        palm: number;
        stamp: number;
        tilt: number;
      } | null = null;
      if (fake !== undefined) {
        if (fake)
          reading = {
            gx: fake.x,
            gy: fake.y,
            palm: fake.palm,
            stamp: fake.stamp,
            tilt: 0,
          };
      } else if (pose && !pose.held) {
        const img = pose.image;
        let gx = 0;
        let gy = 0;
        [2, 5, 9, 13, 17].forEach((i) => {
          gx += img[i].x;
          gy += img[i].y;
        });
        const d = (a: number, b: number) =>
          Math.hypot(
            (img[a].x - img[b].x) * 0.5 * aspect,
            (img[a].y - img[b].y) * 0.5,
          );
        reading = {
          gx: gx / 5,
          gy: gy / 5,
          palm: Math.max(d(0, 9), d(5, 17) * 1.15),
          stamp: pose.timestampMs,
          // Knuckles up or down: the wrist's part in a stroke.
          tilt: Math.atan2(
            pose.world[9].y - pose.world[0].y,
            Math.hypot(
              pose.world[9].x - pose.world[0].x,
              pose.world[9].z - pose.world[0].z,
            ),
          ),
        };
      }

      st.shown += ((reading ? 1 : 0) - st.shown) * (1 - Math.exp(-dt * 12));
      if (reading) {
        st.u = reading.gx * 0.5 + 0.5;
        st.v = 0.5 - reading.gy * 0.5;
        st.lastSeen = nowMs;
        st.tracked = true;
        if (reading.stamp !== st.stamp) {
          const prevStamp = st.stamp;
          st.stamp = reading.stamp;
          const p = Math.max(MIN_PALM, reading.palm);
          st.palm = st.palm
            ? st.palm + (p - st.palm) * (p > st.palm ? 0.35 : 0.12)
            : p;
          const t = reading.stamp / 1000;
          st.tilt = reading.tilt;
          st.tiltBase = Number.isNaN(st.tiltBase)
            ? reading.tilt
            : st.tiltBase + (reading.tilt - st.tiltBase) * 0.06;
          const seat = toSeat(reading.gx, reading.gy);
          const rdt =
            prevStamp > 0
              ? Math.min(0.2, (reading.stamp - prevStamp) / 1000)
              : 1 / 30;
          // Speeds in palm lengths, on the camera picture (screen heights).
          const hit = st.detector.push(
            {
              t,
              x: reading.gx * 0.5 * aspect,
              y: reading.gy * 0.5,
              palm: st.palm,
            },
            () => st.aim.piece,
          );
          st.hold.update(
            rdt,
            seat.x,
            seat.y,
            st.detector.speed,
            st.palm * 2 * seat.sy,
          );
          aimFrom(st.hold.x, st.hold.y, st.aim);
          if (hit) {
            st.hitAt = nowMs;
            st.hitV = hit.velocity;
            strike(
              hit.piece,
              hit.velocity,
              side,
              playPoint(hit.piece, side, st.aim.point, hitPoint),
            );
          }
        }
      } else if (nowMs - st.lastSeen > 250) {
        st.tracked = false;
        st.detector.reset();
        st.hold.reset();
        st.palm = 0;
        st.tiltBase = Number.NaN;
      }

      // Not tracked: rest over this side's piece.
      if (!st.tracked) {
        const h = headOf(devRest[side] ?? REST[side]);
        if (h) {
          st.aim.piece = h.id;
          st.aim.point.copy(h.center);
          st.aim.normal.copy(h.normal);
        }
      }

      // A tap's swing overrides the aim for a moment.
      let stroke = st.tracked ? st.hold.stroke : (devStroke[side] ?? 0);
      // A flick of the wrist (knuckles down) tips the stick down too.
      if (st.tracked && !Number.isNaN(st.tiltBase)) {
        const flick = Math.min(
          WRIST.most,
          Math.max(0, (st.tiltBase - st.tilt - WRIST.from) / WRIST.full),
        );
        stroke = Math.min(1.15, stroke + flick);
      }
      const target = playPoint(st.aim.piece, side, st.aim.point, aimTarget);
      const targetNormal = st.aim.normal;
      if (st.swing) {
        const e = (nowMs - st.swing.at) / 1000;
        if (e > SWING_DOWN + WHACK_LENGTH + 0.1) st.swing = null;
        else {
          const h = headOf(st.swing.piece);
          playPoint(st.swing.piece, side, st.swing.point, target);
          if (h) targetNormal.copy(h.normal);
          // Down onto the head, then the same whack and rebound as a stroke.
          stroke =
            e < SWING_DOWN
              ? ease(e / SWING_DOWN)
              : whack(e - SWING_DOWN, st.swing.velocity);
        }
      }
      // The whack: on a hit the tip meets the head, rebounds, then rests.
      const w = (nowMs - st.hitAt) / 1000;
      if (w < WHACK_LENGTH) stroke = whack(w, st.hitV);

      // Ease the drawn aim (snap on the first frame).
      const k = started.current ? 1 - Math.exp(-DRAW_FOLLOW * dt) : 1;
      st.point.lerp(target, st.swing ? Math.max(k, 0.6) : k);
      st.normal.lerp(targetNormal, k).normalize();
      poseStick(st, side, stroke);

      // The trail: how fast the tip moves, and the stick's last places.
      const tr = trails[side];
      if (tr.stick && tr.tip && st.ghost) {
        st.ghost.root.updateMatrixWorld(true);
        tr.tip.getWorldPosition(tipNow);
        const v = tr.filled
          ? tipNow.distanceTo(tr.lastTip) / Math.max(1e-3, dt)
          : 0;
        tr.speed += (v - tr.speed) * 0.5;
        tr.lastTip.copy(tipNow);
        for (let i = tr.past.length - 1; i > 0; i -= 1)
          tr.past[i].copy(tr.past[i - 1]);
        tr.past[0].copy(tr.stick.matrixWorld);
        tr.filled = Math.min(tr.past.length, tr.filled + 1);
        const shown = Math.min(
          1,
          Math.max(0, (tr.speed - TRAIL.from) / TRAIL.full),
        );
        tr.copies.forEach((m, i) => {
          /* eslint-disable no-param-reassign */
          m.visible = shown > 0.02 && tr.filled > i + 1;
          m.matrix.copy(tr.past[i + 1]);
          m.matrixWorldNeedsUpdate = true;
          (m.material as MeshBasicMaterial).opacity = shown * TRAIL.opacity[i];
          /* eslint-enable no-param-reassign */
        });
      }

      // For the hi-hat: the tip's place (across the kit, and its height).
      const hatHead = headOf("hihat");
      st.hat.present = st.tracked && !!hatHead;
      st.hat.x = st.point.x;
      st.hat.y = st.point.y + HOVER * (1 - stroke);
      st.hat.speed = st.detector.speed;
    });
    started.current = true;

    // The hi-hat: a stick (or held pointer) resting on it closes it.
    const hat = headOf("hihat");
    hatChanged(
      drums.hihat.update(
        nowMs / 1000,
        [ghosts.left.hat, ghosts.right.hat, drums.pointer],
        hat
          ? {
              id: "hihat",
              x: hat.center.x,
              y: hat.center.y,
              a: hat.radius,
              b: hat.radius * 0.5,
              angle: 0,
            }
          : null,
      ),
    );
  });

  return (
    <>
      <HandTracker targetFps={HAND_FPS} />
      <primitive object={models.left.root} />
      <primitive object={models.right.root} />
      {[...trails.left.copies, ...trails.right.copies].map((m) => (
        <primitive key={m.uuid} object={m} />
      ))}
    </>
  );
};

// Your hands, as two ghost hands holding drumsticks over the kit.
//
// Where your hand is on the camera picture picks the piece it aims at (see
// aim.ts: the cymbals up high, the drums below, over your own reach). The
// ghost's stick tip hovers over that piece and the piece glows softly, so
// you always see what you'll hit. A quick move down (a stroke) plays the
// aimed piece at the start of the stroke, louder for faster strokes, once
// per stroke (hits.ts); the stick whacks the head and rebounds. A stick
// resting still on the hi-hat closes it (hihat.ts).
//
// With no hand in view the ghosts rest over the snare and the floor tom,
// and a tap on a piece swings the nearer one onto it (PointerInput.tsx).
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
  Vector3,
  type Object3D,
} from "three";
// eslint-disable-next-line import/extensions
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";

import { HandAim, ReachBox, REGIONS, type Box, type StickPiece } from "./aim";
import { ghostMaterial, placeGhost, readGhost, type Ghost } from "./ghost";
import type { HatInput } from "./hihat";
import { whack, WHACK_LENGTH } from "./fx";
import { StrokeDetector, strokeUnit } from "./hits";
import { HandPairer, type Side } from "./pair";
import { handTracking } from "./tracking";
import { dressModel } from "./look";
import { MODELS } from "./models";
import type { PieceId } from "./pieces";
import { drums, hatChanged, headOf, strike, useDrumsVersion } from "./state";

useGLTF.preload(MODELS.ghostLeft);
useGLTF.preload(MODELS.ghostRight);

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
/** Where the hands can be (m): the drummer's reach over the kit. */
const HAND_SPACE = { x: 0.95, yMax: 1.45, zMax: 0.25 };
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
/** Where each ghost rests with no hand in view. */
const REST: Record<Side, PieceId> = { left: "snare", right: "tom2" };
/** Over a drum the tip wanders this far from the middle (share of the radius) with your hand. */
const WANDER = 0.35;
/** A tap's swing down to the head (s); then the whack and rebound (fx.ts). */
const SWING_DOWN = 0.05;
/** A stroke on its way down tips the stick this far (1 = on the head) at full speed. */
const WIND = 0.45;
/** Follow rate of the drawn aim point (1/s). */
const DRAW_FOLLOW = 22;
/** A hand not seen for this long (ms) is gone. */
const LOST_MS = 600;
/** The hand's place on the picture: the wrist and the four knuckles. */
const PALM = [0, 5, 9, 13, 17];

const SIDES: Side[] = ["left", "right"];

type GhostState = {
  ghost: Ghost | null;
  detector: StrokeDetector;
  aim: HandAim;
  /** The aimed piece (null with no hand in view). */
  piece: PieceId | null;
  /** The aim on the piece's head (world), before the cymbal edge. */
  target: Vector3;
  targetNormal: Vector3;
  /** The drawn aim point and normal (eased). */
  point: Vector3;
  normal: Vector3;
  /** The last reading's time (s) and when it came (performance.now()). */
  t: number;
  lastSeen: number;
  tracked: boolean;
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
  /** The hand on the camera picture (0..1, v down), and how shown (0..1). */
  u: number;
  v: number;
  shown: number;
  /** The hand's 21 points on the picture (u, v pairs), for the corner camera. */
  points: Float32Array;
};

/** Development only: where each ghost rests instead (a piece), and a stroke. */
export const devRest: Partial<Record<Side, PieceId>> = {};
export const devStroke: Partial<Record<Side, number>> = {};

/** Development only: pretend hands (tracker units: x right, y up, -1..1). */
export const devHands: Partial<
  Record<Side, { x: number; y: number; palm: number; stamp: number } | null>
> = {};

const newState = (side: Side): GhostState => ({
  ghost: null,
  detector: new StrokeDetector(),
  aim: new HandAim(),
  piece: null,
  target: new Vector3(),
  targetNormal: new Vector3(0, 1, 0),
  point: new Vector3(),
  normal: new Vector3(0, 1, 0),
  t: -1,
  lastSeen: -1e9,
  tracked: false,
  swing: null,
  hitAt: -1e9,
  hitV: 0,
  hat: { id: side, present: false, x: 0, y: 0, speed: 0 },
  u: 0.5,
  v: 0.5,
  shown: 0,
  points: new Float32Array(42),
});

export const ghosts: Record<Side, GhostState> = {
  left: newState("left"),
  right: newState("right"),
};

/** Your reach on the camera picture (the corner camera draws it). */
export const reach = new ReachBox();
export const reachBox: Box = reach.box();
const pairer = new HandPairer();

/** Development only: the hits by hand, with the hand's place (for testing). */
export const devTrace: Array<{
  t: number;
  side: Side;
  piece: PieceId;
  velocity: number;
  u: number;
  v: number;
}> = [];

/** A tap on a piece: the nearer ghost swings onto it. */
export const swingAt = (piece: PieceId, at: Vector3 | null, velocity = 0.7) => {
  const now = performance.now();
  // On the head, within its rim (kit space, whatever the view).
  const h = headOf(piece);
  const point = (at ?? h?.center ?? new Vector3()).clone();
  if (h) {
    point.sub(h.center);
    point.addScaledVector(h.normal, -point.dot(h.normal));
    if (point.length() > h.radius * 0.85) point.setLength(h.radius * 0.85);
    point.add(h.center);
  }
  const dist = (s: Side) => ghosts[s].point.distanceTo(point);
  let side: Side = dist("left") <= dist("right") ? "left" : "right";
  const other: Side = side === "left" ? "right" : "left";
  // Quick taps alternate hands, like a roll.
  const busy = ghosts[side].swing && now - ghosts[side].swing!.at < 120;
  if (busy) side = other;
  ghosts[side].swing = { piece, point, at: now, velocity };
};

const ease = (t: number) => 1 - (1 - Math.min(1, Math.max(0, t))) ** 3;

const tmp = new Vector3();
const flat = new Vector3();
const dir = new Vector3();
const grip = new Vector3();
const back = new Vector3();
const aimTarget = new Vector3();
const aimNormal = new Vector3();
const hitPoint = new Vector3();
const tipNow = new Vector3();
const side3 = new Vector3();
/** The stick's trail: copies, their colour and opacities, and the tip speeds (m/s) it shows from and is full at. */
const TRAIL = {
  copies: 3,
  color: "#f3dcb8",
  opacity: [0.32, 0.18, 0.08],
  from: 1.6,
  full: 3,
};

/**
 * The aim on a piece's head: its middle, moved a little with your hand
 * inside the piece's region, so the tip feels alive but never leaves it.
 */
const aimOnHead = (st: GhostState, piece: StickPiece) => {
  const h = headOf(piece);
  if (!h) return;
  const [x0, x1, y0, y1] = REGIONS[piece];
  const rx = Math.min(1, Math.max(0, (st.aim.x - x0) / (x1 - x0))) - 0.5;
  const ry = Math.min(1, Math.max(0, (st.aim.y - y0) / (y1 - y0))) - 0.5;
  // Across the kit (your left is +x from the seat) and far / near.
  side3.set(1, 0, 0).addScaledVector(h.normal, -h.normal.x).normalize();
  flat.crossVectors(side3, h.normal).normalize();
  st.target
    .copy(h.center)
    .addScaledVector(side3, -rx * 2 * WANDER * h.radius)
    .addScaledVector(flat, -ry * 2 * WANDER * h.radius);
  st.targetNormal.copy(h.normal);
};

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
    st.piece === "hihat" ||
    st.piece === "crash" ||
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
    const along = Math.sqrt(L * L - drop * drop);
    grip.copy(rest).addScaledVector(flat, -along);
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
  // Never out of the drummer's reach (and never towards the room).
  if (
    grip.z > HAND_SPACE.zMax ||
    grip.y > HAND_SPACE.yMax ||
    Math.abs(grip.x) > HAND_SPACE.x
  ) {
    grip.set(
      Math.max(-HAND_SPACE.x, Math.min(HAND_SPACE.x, grip.x)),
      Math.min(HAND_SPACE.yMax, grip.y),
      Math.min(HAND_SPACE.zMax, grip.z),
    );
    dir.copy(tipAt).sub(grip).normalize();
  }
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
  useDrumsVersion();
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
  const lastStamp = useRef({ ms: -1, t: -1 }).current;
  const fakeStamp = useRef<Partial<Record<Side, number>>>({}).current;
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
    const nowMs = performance.now();

    // This frame's new hand readings (picture u, v down; 21 points each).
    const readings: Array<{
      u: number;
      v: number;
      size: number;
      pts: ArrayLike<number> | null;
    }> = [];
    let stampMs = -1;
    if (devHands.left !== undefined || devHands.right !== undefined) {
      SIDES.forEach((side) => {
        const f = devHands[side];
        if (!f || f.stamp === fakeStamp[side]) return;
        fakeStamp[side] = f.stamp;
        stampMs = f.stamp;
        readings.push({
          u: f.x * 0.5 + 0.5,
          v: 0.5 - f.y * 0.5,
          size: 0,
          pts: null,
        });
      });
    } else if (drums.handsOn && node?.poses) {
      const { poses } = node;
      SIDES.forEach((side) => {
        const pose = poses[side];
        if (!pose || pose.held || pose.timestampMs <= lastStamp.ms) return;
        stampMs = Math.max(stampMs, pose.timestampMs);
        const img = pose.image;
        let u = 0;
        let v = 0;
        PALM.forEach((i) => {
          u += img[i].x * 0.5 + 0.5;
          v += 0.5 - img[i].y * 0.5;
        });
        const pts = new Float32Array(42);
        for (let i = 0; i < 21; i += 1) {
          pts[i * 2] = img[i].x * 0.5 + 0.5;
          pts[i * 2 + 1] = 0.5 - img[i].y * 0.5;
        }
        // The hand's size: wrist to middle knuckle (picture heights).
        const size = Math.hypot(
          (img[0].x - img[9].x) * 0.5,
          (img[0].y - img[9].y) * 0.5,
        );
        readings.push({ u: u / PALM.length, v: v / PALM.length, size, pts });
      });
    }
    if (stampMs > 0) {
      lastStamp.ms = stampMs;
      const t = stampMs / 1000;
      // Which hand is which: by where each was.
      const slot = pairer.update(t, readings);
      reach.relax(lastStamp.t > 0 ? t - lastStamp.t : 0);
      lastStamp.t = t;
      SIDES.forEach((side) => {
        const i = slot[side];
        if (i < 0) return;
        const st = ghosts[side];
        const r = readings[i];
        const rdt = st.t > 0 ? Math.min(0.2, t - st.t) : 1 / 30;
        st.t = t;
        st.u = r.u;
        st.v = r.v;
        if (r.pts) st.points.set(r.pts);
        else
          for (let k = 0; k < 21; k += 1) {
            st.points[k * 2] = r.u;
            st.points[k * 2 + 1] = r.v;
          }
        st.lastSeen = nowMs;
        st.tracked = true;
        reach.see(side, r.u, r.v, rdt);
        reach.box(reachBox);
        const h = strokeUnit(reachBox.v1 - reachBox.v0);
        // The stroke is read before the aim takes this reading, so a stroke
        // plays the piece aimed at just before it.
        const { piece } = st.aim;
        const hit = st.detector.push({
          t,
          x: (r.u - reachBox.u0) / h,
          y: (r.v - reachBox.v0) / h,
        });
        st.piece = st.aim.update(rdt, r.u, r.v, reachBox);
        aimOnHead(st, st.piece);
        const played = piece ?? st.piece;
        if (hit) {
          st.hitAt = nowMs;
          st.hitV = hit.velocity;
          if (piece !== st.piece) aimOnHead(st, played);
          strike(
            played,
            hit.velocity,
            side,
            playPoint(played, side, st.target, hitPoint),
          );
          if (import.meta.env.DEV) {
            devTrace.push({
              t: Math.round(nowMs),
              side,
              piece: played,
              velocity: Number(hit.velocity.toFixed(2)),
              u: Number(r.u.toFixed(3)),
              v: Number(r.v.toFixed(3)),
            });
            if (devTrace.length > 400) devTrace.shift();
          }
        }
      });
    }

    SIDES.forEach((side) => {
      const st = ghosts[side];
      const seen = st.tracked && nowMs - st.lastSeen <= LOST_MS;
      st.shown +=
        ((seen && nowMs - st.lastSeen < 150 ? 1 : 0) - st.shown) *
        (1 - Math.exp(-dt * 12));
      if (st.tracked && !seen) {
        st.tracked = false;
        st.detector.reset();
        st.aim.reset();
        reach.lose(side);
      }

      // Not tracked: rest over this side's piece.
      if (!st.tracked) {
        st.piece = null;
        const h = headOf(devRest[side] ?? REST[side]);
        if (h) {
          st.target.copy(h.center);
          st.targetNormal.copy(h.normal);
        }
      }
      const restPiece = st.tracked ? st.piece : (devRest[side] ?? REST[side]);

      // On the way down a stroke tips the stick (until the hit's whack).
      let stroke = st.tracked
        ? Math.min(WIND, Math.max(0, st.detector.down / 4))
        : (devStroke[side] ?? 0);
      // A tap's swing overrides the aim for a moment.
      const target = playPoint(restPiece, side, st.target, aimTarget);
      const targetNormal = aimNormal.copy(st.targetNormal);
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
      // (box heights/s → about palms/s)
      st.hat.speed = st.detector.speed * 3;
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
      {drums.started && drums.handsOn ? (
        <HandTracker targetFps={handTracking().targetFps} />
      ) : null}
      <primitive object={models.left.root} />
      <primitive object={models.right.root} />
      {[...trails.left.copies, ...trails.right.copies].map((m) => (
        <primitive key={m.uuid} object={m} />
      ))}
    </>
  );
};

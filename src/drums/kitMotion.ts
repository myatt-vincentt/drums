// How the kit moves when it is played (the pieces themselves; sound is in
// audio.ts). Every hit is scaled by its loudness:
//
//   - drum heads: a ripple ring spreads from where the stick lands and fades
//     in about 0.4 s (harder hits: bigger, faster rings), and the drum dips a
//     few millimetres and settles back
//   - kick: the beater swings into the head and the head pulses
//   - crash: it tilts and sways about its bell, dying away over about two
//     seconds, turning a little, with a brief bright shimmer on hard hits
//   - hi-hat: an open hit rattles and sways the top cymbal; a closed hit
//     ticks it; closing snaps the top down onto the bottom
import {
  Color,
  Group,
  Quaternion,
  Vector3,
  type Material,
  type Mesh,
  type MeshStandardMaterial,
  type Object3D,
} from "three";

import { dip, easeOut, pulse, wobble, wobbleLength } from "./fx";
import type { PieceId } from "./pieces";
import type { HitEvent } from "./state";

/** Ripples: deepest dent (m), how many at once per head, how long (s). */
const RIPPLE = { depth: 0.018, slots: 3, life: 0.45 };
/** A drum's dip at full loudness (m). */
const DIP_DEPTH = 0.003;
/** The crash: sway (rad at full loudness), its decay (s) and rate (Hz), turn (rad). */
const CRASH = { tilt: 0.13, tau: 0.42, freq: 2.1, turn: 0.12, shimmer: 0.55 };
/** The hi-hat's top: sway, decay, rate, rattle (m), tick (m). */
const HAT = { tilt: 0.05, tau: 0.16, freq: 6, rattle: 0.0012, tick: 0.0015 };
/** The hi-hat's top: how far it drops to close (m) and how fast (s). */
const HAT_DROP = 0.015;
const HAT_CLOSE = 0.05;
const HAT_OPEN = 0.14;
/** The kick beater: its hinge in the kick's frame, strike angle, in / back (s). */
const BEATER = {
  hinge: new Vector3(0, 0.128, -0.274),
  strike: 0.665,
  in: 0.045,
  out: 0.2,
};

const RIPPLE_GLSL = /* glsl */ `
uniform float uTime;
uniform vec4 uHits[${RIPPLE.slots}];
uniform float uAmp[${RIPPLE.slots}];
uniform float uMetres;
uniform float uRadius;
// The dent (local units, into the drum) at a point of the head.
float ripDent(vec3 p) {
  float rip = 0.0;
  for (int i = 0; i < ${RIPPLE.slots}; i++) {
    float age = uTime - uHits[i].w;
    if (age < 0.0 || age > ${RIPPLE.life.toFixed(2)} || uAmp[i] <= 0.0) continue;
    float d = length(p - uHits[i].xyz) * uMetres;
    float front = age * (0.7 + 0.9 * uAmp[i]);
    float x = (d - front) / 0.028;
    float y = (d - front + 0.055) / 0.028;
    float ring = exp(-x * x) - 0.45 * exp(-y * y);
    rip += uAmp[i] * ring * (1.0 - smoothstep(0.0, ${RIPPLE.life.toFixed(2)}, age)) * exp(-d * 3.5);
  }
  rip *= 1.0 - smoothstep(0.8, 0.98, length(p) / uRadius);
  return rip * ${RIPPLE.depth.toFixed(4)} / uMetres;
}
`;

type RippleHead = {
  mesh: Mesh;
  u: {
    uTime: { value: number };
    uHits: { value: Vector3[] | Float32Array };
    uAmp: { value: number[] };
    uMetres: { value: number };
    uRadius: { value: number };
  };
  hits: Float32Array;
  next: number;
  /** The head's normal in its own frame. */
  normal: Vector3;
};

/** A head material that ripples (one per head: each has its own hits). */
const rippleMaterial = (base: Material, u: RippleHead["u"]) => {
  const m = base.clone();
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    // eslint-disable-next-line no-param-reassign
    shader.vertexShader = `${RIPPLE_GLSL}\n${shader.vertexShader}`
      .replace(
        "#include <beginnormal_vertex>",
        `#include <beginnormal_vertex>
        {
          // Tilt the normal with the ripple, so the ring catches the light.
          vec3 rn = normalize(objectNormal);
          vec3 ra = abs(rn.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
          vec3 t1 = normalize(cross(rn, ra));
          vec3 t2 = cross(rn, t1);
          float e = 0.01 / uMetres;
          float gx = (ripDent(position + t1 * e) - ripDent(position - t1 * e)) / (2.0 * e);
          float gy = (ripDent(position + t2 * e) - ripDent(position - t2 * e)) / (2.0 * e);
          objectNormal = normalize(rn + gx * t1 + gy * t2);
        }`,
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        transformed -= normalize(normal) * ripDent(position);`,
      );
  };
  m.customProgramCacheKey = () => "drums-ripple";
  return m;
};

type Sway = { at: number; amp: number; axis: Vector3 };

export type KitParts = {
  root: Object3D;
  /** Each drum's group and its resting place (for the dip). */
  bodies: { id: PieceId; node: Object3D; rest: Vector3 }[];
};

const SHIMMER = new Color("#ffd27a");
const tmp = new Vector3();
const tmp2 = new Vector3();
const q = new Quaternion();
const q2 = new Quaternion();
const n3 = new Vector3();

export class KitMotion {
  private heads = new Map<PieceId, RippleHead[]>();

  private beater: Group | null = null;

  private crash: {
    pivot: Group;
    normal: Vector3;
    mats: MeshStandardMaterial[];
    turn: number;
  } | null = null;

  private crashSways: Sway[] = [];

  private hatTop: Object3D | null = null;

  private hatTopY = 0;

  private hatSways: Sway[] = [];

  private hatTicks: { at: number; amp: number }[] = [];

  private hat = { closed: false, from: 0, to: 0, at: -10, offset: 0 };

  private kickAt = -10;

  private dips = new Map<PieceId, { at: number; amp: number }>();

  private seq = 0;

  private shimmer = { at: -10, amp: 0 };

  constructor(root: Object3D) {
    root.updateMatrixWorld(true);
    // Rippling heads.
    (["Kick", "Snare", "Tom1", "Tom2"] as const).forEach((name) => {
      const id = name.toLowerCase() as PieceId;
      const list: RippleHead[] = [];
      root.getObjectByName(name)?.traverse((o) => {
        const mesh = o as Mesh;
        if (!mesh.isMesh || !mesh.name.endsWith("_Head")) return;
        const metres = mesh.getWorldScale(tmp).x;
        mesh.geometry.computeBoundingSphere();
        const radius = mesh.geometry.boundingSphere?.radius ?? 1;
        const hits = new Float32Array(RIPPLE.slots * 4).fill(-100);
        const u = {
          uTime: { value: 0 },
          uHits: { value: hits },
          uAmp: { value: new Array(RIPPLE.slots).fill(0) },
          uMetres: { value: metres },
          uRadius: { value: radius },
        };
        mesh.material = rippleMaterial(mesh.material as Material, u);
        // The head's normal in its own frame: the mesh's flattest axis.
        const box =
          mesh.geometry.boundingBox ??
          (mesh.geometry.computeBoundingBox(), mesh.geometry.boundingBox);
        const size = box ? box.getSize(new Vector3()) : new Vector3(1, 0, 1);
        const normal = new Vector3(
          size.x <= size.y && size.x <= size.z ? 1 : 0,
          size.y < size.x && size.y <= size.z ? 1 : 0,
          size.z < size.x && size.z < size.y ? 1 : 0,
        );
        list.push({ mesh, u, hits, next: 0, normal });
      });
      this.heads.set(id, list);
    });

    // The beater swings about its hinge: a pivot there, holding the beater.
    const kick = root.getObjectByName("Kick");
    const beaterMesh = root.getObjectByName("Kick_Beater");
    if (kick && beaterMesh) {
      this.beater = new Group();
      this.beater.name = "Kick_BeaterHinge";
      this.beater.position.copy(BEATER.hinge);
      kick.add(this.beater);
      root.updateMatrixWorld(true);
      this.beater.attach(beaterMesh);
    }

    // The crash sways about its bell: a pivot there, holding the cymbal.
    const crashGroup = root.getObjectByName("Crash");
    const crashCymbal = root.getObjectByName("Crash_Cymbal");
    const bell = root.getObjectByName("Crash_HitCenter");
    if (crashGroup && crashCymbal && bell) {
      const pivot = new Group();
      pivot.name = "Crash_Pivot";
      pivot.position.copy(bell.position);
      crashGroup.add(pivot);
      root.updateMatrixWorld(true);
      pivot.attach(crashCymbal);
      const normal = new Vector3(0, 1, 0).applyQuaternion(bell.quaternion);
      // Its own bronze (for the shimmer).
      const mats: MeshStandardMaterial[] = [];
      crashCymbal.traverse((o) => {
        const mesh = o as Mesh;
        if (!mesh.isMesh) return;
        const m = (mesh.material as MeshStandardMaterial).clone();
        mesh.material = m;
        mats.push(m);
      });
      this.crash = { pivot, normal, mats, turn: 0 };
    }

    this.hatTop = root.getObjectByName("HiHat_Top") ?? null;
    this.hatTopY = this.hatTop?.position.y ?? 0;
  }

  /** Where a hit lands on a head, in the head's own frame. */
  private ripple(id: PieceId, e: HitEvent, now: number) {
    this.heads.get(id)?.forEach((h) => {
      const local = e.point
        ? h.mesh.worldToLocal(tmp.copy(e.point))
        : tmp.set(0, 0, 0);
      // Onto the head's plane.
      local.addScaledVector(h.normal, -local.dot(h.normal));
      /* eslint-disable no-param-reassign */
      const i = h.next;
      h.next = (h.next + 1) % RIPPLE.slots;
      h.hits.set([local.x, local.y, local.z, now], i * 4);
      h.u.uAmp.value[i] = 0.35 + 0.65 * e.velocity;
      /* eslint-enable no-param-reassign */
    });
  }

  // eslint-disable-next-line class-methods-use-this
  private sway(
    list: Sway[],
    e: HitEvent,
    center: Object3D | null,
    normal: Vector3,
    amp: number,
  ) {
    // The side that is hit goes down first: tilt about (normal × towards the hit).
    const axis = new Vector3(1, 0, 0);
    if (e.point && center) {
      center.getWorldPosition(tmp2);
      tmp.copy(e.point).sub(tmp2);
      n3.copy(normal);
      tmp.addScaledVector(n3, -tmp.dot(n3));
      if (tmp.lengthSq() > 1e-8)
        axis.crossVectors(n3, tmp.normalize()).normalize();
    }
    list.push({ at: e.at, amp, axis });
    if (list.length > 3) list.shift();
  }

  update(
    now: number,
    events: readonly HitEvent[],
    hatClosed: boolean,
    bodies: KitParts["bodies"],
  ) {
    events.forEach((e) => {
      if (e.seq <= this.seq) return;
      this.seq = e.seq;
      const v = e.velocity;
      if (e.piece === "kick") {
        this.kickAt = e.at;
        this.ripple("kick", { ...e, point: null }, e.at);
      } else if (e.piece === "crash") {
        if (this.crash)
          this.sway(
            this.crashSways,
            e,
            this.crash.pivot,
            this.crash.normal,
            CRASH.tilt * v,
          );
        if (this.crash)
          this.crash.turn += CRASH.turn * v * (Math.random() > 0.5 ? 1 : -1);
        if (v > CRASH.shimmer) this.shimmer = { at: e.at, amp: v };
      } else if (e.piece === "hihat") {
        if (hatClosed) this.hatTicks.push({ at: e.at, amp: v });
        else
          this.sway(
            this.hatSways,
            e,
            this.hatTop,
            n3.set(0, 1, 0),
            HAT.tilt * v,
          );
        if (this.hatTicks.length > 3) this.hatTicks.shift();
      } else {
        this.ripple(e.piece, e, e.at);
      }
      if (e.piece !== "crash" && e.piece !== "hihat")
        this.dips.set(e.piece, { at: e.at, amp: v });
    });

    // Ripples: the shaders' clock.
    this.heads.forEach((list) =>
      list.forEach((h) => {
        // eslint-disable-next-line no-param-reassign
        h.u.uTime.value = now;
      }),
    );

    // Each drum dips along its head's normal and settles back.
    bodies.forEach(({ id, node, rest }) => {
      node.position.copy(rest);
      const d = this.dips.get(id);
      if (!d || id === "kick") return;
      const head = this.heads.get(id)?.[0];
      if (!head) return;
      n3.copy(head.normal).transformDirection(head.mesh.matrixWorld);
      node.position.addScaledVector(n3, -DIP_DEPTH * d.amp * dip(now - d.at));
    });

    // The kick's beater: forward to the head, then back.
    if (this.beater) {
      const e = now - this.kickAt;
      let a = 0;
      if (e < BEATER.in) a = BEATER.strike * easeOut(e / BEATER.in);
      else if (e < BEATER.in + BEATER.out)
        a = BEATER.strike * (1 - easeOut((e - BEATER.in) / BEATER.out));
      this.beater.rotation.x = a;
    }

    // The crash: sway, turn and shimmer.
    if (this.crash) {
      const c = this.crash;
      q.identity();
      this.crashSways.forEach((s) => {
        const t = now - s.at;
        if (t > wobbleLength(CRASH.tau)) return;
        q2.setFromAxisAngle(s.axis, s.amp * wobble(t, CRASH.tau, CRASH.freq));
        q.multiply(q2);
      });
      q2.setFromAxisAngle(c.normal, c.turn);
      c.pivot.quaternion.copy(q2).multiply(q);
      const sh = this.shimmer.amp * pulse(now - this.shimmer.at, 0.35);
      c.mats.forEach((m) => {
        m.emissive.copy(SHIMMER);
        // eslint-disable-next-line no-param-reassign
        m.emissiveIntensity = sh * 0.9;
      });
    }

    // The hi-hat's top: closing snaps down, opening lifts; hits sway or tick.
    if (this.hatTop) {
      const h = this.hat;
      if (hatClosed !== h.closed) {
        h.closed = hatClosed;
        h.from = h.offset;
        h.to = hatClosed ? -HAT_DROP : 0;
        h.at = now;
      }
      h.offset =
        h.from +
        (h.to - h.from) *
          easeOut((now - h.at) / (hatClosed ? HAT_CLOSE : HAT_OPEN));
      let y = h.offset;
      this.hatTicks.forEach((t) => {
        y -= HAT.tick * t.amp * pulse(now - t.at, 0.07);
      });
      q.identity();
      this.hatSways.forEach((s) => {
        const t = now - s.at;
        if (t > wobbleLength(HAT.tau)) return;
        q2.setFromAxisAngle(s.axis, s.amp * wobble(t, HAT.tau, HAT.freq));
        q.multiply(q2);
        y += ((HAT.rattle * s.amp) / HAT.tilt) * wobble(t, HAT.tau * 0.5, 22);
      });
      this.hatTop.position.y = this.hatTopY + y;
      this.hatTop.quaternion.copy(q);
    }
  }
}

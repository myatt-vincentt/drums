// The drum kit: a full 3D kit at the bottom of the screen, in front of you as
// if you were sitting behind it, seen from the front and a little above like
// a stage camera. It is mirrored like the selfie picture, so the hi-hat is on
// the same side as your left hand, and tipped towards the camera so the drum
// heads face you. It stays put (no body following), so the drums are always
// where you expect them.
//
// Each frame it also works out where every head is on screen (the zones the
// sticks and taps hit), swings the kick's beater when the kick plays and
// drops the hi-hat's top cymbal while the hats are closed.
import { useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import {
  Group,
  Vector3,
  type Mesh,
  type Object3D,
  type PerspectiveCamera,
} from "three";

import { fitKit } from "./fit";
import { ellipseFromRim, type Zone } from "./hits";
import { dressMaterial, studioEnvironment } from "./look";
import { PIECES, STICK_PIECES, type PieceId } from "./pieces";
import { drums } from "./state";

export const KIT_URL = "/models/drum-kit.glb";
useGLTF.preload(KIT_URL);

/** How far the kit is tipped towards the camera (radians). */
export const KIT_TILT = 0.42;
/** The kick beater's hinge in the kick's frame, and its strike angle. */
const BEATER_HINGE = new Vector3(0, -0.1903, -0.2353);
const BEATER_STRIKE = 0.631;
/** Beater: forward and back (s). */
const BEATER_IN = 0.045;
const BEATER_OUT = 0.2;
/**
 * The cymbals stand a little taller and further out than in the model, so on
 * screen they clear the drums below them (a stroke down to the floor tom or
 * the snare doesn't pass through a cymbal first). Their stands stretch to
 * match. `x` and `z` move the whole piece (model metres).
 */
const RAISE: Record<
  string,
  { by: number; top: number; stands: string[]; x: number; z: number }
> = {
  Crash: { by: 0.18, top: 0.9985, stands: ["Crash_Stand"], x: -0.06, z: -0.08 },
  HiHat: { by: 0.1, top: 0.8861, stands: ["HiHat_Stand"], x: 0.04, z: 0 },
};
/** How far the hi-hat's top drops to close (model metres). */
const HAT_DROP = 0.017;
/** Settle rates for the hi-hat's top (1/s): closing is quick. */
const HAT_CLOSE_RATE = 45;
const HAT_OPEN_RATE = 16;
/** How fast the kit settles into a new fitted size (1/s). */
const FIT_RATE = 8;
/** Points round each head's rim. */
const RIM = 16;
/** The sticks' zones are a little larger than the heads (easier to hit). */
const PAD = { a: 1.12, b: 1.3, minB: 0.42 };

const easeOut = (t: number) => 1 - (1 - Math.min(1, Math.max(0, t))) ** 3;

type Prepared = {
  root: Object3D;
  beater: Group | null;
  hatTop: Object3D | null;
  hatTopY: number;
  centers: { id: PieceId; node: Object3D; radius: number }[];
};

/** Clones the model once, dresses its materials and adds the beater's hinge. */
const prepare = (
  scene: Object3D,
  envMap: ReturnType<typeof studioEnvironment>,
): Prepared => {
  const root = scene.clone(true);
  root.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    mats.forEach((m) => dressMaterial(m, envMap));
  });
  // Taller cymbal stands.
  Object.entries(RAISE).forEach(([piece, { by, top, stands, x, z }]) => {
    const group = root.getObjectByName(piece);
    if (!group) return;
    group.position.x += x;
    group.position.z += z;
    const k = (top + by) / top;
    group.children.forEach((child) => {
      /* eslint-disable no-param-reassign */
      if (stands.includes(child.name)) {
        // Stretched up from the floor.
        child.position.y *= k;
        child.scale.y *= k;
      } else child.position.y += by;
      /* eslint-enable no-param-reassign */
    });
  });
  // The beater swings about its hinge: a pivot there, holding the beater.
  const kick = root.getObjectByName("Kick");
  const beaterMesh = root.getObjectByName("Kick_Beater");
  let beater: Group | null = null;
  if (kick && beaterMesh) {
    beater = new Group();
    beater.name = "Kick_BeaterHinge";
    beater.position.copy(BEATER_HINGE);
    kick.add(beater);
    root.updateMatrixWorld(true);
    beater.attach(beaterMesh);
  }
  const hatTop = root.getObjectByName("HiHat_Top") ?? null;
  const centers = PIECES.flatMap((p) => {
    const node = root.getObjectByName(p.hitCenter);
    return node ? [{ id: p.id, node, radius: p.radius }] : [];
  });
  return { root, beater, hatTop, hatTopY: hatTop?.position.y ?? 0, centers };
};

const c3 = new Vector3();
const n3 = new Vector3();
const u3 = new Vector3();
const w3 = new Vector3();
const p3 = new Vector3();
const rim = new Float32Array(RIM * 2);

export const Kit = () => {
  const { scene } = useGLTF(KIT_URL);
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const size = useThree((s) => s.size);
  const kit = useMemo(() => prepare(scene, studioEnvironment(gl)), [scene, gl]);
  const outer = useRef<Group>(null);
  const fit = useRef({ key: "", scale: 0, y: 0, nowScale: 0, nowY: 0 });
  const hatOffset = useRef(0);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.1);
    const g = outer.current;
    if (!g) return;
    const aspect = size.width / Math.max(1, size.height);
    drums.aspect = aspect;

    // Fit the kit to the screen (again after a resize or a turn).
    const f = fit.current;
    const key = `${size.width}x${size.height}:${camera.fov}`;
    if (key !== f.key) {
      f.key = key;
      const next = fitKit(camera, KIT_TILT);
      f.scale = next.scale;
      f.y = next.y;
      if (f.nowScale === 0) {
        f.nowScale = f.scale;
        f.nowY = f.y;
      }
    }
    const k = 1 - Math.exp(-FIT_RATE * dt);
    f.nowScale += (f.scale - f.nowScale) * k;
    f.nowY += (f.y - f.nowY) * k;
    g.position.set(0, f.nowY, 0);
    g.scale.setScalar(f.nowScale);
    drums.scale = f.nowScale;
    drums.root = kit.root;

    // The kick's beater: forward to the head, then back.
    if (kit.beater) {
      const e = (performance.now() - drums.hitAt.kick) / 1000;
      let a = 0;
      if (e < BEATER_IN) a = BEATER_STRIKE * easeOut(e / BEATER_IN);
      else if (e < BEATER_IN + BEATER_OUT)
        a = BEATER_STRIKE * (1 - easeOut((e - BEATER_IN) / BEATER_OUT));
      kit.beater.rotation.x = a;
    }

    // The hi-hat's top: down while closed.
    if (kit.hatTop) {
      const target = drums.hihat.closed ? -HAT_DROP : 0;
      const rate = drums.hihat.closed ? HAT_CLOSE_RATE : HAT_OPEN_RATE;
      hatOffset.current +=
        (target - hatOffset.current) * (1 - Math.exp(-rate * dt));
      kit.hatTop.position.y = kit.hatTopY + hatOffset.current;
    }

    // Every head on screen.
    g.updateMatrixWorld(true);
    const zones: Zone[] = [];
    const stickZones: Zone[] = [];
    kit.centers.forEach(({ id, node, radius }) => {
      node.getWorldPosition(c3);
      n3.set(0, 1, 0).transformDirection(node.matrixWorld);
      // Two directions across the head.
      u3.set(1, 0, 0);
      if (Math.abs(n3.x) > 0.9) u3.set(0, 0, 1);
      u3.cross(n3).normalize();
      w3.copy(n3).cross(u3).normalize();
      const r = radius * f.nowScale;
      for (let i = 0; i < RIM; i += 1) {
        const a = (i / RIM) * Math.PI * 2;
        p3.copy(c3)
          .addScaledVector(u3, Math.cos(a) * r)
          .addScaledVector(w3, Math.sin(a) * r)
          .project(camera);
        rim[i * 2] = p3.x * 0.5 * aspect;
        rim[i * 2 + 1] = p3.y * 0.5;
      }
      p3.copy(c3).project(camera);
      const z = ellipseFromRim(id, p3.x * 0.5 * aspect, p3.y * 0.5, rim);
      zones.push(z);
      if (STICK_PIECES.includes(id)) {
        const a = z.a * PAD.a;
        stickZones.push({ ...z, a, b: Math.max(z.b * PAD.b, a * PAD.minB) });
      }
    });
    drums.zones = zones;
    drums.stickZones = stickZones;
  }, -1);

  return (
    <>
      <group ref={outer} name="DrumKitRig">
        <group rotation-x={KIT_TILT}>
          {/* Mirrored like the selfie picture: the hi-hat on your left. */}
          <group scale={[-1, 1, 1]}>
            <primitive object={kit.root} />
          </group>
        </group>
      </group>
      {/* Key light from above the camera, and a soft fill from the side. */}
      <directionalLight position={[1.2, 3, 4]} intensity={1.6} />
      <directionalLight position={[-3, 1, 2]} intensity={0.5} />
    </>
  );
};

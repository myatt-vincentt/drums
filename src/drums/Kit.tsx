// The drum kit, a real kit in real order on the studio floor: from the
// drummer's seat the hi-hat and snare are on the left, the rack tom in the
// middle, the floor tom and crash on the right, the kick in front of you.
//
// On a tall phone screen the outer pieces move in towards the middle a
// little (layout.ts), each with its own stand. Each frame the kit also
// publishes where every head is (for the ghost sticks and taps), swings the
// kick's beater when the kick plays and drops the hi-hat's top cymbal while
// the hats are closed.
import { useMemo } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import { Box3, Group, Vector3, type Object3D } from "three";

import { pieceShift } from "./layout";
import { dressModel } from "./look";
import { MODELS } from "./models";
import { PIECES, type PieceId } from "./pieces";
import { drums, type Head } from "./state";

useGLTF.preload(MODELS.kit);

/** The kick beater's hinge in the kick's frame, and its strike angle. */
const BEATER_HINGE = new Vector3(0, 0.128, -0.274);
const BEATER_STRIKE = 0.631;
/** Beater: forward and back (s). */
const BEATER_IN = 0.045;
const BEATER_OUT = 0.2;
/** How far the hi-hat's top drops to close (m). */
const HAT_DROP = 0.017;
/** Settle rates for the hi-hat's top (1/s): closing is quick. */
const HAT_CLOSE_RATE = 45;
const HAT_OPEN_RATE = 16;

const easeOut = (t: number) => 1 - (1 - Math.min(1, Math.max(0, t))) ** 3;

type Movable = { id: PieceId; nodes: { node: Object3D; x: number }[] };

type Prepared = {
  root: Object3D;
  beater: Group | null;
  hatTop: Object3D | null;
  hatTopY: number;
  movable: Movable[];
  centers: { id: PieceId; node: Object3D; radius: number }[];
};

/** Clones the model once, dresses its materials and adds the beater's hinge. */
const prepare = (scene: Object3D): Prepared => {
  const root = scene.clone(true);
  dressModel(root);
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
  // Each piece moves with its stand (a stand kept with the hardware moves too).
  const hardware = root.getObjectByName("Hardware");
  const movable = PIECES.map((p) => {
    const nodes: Object3D[] = [];
    const group = root.getObjectByName(p.node);
    if (group) nodes.push(group);
    hardware?.children.forEach((c) => {
      if (c.name.startsWith(`${p.node}_`)) nodes.push(c);
    });
    return {
      id: p.id,
      nodes: nodes.map((node) => ({ node, x: node.position.x })),
    };
  });
  // Each head's size, measured on the model (the table is the fallback).
  root.updateMatrixWorld(true);
  const box = new Box3();
  const dims = new Vector3();
  const centers = PIECES.flatMap((p) => {
    const node = root.getObjectByName(p.hitCenter);
    if (!node) return [];
    const surface = root.getObjectByName(p.surface);
    let { radius } = p;
    if (surface) {
      box.setFromObject(surface).getSize(dims);
      const sorted = [dims.x, dims.y, dims.z].sort((a, b) => b - a);
      radius = sorted[1] / 2;
    }
    return [{ id: p.id, node, radius }];
  });
  return {
    root,
    beater,
    hatTop,
    hatTopY: hatTop?.position.y ?? 0,
    movable,
    centers,
  };
};

export const Kit = () => {
  const { scene } = useGLTF(MODELS.kit);
  const size = useThree((s) => s.size);
  const kit = useMemo(() => prepare(scene), [scene]);
  const heads = useMemo<Head[]>(
    () =>
      kit.centers.map((c) => ({
        id: c.id,
        center: new Vector3(),
        normal: new Vector3(),
        radius: c.radius,
      })),
    [kit],
  );
  const hat = useMemo(() => ({ offset: 0 }), []);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.1);
    const aspect = size.width / Math.max(1, size.height);
    drums.aspect = aspect;
    drums.root = kit.root;

    // The layout for this screen.
    kit.movable.forEach(({ id, nodes }) => {
      const dx = pieceShift(id, aspect);
      nodes.forEach(({ node, x }) => {
        // eslint-disable-next-line no-param-reassign
        node.position.x = x + dx;
      });
    });

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
      hat.offset += (target - hat.offset) * (1 - Math.exp(-rate * dt));
      kit.hatTop.position.y = kit.hatTopY + hat.offset;
    }

    // Every head in the scene.
    kit.root.updateMatrixWorld(true);
    kit.centers.forEach(({ node }, i) => {
      node.getWorldPosition(heads[i].center);
      heads[i].normal.set(0, 1, 0).transformDirection(node.matrixWorld);
    });
    drums.heads = heads;
  }, -2);

  return <primitive object={kit.root} />;
};

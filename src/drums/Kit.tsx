// The drum kit, a real kit in real order on the studio floor: from the
// drummer's seat the hi-hat and snare are on the left, the rack tom in the
// middle, the floor tom and crash on the right, the kick in front of you.
//
// On a tall phone screen the outer pieces move in towards the middle a
// little (layout.ts), each with its own stand. Each frame the kit also
// publishes where every head is (for the ghost sticks and taps) and moves as
// it is played (kitMotion.ts).
import { useMemo } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import { Box3, Vector3, type Object3D } from "three";

import { pieceShift } from "./layout";
import { KitMotion } from "./kitMotion";
import { dressModel } from "./look";
import { MODELS } from "./models";
import { PIECES, type PieceId } from "./pieces";
import { drums, type Head } from "./state";

useGLTF.preload(MODELS.kit);

type Movable = { id: PieceId; nodes: { node: Object3D; rest: Vector3 }[] };

type Prepared = {
  root: Object3D;
  motion: KitMotion;
  movable: Movable[];
  centers: { id: PieceId; node: Object3D; radius: number }[];
};

/** Clones the model once, dresses its materials and adds the beater's hinge. */
const prepare = (scene: Object3D): Prepared => {
  const root = scene.clone(true);
  dressModel(root);
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
      nodes: nodes.map((node) => ({ node, rest: node.position.clone() })),
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
  return { root, motion: new KitMotion(root), movable, centers };
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
  const bodies = useMemo(
    () =>
      kit.movable.flatMap(({ id, nodes }) =>
        nodes.map(({ node }) => ({ id, node, rest: new Vector3() })),
      ),
    [kit],
  );

  useFrame(() => {
    const aspect = size.width / Math.max(1, size.height);
    drums.aspect = aspect;
    drums.root = kit.root;

    // The layout for this screen, then the hits' motion on top.
    let b = 0;
    kit.movable.forEach(({ id, nodes }) => {
      const dx = pieceShift(id, aspect);
      nodes.forEach(({ rest }) => {
        bodies[b].rest.copy(rest);
        bodies[b].rest.x += dx;
        b += 1;
      });
    });
    kit.motion.update(
      performance.now() / 1000,
      drums.events,
      drums.hihat.closed,
      bodies,
    );

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
